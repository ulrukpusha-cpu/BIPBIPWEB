/**
 * Configuration MTN MoMo (variables d'environnement uniquement, pas de secrets en dur).
 */
function getConfig() {
    const baseUrl = (process.env.MTN_BASE_URL || '').replace(/\/$/, '');
    const targetEnv = process.env.MTN_TARGET_ENVIRONMENT || 'mtnciv';

    return {
        subscriptionKey: process.env.MTN_SUBSCRIPTION_KEY || '',
        apiUser: process.env.MTN_API_USER || '',
        apiKey: process.env.MTN_API_KEY || '',
        baseUrl,
        targetEnvironment: targetEnv,
        currency: process.env.MTN_CURRENCY || 'XOF',
        isConfigured: !!(
            process.env.MTN_SUBSCRIPTION_KEY &&
            process.env.MTN_API_USER &&
            process.env.MTN_API_KEY &&
            baseUrl
        )
    };
}

module.exports = { getConfig };
