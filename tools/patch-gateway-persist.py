#!/usr/bin/env python3
"""Persiste les stats/transactions du USSD gateway sur disque (survie aux redemarrages)."""
import sys
PATH = '/root/var/www/ussd-gateway/index.js'
with open(PATH, 'r', encoding='utf-8') as f:
    c = f.read()

if 'gateway-stats.json' in c:
    print('ALREADY'); sys.exit(0)

# 1) require fs
A1 = "const path = require('path');"
if A1 not in c:
    print('A1_NOT_FOUND'); sys.exit(1)
c = c.replace(A1, A1 + "\nconst fs = require('fs');", 1)

# 2) bloc de persistance apres l'objet stats
A2 = "    dailyVolume: {},\n    hourlyVolume: {}\n};"
if A2 not in c:
    print('A2_NOT_FOUND'); sys.exit(1)
BLOCK = A2 + """

// --- Persistance des stats sur disque (survie aux redemarrages du gateway) ---
const STATS_FILE = path.join(__dirname, 'gateway-stats.json');
(function loadStats() {
    try {
        if (fs.existsSync(STATS_FILE)) {
            const saved = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
            if (saved && typeof saved === 'object') {
                ['mtn', 'orange', 'moov'].forEach(function (op) { if (saved[op]) stats[op] = saved[op]; });
                if (Array.isArray(saved.transactions)) stats.transactions = saved.transactions;
                if (saved.lastTransaction) stats.lastTransaction = saved.lastTransaction;
                if (saved.dailyVolume) stats.dailyVolume = saved.dailyVolume;
                if (saved.hourlyVolume) stats.hourlyVolume = saved.hourlyVolume;
                console.log('[STATS] Historique charge depuis disque : ' + stats.transactions.length + ' transactions');
            }
        }
    } catch (e) { console.log('[STATS] load error: ' + e.message); }
})();
let _statsSaveTimer = null;
function scheduleSaveStats() {
    if (_statsSaveTimer) return;
    _statsSaveTimer = setTimeout(function () {
        _statsSaveTimer = null;
        try {
            fs.writeFileSync(STATS_FILE, JSON.stringify({
                mtn: stats.mtn, orange: stats.orange, moov: stats.moov,
                transactions: stats.transactions, lastTransaction: stats.lastTransaction,
                dailyVolume: stats.dailyVolume, hourlyVolume: stats.hourlyVolume
            }), 'utf8');
        } catch (e) { console.log('[STATS] save error: ' + e.message); }
    }, 1500);
}"""
c = c.replace(A2, BLOCK, 1)

# 3) sauvegarde a chaque transaction
A3 = "    stats.lastTransaction = transaction;"
if A3 not in c:
    print('A3_NOT_FOUND'); sys.exit(1)
c = c.replace(A3, A3 + "\n    scheduleSaveStats();", 1)

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(c)
print('PATCHED_OK')
