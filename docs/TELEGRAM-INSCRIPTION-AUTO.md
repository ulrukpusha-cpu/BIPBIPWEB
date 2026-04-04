# Inscription automatique des utilisateurs Telegram

Quand un client ouvre la Mini App depuis Telegram (avec `initData` valide), le serveur enregistre automatiquement son **ID Telegram** et sa **photo de profil** dans la table `telegram_users`.

## Prérequis

1. **Table Supabase** : la table doit s’appeler **`telegram_users`** avec les colonnes exactes du script (voir ci‑dessous). Si tu as créé une table avec un autre nom (ex. `utilisateurs_télégramme`), soit tu recrées la table avec le script, soit tu mets dans le `.env` : `TELEGRAM_USERS_TABLE=utilisateurs_télégramme` — **les noms de colonnes doivent rester** : `telegram_id`, `username`, `first_name`, `last_name`, `language_code`, `photo_url`, `created_at`, `updated_at`.
2. **Bot Telegram** : `TELEGRAM_BOT_TOKEN` dans le `.env` (déjà requis pour la Mini App).

## Création de la table

Dans **Supabase** → **Éditeur SQL** → Nouvelle requête, coller et exécuter le contenu de :

**`database/schema-telegram-users.sql`**

Cela crée la table `telegram_users` avec : `telegram_id`, `username`, `first_name`, `last_name`, `language_code`, `photo_url`, `created_at`, `updated_at`.

## Comportement

- **Côté client** : au chargement de l’app, si l’utilisateur est connecté via Telegram (`tg.initData` présent), un `POST /api/telegram/register` est envoyé avec l’en-tête `X-Telegram-Init-Data`.
- **Côté serveur** : le middleware valide `initData`, puis le service :
  - insère ou met à jour la ligne dans `telegram_users` (ID, username, prénom, nom, langue) ;
  - appelle l’API Telegram `getUserProfilePhotos` pour récupérer la photo de profil ;
  - télécharge la photo et la sauvegarde dans `uploads/telegram-avatars/<telegram_id>.jpg` ;
  - enregistre dans `photo_url` le chemin public (ex. `/uploads/telegram-avatars/123456.jpg`).

L’utilisateur enregistré est disponible côté client dans `window.__bipbipRegisteredUser` après la réponse (optionnel, pour afficher la photo dans l’UI).

## Sécurité

- La route `/api/telegram/register` exige une **authentification Telegram** valide (`initData` signé par le bot).
- La table `telegram_users` est protégée par RLS ; seul le backend (clé `service_role`) y a accès.

## Utilisation des données

- **ID** : `telegram_id` — pour lier commandes, quêtes, annonces, etc.
- **Photo** : `photo_url` — URL publique (ex. `https://bipbiprecharge.ci/uploads/telegram-avatars/123456.jpg`) pour afficher l’avatar dans le profil ou les listes.

## Dépannage (l’inscription ne fait rien)

1. **Ouvrir la Mini App depuis Telegram** (pas dans un navigateur) : l’`initData` n’existe que quand l’app est lancée depuis le client Telegram.
2. **Logs serveur** : `pm2 logs BIPBIPWEB`. Tu dois voir au moins `[Register] POST /api/telegram/register`. Si tu vois `401 — initData absent ou invalide`, la requête arrive sans initData valide. Si tu vois `Erreur getOrCreateUser: ...`, c’est souvent une table Supabase manquante ou un mauvais nom de table.
3. **Table Supabase** : le code utilise la table **`telegram_users`** (ou la valeur de `TELEGRAM_USERS_TABLE` dans le `.env`). Les colonnes doivent être en anglais : `telegram_id`, `username`, `first_name`, `last_name`, `language_code`, `photo_url`, `created_at`, `updated_at`. Si ta table a un autre nom (ex. `utilisateurs_télégramme`), ajoute dans le `.env` : `TELEGRAM_USERS_TABLE=utilisateurs_télégramme` (et vérifie que les noms de colonnes correspondent).
4. **Console navigateur** (dans Telegram : ouvrir la Web App puis inspecter / logs) : tu devrais voir `[Bipbip] Inscription auto — envoi POST` puis soit `Utilisateur enregistré`, soit `Register réponse: 401/500 ...`.
5. **Redémarrer l’app** après toute modification du `.env` : `pm2 restart BIPBIPWEB`.
