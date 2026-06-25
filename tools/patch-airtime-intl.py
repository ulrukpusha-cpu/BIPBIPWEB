# -*- coding: utf-8 -*-
# Ajoute la recharge internationale (RECHARGE_INTL) : saveParams airtime + branche de livraison.
import io
f = "/root/var/www/BIPBIPWEB/server.js"
s = io.open(f, encoding="utf-8").read()
orig = s

# 1) saveParams airtime — après le bloc saveParams carte cadeau
gift_block_end = ("            }); } catch (e) { console.error('[Gift saveParams]', e.message); }\n"
                  "        }\n")
if "Airtime saveParams" not in s:
    add = (gift_block_end +
           "        if (opNorm === 'RECHARGE_INTL' && req.body && req.body.operatorId) {\n"
           "            try { giftDelivery.saveParams(orderId, {\n"
           "                type: 'airtime',\n"
           "                operatorId: Number(req.body.operatorId),\n"
           "                senderEUR: req.body.senderEUR != null ? Number(req.body.senderEUR) : null,\n"
           "                iso: req.body.iso || null,\n"
           "                number: String(req.body.number || phone || '').replace(/\\D/g, '')\n"
           "            }); } catch (e) { console.error('[Airtime saveParams]', e.message); }\n"
           "        }\n")
    if s.count(gift_block_end) == 1:
        s = s.replace(gift_block_end, add, 1)
        print("saveParams airtime ajouté")
    else:
        print("WARN saveParams airtime ancre count:", s.count(gift_block_end))
else:
    print("saveParams airtime déjà présent")

# 2) branche de livraison RECHARGE_INTL — avant la branche USSD
ussd = "            } else if (order.operator !== 'ANNONCE_LED' && order.phone) {\n"
if "Airtime deliver" not in s:
    branch = (
        "            } else if (order.operator === 'RECHARGE_INTL') {\n"
        "                try {\n"
        "                    const air = await giftDelivery.deliverAirtime(order);\n"
        "                    if (air.ok) {\n"
        "                        if (order.userId) await sendTelegramMessage(order.userId, '\U0001F30D <b>Recharge internationale effectuée !</b>\\n\\n\U0001F4DE ' + order.phone + '\\n✅ ' + (order.giftCard || 'Recharge envoyée'));\n"
        "                        try { await pushService.sendToUser(order.userId, '\U0001F30D Recharge envoyée', order.phone + ' rechargé avec succès', { screen: 'commandes', orderId: String(orderId) }); } catch (e) {}\n"
        "                    } else {\n"
        "                        if (order.userId) await sendTelegramMessage(order.userId, '\U0001F30D Paiement validé. Ta recharge internationale est en cours.');\n"
        "                    }\n"
        "                } catch (e) {\n"
        "                    console.error('[Airtime deliver]', e.message);\n"
        "                    if (order.userId) await sendTelegramMessage(order.userId, '⚠️ Recharge internationale en cours de traitement.');\n"
        "                }\n"
        + ussd)
    if s.count(ussd) >= 1:
        s = s.replace(ussd, branch, 1)
        print("branche RECHARGE_INTL ajoutée")
    else:
        print("WARN branche ussd introuvable")
else:
    print("branche RECHARGE_INTL déjà présente")

if s != orig:
    io.open(f, "w", encoding="utf-8").write(s)
    print("ÉCRIT")
else:
    print("aucun changement")
