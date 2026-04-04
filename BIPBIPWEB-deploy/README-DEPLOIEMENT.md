# 🚀 Déploiement Bipbip Recharge CI (bipbiprecharge.ci)

Ce dossier contient **tous les fichiers** à déployer sur ton VPS pour remplacer ou installer le projet Bipbip Recharge.

---

## 📁 Contenu du dossier (fichiers à envoyer sur le VPS)

| Fichier / Dossier | Rôle |
|-------------------|------|
| **index.html** | Page principale (interface) |
| **styles.css** | Styles (thème, cartes, toast) |
| **app.js** | Logique frontend (navigation, commandes, formulaire) |
| **server.js** | Backend Express (API, Telegram, uploads) |
| **storage.js** | Stockage des commandes (JSON ou MySQL) – **obligatoire** |
| **package.json** | Dépendances Node.js |
| **.env.example** | Modèle de configuration (à copier en .env sur le VPS) |
| **assets/** | Logo et images (logo.png, logo 2.PNG) |

---

## ⚠️ Sur le VPS : ne pas remplacer

Si tu **remplaces** un projet déjà en ligne :

- **.env** → Garde ton fichier .env actuel (token Telegram, ADMIN_CHAT_ID, PORT). Ne l’écrase pas.
- **data/** → Dossier des commandes (orders.json). Ne pas supprimer.
- **uploads/** → Preuves de paiement déjà envoyées. Ne pas supprimer.

Le **nom de domaine** (ex. bipbiprecharge.ci) est configuré dans **Nginx / Apache / Caddy** (ou ton hébergeur), pas dans ce dossier. Remplacer ces fichiers ne change pas le domaine.

---

## 📋 Étapes pour remplacer le projet sur le VPS

### 1. Sauvegarder sur le VPS (recommandé)

```bash
cd /chemin/vers/ton/projet   # ex. /var/www/bipbiprecharge
cp .env .env.backup
# Optionnel : sauvegarder data/ et uploads/
```

### 2. Envoyer les fichiers

- Envoie **tout le contenu** de ce dossier **BIPBIPWEB-deploy** vers le dossier du projet sur le VPS (FTP, SFTP, SCP, ou Git).
- **Ne remplace pas** le fichier `.env` sur le VPS (garde ton .env actuel).
- Si le dossier `data/` ou `uploads/` n’existe pas sur le VPS, le serveur les créera au premier démarrage.

### 3. Sur le VPS : installer les dépendances (si besoin)

```bash
cd /chemin/vers/ton/projet
npm install
```

### 4. Redémarrer l’application

**Avec PM2 :**

```bash
pm2 restart bipbip
# ou le nom de ton app
pm2 restart all
```

**Sans PM2 :**

```bash
# Arrêter l’ancien processus (Ctrl+C ou kill)
node server.js
# ou en arrière-plan :
nohup node server.js &
```

### 5. Vérifier

Ouvre **https://bipbiprecharge.ci** (ou ton domaine). Tu dois voir la nouvelle interface (Bienvenue, Acheter, Tarifs, etc.).

---

## 🌐 Configuration Nginx (exemple pour bipbiprecharge.ci)

Ton domaine pointe déjà vers le serveur. Le bloc serveur peut ressembler à ceci (à adapter selon ton config actuelle) :

```nginx
server {
    listen 80;
    server_name bipbiprecharge.ci www.bipbiprecharge.ci;
    location / {
        proxy_pass http://127.0.0.1:3000;   # PORT dans .env
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Puis `sudo nginx -t` et `sudo systemctl reload nginx`.  
Si tu utilises HTTPS (recommandé), tu as un bloc `listen 443` avec `ssl_*` ; le `proxy_pass` reste le même.

---

## ✅ Checklist rapide

- [ ] Fichiers du dossier **BIPBIPWEB-deploy** envoyés sur le VPS (sauf .env à garder)
- [ ] `.env` sur le VPS conservé (PORT, TELEGRAM_BOT_TOKEN, ADMIN_CHAT_ID)
- [ ] `npm install` exécuté dans le dossier du projet
- [ ] Application redémarrée (PM2 ou `node server.js`)
- [ ] Site ouvert sur ton domaine (bipbiprecharge.ci)

En cas de souci, vérifier les logs : `pm2 logs bipbip` ou les messages d’erreur dans le terminal.
