# Prompt pour Claude Code — Mise à jour USSD Orange CI (Marchand)

> **Comment utiliser** : ouvre Claude Code dans `C:\Users\ASUS\Desktop\ulruk` (ou le dossier qui contient ussd-gateway + ussd-dashboard), puis colle ce prompt en entier.

---

## Contexte

Je viens d'obtenir une nouvelle puce **Orange CI Marchand**. Les codes USSD Orange utilisés par le service Bipbip Recharge changent : il faut désormais utiliser les codes **Marchand** (`#161*…*CODE#`) au lieu des codes client classiques.

Trois composants à mettre à jour :

1. **`ussd-gateway`** — Node.js qui exécute les commandes USSD via modem 4G (Huawei / SIM800). C'est ce module qui envoie réellement `#161*0708552636*1*500*CODE#` au réseau pour faire un transfert.
2. **`ussd-dashboard`** — interface web qui pilote le gateway, montre les forfaits disponibles, permet de tester les codes.
3. **(éventuellement) `data/orange-bundles.json`** — catalogue des forfaits exposés via `GET /api/bundles/orange` (consommé par l'APK Bipbip).

Les sources sont sur mon GitHub + dans le dossier local `C:\Users\ASUS\Desktop\ulruk\` (à toi de localiser les bons sous-dossiers — probablement `ussd-gateway/` et `ussd-dashboard/`).

Le VPS expose le gateway sur `localhost:3002`. Le serveur Bipbip (`bipbiprecharge.ci`) le proxy via `GET /api/bundles/orange` et `POST /api/bundle/subscribe` → forward → exécution USSD.

---

## Convention de format dans les codes

- `<phone>` = numéro destinataire (10 chiffres sans `+225`, ex `0708552636`)
- `<amount>` = montant en FCFA, entier
- `<CODE>` = code secret marchand de la puce Orange (NE JAMAIS hardcoder dans le repo, doit venir de `process.env.ORANGE_MERCHANT_CODE` ou équivalent)

---

## Nouveau catalogue complet à intégrer

### Solde + Transfert + Commission

```
solde                 : #145*611*CODE#
transfert crédit      : #161*<phone>*1*<amount>*CODE#
voir commission (BNF) : #161*2*CODE#
```

### Internet — Pass 1 à 3 jours (menu `3*2`)

| # | Nom                                | Prix | Code |
|---|------------------------------------|------|------|
| 1 | Pass 2 jrs                         | 200 F | `#161*<phone>*3*2*1*CODE#` |
| 2 | Pass 2 jrs                         | 300 F | `#161*<phone>*3*2*2*CODE#` |
| 3 | 3 jours 340 Mo + Live TV           | 400 F | `#161*<phone>*3*2*3*CODE#` |
| 4 | Pass 3 jours                       | 400 F | `#161*<phone>*3*2*4*CODE#` |
| 5 | Pass 3 jours                       | 500 F | `#161*<phone>*3*2*5*CODE#` |
| 6 | Pass spécial 3 jrs                 | 500 F | `#161*<phone>*3*2*6*CODE#` |
| 7 | Pass Megawin 1 Go                  | 500 F | `#161*<phone>*3*2*7*CODE#` |
| 8 | Pass 3 jrs 750 Mo + Vidéo Cuisine  | 700 F | `#161*<phone>*3*2*8*CODE#` |

### Internet — Pass 5 à 7 jours (menu `3*3`)

| # | Nom                                                | Prix   | Code |
|---|----------------------------------------------------|--------|------|
| 1 | Pass semaine                                       | 800 F  | `#161*<phone>*3*3*1*CODE#` |
| 2 | Pass 5 jrs                                         | 1000 F | `#161*<phone>*3*3*2*CODE#` |
| 3 | Pass Semaine 1.5 Go + Orange Music Talent          | 1200 F | `#161*<phone>*3*3*3*CODE#` |
| 4 | Pass semaine                                       | 1500 F | `#161*<phone>*3*3*4*CODE#` |

### Internet — Pass réseaux sociaux (menu `3*1`)

| # | Nom                  | Prix  | Code |
|---|----------------------|-------|------|
| 1 | Pass Social          | 300 F | `#161*<phone>*3*1*1*CODE#` |
| 2 | Pass Social TikTok   | 300 F | `#161*<phone>*3*1*2*CODE#` |
| 3 | Pass Social          | 500 F | `#161*<phone>*3*1*3*CODE#` |

### Internet — Mois (menu `3*4`)

| # | Nom        | Prix     | Code |
|---|------------|----------|------|
| 1 | Pass Mois  | 2500 F   | `#161*<phone>*3*4*1*CODE#` |
| 2 | Pass Mois  | 3000 F   | `#161*<phone>*3*4*2*CODE#` |
| 3 | Pass Mois  | 5000 F   | `#161*<phone>*3*4*3*CODE#` |
| 4 | Pass Mois  | 10000 F  | `#161*<phone>*3*4*4*CODE#` |
| 5 | Pass Mois  | 20000 F  | `#161*<phone>*3*4*5*CODE#` |

### Internet — Nuit (menu `3*5`)

| # | Nom              | Prix  | Code |
|---|------------------|-------|------|
| 1 | Pass Internet Nuit | 250 F | `#161*<phone>*3*5*1*CODE#` |

### Internet — Illimité (menu `6*1`)

| # | Nom                              | Prix  | Code |
|---|----------------------------------|-------|------|
| 1 | Pass Social Illimité AC 24 h     | 500 F | `#161*<phone>*6*1*1*CODE#` |
| 2 | Pass Illimité AC + TikTok 24 h   | 800 F | `#161*<phone>*6*1*2*CODE#` |

### Appel — Pass 1 à 3 jours (menu `2*1`)

| # | Nom                                | Prix  | Code |
|---|------------------------------------|-------|------|
| 1 | Pass Minutes 1 jour                | 200 F | `#161*<phone>*2*1*1*CODE#` |
| 2 | Pass Mix 2 jrs                     | 300 F | `#161*<phone>*2*1*2*CODE#` |
| 3 | Pass Mix                           | 400 F | `#161*<phone>*2*1*3*CODE#` |
| 4 | Pass Mix 3 jrs + Veedz TV          | 600 F | `#161*<phone>*2*1*4*CODE#` |

### Appel — Pass 5 à 7 jours (menu `2*2`)

| # | Nom                                       | Prix   | Code |
|---|-------------------------------------------|--------|------|
| 1 | Pass Mix 5 jrs                            | 500 F  | `#161*<phone>*2*2*1*CODE#` |
| 2 | Pass Mix 7 jrs + Veedz TV                 | 700 F  | `#161*<phone>*2*2*2*CODE#` |
| 3 | Pass Mix semaine                          | 1000 F | `#161*<phone>*2*2*3*CODE#` |
| 4 | Pass Mix 7 jrs + Veedz TV                 | 1200 F | `#161*<phone>*2*2*4*CODE#` |
| 5 | Pass Mix semaine                          | 1500 F | `#161*<phone>*2*2*5*CODE#` |

### Appel — Mois (menu `2*3`)

| # | Nom        | Prix     | Code |
|---|------------|----------|------|
| 1 | Pass Mix   | 3000 F   | `#161*<phone>*2*3*1*CODE#` |
| 2 | Pass Mix   | 5000 F   | `#161*<phone>*2*3*2*CODE#` |
| 3 | Pass Mix   | 10000 F  | `#161*<phone>*2*3*3*CODE#` |
| 4 | Pass Mix   | 20000 F  | `#161*<phone>*2*3*4*CODE#` |

### Appel — Promo (menu `2*5`)

| # | Nom               | Prix  | Code |
|---|-------------------|-------|------|
| 1 | Pass Mix 5 jrs    | 700 F | `#161*<phone>*2*5*1*CODE#` |

### International — Burkina Faso (menu `5*1`)

| # | Nom        | Prix    | Code |
|---|------------|---------|------|
| 1 | Pass BF    | 300 F   | `#161*<phone>*5*1*1*CODE#` |
| 2 | Pass BF    | 500 F   | `#161*<phone>*5*1*2*CODE#` |
| 3 | Pass BF    | 1000 F  | `#161*<phone>*5*1*3*CODE#` |
| 4 | Pass BF    | 2500 F  | `#161*<phone>*5*1*4*CODE#` |

### International — Mali (menu `5*2`)

| # | Nom        | Prix    | Code |
|---|------------|---------|------|
| 1 | Pass ML    | 300 F   | `#161*<phone>*5*2*1*CODE#` |
| 2 | Pass ML    | 500 F   | `#161*<phone>*5*2*2*CODE#` |
| 3 | Pass ML    | 1000 F  | `#161*<phone>*5*2*3*CODE#` |
| 4 | Pass ML    | 2500 F  | `#161*<phone>*5*2*4*CODE#` |

### International — Sénégal (menu `5*3`)

| # | Nom        | Prix    | Code |
|---|------------|---------|------|
| 1 | Pass SNG   | 300 F   | `#161*<phone>*5*3*1*CODE#` |
| 2 | Pass SNG   | 500 F   | `#161*<phone>*5*3*2*CODE#` |
| 3 | Pass SNG   | 1000 F  | `#161*<phone>*5*3*3*CODE#` |
| 4 | Pass SNG   | 2500 F  | `#161*<phone>*5*3*4*CODE#` |

---

## Ce que je veux que tu fasses

1. **Localise** dans `ulruk/` les dossiers `ussd-gateway` et `ussd-dashboard` (ou leurs équivalents). Si l'un n'existe pas en local, vérifie GitHub et clone-le.

2. **Dans `ussd-gateway`** :
   - Trouve le fichier qui contient le catalogue Orange (probablement `data/orange.json`, `config/orange-bundles.js`, ou hardcodé dans un router type `routes/bundles.js` / `services/orange.js`).
   - **Remplace intégralement** par le nouveau catalogue ci-dessus, structuré en arborescence (data → 1-3j, 5-7j, social, mois, nuit, illimité ; voice → 1-3j, 5-7j, mois, promo ; international → bf, ml, sng).
   - Format JSON attendu (adapte aux conventions du repo) :
     ```json
     {
       "operator": "orange",
       "merchant": true,
       "balance": "#145*611*{code}#",
       "transfer": {
         "credit": "#161*{phone}*1*{amount}*{code}#",
         "commission": "#161*2*{code}#"
       },
       "data": {
         "1_3_days": [
           { "id": "data_2j_200", "name": "Pass 2 jrs", "price": 200, "data": "", "duration": "2 jours", "ussd": "#161*{phone}*3*2*1*{code}#" },
           ...
         ],
         "5_7_days": [...],
         "social": [...],
         "month": [...],
         "night": [...],
         "unlimited": [...]
       },
       "voice": {
         "1_3_days": [...],
         "5_7_days": [...],
         "month": [...],
         "promo": [...]
       },
       "international": {
         "bf": [...], "ml": [...], "sng": [...]
       }
     }
     ```
   - Les champs `{phone}`, `{amount}`, `{code}` sont des placeholders. Le code qui exécute le USSD doit les remplacer avant l'envoi au modem.
   - Le code secret marchand DOIT venir de `process.env.ORANGE_MERCHANT_CODE`. Ajoute-le dans `.env.example` (sans valeur). Ne le hardcode JAMAIS.

3. **Dans `ussd-dashboard`** :
   - Adapte l'UI pour refléter la nouvelle hiérarchie (Solde / Transfert / Internet / Appel / International).
   - Si la dashboard utilise les mêmes données JSON que le gateway, partage le fichier (pas de duplication).
   - Ajoute un onglet "Marchand" qui indique clairement le mode (avec un badge `MERCHANT` vert).

4. **Vérifie le proxy côté Bipbip serveur** :
   - Sur le VPS `163.245.209.15`, le fichier `/root/var/www/BIPBIPWEB/server.js` proxy `GET /api/bundles/orange` vers `localhost:3002`. Vérifie que la nouvelle structure JSON est compatible. Si pas compatible, adapte aussi le serveur pour ré-aplatir la hiérarchie en liste plate (l'APK consomme actuellement un array `{ data: [...], mix: [...] }`).
   - Format attendu côté APK :
     ```json
     {
       "operator": "orange",
       "data":  [ { id, name, price, data?, duration?, option? }, ... ],
       "mix":   [ ... ]   // forfaits voice + data combinés
     }
     ```

5. **Tests** :
   - Démarre le gateway en local, fais un dry-run de chaque sous-menu (sans envoyer au modem) pour vérifier que chaque code est bien généré.
   - Vérifie qu'aucun code ne contient `<phone>` ou `<CODE>` littéral après substitution.

6. **Déploiement VPS** :
   - SSH config : Host `163.245.209.15`, User `root`, IdentityFile `~/.ssh/bipbip_vps`.
   - Le ussd-gateway tourne en pm2 sous le nom `ussd-gateway` (port 3002).
   - Pour déployer : push sur git, puis `ssh 163.245.209.15 "cd /root/var/www/ussd-gateway && git pull && pm2 restart ussd-gateway"`.
   - Ajoute la variable `ORANGE_MERCHANT_CODE=<code-secret>` dans le `.env` du VPS (sans push sur git).

7. **Rapport final** : récap des fichiers modifiés, exemples de codes générés, et instructions pour configurer la variable secrète sur le VPS.

---

## Ne pas faire

- Ne touche pas au catalogue MTN ni Moov (rien à voir ici).
- Ne hardcode pas le code marchand dans le repo (env var obligatoire).
- N'envoie pas de vrai USSD au modem pendant les tests (mode dry-run uniquement).
