// ==================== BIPBIP - Stockage (JSON ou MySQL) ====================
const fs = require('fs');
const path = require('path');

const ORDERS_FILE = path.join(__dirname, 'data', 'orders.json');
const useSupabase = process.env.USE_SUPABASE === 'true' && process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
const useMysql = process.env.USE_MYSQL === 'true' && process.env.DB_USER && process.env.DB_PASSWORD;

let orders = {};
let validatedOrders = [];

// ---------- Mode fichier JSON ----------
function ensureDataDir() {
    const dir = path.join(__dirname, 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
}

function loadOrdersFile() {
    ensureDataDir();
    if (fs.existsSync(ORDERS_FILE)) {
        const data = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
        orders = data.orders || {};
        validatedOrders = data.validatedOrders || [];
    }
}

function saveOrdersFile() {
    ensureDataDir();
    fs.writeFileSync(ORDERS_FILE, JSON.stringify({ orders, validatedOrders }, null, 2));
}

// API commune (mode JSON)
const jsonStorage = {
    async getOrderById(orderId) {
        if (orders[orderId]) return orders[orderId];
        return validatedOrders.find(o => o.id === orderId) || null;
    },

    async getOrdersByUserId(userId) {
        const fromPending = Object.values(orders).filter(o => o.userId === userId);
        const fromValidated = validatedOrders.filter(o => o.userId === userId);
        return [...fromPending, ...fromValidated].sort(
            (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        );
    },

    async createOrder(order) {
        orders[order.id] = {
            ...order,
            createdAt: order.createdAt || new Date().toISOString()
        };
        saveOrdersFile();
        return order;
    },

    async updateOrderProof(orderId, proofPath, status = 'proof_sent', paymentMethod) {
        if (!orders[orderId]) return null;
        orders[orderId].proof = proofPath;
        orders[orderId].status = status;
        if (paymentMethod != null && paymentMethod !== '') {
            orders[orderId].paymentMethod = String(paymentMethod);
        }
        saveOrdersFile();
        return orders[orderId];
    },

    async setOrderValidated(orderId) {
        const order = orders[orderId];
        if (!order) return null;
        order.status = 'validated';
        order.validatedAt = new Date().toISOString();
        validatedOrders.push({ ...order });
        delete orders[orderId];
        saveOrdersFile();
        return order;
    },

    async setOrderRejected(orderId, reason) {
        const order = orders[orderId] || validatedOrders.find(o => o.id === orderId);
        if (!order) return null;
        order.status = 'rejected';
        order.rejectedAt = new Date().toISOString();
        order.rejectReason = reason || 'Non spécifié';
        if (orders[orderId]) {
            delete orders[orderId];
        }
        saveOrdersFile();
        return order;
    },

    async getOrdersPending() {
        return Object.values(orders);
    },

    async getValidatedOrders() {
        return [...validatedOrders];
    },

    async getOrdersByStatus(status) {
        if (status === 'validated') return jsonStorage.getValidatedOrders();
        return Object.values(orders).filter(o => o.status === status);
    },

    async getStats() {
        const pending = Object.values(orders).length;
        const validated = validatedOrders.length;
        const totalAmount = validatedOrders.reduce((s, o) => s + (o.amountTotal || o.amount || 0), 0);
        return { pending, validated, totalAmount, totalOrders: pending + validated };
    }
};

// Charger le fichier au démarrage (mode JSON)
loadOrdersFile();

// ---------- Export : Supabase > MySQL > JSON ----------
let storage = jsonStorage;

if (useSupabase) {
    try {
        const db = require('./database/db-supabase');
        storage = {
            getOrderById: db.getOrderById,
            getOrdersByUserId: db.getOrdersByUserId,
            createOrder: db.createOrder,
            updateOrderProof: db.updateOrderProof,
            setOrderValidated: db.setOrderValidated,
            setOrderRejected: db.setOrderRejected,
            getOrdersPending: db.getOrdersPending,
            getValidatedOrders: db.getValidatedOrders,
            getOrdersByStatus: db.getOrdersByStatus,
            getStats: db.getStats
        };
        console.log('[Storage] Supabase activé');
    } catch (err) {
        console.warn('[Storage] Supabase non disponible, utilisation du fichier JSON:', err.message);
    }
} else if (useMysql) {
    try {
        const db = require('./database/db');
        storage = {
            getOrderById: db.getOrderById,
            getOrdersByUserId: db.getOrdersByUserId,
            createOrder: db.createOrder,
            updateOrderProof: db.updateOrderProof,
            setOrderValidated: db.setOrderValidated,
            setOrderRejected: db.setOrderRejected,
            getOrdersPending: db.getOrdersPending,
            getValidatedOrders: db.getValidatedOrders,
            getOrdersByStatus: db.getOrdersByStatus,
            getStats: db.getStats
        };
        console.log('[Storage] MySQL activé (bipbip_recharge)');
    } catch (err) {
        console.warn('[Storage] MySQL non disponible, utilisation du fichier JSON:', err.message);
    }
} else {
    console.log('[Storage] Fichier JSON (data/orders.json)');
}

module.exports = storage;
