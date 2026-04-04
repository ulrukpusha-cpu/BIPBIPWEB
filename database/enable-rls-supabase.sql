-- ==================== Activer RLS (Row Level Security) – Supabase ====================
-- À exécuter dans le SQL Editor du dashboard Supabase pour corriger l’erreur
-- "RLS handicapé en public" du Conseiller en sécurité.

-- Ton backend Node utilise la clé service_role, qui contourne le RLS.
-- Sans politique pour le rôle anon, les accès directs (clé anon) sont bloqués.

ALTER TABLE IF EXISTS orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS momo_transactions ENABLE ROW LEVEL SECURITY;

-- Aucune politique pour anon = aucun accès direct aux données depuis le client.
-- Le serveur BIPBIP (service_role) continue d’accéder à tout normalement.
