// ─────────────────────────────────────────────────────────────────────────────
// Recoupement des commandes bloquees en `validated` avec la trace REELLE de la
// recharge, pour distinguer :
//   - LIVREE      : l'USSD a repondu OK, seul le statut n'a pas suivi (bug des chemins
//                   de validation manuels, cf. patch_delivered.py) -> a repasser livree
//   - ECHEC       : l'USSD a repondu ERREUR -> doit RESTER `validated` (reprise possible)
//   - A VERIFIER  : traces OK *et* ERREUR pour ce numero dans la meme periode
//   - INDETERMINE : aucune trace exploitable (logs tournes : retention pm2 = 7 jours)
//
// Source : les logs BIPBIPWEB eux-memes, seule source qui porte le NUMERO :
//   [USSD] ORANGE | 0705270900 | 1000 FCFA | OK
//   [USSD Forfait] ORANGE | 0789535809 | data orange_2_2_1 | OK
//   [CI backup] Reloadly topup OK cmd <ORDER_ID> op <id>        (porte l'id de commande)
// Le gateway, lui, ne garde que ses 100 dernieres transactions SANS numero ni orderId
// (/api/stats/transactions) : inutilisable pour ce recoupement.
//
// Usage (depuis /root/var/www/BIPBIPWEB) :
//   node reconcile_delivered.js            # rapport seul (aucune ecriture)
//   node reconcile_delivered.js --apply    # + repasse les LIVREE en credit/forfait_delivered
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const orderStorage = require('./storage');

const LOG_DIR = '/root/.pm2/logs';
const APPLY = process.argv.includes('--apply');
const LIST_IND = process.argv.includes('--list-indetermine');
const _ci = process.argv.indexOf('--close');
const CLOSE = _ci > -1 ? String(process.argv[_ci + 1] || '').trim() : '';

function normPhone(p) {
    const d = String(p || '').replace(/\D/g, '');
    return d.length > 10 ? d.slice(-10) : d;
}

// Copie conforme de getOrderBundleMeta (server.js) : forfait = bundleType data|mix.
function bundleMeta(order) {
    if (!order) return null;
    if (order.bundleType && order.bundleId) {
        const t = String(order.bundleType).toLowerCase();
        if (t === 'data' || t === 'mix') return { bundleType: t, bundleId: String(order.bundleId) };
    }
    if (order.notes && typeof order.notes === 'string') {
        try {
            const j = JSON.parse(order.notes);
            if (j && j.bundleType && j.bundleId) {
                const t = String(j.bundleType).toLowerCase();
                if (t === 'data' || t === 'mix') return { bundleType: t, bundleId: String(j.bundleId) };
            }
        } catch (_) { /* notes libre */ }
    }
    return null;
}

// ── 1) Fenetres couvertes par les fichiers de log ────────────────────────────
// pm2-logrotate nomme le fichier a l'instant de la rotation : son contenu s'arrete
// donc a sa propre mtime et commence a la rotation precedente.
function loadLogFiles() {
    const files = fs.readdirSync(LOG_DIR)
        .filter(f => /^BIPBIPWEB-out(__.*)?\.log(\.gz)?$/.test(f))
        .map(f => {
            const full = path.join(LOG_DIR, f);
            const isCurrent = f === 'BIPBIPWEB-out.log';
            return { name: f, full, isCurrent, end: isCurrent ? Date.now() : fs.statSync(full).mtimeMs };
        })
        .sort((a, b) => a.end - b.end);
    // Le plus ancien fichier n'a pas de borne basse connue : la rotation etant quotidienne
    // (rotateInterval 0 0 * * *), on lui donne 24 h de couverture. Sans cette borne il
    // avalait TOUT l'historique et attribuait a une commande de juillet une trace USSD
    // d'aout (meme numero, meme montant) — faux positif dangereux avec --apply.
    let prev = null;
    for (const f of files) { f.start = prev === null ? f.end - 24 * 3600 * 1000 : prev; prev = f.end; }
    return files;
}

