# Liste de flux RSS (max 6) + où mettre les clés API

## 1. Liste de 6 flux RSS recommandés

Tu peux en utiliser jusqu’à 6 (ou moins). À mettre dans le **.env du VPS** (pas sur un site externe).

| # | Site / Thème | URL du flux RSS |
|---|----------------|------------------|
| 1 | **RFI – Actualités** | `https://www.rfi.fr/fr/rss` |
| 2 | **RFI – Afrique** | `https://www.rfi.fr/fr/afrique/rss` |
| 3 | **Fratmat (Côte d’Ivoire)** | `https://www.fratmat.info/feed/` |
| 4 | **BBC Afrique** | `https://feeds.bbci.co.uk/french/rss.xml` |
| 5 | **Le Monde – Afrique** | `https://www.lemonde.fr/afrique/rss_full.xml` |
| 6 | **Jeune Afrique** | `https://www.jeuneafrique.com/feed/` |

### Dans le .env du VPS (un seul flux)

```env
RSS_FEED_URL=https://www.rfi.fr/fr/afrique/rss
```

### Dans le .env du VPS (plusieurs flux, max 6)

```env
RSS_FEED_URLS=https://www.rfi.fr/fr/rss,https://www.rfi.fr/fr/afrique/rss,https://www.fratmat.info/feed/,https://feeds.bbci.co.uk/french/rss.xml,https://www.lemonde.fr/afrique/rss_full.xml,https://www.jeuneafrique.com/feed/
```

Les flux sont lus par le script **cron** (`node cron/fetchNewsRss.js`). Aucune clé à mettre sur ces sites : ce sont juste des URLs que ton serveur appelle en lecture.

---

## 2. Où mettre **X-Ingest-Key** ou **X-Admin-Key** ?

Ces clés ne se mettent **pas** sur un site de flux RSS.  
Elles se mettent **dans la requête HTTP** quand **toi** (ou OpenClaw, ou Postman, ou un script) tu appelles **ton** API sur `bipbiprecharge.ci`.

### Cas 1 : OpenClaw ou un script envoie des actualités vers ton site

Quelqu’un (ou un outil) fait un **POST** vers :

`https://bipbiprecharge.ci/api/actualites/ingest`

Dans cette requête HTTP, il faut ajouter un **header** (en-tête) :

- Soit **`X-Ingest-Key: ta_cle_secrete`**
- Soit **`X-Admin-Key: ta_cle_secrete`** (si tu n’as pas défini `INGEST_SECRET_KEY` dans le .env)

Où « ta_cle_secrete » = la valeur de **`INGEST_SECRET_KEY`** (ou **`ADMIN_SECRET_KEY`**) dans le **.env du VPS**.

En résumé :

- **Où** : dans les **headers** de la requête POST vers **ton** API (`/api/actualites/ingest`).
- **Pas où** : sur les sites des flux RSS (RFI, Fratmat, etc.) ; eux ne voient jamais cette clé.

### Cas 2 : Toi tu valides des actualités en admin (pending → approuver)

Tu appelles par exemple :

- `GET https://bipbiprecharge.ci/api/actualites/admin/pending`
- `POST https://bipbiprecharge.ci/api/actualites/admin/:id/approve`

Là aussi, la clé va **dans la requête** que tu envoies vers **bipbiprecharge.ci**, en header :

- **`X-Admin-Key: ta_cle_secrete`**

Même logique : la clé est dans l’en-tête HTTP de l’appel à **ton** API, pas sur un site externe.

---

## 3. Récapitulatif

| Élément | Où le mettre |
|--------|---------------|
| **Liste des 6 flux RSS** | Dans le **.env du VPS** : `RSS_FEED_URL=...` ou `RSS_FEED_URLS=...` (voir exemples ci-dessus). |
| **X-Ingest-Key** | Dans le **header** de la requête POST vers `https://bipbiprecharge.ci/api/actualites/ingest` (OpenClaw, script, Postman). |
| **X-Admin-Key** | Dans le **header** de toute requête vers les routes `/api/actualites/admin/...` ou, si tu n’as pas `INGEST_SECRET_KEY`, aussi pour `/api/actualites/ingest`. |
| **Valeur de la clé** | Dans le **.env du VPS** : `ADMIN_SECRET_KEY=...` et optionnellement `INGEST_SECRET_KEY=...`. |

Les sites de flux RSS (RFI, Fratmat, etc.) ne reçoivent jamais ces clés ; seules les requêtes vers **ton** domaine (bipbiprecharge.ci) doivent contenir **X-Ingest-Key** ou **X-Admin-Key** dans les headers.
