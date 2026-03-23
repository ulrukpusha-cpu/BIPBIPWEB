# Liens YouTube / X dans Supabase

## Vue dédiée (recommandé)

Exécute dans Supabase → **SQL Editor** le fichier **`database/migration-vue-liens-youtube-x.sql`**.

Cela crée la **vue** **`v_liens_youtube_x`**, visible dans le Table Editor (onglet Tables / Views) avec :
- `telegram_id`, `first_name`, `last_name`, `username`
- `lien_youtube_ou_x` (le lien)
- `date_mise_a_jour`

Tu peux ouvrir cette vue comme une table pour voir tous les liens enregistrés par les clients.

## Tables brutes

- **telegram_users** → colonne **`social_link`** (lien enregistré dans le Profil).
- **orders** → colonne **`notes`** pour les commandes promo (operator = `PROMO_LIKES`) : `lien | formule | montant F`.
