# Description du business – BipBip Recharge

## Version française (pour dossier MTN MoMo)

**BipBip Recharge** est une plateforme de recharge de crédit mobile et mobile money en Côte d’Ivoire, destinée aux particuliers et aux petits revendeurs.

**Activité principale**  
Nous proposons l’achat de recharges pour les opérateurs MTN, Orange et Moov (crédit d’appels, SMS et data), avec un canal de vente simple et accessible : une **Mini Application Telegram** et un **site web** optimisés mobile. Le client choisit l’opérateur, le montant et le numéro à recharger, paie (notamment via **MTN Mobile Money**), et reçoit sa recharge sous quelques minutes.

**Positionnement**  
BipBip Recharge vise la **convenience** et la **sécurité** : pas besoin de se déplacer ni de gérer du cash. L’intégration de l’**API MTN MoMo (Collection)** permet à nos clients de payer directement depuis leur compte MoMo, avec une demande de paiement envoyée sur leur téléphone et un débit instantané en cas d’acceptation. Cela réduit les délais de traitement et améliore l’expérience utilisateur pour les clients MTN.

**Modèle économique**  
Nous appliquons des frais de service modestes (pourcentage du montant de la recharge) et nous nous appuyons sur un volume de transactions régulier. L’objectif est de proposer un service fiable et transparent, en conformité avec les règles des opérateurs et de MTN MoMo.

**Cible**  
- Particuliers souhaitant recharger leur ligne ou celle d’un proche.  
- Petits commerces et revendeurs de recharges en Côte d’Ivoire.  
- Utilisateurs déjà familiers de Telegram et du mobile money (dont MTN MoMo).

**Utilisation prévue de l’API MTN MoMo**  
Nous utilisons l’**API Collection (Request to Pay)** pour :  
- Envoyer une demande de paiement au client sur son numéro MTN MoMo.  
- Recevoir le règlement sur notre compte marchand MTN MoMo.  
- Mettre à jour automatiquement le statut de la commande (succès / échec) et notifier l’utilisateur (Telegram / site).  

Nous nous engageons à respecter les conditions d’utilisation MTN MoMo, à sécuriser les données et à n’utiliser l’API que pour des transactions liées à notre activité de recharge.

---

## English version (for MTN MoMo application)

**BipBip Recharge** is a mobile airtime and mobile money top-up platform in Côte d'Ivoire, serving individuals and small-scale resellers.

**Core business**  
We offer airtime and data top-ups for MTN, Orange, and Moov. Sales are made through a **Telegram Mini App** and a **mobile-friendly website**. The customer selects the operator, amount, and number to be recharged, pays (including via **MTN Mobile Money**), and receives the top-up within minutes.

**Positioning**  
BipBip Recharge focuses on **convenience** and **security**: no need to travel or handle cash. Integrating the **MTN MoMo Collection API** allows our customers to pay directly from their MoMo account via a payment request sent to their phone, with instant debit upon acceptance. This shortens processing time and improves the experience for MTN users.

**Business model**  
We apply a small service fee (percentage of the top-up amount) and rely on steady transaction volume. Our aim is to provide a reliable, transparent service in line with operator and MTN MoMo policies.

**Target audience**  
- Individuals recharging their own or a relative’s line.  
- Small shops and airtime resellers in Côte d'Ivoire.  
- Users already comfortable with Telegram and mobile money (including MTN MoMo).

**Intended use of the MTN MoMo API**  
We use the **Collection API (Request to Pay)** to:  
- Send a payment request to the customer’s MTN MoMo number.  
- Receive payment on our MTN MoMo merchant account.  
- Automatically update order status (success/failure) and notify the user (Telegram / website).  

We commit to complying with MTN MoMo terms of use, securing data, and using the API only for transactions related to our recharge business.
