/**
 * MTN MoMo Collection API: RequestToPay et Get Transaction Status.
 */
const { getConfig } = require('./config');
const { getAccessToken } = require('./auth');
const { randomUUID } = require('crypto');

async function requestToPay({ amount, currency, payerPhone, externalId, payerMessage, payeeNote }) {
    const { baseUrl, subscriptionKey, targetEnvironment, isConfigured } = getConfig();
    if (!isConfigured) throw new Error('MTN MoMo non configuré');

    const token = await getAccessToken();
    const referenceId = randomUUID();
    const fetch = (await import('node-fetch')).default;

    // Numéro au format international sans + (ex: 2250700000000)
    const partyId = String(payerPhone).replace(/\D/g, '');
    const normalizedPhone = partyId.startsWith('225') ? partyId : `225${partyId}`;

    const url = `${baseUrl}/collection/v1_0/requesttopay`;
    const body = {
        amount: String(amount),
        currency: currency || 'XOF',
        externalId: externalId || referenceId,
        payer: {
            partyIdType: 'MSISDN',
            partyId: normalizedPhone
        },
        payerMessage: payerMessage || 'Paiement BipBip Recharge',
        payeeNote: payeeNote || `Commande ${externalId || referenceId}`
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Ocp-Apim-Subscription-Key': subscriptionKey,
            'X-Target-Environment': targetEnvironment,
            'X-Reference-Id': referenceId,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`MTN RequestToPay error ${response.status}: ${text}`);
    }

    return { referenceId, status: response.status };
}

async function getTransactionStatus(referenceId) {
    const { baseUrl, subscriptionKey, targetEnvironment, isConfigured } = getConfig();
    if (!isConfigured) throw new Error('MTN MoMo non configuré');

    const token = await getAccessToken();
    const fetch = (await import('node-fetch')).default;
    const url = `${baseUrl}/collection/v1_0/requesttopay/${referenceId}`;

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Ocp-Apim-Subscription-Key': subscriptionKey,
            'X-Target-Environment': targetEnvironment
        }
    });

    if (response.status === 404) {
        return { status: 'UNKNOWN', referenceId };
    }

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`MTN GetStatus error ${response.status}: ${text}`);
    }

    const data = await response.json();
    return {
        referenceId,
        status: data.status || 'UNKNOWN',
        financialTransactionId: data.financialTransactionId,
        reason: data.reason
    };
}

module.exports = { requestToPay, getTransactionStatus };
