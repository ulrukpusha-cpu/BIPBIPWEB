/**
 * Protection des routes admin : header X-Admin-Key doit correspondre à ADMIN_SECRET_KEY.
 * Dans .env : ADMIN_SECRET_KEY=ta_cle_secrete
 * Côté client (ou Postman) : X-Admin-Key: ta_cle_secrete
 */
function adminAuth(req, res, next) {
    const secret = (process.env.ADMIN_SECRET_KEY || '').trim();
    if (!secret) {
        return res.status(503).json({ error: 'Admin non configuré (ADMIN_SECRET_KEY)' });
    }
    const key = String(req.headers['x-admin-key'] || req.query.adminKey || '').trim();
    if (key !== secret) {
        return res.status(401).json({ error: 'Non autorisé' });
    }
    next();
}

module.exports = { adminAuth };
