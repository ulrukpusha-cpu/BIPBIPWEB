# MTN MoMo – Intégration paiement BipBip

Intégration de l’API **MTN MoMo Collection** (RequestToPay) pour les paiements en FCFA (XOF), déployable en Côte d’Ivoire (`mtnciv`).

## Prérequis

- **Supabase** configuré (table `momo_transactions` créée via `database/schema-momo-supabase.sql`).
- Compte **MTN MoMo Developer** et abonnement à l’API Collection (clés d’abonnement, API User, API Key).

## Architecture

```
User (Telegram / WebApp)  →  POST /api/momo/request-to-pay
                                    ↓
Backend crée RequestToPay MTN  →  Enregistrement PENDING en base
                                    ↓
MTN envoie PUT /api/momo/callback  OU  client fait GET /api/momo/poll-status/:id
                                    ↓
Mise à jour statut (SUCCESSFUL / FAILED)  →  Notification Telegram si SUCCESSFUL
```

## Structure du projet

```
services/mtn-momo/
  config.js     # Lecture des variables d’environnement (aucun secret en dur)
  auth.js       # OAuth2 Client Credentials + cache du token
  api.js        # requestToPay, getTransactionStatus
  index.js      # Export du module

database/
  schema-momo-supabase.sql   # Table momo_transactions (PostgreSQL)
  momo-repository.js        # Création / lecture / mise à jour des transactions

routes/
  momo.js       # Routes Express: request-to-pay, status, poll-status, callback
```

## Variables d’environnement

| Variable | Description |
|----------|-------------|
| `MTN_SUBSCRIPTION_KEY` | Clé d’abonnement (Ocp-Apim-Subscription-Key) |
| `MTN_API_USER` | API User fourni par MTN |
| `MTN_API_KEY` | API Key (secret) |
| `MTN_BASE_URL` | URL de l’API (sandbox ou production) |
| `MTN_TARGET_ENVIRONMENT` | Ex: `mtnciv` pour Côte d’Ivoire |
| `MTN_CALLBACK_SECRET` | (Optionnel) Secret partagé pour valider le callback PUT |
| `BIPBIP_MOMO_PHONE` | (Optionnel) Numéro MoMo affiché sur le site (ex. 0586205861) |

**Où l’argent est déposé :** Les virements API sont crédités sur le compte MoMo **lié à ton abonnement MTN** (pas un numéro envoyé dans la requête). `BIPBIP_MOMO_PHONE` sert uniquement à l’affichage sur le site.

Exemple `.env` (sandbox) :

```env
MTN_SUBSCRIPTION_KEY=xxx
MTN_API_USER=xxx
MTN_API_KEY=xxx
MTN_BASE_URL=https://sandbox.momodeveloper.mtn.com
MTN_TARGET_ENVIRONMENT=mtnciv
MTN_CALLBACK_SECRET=mon_secret_callback
```

## Base de données (Supabase)

1. Dans le **SQL Editor** Supabase, exécuter d’abord `database/schema-supabase.sql` (table `orders`).
2. Puis exécuter `database/schema-momo-supabase.sql` (table `momo_transactions`).

Colonnes principales : `reference_id`, `phone_number`, `amount`, `currency`, `status` (PENDING / SUCCESSFUL / FAILED), `order_id`, `telegram_chat_id`, `created_at`, `updated_at`.

## API exposée

| Méthode | Route | Description |
|---------|--------|-------------|
| POST | `/api/momo/request-to-pay` | Crée un RequestToPay et enregistre la transaction en PENDING. Body: `amount`, `phone`, `orderId?`, `telegramChatId?`, `payerMessage?`, `payeeNote?` |
| GET | `/api/momo/status/:referenceId` | Retourne la transaction depuis la base. |
| GET | `/api/momo/poll-status/:referenceId` | Interroge MTN, met à jour la base, notifie Telegram si SUCCESSFUL, puis retourne la transaction. |
| PUT | `/api/momo/callback` | Callback appelé par MTN. Body: `referenceId`, `status`. Optionnel: header `X-Callback-Secret` = `MTN_CALLBACK_SECRET`. |

## Sécurité

- **Secrets** : uniquement dans les variables d’environnement (pas de clés en dur).
- **Token** : cache jusqu’à expiration (rafraîchissement automatique).
- **Callback** : si `MTN_CALLBACK_SECRET` est défini, le serveur vérifie le header `X-Callback-Secret` et rejette en 401 si différent.

## Gestion des erreurs

- 400 : paramètres manquants ou invalides.
- 401 : callback non autorisé (secret incorrect).
- 404 : référence inconnue.
- 503 : MTN ou Supabase non configurés.
- 500 : erreur MTN ou base ; message d’erreur dans la réponse JSON.

## Intégration depuis le bot Telegram (Python)

Exemple d’appel depuis un script Python pour déclencher un paiement :

```python
import os
import requests

API_BASE = os.getenv("BIPBIP_API_URL", "https://ton-domaine.com")

def request_momo_payment(amount: int, phone: str, order_id: str = None, telegram_chat_id: str = None):
    r = requests.post(f"{API_BASE}/api/momo/request-to-pay", json={
        "amount": amount,
        "phone": phone,
        "orderId": order_id,
        "telegramChatId": telegram_chat_id,
    })
    r.raise_for_status()
    data = r.json()
    return data["referenceId"], data["status"]

# Après envoi du lien de paiement à l'utilisateur :
# ref_id, status = request_momo_payment(5000, "2250700000000", order_id="ABC123", telegram_chat_id="6735995998")
# L'utilisateur reçoit la demande MoMo sur son téléphone.
# Soit tu configures l'URL de callback chez MTN (PUT vers /api/momo/callback),
# soit le frontend / bot fait des GET /api/momo/poll-status/{ref_id} jusqu'à SUCCESSFUL ou FAILED.
```

## Suite possible

1. **Créer le projet Supabase** et exécuter les deux schémas SQL.
2. **Renseigner les variables MTN** dans `.env` (après obtention des clés via la procédure développeur MTN).
3. **Configurer l’URL de callback** dans le portail MTN (si disponible) : `https://ton-domaine.com/api/momo/callback`.
4. **Tester** : `POST /api/momo/request-to-pay` puis `GET /api/momo/poll-status/:referenceId` ou attendre le callback.
