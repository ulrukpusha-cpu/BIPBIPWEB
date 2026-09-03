/**
 * Agent Modérateur Actualités (Pack Essential #2)
 * Auto-approving des actualités RSS avec filtrage IA
 * Boss: démarrage commande pm2 start
 */

const dotenv = require('dotenv');
dotenv.config({ path: '../.env' });

const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Expressions à rejeter automatiquement (arnaques / clickbait).
//
// Resserré le 2026-08-18 après mesure sur 500 articles réels : l'ancienne liste
// rejetait 10 articles, tous légitimes et aucun spam. Les mots isolés ('arnaque',
// 'escroquerie', 'scam', 'fake news') sont du vocabulaire journalistique courant —
// ils censuraient l'actualité anti-fraude, la plus utile à nos utilisateurs.
// 'héritage' et 'loto' ajoutaient des faux positifs ('l'héritage de Mariama Bâ',
// et 'loto' capturé en sous-chaîne dans un article Bitcoin).
//
// Ne restent que des constructions publicitaires sans usage journalistique.
// Les sources étant des flux curatés (RFI, BBC, AIP...), ce filet est un garde-fou
// pour les flux ajoutés via le bot Telegram, pas pour la presse établie.
const BLACKLISTED_KEYWORDS = [
  'prince nigérian', 'gagné sans participer', 'argent facile',
  '100% vrai', 'incroyable mais vrai', "gagnez de l'argent",
  'devenez riche rapidement'
];

// Limites de mots : évite que 'loto' matche à l'intérieur d'un autre mot.
const BLACKLIST_RX = BLACKLISTED_KEYWORDS.map(w => ({
  word: w,
  rx: new RegExp('(?<!\\w)' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?!\\w)', 'i'),
}));

// Mots-clés doublons (déjà vus dans les titres récents = risque doublon)
const SIMILARITY_THRESHOLD = 0.75;

// ── Garde-fou / alertes Telegram ────────────────────────────────────────────
// Depuis l'activation de la modération (18/08/2026), l'agent est un passage
// obligatoire : s'il se bloque, les articles s'empilent en 'pending' sans
// erreur visible. Seuils calibrés sur la cadence réelle mesurée sur 24h
// (7 à 36 articles/h, plus long silence observé : 120 min).
const ALERT_TG_TOKEN = process.env.MOD_ALERT_TG_TOKEN || process.env.TELEGRAM_BOT_TOKEN_ADMIN;
const ALERT_TG_CHAT = process.env.MOD_ALERT_CHAT_ID
  || (process.env.ADMIN_CHAT_IDS || '').split(',')[0].trim();
// `parseInt(x, 10) || defaut` ecraserait un seuil regle a 0 (0 est falsy),
// ce qui rendrait la configuration silencieusement inoperante.
function envInt(name, defaut) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) ? n : defaut;
}
const ALERT_PENDING_MAX = envInt('MOD_ALERT_PENDING_MAX', 60);
const ALERT_STALE_MIN = envInt('MOD_ALERT_STALE_MIN', 120);
const ALERT_INGEST_MIN = envInt('MOD_ALERT_INGEST_MIN', 180);
const ALERT_COOLDOWN_MIN = envInt('MOD_ALERT_COOLDOWN_MIN', 60);

