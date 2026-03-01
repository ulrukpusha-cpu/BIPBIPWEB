# Mise à jour des actualités (IA, RSS, OpenClaw)

## 1. Webhook d’ingestion (OpenClaw, API, météo)

Tu peux **envoyer des actualités** depuis un agent (OpenClaw), un script ou une API externe vers Bipbip.

### Endpoint

```
POST https://bipbiprecharge.ci/api/actualites/ingest
Header: X-Ingest-Key: <ta_clé_secrete>
Content-Type: application/json
```

### Clé

- Dans le `.env` du VPS : **`INGEST_SECRET_KEY=une_cle_secrete`**
- Si tu ne mets pas `INGEST_SECRET_KEY`, la route accepte la même clé que **`ADMIN_SECRET_KEY`** (header `X-Admin-Key` ou `X-Ingest-Key`).

### Body (JSON)

| Champ           | Obligatoire | Description                                      |
|----------------|-------------|--------------------------------------------------|
| `title`        | oui         | Titre de l’actualité (max 255 caractères)        |
| `content`      | oui         | Texte complet                                    |
| `summary_short`| non         | Résumé court (max 500 car.)                      |
| `sources`      | non         | Tableau `[{ "name": "...", "url": "..." }]` ou chaîne JSON |
| `auto_approve` | non         | `true` = publié tout de suite, sinon en attente |

### Exemples

**Actualité (en attente de validation admin) :**
```json
{
  "title": "Météo Abidjan : 32°C, ensoleillé",
  "content": "Prévisions pour la journée. Vent faible.",
  "summary_short": "32°C, ensoleillé.",
  "sources": [{ "name": "OpenClaw Météo", "url": "https://..." }]
}
```

**Publication directe (sans modération) :**
```json
{
  "title": "Flash info",
  "content": "Contenu...",
  "summary_short": "Résumé.",
  "auto_approve": true
}
```

OpenClaw (ou tout client HTTP) peut appeler cet endpoint avec la clé en header pour envoyer des news, météo, etc.

---

## 2. Flux RSS (actualités automatiques)

Un cron récupère des flux RSS et crée des actualités en **pending** (à valider en admin).

### Configuration (.env sur le VPS)

```env
# Un seul flux
RSS_FEED_URL=https://www.fratmat.info/feed/

# Ou plusieurs (séparés par des virgules)
RSS_FEED_URLS=https://www.fratmat.info/feed/,https://autre-site.com/feed.xml
```

### Lancer le cron

**À la main :**
```bash
cd /root/var/www/BIPBIPWEB
node cron/fetchNewsRss.js
```

**Automatique (crontab, ex. toutes les heures) :**
```bash
0 * * * * cd /root/var/www/BIPBIPWEB && node cron/fetchNewsRss.js
```

Les articles récupérés sont en statut **pending**. Tu les valides via l’API admin :

- `GET /api/actualites/admin/pending` (header `X-Admin-Key`) pour lister
- `POST /api/actualites/admin/:id/approve` pour approuver

---

## 3. Récap : garder les actualités à jour

| Méthode              | Rôle                                      |
|----------------------|-------------------------------------------|
| **Ingest (webhook)** | OpenClaw / script envoie news, météo, etc. |
| **RSS (cron)**       | Import auto depuis des sites d’actualités  |
| **Admin**            | Validation des articles en attente        |

Après déploiement, ajoute `INGEST_SECRET_KEY` (ou utilise `ADMIN_SECRET_KEY`) et, si tu veux du RSS, `RSS_FEED_URL` ou `RSS_FEED_URLS` dans le `.env` du VPS.
