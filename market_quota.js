// Quota d'articles Market : 3 gratuits par vendeur + 3 par pack payé (PACK_ARTICLES).
// Source de vérité côté serveur (la limite front seule était contournable).
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, 'market_quota.json');
const FREE_ARTICLES = 3;
const PACK_SLOTS = 3;

let bonus = {};   // sellerId -> slots bonus cumulés (packs payés)
function load() {
  try { bonus = (JSON.parse(fs.readFileSync(FILE, 'utf8')).bonus) || {}; }
  catch (e) { bonus = {}; }
}
function save() {
  try { fs.writeFileSync(FILE, JSON.stringify({ bonus, updatedAt: new Date().toISOString() }, null, 2)); }
  catch (e) { console.error('[market_quota] save:', e.message); }
}
load();

module.exports = {
  FREE_ARTICLES,
  PACK_SLOTS,
  getBonusSlots: (id) => bonus[String(id)] || 0,
  getLimit: (id) => FREE_ARTICLES + (bonus[String(id)] || 0),
  addPack: (id, slots = PACK_SLOTS) => {
    const k = String(id);
    bonus[k] = (bonus[k] || 0) + slots;
    save();
    return bonus[k];
  },
  reload: load,
};
