// ==================== BIPBIP - Connexion Supabase (PostgreSQL) ====================
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_ANON_KEY) doivent être définis dans .env');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Retry court sur les LECTURES uniquement (idempotentes) pour absorber les
// 522/timeouts intermittents de l'edge Cloudflare devant Supabase. Jamais sur
// les ecritures (risque de doublon si la 1re a deja reussi cote serveur).
async function withRetry(fn, label, tries = 3) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
        try { return await fn(); }
        catch (e) {
            lastErr = e;
            if (i === tries - 1) break;
            await new Promise(r => setTimeout(r, 300 * (i + 1)));
        }
    }
    console.warn('[db-supabase] ' + (label || 'read') + ' KO apres ' + tries + ' essais:', (lastErr && lastErr.message) ? String(lastErr.message).split('\n')[0].slice(0, 160) : lastErr);
    throw lastErr;
}

function rowToOrder(row) {
    if (!row) return null;
    return {
        id: row.id,
        userId: row.user_id,
        username: row.username,
        operator: row.operator,
        amount: row.amount,
        amountTotal: row.amount_total,
        phone: row.phone,
        proof: row.proof,
        status: row.status,
        notes: row.notes || null,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        validatedAt: row.validated_at ? new Date(row.validated_at).toISOString() : null,
        rejectedAt: row.rejected_at ? new Date(row.rejected_at).toISOString() : null,
        rejectReason: row.reject_reason,
        paymentMethod: row.payment_method || null
    };
}

function orderToRow(order) {
    const row = {
        id: order.id,
        user_id: order.userId || null,
        username: order.username || null,
        operator: order.operator,
        amount: order.amount,
        amount_total: order.amountTotal ?? order.amount,
        phone: order.phone,
        proof: order.proof || null,
        status: order.status || 'pending'
    };
    if (order.notes !== undefined) row.notes = order.notes || null;
    return row;
}

async function getOrderById(orderId) {
    const { data, error } = await supabase.from('orders').select('*').eq('id', orderId).single();
    if (error && error.code !== 'PGRST116') throw error;
    return rowToOrder(data);
}

async function getOrdersPending() {
    return withRetry(async () => {
        const { data, error } = await supabase
            .from('orders')
            .select('*')
            .in('status', ['pending', 'proof_sent'])
            .order('created_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(rowToOrder);
    }, 'getOrdersPending');
}

async function getValidatedOrders() {
    return withRetry(async () => {
        const { data, error } = await supabase
            .from('orders')
            .select('*')
            .eq('status', 'validated')
            .order('validated_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(rowToOrder);
    }, 'getValidatedOrders');
}

async function getOrdersByStatus(status) {
    if (status === 'validated') return getValidatedOrders();
    return withRetry(async () => {
        const { data, error } = await supabase
            .from('orders')
            .select('*')
            .eq('status', status)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(rowToOrder);
    }, 'getOrdersByStatus(' + status + ')');
}

async function getAllOrders() {
    return getOrdersPending();
}

async function createOrder(order) {
    const row = orderToRow(order);
    const { error } = await supabase.from('orders').insert(row);
    if (error) throw error;
    return order;
}

async function updateOrderProof(orderId, proofPath, status = 'proof_sent', paymentMethod) {
    const patch = { proof: proofPath, status };
    if (paymentMethod != null) {
        patch.payment_method = paymentMethod ? String(paymentMethod) : null;
    }
    const { error } = await supabase
        .from('orders')
        .update(patch)
        .eq('id', orderId)
        .in('status', ['pending', 'proof_sent']);   // garde : ne PAS ecraser un statut final (deja valide / livre / rejete)
    if (error) throw error;
    return getOrderById(orderId);
}

async function setOrderValidated(orderId) {
    const { error } = await supabase
        .from('orders')
        .update({ status: 'validated', validated_at: new Date().toISOString() })
        .eq('id', orderId);
    if (error) throw error;
    return getOrderById(orderId);
}

async function setOrderRejected(orderId, reason) {
    const { error } = await supabase
        .from('orders')
        .update({
            status: 'rejected',
            rejected_at: new Date().toISOString(),
            reject_reason: reason || 'Non spécifié'
        })
        .eq('id', orderId);
    if (error) throw error;
    return getOrderById(orderId);
}

async function getStats() {
    const { count: pending } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .in('status', ['pending', 'proof_sent']);

    const { data: validatedData } = await supabase
        .from('orders')
        .select('amount_total')
        .eq('status', 'validated');

    const validated = validatedData?.length ?? 0;
    const totalAmount = validatedData?.reduce((s, r) => s + (Number(r.amount_total) || 0), 0) ?? 0;

    return {
        pending: pending ?? 0,
        validated,
        totalAmount,
        totalOrders: (pending ?? 0) + validated
    };
}

async function getOrdersByUserId(userId) {
    const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(rowToOrder);
}

// Finalisation apres livraison USSD reussie : passe la commande a credit_delivered
// / forfait_delivered (UPDATE idempotent). Absente auparavant -> les commandes
// restaient bloquees en 'validated'. Pas de colonne delivered_at/delivery_type en base.
async function setOrderDelivered(orderId, deliveryType = 'credit') {
    const status = deliveryType === 'forfait' ? 'forfait_delivered' : 'credit_delivered';
    const { error } = await supabase
        .from('orders')
        .update({ status })
        .eq('id', orderId);
    if (error) throw error;
    return getOrderById(orderId);
}

module.exports = {
    supabase,
    getOrderById,
    getOrdersPending: getAllOrders,
    getValidatedOrders,
    getOrdersByStatus,
    createOrder,
    updateOrderProof,
    setOrderValidated,
    setOrderRejected,
    setOrderDelivered,
    getStats,
    getOrdersByUserId
};