function readLog(f) {
    const buf = fs.readFileSync(f.full);
    const txt = f.name.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
    return txt.split('\n');
}

// ── 2) Index des traces de livraison, par fichier ────────────────────────────
const RE_CREDIT = /\[USSD\]\s+(\S+)\s+\|\s+(\d+)\s+\|\s+(\d+)\s+FCFA\s+\|\s+(OK|ERREUR.*)$/;
const RE_FORFAIT = /\[USSD Forfait\]\s+(\S+)\s+\|\s+(\d+)\s+\|\s+(\S+)\s+(\S+)\s+\|\s+(OK|ERREUR.*)$/;
const RE_RELOADLY = /\[CI backup\] Reloadly topup OK cmd (\w+)/;

function indexLogs(files) {
    const reloadlyOk = new Set();
    for (const f of files) {
        f.entries = [];
        for (const line of readLog(f)) {
            let m = RE_CREDIT.exec(line);
            if (m) {
                f.entries.push({ kind: 'credit', phone: normPhone(m[2]), amount: Number(m[3]), ok: m[4] === 'OK', line: line.trim() });
                continue;
            }
            m = RE_FORFAIT.exec(line);
            if (m) {
                f.entries.push({ kind: 'forfait', phone: normPhone(m[2]), bundleId: m[4], ok: m[5] === 'OK', line: line.trim() });
                continue;
            }
            m = RE_RELOADLY.exec(line);
            if (m) reloadlyOk.add(m[1]);
        }
    }
    return reloadlyOk;
}

// ── 3) Verdict par commande ──────────────────────────────────────────────────
function verdictFor(order, files, reloadlyOk) {
    if (reloadlyOk.has(order.id)) {
        return { verdict: 'LIVREE', type: 'credit', why: 'Reloadly (secours CI) OK sur l\'id de commande' };
    }
    const t = new Date(order.validatedAt || order.validated_at || order.createdAt || 0).getTime();
    if (!t) return { verdict: 'INDETERMINE', why: 'pas de date de validation' };
    const f = files.find(x => t > x.start && t <= x.end);
    if (!f) return { verdict: 'INDETERMINE', why: 'hors fenetre de logs (retention 7 jours)' };

    const meta = bundleMeta(order);
    const ph = normPhone(order.phone);
    const hits = f.entries.filter(e => e.phone === ph && (
        meta ? (e.kind === 'forfait' && e.bundleId === meta.bundleId)
             : (e.kind === 'credit' && e.amount === Number(order.amount))
    ));
    if (!hits.length) return { verdict: 'INDETERMINE', why: 'aucune trace USSD dans ' + f.name };
    const ok = hits.filter(h => h.ok).length;
    const ko = hits.length - ok;
    if (ok && ko) return { verdict: 'A VERIFIER', why: ok + ' OK et ' + ko + ' ERREUR pour ce numero dans ' + f.name };
    if (ok) return { verdict: 'LIVREE', type: meta ? 'forfait' : 'credit', why: hits[0].line };
    return { verdict: 'ECHEC', why: hits[0].line };
}

