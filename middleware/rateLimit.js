/**
 * Anti-spam : rate limiting par IP et par user - comme BipbipRecharge v2
 */
const rateLimit = require('express-rate-limit');

const createLimiter = (windowMs = 60 * 1000, max = 30, message = 'Trop de requêtes') =>
    rateLimit({
        windowMs,
        max,
        message: { error: message, code: 'RATE_LIMIT' },
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => req.userId || req.ip || 'anon',
    });

const apiLimiter = createLimiter(60 * 1000, 100, 'Trop de requêtes. Réessayez plus tard.');
const paymentLimiter = createLimiter(60 * 1000, 10, 'Trop de tentatives de paiement.');
const annonceLimiter = createLimiter(60 * 1000, 5, "Trop d'annonces envoyées.");

module.exports = {
    apiLimiter,
    paymentLimiter,
    annonceLimiter,
    createLimiter,
};
