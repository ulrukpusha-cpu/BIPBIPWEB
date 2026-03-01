/**
 * Repository des transactions MTN MoMo (Supabase).
 * Nécessite SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans .env.
 */
let _client = null;

function getSupabaseClient() {
    if (_client) return _client;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('MoMo: Supabase requis (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
    const { createClient } = require('@supabase/supabase-js');
    _client = createClient(url, key);
    return _client;
}

function rowToTransaction(row) {
    if (!row) return null;
    return {
        referenceId: row.reference_id,
        phoneNumber: row.phone_number,
        amount: Number(row.amount),
        currency: row.currency,
        status: row.status,
        orderId: row.order_id,
        annonceId: row.annonce_id || null,
        telegramChatId: row.telegram_chat_id,
        failureReason: row.failure_reason,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

async function createTransaction({ referenceId, phoneNumber, amount, currency, status, orderId, annonceId, telegramChatId }) {
    const supabase = getSupabaseClient();
    const row = {
        reference_id: referenceId,
        phone_number: phoneNumber,
        amount: amount,
        currency: currency || 'XOF',
        status: status || 'PENDING',
        order_id: orderId || null,
        telegram_chat_id: telegramChatId || null
    };
    if (annonceId != null) row.annonce_id = annonceId;
    const { error } = await supabase.from('momo_transactions').insert(row);
    if (error) throw error;
    return getTransactionByReferenceId(referenceId);
}

async function getTransactionByReferenceId(referenceId) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('momo_transactions')
        .select('*')
        .eq('reference_id', referenceId)
        .single();
    if (error && error.code !== 'PGRST116') throw error;
    return rowToTransaction(data);
}

async function getSuccessfulTransactionForAnnonce(annonceId) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('momo_transactions')
        .select('*')
        .eq('annonce_id', annonceId)
        .eq('status', 'SUCCESSFUL')
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return rowToTransaction(data);
}

async function updateTransactionStatus(referenceId, status, failureReason = null) {
    const supabase = getSupabaseClient();
    const payload = { status };
    if (failureReason != null) payload.failure_reason = failureReason;
    const { error } = await supabase
        .from('momo_transactions')
        .update(payload)
        .eq('reference_id', referenceId);
    if (error) throw error;
    return getTransactionByReferenceId(referenceId);
}

function isAvailable() {
    return !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY));
}

module.exports = {
    createTransaction,
    getTransactionByReferenceId,
    getSuccessfulTransactionForAnnonce,
    updateTransactionStatus,
    isAvailable
};