// ── 4) Rapport ───────────────────────────────────────────────────────────────
(async () => {
    const files = loadLogFiles();
    if (!files.length) { console.error('Aucun log BIPBIPWEB-out dans ' + LOG_DIR); process.exit(1); }
    const reloadlyOk = indexLogs(files);
    const coverFrom = new Date(files[0].start).toISOString().slice(0, 16);
    console.log('Fenetre de logs exploitable : ' + coverFrom + ' -> maintenant  ('
        + files.length + ' fichiers, ' + files.reduce((n, f) => n + f.entries.length, 0) + ' traces USSD)');

    const all = await orderStorage.getValidatedOrders();
    const stuck = (all || []).filter(o => o.status === 'validated');
    console.log('Commandes bloquees en `validated` : ' + stuck.length + '\n');

    const buckets = { LIVREE: [], ECHEC: [], 'A VERIFIER': [], INDETERMINE: [] };
    for (const o of stuck) {
        const v = verdictFor(o, files, reloadlyOk);
        buckets[v.verdict].push({ o, v });
    }

    for (const k of ['LIVREE', 'ECHEC', 'A VERIFIER']) {
        if (!buckets[k].length) continue;
        console.log('── ' + k + ' (' + buckets[k].length + ') ' + '─'.repeat(40));
        for (const { o, v } of buckets[k]) {
            console.log('  ' + o.id + '  ' + String(o.operator).padEnd(7) + ' ' + String(o.amount).padStart(6) + 'F  '
                + o.phone + '  ' + String(o.validatedAt || o.validated_at || '').slice(0, 16)
                + (v.type ? '  [' + v.type + ']' : ''));
            console.log('      ' + v.why);
        }
        console.log('');
    }
    console.log('INDETERMINE (hors portee des logs) : ' + buckets.INDETERMINE.length
        + ' commandes — aucune source ne permet de trancher, on n\'y touche pas.\n');

    if (LIST_IND) {
        console.log('── INDETERMINE (' + buckets.INDETERMINE.length + ') ' + '─'.repeat(36));
        for (const { o } of buckets.INDETERMINE) {
            console.log('  ' + o.id + '  ' + String(o.operator).padEnd(7) + ' ' + String(o.amount).padStart(6) + 'F  '
                + o.phone + '  ' + String(o.validatedAt || o.validated_at || '').slice(0, 16)
                + '  [' + (bundleMeta(o) ? 'forfait' : 'credit') + ']');
        }
        console.log('');
    }

    // ── Cloture manuelle ────────────────────────────────────────────────────
    // Commandes servies A LA MAIN hors BIPBIP (recharge via le bot/gateway USSD apres
    // reclamation client) : la livraison a bien eu lieu, seule la base l'ignore.
    // Equivalent differe du bouton « Deja recharge (manuel) ». C'est un ARBITRAGE HUMAIN :
    // l'outil n'infere rien ici, il applique la liste donnee.
    if (CLOSE) {
        const _kw = CLOSE.toUpperCase();
        const targets = _kw === 'ECHEC' ? buckets.ECHEC.map(x => x.o)
            : _kw === 'INDETERMINE' ? buckets.INDETERMINE.map(x => x.o)
            : CLOSE.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
                .map(id => stuck.find(o => String(o.id).toUpperCase() === id) || { id, missing: true });
        console.log('── CLOTURE MANUELLE (' + targets.length + ') ' + '─'.repeat(30));
        let n = 0;
        for (const o of targets) {
            if (o.missing) { console.error('  ' + o.id + ' : introuvable parmi les commandes `validated` — ignoree'); continue; }
            const type = bundleMeta(o) ? 'forfait' : 'credit';
            try {
                await orderStorage.setOrderDelivered(o.id, type);
                console.log('  ' + o.id + ' -> ' + type + '_delivered (servie a la main)');
                n++;
            } catch (e) { console.error('  ' + o.id + ' ECHEC MAJ : ' + (e.message || e)); }
        }
        console.log('\n' + n + '/' + targets.length + ' commandes cloturees.\n');
    }

    if (!APPLY) {
        console.log('Rapport seul. Options : --apply (repasse les ' + buckets.LIVREE.length
            + ' LIVREE), --close <ID,ID|ECHEC> (cloture des commandes servies a la main), '
            + '--list-indetermine.');
        return;
    }
    let done = 0;
    for (const { o, v } of buckets.LIVREE) {
        try {
            await orderStorage.setOrderDelivered(o.id, v.type === 'forfait' ? 'forfait' : 'credit');
            console.log('  ' + o.id + ' -> ' + (v.type === 'forfait' ? 'forfait_delivered' : 'credit_delivered'));
            done++;
        } catch (e) {
            console.error('  ' + o.id + ' ECHEC MAJ : ' + (e.message || e));
        }
    }
    console.log('\n' + done + '/' + buckets.LIVREE.length + ' commandes corrigees.');
})().catch(e => { console.error('ERR', e.stack || e); process.exit(1); });
