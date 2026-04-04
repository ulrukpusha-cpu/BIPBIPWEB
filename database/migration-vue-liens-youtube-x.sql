-- Vue Supabase : Liens YouTube / X (visible dans Table Editor)
-- À exécuter dans Supabase → SQL Editor

-- Vue des utilisateurs avec lien social enregistré (table telegram_users)
CREATE OR REPLACE VIEW public.v_liens_youtube_x AS
SELECT
    telegram_id,
    first_name,
    last_name,
    username,
    social_link AS lien_youtube_ou_x,
    updated_at AS date_mise_a_jour
FROM public.telegram_users
WHERE social_link IS NOT NULL AND TRIM(social_link) <> '';

COMMENT ON VIEW public.v_liens_youtube_x IS 'Liens chaîne YouTube ou compte X enregistrés par les clients (profil Mini App)';
