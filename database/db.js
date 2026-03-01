// ==================== BIPBIP - Connexion MySQL ====================
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'bipbip_recharge',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

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
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        validatedAt: row.validated_at ? new Date(row.validated_at).toISOString() : null,
        rejectedAt: row.rejected_at ? new Date(row.rejected_at).toISOString() : null,
        rejectReason: row.reject_reason
    };
}

async function getOrderById(orderId) {
    const [rows] = await pool.execute('SELECT * FROM orders WHERE id = ?', [orderId]);
    return rowToOrder(rows[0]);
}

async function getOrdersPending() {
    const [rows] = await pool.execute(
        "SELECT * FROM orders WHERE status IN ('pending', 'proof_sent') ORDER BY created_at DESC"
    );
    return rows.map(rowToOrder);
}

async function getValidatedOrders() {
    const [rows] = await pool.execute(
        "SELECT * FROM orders WHERE status = 'validated' ORDER BY validated_at DESC"
    );
    return rows.map(rowToOrder);
}

async function getOrdersByStatus(status) {
    if (status === 'validated') return getValidatedOrders();
    const [rows] = await pool.execute('SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC', [status]);
    return rows.map(rowToOrder);
}

async function getAllOrders() {
    const [rows] = await pool.execute("SELECT * FROM orders WHERE status IN ('pending', 'proof_sent') ORDER BY created_at DESC");
    return rows.map(rowToOrder);
}

async function createOrder(order) {
    await pool.execute(
        `INSERT INTO orders (id, user_id, username, operator, amount, amount_total, phone, proof, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
            order.id,
            order.userId || null,
            order.username || null,
            order.operator,
            order.amount,
            order.amountTotal || order.amount,
            order.phone,
            order.proof || null,
            order.status || 'pending'
        ]
    );
    return order;
}

async function updateOrderProof(orderId, proofPath, status = 'proof_sent') {
    await pool.execute(
        'UPDATE orders SET proof = ?, status = ? WHERE id = ?',
        [proofPath, status, orderId]
    );
    return getOrderById(orderId);
}

async function setOrderValidated(orderId) {
    await pool.execute(
        "UPDATE orders SET status = 'validated', validated_at = NOW() WHERE id = ?",
        [orderId]
    );
    return getOrderById(orderId);
}

async function setOrderRejected(orderId, reason) {
    await pool.execute(
        'UPDATE orders SET status = \'rejected\', rejected_at = NOW(), reject_reason = ? WHERE id = ?',
        [reason || 'Non spécifié', orderId]
    );
    return getOrderById(orderId);
}

async function getStats() {
    const [pendingRows] = await pool.execute(
        "SELECT COUNT(*) as c FROM orders WHERE status IN ('pending', 'proof_sent')"
    );
    const [validatedRows] = await pool.execute(
        "SELECT COUNT(*) as c, COALESCE(SUM(amount_total), 0) as total FROM orders WHERE status = 'validated'"
    );
    return {
        pending: pendingRows[0].c,
        validated: validatedRows[0].c,
        totalAmount: validatedRows[0].total,
        totalOrders: pendingRows[0].c + validatedRows[0].c
    };
}

async function getOrdersByUserId(userId) {
    const [rows] = await pool.execute('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', [userId]);
    return rows.map(rowToOrder);
}

module.exports = {
    pool,
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
