// services/push.js — envoi de notifications push FCM (firebase-admin).
// La clé de compte de service vit dans .env (FIREBASE_SERVICE_ACCOUNT = chemin JSON) — jamais exposée au client.
// Sans clé, l'envoi est désactivé proprement (les tokens continuent d'être collectés).

const fs = require('fs');
const path = require('path');
const TOKENS_FILE = path.join(__dirname, '..', 'push-tokens.json');

let _admin = null, _initTried = false;
function getAdmin() {
  if (_initTried) return _admin;
  _initTried = true;
  try {
    const saPath = process.env.FIREBASE_SERVICE_ACCOUNT || path.join(__dirname, '..', 'firebase-service-account.json');
    if (!fs.existsSync(saPath)) { console.warn('[Push] service account introuvable -> envoi FCM désactivé'); return null; }
    // firebase-admin v13+ : API modulaire par sous-chemins
    const { initializeApp, cert, getApps } = require('firebase-admin/app');
    const { getMessaging } = require('firebase-admin/messaging');
    const app = getApps().length ? getApps()[0] : initializeApp({ credential: cert(require(saPath)) });
    _admin = { messaging: () => getMessaging(app) };
    console.log('[Push] firebase-admin initialisé');
  } catch (e) { console.error('[Push] init:', e.message); _admin = null; }
  return _admin;
}

function loadTokens() { try { return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')); } catch (e) { return {}; } }
function saveTokens(t) { try { fs.writeFileSync(TOKENS_FILE, JSON.stringify(t)); } catch (e) {} }

function registerToken(token, userId, platform) {
  if (!token) return;
  const t = loadTokens();
  t[token] = { userId: userId != null && userId !== '' ? String(userId) : null, platform: platform || 'android', updatedAt: Date.now() };
  saveTokens(t);
}

function tokensForUser(userId) {
  const t = loadTokens(); const uid = String(userId);
  return Object.keys(t).filter(tok => t[tok].userId === uid);
}

// Envoi ciblé à un utilisateur (tous ses appareils). data = objet (valeurs converties en string).
async function sendToUser(userId, title, body, data) {
  const admin = getAdmin(); if (!admin || userId == null) return { sent: 0 };
  const tokens = tokensForUser(userId); if (!tokens.length) return { sent: 0 };
  const dataStr = {}; Object.keys(data || {}).forEach(k => { dataStr[k] = String((data || {})[k]); });
  try {
    const r = await admin.messaging().sendEachForMulticast({
      notification: { title: String(title || 'Bipbip Recharge'), body: String(body || '') },
      data: dataStr, tokens,
      android: { priority: 'high', notification: { sound: 'default', channelId: 'bipbip_default' } }
    });
    if (r.responses) {
      const all = loadTokens(); let changed = false;
      r.responses.forEach((resp, i) => {
        const code = resp && resp.error && resp.error.code || '';
        if (!resp.success && /not-registered|invalid-argument|invalid-registration/.test(code)) { delete all[tokens[i]]; changed = true; }
      });
      if (changed) saveTokens(all);
    }
    return { sent: r.successCount || 0, failed: r.failureCount || 0 };
  } catch (e) { console.error('[Push] send:', e.message); return { sent: 0, error: e.message }; }
}

module.exports = { registerToken, sendToUser, tokensForUser, _getAdmin: getAdmin };
