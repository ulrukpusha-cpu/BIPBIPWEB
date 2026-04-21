/**
 * Client Supabase partagé pour actualites, annonces, led_messages, quests
 * TCP connect timeout porté à 30s via undici Agent (défaut Node.js = 10s)
 */
let _client = null;

function getSupabase() {
    if (_client) return _client;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    const { createClient } = require('@supabase/supabase-js');
    const { fetch: undiciFetch, Agent } = require('undici');
    const dispatcher = new Agent({
        connect: { timeout: 30000 },
        keepAliveTimeout: 30000,
        keepAliveMaxTimeout: 60000,
    });
    _client = createClient(url, key, {
        global: {
            fetch: (input, init = {}) => undiciFetch(input, { ...init, dispatcher })
        }
    });
    return _client;
}

function isAvailable() {
    return !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY));
}

module.exports = { getSupabase, isAvailable };
