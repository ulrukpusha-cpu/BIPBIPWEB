// Repasse UNE commande de `validated` a livree, quand la recharge est bien partie mais que
// le statut n'a pas suivi (chemins de validation manuels, cf. patch_delivered.py).
// Usage (depuis /root/var/www/BIPBIPWEB) :
//   node /root/fix_order_delivered.js <ORDER_ID> [forfait|credit]
require('dotenv').config();
const s = require('./storage');

(async () => {
    const id = process.argv[2];
    const type = process.argv[3] === 'credit' ? 'credit' : 'forfait';
    if (!id) { console.error('Usage: node fix_order_delivered.js <ORDER_ID> [forfait|credit]'); process.exit(1); }
    const before = await s.getOrderById(id);
    if (!before) { console.error(id + ' introuvable'); process.exit(1); }
    if (before.status !== 'validated') {
        console.log(id + ' : statut ' + before.status + ' — rien a faire.');
        return;
    }
    await s.setOrderDelivered(id, type);
    const after = await s.getOrderById(id);
    console.log(id + ' : ' + before.status + ' -> ' + after.status);
})().catch(e => { console.error('ERR', e.message || e); process.exit(1); });
