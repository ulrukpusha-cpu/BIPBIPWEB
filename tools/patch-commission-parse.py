#!/usr/bin/env python3
"""Le bot extrait juste le montant de la commission au lieu d'afficher tout le popup."""
import sys
PATH = '/root/var/www/ussd-gateway/telegram-bot.js'
with open(PATH, encoding='utf-8') as f:
    c = f.read()

OLD = """        if (data && data.success) {
            let text = '\U0001F4B0 <b>Commission Orange (BNF)</b>\\n\\n';
            text += '<code>' + String(data.rawResponse || '(reponse vide)').slice(0, 600) + '</code>\\n\\n';
            text += '\U0001F4DF ' + (data.ussdCode || '');
            await sendMessage(chatId, text);
        } else {"""

NEW = r"""        if (data && data.success) {
            const raw = String(data.rawResponse || '');
            // Extrait le montant : ex "Votre solde est de: 338.00F" -> "338.00"
            let montant = null;
            let m = raw.match(/(?:solde\s+est\s+de|commission|disponible)[^0-9]{0,40}([0-9][0-9\s.,]*[0-9]|[0-9])\s*(?:F\s*CFA|FCFA|F)\b/i);
            if (!m) m = raw.match(/([0-9][0-9\s.,]*[0-9]|[0-9])\s*(?:F\s*CFA|FCFA|F)\b/i);
            if (m) montant = m[1].replace(/\s+/g, '').replace(',', '.');
            let text;
            if (montant) {
                text = '💰 <b>Commission Orange</b>\n\n💵 Montant disponible : <b>' + montant + ' F</b>';
            } else {
                text = '💰 <b>Commission Orange</b>\n\n<code>' + raw.slice(0, 400) + '</code>';
            }
            await sendMessage(chatId, text);
        } else {"""

if 'Montant disponible' in c:
    print('ALREADY'); sys.exit(0)
if OLD not in c:
    print('OLD_NOT_FOUND'); sys.exit(1)
c = c.replace(OLD, NEW, 1)
with open(PATH, 'w', encoding='utf-8') as f:
    f.write(c)
print('PATCHED_OK')
