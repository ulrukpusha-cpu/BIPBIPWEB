/**
 * Protection des routes admin CABINE (Kbine physique).
 *
 * Clé DÉDIÉE, volontairement distincte de ADMIN_SECRET_KEY (admin du site/app grand public) :
 * ces routes génèrent des codes commerciaux et VALIDENT des commandes — donc déclenchent de
 * vraies recharges via le gateway USSD. Elles ne doivent pas être ouvertes par la clé du site,
 * ni par le PIN de l'app (qui renvoie ADMIN_SECRET_KEY au navigateur).
 *
 * Dans .env : CABINE_ADMIN_KEY=ta_cle_cabine
 * Côté client (panneau admin-cabine.html) : header X-Admin-Key: ta_cle_cabine
 */
function cabineAuth(req, res, next) {
    const secret = (process.env.CABINE_ADMIN_KEY || '').trim();
    if (!secret) {
        return res.status(503).json({ error: 'Admin cabine non configuré (CABINE_ADMIN_KEY)' });
    }
    const key = String(req.headers['x-admin-key'] || req.query.adminKey || '').trim();
    if (key !== secret) {
        return res.status(401).json({ error: 'Non autorisé' });
    }
    next();
}

module.exports = { cabineAuth };
