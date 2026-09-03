// Rattache manuellement un depot reel a une commande (comptabilite), quand le
// rapprochement automatique n'a pas pu le faire — typiquement un client qui paie un
// montant different du total du (hors tolerance +/-5 F).
// Passe par l'API du serveur pour que sa copie EN MEMOIRE soit mise a jour : editer
// deposits.json a la main serait ecrase au prochain saveDeposits().
// La cle admin est lue dans .env et n'est jamais affichee.
//
// Usage (depuis /root/var/www/BIPBIPWEB) :
//   node attach_deposit.js <DEPOT_ID> <ORDER_ID>
require('dotenv').config();

const [depId, orderId] = process.argv.slice(2);
if (!depId || !orderId) {
    console.error('Usage: node attach_deposit.js <DEPOT_ID> <ORDER_ID>');
    process.exit(1);
}
const port = process.env.PORT || 3000;

fetch('http://127.0.0.1:' + port + '/api/deposits/' + depId + '/consume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': process.env.ADMIN_SECRET_KEY || '' },
    body: JSON.stringify({ orderId }),
})
    .then(r => r.text().then(t => {
        console.log('HTTP ' + r.status + ' ' + t);
        process.exit(r.status === 200 ? 0 : 1);
    }))
    .catch(e => { console.error('ERR', e.message || e); process.exit(1); });
