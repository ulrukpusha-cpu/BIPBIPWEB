/**
 * Client Supabase partagé pour actualites, annonces, led_messages, quests
 */
let _client = null;

function getSupabase() {
    if (_client) return _client;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    const { createClient } = require('@supabase/supabase-js');
    _client = createClient(url, key);
    return _client;
}

function isAvailable() {
    return !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY));
}

module.exports = { getSupabase, isAvailable };
