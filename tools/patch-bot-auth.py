#!/usr/bin/env python3
"""Patche bot.py pour intercepter /start auth_<token> et notifier le serveur."""
import sys

PATH = '/root/var/www/BIPBIPWEB/bot.py'

OLD_START = '''# ================== START ==================
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [InlineKeyboardButton("\U0001f4b3 Acheter", callback_data="buy")],
        [InlineKeyboardButton("\U0001f4b0 Tarifs", callback_data="prices")],
        [InlineKeyboardButton("❓ Aide", callback_data="help")],
        [InlineKeyboardButton("\U0001f4ca Statut", callback_data="status")],
        [InlineKeyboardButton("❌ Annuler", callback_data="cancel")],
    ]
    text = "\U0001f44b **Bipbip Recharge CI Express**\\n\\nChoisissez une action \U0001f447"
    if update.message:
        await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))
    else:
        await update.callback_query.answer()
        await update.callback_query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard))
'''

NEW_START = '''# ================== START ==================
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    # Intercept /start auth_<token> : flow d'authentification APK natif
    if update.message and context.args:
        arg = context.args[0]
        if arg.startswith('auth_'):
            token = arg[5:]
            tg_user = update.message.from_user
            user_payload = {
                'id': tg_user.id,
                'first_name': tg_user.first_name or '',
                'last_name': tg_user.last_name or '',
                'username': tg_user.username or '',
                'photo_url': ''
            }
            try:
                import os, json
                import urllib.request
                req_body = json.dumps({'token': token, 'telegramUser': user_payload}).encode('utf-8')
                req = urllib.request.Request(
                    'http://localhost:3000/api/auth/telegram-poll/claim',
                    data=req_body,
                    headers={
                        'Content-Type': 'application/json',
                        'X-Bot-Secret': os.environ.get('BOT_INTERNAL_SECRET', '')
                    },
                    method='POST'
                )
                with urllib.request.urlopen(req, timeout=8) as resp:
                    if resp.status == 200:
                        await update.message.reply_text(
                            "✅ **Connexion réussie !**\\n\\nRetourne dans l'app Bipbip Recharge, "
                            "tu es maintenant connecté.",
                            parse_mode='Markdown'
                        )
                        return
                    else:
                        await update.message.reply_text(
                            "❌ Échec de la connexion. Le code a peut-être expiré.\\n"
                            "Retourne dans l'app et réessaie."
                        )
                        return
            except Exception as e:
                await update.message.reply_text(f"⚠️ Erreur : {e}")
                return

    keyboard = [
        [InlineKeyboardButton("\U0001f4b3 Acheter", callback_data="buy")],
        [InlineKeyboardButton("\U0001f4b0 Tarifs", callback_data="prices")],
        [InlineKeyboardButton("❓ Aide", callback_data="help")],
        [InlineKeyboardButton("\U0001f4ca Statut", callback_data="status")],
        [InlineKeyboardButton("❌ Annuler", callback_data="cancel")],
    ]
    text = "\U0001f44b **Bipbip Recharge CI Express**\\n\\nChoisissez une action \U0001f447"
    if update.message:
        await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))
    else:
        await update.callback_query.answer()
        await update.callback_query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard))
'''

with open(PATH, 'r', encoding='utf-8') as f:
    content = f.read()

if 'auth_' in content and 'telegram-poll/claim' in content:
    print('ALREADY_PATCHED')
    sys.exit(0)

if OLD_START not in content:
    print('PATTERN_NOT_FOUND')
    sys.exit(1)

content = content.replace(OLD_START, NEW_START)
with open(PATH, 'w', encoding='utf-8') as f:
    f.write(content)
print('PATCHED_OK')