class AgentModerateurActualites {
  constructor() {
    this.supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    this.isRunning = false;
    this.stats = { checked: 0, approved: 0, rejected: 0 };
    // Etat des alertes : evite de re-notifier en boucle, et permet d'annoncer
    // le retour a la normale.
    this.alerts = {
      pending: { active: false, sentAt: 0 },
      stale: { active: false, sentAt: 0 },
      ingest: { active: false, sentAt: 0 },
    };
    console.log('[Agent #2] Modérateur Actualités initialisé');
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    console.log('[Agent #2] Démarrage...');
    
    // Vérification initiale
    await this.checkPendingActualites();
    
    // Planification : toutes les 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      console.log('[Agent #2] Cycle de vérification:', new Date().toISOString());
      await this.checkPendingActualites();
    });
    
    // Fetch RSS : assuré par le crontab système (horaire), pas ici.
    //   0 * * * * node cron/fetchNewsRss.js
    // Le planificateur 2h qui vivait ici faisait doublon (retiré le 2026-08-17).

    console.log('[Agent #2] Modérateur Actualités actif - Vérification toutes les 5 minutes');
    
    // Garde-fou : controle de sante toutes les 15 min
    cron.schedule('*/15 * * * *', () => this.checkHealth());
    await this.checkHealth();
    console.log('[Agent #2] Garde-fou actif — alertes Telegram vers',
      ALERT_TG_CHAT ? 'chat ' + ALERT_TG_CHAT : '(aucun destinataire configuré)');

    // Rapport quotidien à 21h
    cron.schedule('0 21 * * *', () => this.sendDailyReport());
  }

  async checkPendingActualites() {
    try {
      // Récupérer actualités en pending
      const { data: actualites, error } = await this.supabase
        .from('actualites')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(20);

      if (error) {
        console.error('[Agent #2] Erreur Supabase:', error);
        return;
      }

      if (!actualites || actualites.length === 0) return;

      console.log(`[Agent #2] ${actualites.length} actualité(s) à modérer`);

      // Titres récents chargés UNE fois par cycle (et non par article : c'était
      // une requête par actualité). La liste est complétée au fil des validations
      // pour attraper aussi les doublons présents dans le lot courant.
      const recentTitles = await this.loadRecentTitles();

      for (const actu of actualites) {
        await this.moderateActualite(actu, recentTitles);
      }

    } catch (err) {
      console.error('[Agent #2] Erreur checkPendingActualites:', err.message);
    }
  }

  // Titres approuvés des 7 derniers jours (le TTL de 24h en limite le volume).
  async loadRecentTitles() {
    const { data, error } = await this.supabase
      .from('actualites')
      .select('title')
      .eq('status', 'approved')
      .gte('published_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    if (error) {
      console.error('[Agent #2] Chargement des titres récents KO:', error.message);
      return null; // null = on saute la déduplication plutôt que de tout rejeter
    }
    return (data || []).map(a => (a.title || '').toLowerCase());
  }

  async moderateActualite(actu, recentTitles) {
    const title = (actu.title || '').toLowerCase();
    const content = (actu.content || '').toLowerCase();
    this.stats.checked++;

    // 1. Vérifier blacklist
    const hit = BLACKLIST_RX.find(b => b.rx.test(title) || b.rx.test(content));
    if (hit) {
      await this.rejectActualite(actu, `Expression blacklistée: ${hit.word}`);
      return;
    }

    // 2. Vérifier titre trop court/vague
    if (title.length < 20) {
      await this.rejectActualite(actu, 'Titre trop court (< 20 caractères)');
      return;
    }

    // 3. Vérifier doublon avec actualités récentes
    if (recentTitles) {
      const similar = recentTitles.find(t => this.similarity(t, title) > SIMILARITY_THRESHOLD);
      if (similar) {
        await this.rejectActualite(actu, 'Doublon avec actualité récente');
        return;
      }
    }

    // 4. Tout est OK → APPROUVER
    await this.approveActualite(actu);
    if (recentTitles) recentTitles.push(title);
  }

  similarity(s1, s2) {
    const set1 = new Set(s1.split(' '));
    const set2 = new Set(s2.split(' '));
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    return intersection.size / Math.max(set1.size, set2.size);
  }

  // Embarque la trace de modération dans sources[0].mod (même convention que
  // image/cat dans actualitesService) : la table n'a pas de colonne dédiée.
  withModMeta(sources, by, motif) {
    let arr;
    if (Array.isArray(sources)) arr = sources.slice();
    else if (typeof sources === 'string') { try { arr = JSON.parse(sources); } catch (e) { arr = null; } }
    if (!Array.isArray(arr) || !arr.length) arr = [{}];
    arr[0] = Object.assign({}, arr[0], { mod: { by, at: new Date().toISOString(), motif: motif || undefined } });
    return JSON.stringify(arr);
  }

  async approveActualite(actu) {
    try {
      // NB: la table actualites n'a pas de colonnes moderated_by/moderation_notes.
      // La trace de modération est stockée dans sources[0].mod, comme image/cat.
      const { error } = await this.supabase
        .from('actualites')
        .update({ 
          status: 'approved',
          published_at: new Date().toISOString(),
          sources: this.withModMeta(actu.sources, 'agent-ia-002', null)
        })
        .eq('id', actu.id);

      if (error) throw error;

      this.stats.approved++;
      console.log(`[Agent #2] ✅ Actualité validée: ${actu.title?.slice(0, 50)}...`);

    } catch (err) {
      console.error('[Agent #2] Erreur approveActualite:', err);
    }
  }

  async rejectActualite(actu, motif) {
    try {
      const { error } = await this.supabase
        .from('actualites')
        .update({ 
          status: 'rejected',
          sources: this.withModMeta(actu.sources, 'agent-ia-002', motif)
        })
        .eq('id', actu.id);

      if (error) throw error;

      this.stats.rejected++;
      console.log(`[Agent #2] ❌ Actualité rejetée (${motif}): ${actu.title?.slice(0, 40)}...`);

    } catch (err) {
      console.error('[Agent #2] Erreur rejectActualite:', err);
    }
  }

  // Trois signaux distincts :
  //   1. la file d'attente ne se vide plus  -> agent bloque
  //   2. plus rien de publie ALORS QUE des articles attendent -> agent bloque
  //      (la condition "et des articles attendent" evite d'alerter quand il n'y
  //       a simplement pas d'actualite neuve : le cas est frequent, la
  //       deduplication par slug filtrant deja la majorite des articles)
  //   3. plus rien d'ingere du tout -> le cron horaire fetchNewsRss est mort
  async checkHealth() {
    try {
      const now = Date.now();
      const { count: pendingCount } = await this.supabase
        .from('actualites').select('id', { count: 'exact', head: true }).eq('status', 'pending');
      const { data: pub } = await this.supabase
        .from('actualites').select('published_at').eq('status', 'approved')
        .order('published_at', { ascending: false }).limit(1);
      const { data: ing } = await this.supabase
        .from('actualites').select('created_at')
        .order('created_at', { ascending: false }).limit(1);

      const mins = v => (v ? Math.round((now - new Date(v).getTime()) / 60000) : null);
      const n = pendingCount || 0;
      const sincePub = pub && pub[0] ? mins(pub[0].published_at) : null;
      const sinceIng = ing && ing[0] ? mins(ing[0].created_at) : null;

      if (n > ALERT_PENDING_MAX) {
        await this.raiseAlert('pending', `File de modération bloquée : ${n} article(s) en attente (seuil : ${ALERT_PENDING_MAX}).`);
      } else {
        await this.clearAlert('pending', `File de modération repartie (${n} en attente).`);
      }

      if (n > 0 && sincePub !== null && sincePub > ALERT_STALE_MIN) {
        await this.raiseAlert('stale', `Rien publié depuis ${sincePub} min alors que ${n} article(s) attendent la modération.`);
      } else {
        await this.clearAlert('stale', 'Publication repartie.');
      }

      if (sinceIng !== null && sinceIng > ALERT_INGEST_MIN) {
        await this.raiseAlert('ingest', `Aucun article ingéré depuis ${sinceIng} min — le cron horaire fetchNewsRss est probablement mort.`);
      } else {
        await this.clearAlert('ingest', 'Ingestion RSS repartie.');
      }
    } catch (err) {
      console.error('[Agent #2] checkHealth KO:', err.message);
    }
  }

  async raiseAlert(key, msg) {
    const st = this.alerts[key];
    if (st.active && Date.now() - st.sentAt < ALERT_COOLDOWN_MIN * 60000) return;
    this.alerts[key] = { active: true, sentAt: Date.now() };
    console.error('[Agent #2] ALERTE', key, '—', msg);
    await this.notify('⚠️ BIPBIP actualités\n\n' + msg);
  }

  async clearAlert(key, msg) {
    if (!this.alerts[key].active) return;
    this.alerts[key] = { active: false, sentAt: 0 };
    console.log('[Agent #2] Alerte levée:', key);
    await this.notify('✅ BIPBIP actualités\n\n' + msg);
  }

  // Une panne Telegram ne doit jamais interrompre la moderation.
  async notify(text) {
    if (!ALERT_TG_TOKEN || !ALERT_TG_CHAT) return;
    try {
      const r = await fetch(`https://api.telegram.org/bot${ALERT_TG_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: ALERT_TG_CHAT, text, disable_web_page_preview: true }),
      });
      if (!r.ok) console.error('[Agent #2] Telegram KO:', r.status);
    } catch (err) {
      console.error('[Agent #2] Telegram KO:', err.message);
    }
  }

  sendDailyReport() {
    const report = `📊 Rapport Agent #2 (${new Date().toLocaleDateString()})\n\n` +
      `• Actualités vérifiées: ${this.stats.checked}\n` +
      `• Approuvées: ${this.stats.approved} ✅\n` +
      `• Rejetées: ${this.stats.rejected} ❌\n\n` +
      `[Agent #2] Modérateur Actualités - Opérationnel`;
    
    console.log('[Agent #2] Rapport:', report);
    this.stats = { checked: 0, approved: 0, rejected: 0 };
  }
}

// Démarrage auto
const agent = new AgentModerateurActualites();
agent.start().catch(err => {
  console.error('[Agent #2] Erreur fatale:', err);
  process.exit(1);
});

module.exports = { AgentModerateurActualites };
