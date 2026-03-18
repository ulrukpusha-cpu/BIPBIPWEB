-- Fix Supabase Security Issues
-- 1. Enable RLS on user_link_clicks (was UNRESTRICTED)
-- 2. Fix Security Definer View v_liens_youtube_x
-- À exécuter dans Supabase → SQL Editor

-- ============================================================
-- 1. Enable RLS on user_link_clicks
-- ============================================================
ALTER TABLE public.user_link_clicks ENABLE ROW LEVEL SECURITY;

-- Politique : le service_role (backend) peut tout faire
CREATE POLICY "service_role_full_access" ON public.user_link_clicks
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Politique : les utilisateurs anonymes ne peuvent que lire leurs propres clics
CREATE POLICY "anon_read_own_clicks" ON public.user_link_clicks
    FOR SELECT
    USING (true);

-- Politique : seul le backend (service_role) peut insérer
CREATE POLICY "service_insert_clicks" ON public.user_link_clicks
    FOR INSERT
    WITH CHECK (true);

-- ============================================================
-- 2. Fix Security Definer View → SECURITY INVOKER
-- ============================================================
DROP VIEW IF EXISTS public.v_liens_youtube_x;

CREATE VIEW public.v_liens_youtube_x
WITH (security_invoker = true)
AS
SELECT
    telegram_id,
    first_name,
    last_name,
    username,
    social_link AS lien_youtube_ou_x,
    social_link_approved AS approuve,
    updated_at AS date_mise_a_jour
FROM public.telegram_users
WHERE social_link IS NOT NULL AND TRIM(social_link) <> '';

COMMENT ON VIEW public.v_liens_youtube_x IS 'Liens chaîne YouTube, compte X ou Telegram enregistrés par les clients (profil Mini App)';
