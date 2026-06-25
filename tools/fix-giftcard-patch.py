# -*- coding: utf-8 -*-
# Répare la branche CARTE_CADEAU (string cassée par le heredoc) + ajoute saveParams.
import io

f = "/root/var/www/BIPBIPWEB/server.js"
s = io.open(f, encoding="utf-8").read()
orig = s

# 1) Remplacer toute la branche CARTE_CADEAU cassée par une version propre (string sur une ligne, \n échappés)
start = "            } else if (order.operator === 'CARTE_CADEAU') {"
end = "            } else if (order.operator !== 'ANNONCE_LED' && order.phone) {"
i = s.find(start)
j = s.find(end, i) if i != -1 else -1

clean = (
    "            } else if (order.operator === 'CARTE_CADEAU') {\n"
    "                try {\n"
    "                    const gift = await giftDelivery.deliver(order);\n"
    "                    if (gift.ok && gift.card) {\n"
    "                        const codeMsg = '\U0001F381 <b>Carte cadeau livrée !</b>\\n\\n' + (order.giftCard || '') + '\\n\\n\U0001F511 Code : <code>' + gift.card.code + '</code>' + (gift.card.pin ? '\\n\U0001F522 PIN : <code>' + gift.card.pin + '</code>' : '');\n"
    "                        if (order.userId) await sendTelegramMessage(order.userId, codeMsg);\n"
    "                        try { await pushService.sendToUser(order.userId, '\U0001F381 Carte cadeau prête', 'Ton code est disponible dans Mes commandes', { screen: 'commandes', orderId: String(orderId) }); } catch (e) {}\n"
    "                    } else {\n"
    "                        if (order.userId) await sendTelegramMessage(order.userId, '\U0001F381 Paiement validé. Ta carte cadeau est en cours de génération, le code arrive dans un instant.');\n"
    "                    }\n"
    "                } catch (e) {\n"
    "                    console.error('[GiftCard deliver]', e.message);\n"
    "                    if (order.userId) await sendTelegramMessage(order.userId, '⚠️ Carte cadeau : génération en cours, le code arrive très vite.');\n"
    "                }\n"
)

if i != -1 and j != -1:
    s = s[:i] + clean + s[j:]
    print("branche CARTE_CADEAU réparée")
else:
    print("WARN: branche introuvable (i=%s j=%s)" % (i, j))

# 2) saveParams après createOrder (ancre unique via le commentaire admin)
anchor = ("        await orderStorage.createOrder(order);\n"
          "        \n"
          "        // Notifier tous les admins via bot admin uniquement\n")
if "giftDelivery.saveParams" not in s:
    add = ("        await orderStorage.createOrder(order);\n"
           "        // Carte cadeau : mémorise les paramètres Reloadly pour la livraison auto post-paiement\n"
           "        if (opNorm === 'CARTE_CADEAU' && req.body && req.body.reloadlyProductId) {\n"
           "            try { giftDelivery.saveParams(orderId, {\n"
           "                reloadlyProductId: Number(req.body.reloadlyProductId),\n"
           "                faceValue: req.body.reloadlyFaceValue != null ? Number(req.body.reloadlyFaceValue) : null,\n"
           "                recipientCurrency: req.body.reloadlyRecipientCurrency || null\n"
           "            }); } catch (e) { console.error('[Gift saveParams]', e.message); }\n"
           "        }\n"
           "        \n"
           "        // Notifier tous les admins via bot admin uniquement\n")
    if s.count(anchor) == 1:
        s = s.replace(anchor, add, 1)
        print("saveParams ajouté")
    else:
        print("WARN saveParams ancre count:", s.count(anchor))
else:
    print("saveParams déjà présent")

if s != orig:
    io.open(f, "w", encoding="utf-8").write(s)
    print("ÉCRIT")
else:
    print("aucun changement")
