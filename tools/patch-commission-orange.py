#!/usr/bin/env python3
"""Ajoute la commission Orange (#161*2*CODE#) : endpoint gateway + commande bot."""
import sys

GW = '/root/var/www/ussd-gateway/credit-routes.js'
BOT = '/root/var/www/ussd-gateway/telegram-bot.js'

# ---------- 1) credit-routes.js : endpoint /api/commission/orange ----------
c = open(GW, encoding='utf-8').read()
if '/api/commission/orange' in c:
    print('GW_ALREADY')
else:
    anchor = "module.exports = function(app, stats, nodes, pendingRequests, findAvailableNode, generateId) {"
    if anchor not in c:
        print('GW_ANCHOR_NOT_FOUND'); sys.exit(1)
    endpoint = anchor + """

  // Commission Orange marchand : #161*2*CODE#  (BNF)
  app.post('/api/commission/orange', async (req, res) => {
    const operator = 'orange';
    const node = findAvailableNode(operator);
    if (!node) {
      return res.status(503).json({ success: false, error: 'Aucun telephone Orange disponible' });
    }
    const code = process.env.ORANGE_MERCHANT_CODE || 'CODE';
    const ussdCode = '#161*2*' + code + '#';
    const transferId = 'comm_orange_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    node.busy = true;
    node.ws.send(JSON.stringify({ type: 'EXECUTE_USSD', transferId, ussdCode, isBalanceCheck: true }));
    console.log('[COMMISSION] orange: ' + ussdCode + ' (id: ' + transferId + ')');
    try {
      const result = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          pendingRequests.delete(transferId);
          node.busy = false;
          reject(new Error('Timeout commission (90s)'));
        }, 90000);
        pendingRequests.set(transferId, {
          resolve: (data) => { clearTimeout(timeoutId); node.busy = false; resolve(data); },
          reject: (err) => { clearTimeout(timeoutId); node.busy = false; reject(err); },
          timeoutId, operator, amount: 0, isBalanceCheck: true
        });
      });
      res.json({ success: true, operator, rawResponse: result.response, ussdCode, timestamp: Date.now() });
    } catch (err) {
      node.busy = false;
      res.status(408).json({ success: false, error: err.message });
    }
  });
"""
    c = c.replace(anchor, endpoint, 1)
    open(GW, 'w', encoding='utf-8').write(c)
    print('GW_PATCHED')

# ---------- 2) telegram-bot.js : commande /commission ----------
b = open(BOT, encoding='utf-8').read()
if '/commission' in b and 'cmdCommission' in b:
    print('BOT_ALREADY')
else:
    # 2a) clavier
    kb = "                [{ text: '\U0001F381 Forfaits' }, { text: '\U0001F504 Transactions' }],"
    if kb in b:
        b = b.replace(kb, kb + "\n                [{ text: '\U0001F4B0 Commission Orange' }],", 1)
    else:
        print('BOT_KB_NOT_FOUND')
    # 2b) buttonMap
    bm = "        '\U0001F504 Transactions': '/transactions',"
    if bm in b:
        b = b.replace(bm, bm + "\n        '\U0001F4B0 Commission Orange': '/commission',", 1)
    else:
        print('BOT_MAP_NOT_FOUND')
    # 2c) switch case
    sw = "        case '/transactions':\n        case '/tx':\n            await cmdTransactions(chatId);\n            break;"
    if sw in b:
        b = b.replace(sw, sw + "\n        case '/commission':\n        case '/bnf':\n            await cmdCommission(chatId);\n            break;", 1)
    else:
        print('BOT_SWITCH_NOT_FOUND')
    # 2d) fonction cmdCommission (avant cmdTransactions)
    fnAnchor = "async function cmdTransactions(chatId) {"
    fn = """async function cmdCommission(chatId) {
    await sendMessage(chatId, '⏳ Verification de la commission Orange en cours... (jusqu a 90s)');
    try {
        const data = await postJSON(`${GATEWAY_URL}/api/commission/orange`, {});
        if (data && data.success) {
            let text = '\U0001F4B0 <b>Commission Orange (BNF)</b>\\n\\n';
            text += '<code>' + String(data.rawResponse || '(reponse vide)').slice(0, 600) + '</code>\\n\\n';
            text += '\U0001F4DF ' + (data.ussdCode || '');
            await sendMessage(chatId, text);
        } else {
            await sendMessage(chatId, '❌ <b>Commission indisponible</b>\\n' + ((data && data.error) || 'Erreur inconnue'));
        }
    } catch (e) {
        await sendMessage(chatId, '❌ <b>Erreur commission</b>\\n' + e.message);
    }
}

"""
    if fnAnchor in b:
        b = b.replace(fnAnchor, fn + fnAnchor, 1)
    else:
        print('BOT_FN_ANCHOR_NOT_FOUND'); sys.exit(1)
    open(BOT, 'w', encoding='utf-8').write(b)
    print('BOT_PATCHED')
