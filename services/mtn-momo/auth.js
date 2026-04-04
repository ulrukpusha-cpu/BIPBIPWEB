/**
 * OAuth2 Client Credentials pour MTN MoMo.
 * Cache du token jusqu'à expiration pour limiter les appels.
 */
const { getConfig } = require('./config');

let cachedToken = null;
let tokenExpiresAt = 0;
const SAFETY_MARGIN_MS = 60 * 1000; // rafraîchir 1 min avant expiration

function isTokenValid() {
    return cachedToken && Date.now() < tokenExpiresAt - SAFETY_MARGIN_MS;
}

async function getAccessToken() {
    if (isTokenValid()) return cachedToken;

    const { baseUrl, subscriptionKey, apiUser, apiKey, isConfigured } = getConfig();
    if (!isConfigured) {
        throw new Error('MTN MoMo: configuration manquante (MTN_SUBSCRIPTION_KEY, MTN_API_USER, MTN_API_KEY, MTN_BASE_URL)');
    }

    const fetch = (await import('node-fetch')).default;
    const tokenUrl = `${baseUrl}/collection/token/`;
    const basicAuth = Buffer.from(`${apiUser}:${apiKey}`).toString('base64');

    const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${basicAuth}`,
            'Ocp-Apim-Subscription-Key': subscriptionKey,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`MTN MoMo token error ${response.status}: ${text}`);
    }

    const data = await response.json();
    cachedToken = data.access_token;
    const expiresIn = (data.expires_in || 3600) * 1000;
    tokenExpiresAt = Date.now() + expiresIn;

    return cachedToken;
}

function clearTokenCache() {
    cachedToken = null;
    tokenExpiresAt = 0;
}

module.exports = { getAccessToken, clearTokenCache, isTokenValid };
