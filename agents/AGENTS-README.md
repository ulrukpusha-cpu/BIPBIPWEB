# 🤖 AGENTS BIPBIP - Pack Essential

## Agents actifs

| # | Nom | Rôle | Fréquence |
|---|-----|------|-----------|
| #1 | Modérateur IA | Validation auto des annonces LED | Toutes les 5 min |
| #8 | Maintenance | Surveillance santé système | Toutes les 15 min |

---

## Commandes de gestion

```bash
# Voir le statut des agents
pm2 status

# Logs temps réel
tail -f /var/log/pm2/bipbip-agent-moderateur-out.log
tail -f /var/log/pm2/bipbip-agent-maintenance-out.log

# Redémarrer
pm2 restart bipbip-agent-moderateur
pm2 restart bipbip-agent-maintenance

# Stop
pm2 stop bipbip-agent-moderateur
pm2 stop bipbip-agent-maintenance

# Monitoring PM2
pm2 monit
```

---

## Pack Pro (4 agents supplémentaires)

| # | Nom | Rôle | Fréquence |
|---|-----|------|-----------|
| #2 | Rotateur LED | Gestion affichage annonces | En continu |
| #3 | Validateur Liens | Approuve liens YouTube/X | Toutes les heures |
| #4 | Détecteur Fraude | Empêche triche clics | En temps réel |
| #6 | Reporter | Stats quotidiennes Telegram | 20h00/jour |

**Prix**: 10$/mois après validation du Pack Essential

---

## Pack Entreprise (8 agents)

**Prix**: 25$/mois

Inclut TOUS les agents + Support prioritaire

---

## Upgrade vers Pack Pro

Pour déployer les agents supplémentaires, exécuter:
```bash
pm2 start ecosystem-pro.config.js
```
