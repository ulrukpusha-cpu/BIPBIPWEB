# Accès à l’espace Admin

## Comment y accéder

Sur l’app (bipbiprecharge.ci ou en local), utilise le **raccourci clavier** :

- **Ctrl + Shift + A** (en même temps)

L’écran **Administration** s’ouvre. Tu y as notamment :

- **Vitesse du bandeau** : réglage de la vitesse du message défilant (15 à 300 secondes). Saisis la valeur, la **clé admin** (voir ci‑dessous), puis **Enregistrer**.
- **En attente / Validées** : onglets pour les commandes (côté client, les validations sont locales).

## Enregistrer la vitesse du bandeau

1. Ouvre l’admin avec **Ctrl + Shift + A**.
2. Dans « Vitesse du bandeau », mets le nombre de **secondes** (ex. **90** = défilement plus lent).
3. Dans « Clé admin », colle la valeur de **ADMIN_SECRET_KEY** (celle du fichier **.env** sur le VPS).
4. Clique sur **Enregistrer**.

La nouvelle vitesse est prise en compte tout de suite pour tous les visiteurs (pas besoin de redémarrer l’app).

## Récapitulatif

| Action | Méthode |
|--------|--------|
| Ouvrir l’admin | **Ctrl + Shift + A** |
| Changer la vitesse du bandeau | Admin → champ secondes (15–300) → Clé admin → Enregistrer |
| Clé admin | C’est **ADMIN_SECRET_KEY** dans le `.env` du serveur |
