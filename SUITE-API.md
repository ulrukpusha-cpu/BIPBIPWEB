# Suite : faire fonctionner l’API BIPBIPWEB

## 1. Vérifier la base Supabase

L’API Node attend une table nommée **`orders`** (en anglais) avec ces colonnes :

- `id`, `user_id`, `username`, `operator`, `amount`, `amount_total`, `phone`, `proof`, `status`, `created_at`, `validated_at`, `rejected_at`, `reject_reason`

Si tu as créé une table **`commandes`** avec des noms en français, soit :

- **Option A** : Dans le **SQL Editor** Supabase, exécute tout le fichier **`database/schema-supabase.sql`**. Ça crée la table **`orders`** avec la bonne structure. Tu peux garder ou supprimer `commandes` selon ton besoin.
- **Option B** : Garder uniquement `orders` et utiliser seulement celle-ci pour l’API.

Pour les paiements MTN MoMo, il faut aussi la table **`momo_transactions`** : exécute **`database/schema-momo-supabase.sql`** dans le SQL Editor si ce n’est pas déjà fait.

---

## 2. Configurer le fichier `.env`

À la racine du projet, copie `.env.example` vers `.env` (si besoin) et remplis au minimum :

```env
PORT=3000
TELEGRAM_BOT_TOKEN=ton_vrai_token_bot
ADMIN_CHAT_ID=ton_chat_id_telegram

# Supabase (obligatoire pour que l’API utilise la base)
USE_SUPABASE=true
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...ta_cle...
```

- **SUPABASE_URL** et **SUPABASE_SERVICE_ROLE_KEY** : dans Supabase → **Project Settings** → **API** (Project URL et clé **service_role**, pas anon).

---

## 3. Lancer l’API

```bash
npm install
npm start
```

Tu dois voir dans la console :

- `[Storage] Supabase activé`
- Le serveur sur `http://localhost:3000`

---

## 4. Tester l’API (commandes)

- **Créer une commande**  
  `POST http://localhost:3000/api/orders`  
  Body (JSON) :  
  `{ "operator": "MTN", "amount": 500, "amountTotal": 500, "phone": "0700000000", "userId": "123", "username": "test" }`

- **Vérifier en base**  
  Dans Supabase → **Table Editor** → table **`orders`** : une ligne doit apparaître.

---

## 5. (Optionnel) Activer MTN MoMo

Quand tu as tes clés MTN (procédure développeur) :

1. Ajouter dans `.env` :

```env
MTN_SUBSCRIPTION_KEY=...
MTN_API_USER=...
MTN_API_KEY=...
MTN_BASE_URL=https://sandbox.momodeveloper.mtn.com
MTN_TARGET_ENVIRONMENT=mtnciv
```

2. Table **`momo_transactions`** créée (voir étape 1).
3. Tester un paiement :  
  `POST http://localhost:3000/api/momo/request-to-pay`  
  Body :  
  `{ "amount": 100, "phone": "2250700000000", "telegramChatId": "ton_chat_id" }`

Détails : **README-MOMO.md**.

---

## Récap

| Étape | Action |
|-------|--------|
| 1 | Table **`orders`** (schéma anglais) + **`momo_transactions`** si tu veux MoMo |
| 2 | `.env` avec Supabase (et Telegram, MTN si besoin) |
| 3 | `npm start` → vérifier « Supabase activé » |
| 4 | Tester `POST /api/orders` et regarder la table `orders` dans Supabase |
| 5 | Quand tu as les clés MTN, remplir les variables MTN et tester `/api/momo/request-to-pay` |
