// Liste rouge des numéros (anti-arnaque). Module autonome, persiste blacklist.json.
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, 'blacklist.json');

// Normalise : garde les 10 derniers chiffres (national CI), matche 0700844365 ET 2250700844365
function norm(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : d;
}

let phones = new Set();
let reasons = {};
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    phones = new Set((raw.phones || []).map(norm));
    reasons = raw.reasons || {};
  } catch (e) { phones = new Set(); reasons = {}; }
}
function save() {
  try {
    fs.writeFileSync(FILE, JSON.stringify({ phones: [...phones], reasons, updatedAt: new Date().toISOString() }, null, 2));
  } catch (e) { console.error('[blacklist] save:', e.message); }
}
load();

module.exports = {
  isBlacklisted: (p) => phones.has(norm(p)),
  add: (p, reason) => { const n = norm(p); if (!n) return false; const had = phones.has(n); phones.add(n); if (reason) reasons[n] = reason; save(); return !had; },
  remove: (p) => { const n = norm(p); const had = phones.delete(n); if (had) { delete reasons[n]; save(); } return had; },
  list: () => [...phones],
  reasonFor: (p) => reasons[norm(p)] || null,
  norm,
  reload: load,
};
