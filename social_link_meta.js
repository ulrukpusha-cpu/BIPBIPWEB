// Métadonnées éditables des liens sponsorisés (titre affiché + description personnalisés).
// Si absent pour un lien, l'affichage retombe sur getLinkPromo (auto selon le domaine).
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, 'social_link_meta.json');

let meta = {};
function load() { try { meta = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch (e) { meta = {}; } }
function save() { try { fs.writeFileSync(FILE, JSON.stringify(meta, null, 2)); } catch (e) { console.error('[social_link_meta] save:', e.message); } }
load();

module.exports = {
  get: (id) => meta[String(id)] || null,
  set: (id, fields) => {
    const k = String(id);
    const cur = meta[k] || {};
    if (fields.title != null) cur.title = String(fields.title).slice(0, 120);
    if (fields.desc != null) cur.desc = String(fields.desc).slice(0, 300);
    if (fields.icon != null) cur.icon = String(fields.icon).slice(0, 8);
    if (fields.points != null && Number.isFinite(Number(fields.points))) cur.points = Math.max(0, Math.min(100, parseInt(fields.points, 10)));
    meta[k] = cur;
    save();
    return cur;
  },
  remove: (id) => { delete meta[String(id)]; save(); },
  reload: load,
};
