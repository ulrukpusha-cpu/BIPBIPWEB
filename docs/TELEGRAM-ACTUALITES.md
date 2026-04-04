# Commande /actualites dans le bot Telegram

## Commandes reconnues

- `/actualites`
- `/actualites_pending`
- `/actualité` ou `/actualités` (avec accent)

Réservé aux **admins** (voir ci‑dessous).

## Pourquoi rien ne se passe ?

### 1. Vérifier que le webhook reçoit les **messages**

Telegram n’envoie que les types d’updates demandés. Si le webhook a été enregistré en ne permettant que les **callback_query**, les **messages** (dont `/actualites`) ne sont pas envoyés.

À faire : appeler l’API Telegram pour (re)définir le webhook en autorisant les messages :

```bash
# Remplace TON_TOKEN et https://ton-domaine.com par tes valeurs
curl -X POST "https://api.telegram.org/bot<TON_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"https://ton-domaine.com/api/telegram/webhook\", \"allowed_updates\": [\"message\", \"edited_message\", \"callback_query\"]}"
```

Sans `allowed_updates` ou avec uniquement `callback_query`, la commande `/actualites` n’arrivera jamais au serveur.

### 2. Vérifier ADMIN_CHAT_ID

Seul le chat_id configuré en admin peut utiliser `/actualites`.

- Dans le `.env` (sur le serveur où tourne l’app) :
  - `ADMIN_CHAT_ID=ton_chat_id` (un seul admin)
  - ou `ADMIN_CHAT_IDS=id1,id2,id3` (plusieurs admins)

- Pour connaître **ton** chat_id :
  1. Envoie un message à ton bot.
  2. Ouvre : `https://api.telegram.org/bot<TON_TOKEN>/getUpdates`
  3. Dans la réponse, repère `"chat":{"id": 123456789}` → c’est ton chat_id.

Si ton chat_id n’est pas dans `ADMIN_CHAT_ID` / `ADMIN_CHAT_IDS`, le bot te répond maintenant **« Accès réservé aux admins »** (au lieu de ne rien faire).

### 3. Redémarrer l’app

Après toute modification du `.env` :

```bash
pm2 restart BIPBIPWEB
```

### 4. Logs

En développement (`NODE_ENV !== 'production'`), le serveur log chaque message reçu par le webhook : `chat_id`, `text`, `adminIds`, `isAdmin`. Regarde la console pour vérifier que le message arrive et que ton chat_id est bien admin.
