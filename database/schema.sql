-- ==================== BIPBIP RECHARGE CI - Schéma MySQL ====================
-- Exécuter ce script dans MySQL pour créer la base et la table des commandes.

CREATE DATABASE IF NOT EXISTS bipbip_recharge CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE bipbip_recharge;

CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(20) PRIMARY KEY,
    user_id VARCHAR(50) NULL,
    username VARCHAR(100) NULL,
    operator VARCHAR(20) NOT NULL,
    amount INT NOT NULL,
    amount_total INT NOT NULL,
    phone VARCHAR(20) NOT NULL,
    proof VARCHAR(500) NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    validated_at DATETIME NULL,
    rejected_at DATETIME NULL,
    reject_reason TEXT NULL
);

CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at);
CREATE INDEX idx_orders_user_id ON orders(user_id);
