/**
 * Génère l'API User et l'API Key MTN MoMo (sandbox) avec ta clé primaire.
 * Usage: node scripts/mtn-sandbox-provision.js
 *
 * Avant de lancer: mets ta clé primaire dans .env :
 *   MTN_SUBSCRIPTION_KEY=ta_cle_primaire
 *
 * Le script affiche MTN_API_USER et MTN_API_KEY à mettre dans .env.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { randomUUID } = require('crypto');

const SUBSCRIPTION_KEY = (process.env.MTN_SUBSCRIPTION_KEY || '').trim();
const BASE = 'https://sandbox.momodeveloper.mtn.com';

async function main() {
    if (!SUBSCRIPTION_KEY) {
        console.error('❌ Mets ta clé primaire dans .env : MTN_SUBSCRIPTION_KEY=...');
        process.exit(1);
    }

    console.log('Clé lue (longueur ' + SUBSCRIPTION_KEY.length + ' caractères)');
    if (SUBSCRIPTION_KEY.length !== 32) {
        console.warn('⚠️  Une clé sandbox fait souvent 32 caractères. Vérifie qu’il n’y a pas d’espace ou de caractère en trop dans .env');
    }

    const apiUserId = randomUUID();
    const fetch = (await import('node-fetch')).default;

    console.log('1. Création de l’API User (X-Reference-Id)...');
    const createUserRes = await fetch(`${BASE}/v1_0/apiuser`, {
        method: 'POST',
        headers: {
            'X-Reference-Id': apiUserId,
            'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ providerCallbackHost: 'webhook.site' })
    });

    if (!createUserRes.ok) {
        const text = await createUserRes.text();
        console.error('❌ Erreur création API User:', createUserRes.status, text);
        if (createUserRes.status === 401) {
            console.error('\n💡 Vérifie sur momodeveloper.mtn.com :');
            console.error('   - Tu dois être abonné au produit COLLECTIONS (API), pas au "Collection Widget".');
            console.error('   - Products → Collections (Request to Pay) → Subscribe, puis récupère la Primary Key.');
            console.error('   - Utilise cette clé dans .env (MTN_SUBSCRIPTION_KEY). Tu peux aussi tester la Secondary Key.');
        }
        process.exit(1);
    }
    console.log('   ✅ API User créé:', apiUserId);

    console.log('2. Génération de l’API Key...');
    const createKeyRes = await fetch(`${BASE}/v1_0/apiuser/${apiUserId}/apikey`, {
        method: 'POST',
        headers: {
            'Ocp-Apim-Subscription-Key': SUBSCRIPTION_KEY,
            'Content-Type': 'application/json'
        },
        body: '{}'
    });

    if (!createKeyRes.ok) {
        const text = await createKeyRes.text();
        console.error('❌ Erreur génération API Key:', createKeyRes.status, text);
        process.exit(1);
    }

    const { apiKey } = await createKeyRes.json();
    if (!apiKey) {
        console.error('❌ Réponse sans apiKey');
        process.exit(1);
    }

    console.log('   ✅ API Key générée (à copier maintenant, elle ne sera plus affichée)\n');
    console.log('--- À ajouter dans ton .env (sandbox) ---');
    console.log('MTN_SUBSCRIPTION_KEY=' + SUBSCRIPTION_KEY);
    console.log('MTN_API_USER=' + apiUserId);
    console.log('MTN_API_KEY=' + apiKey);
    console.log('MTN_BASE_URL=https://sandbox.momodeveloper.mtn.com');
    console.log('MTN_TARGET_ENVIRONMENT=mtnciv');
    console.log('------------------------------------------');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
