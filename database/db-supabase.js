// ==================== BIPBIP - Connexion Supabase (PostgreSQL) ====================
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_ANON_KEY) doivent être définis dans .env');
}

const supabase = createClient(supabaseUrl, supabaseKey);

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
        rejectReason: row.reject_reason
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
    const { data, error } = await supabase
        .from('orders')
        .select('*')
        .in('status', ['pending', 'proof_sent'])
        .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(rowToOrder);
}

async function getValidatedOrders() {
    const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('status', 'validated')
        .order('validated_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(rowToOrder);
}

async function getOrdersByStatus(status) {
    if (status === 'validated') return getValidatedOrders();
    const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('status', status)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(rowToOrder);
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

async function updateOrderProof(orderId, proofPath, status = 'proof_sent') {
    const { error } = await supabase
        .from('orders')
        .update({ proof: proofPath, status })
        .eq('id', orderId);
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
    getStats,
    getOrdersByUserId
};
