# -*- coding: utf-8 -*-
"""
Bot Telegram Bipbip Recharge CI – relié à la webapp (BIPBIPWEB).
Les commandes et preuves sont stockées côté webapp ; l'admin reçoit les notifs Telegram.
"""
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    ContextTypes,
    filters,
)
import os
import asyncio
import requests

# Charger .env si présent (depuis BIPBIP ou BIPBIPWEB)
try:
    from dotenv import load_dotenv
    load_dotenv()
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", "BIPBIPWEB", ".env"))
except ImportError:
    pass

# ================== CONFIG ==================
TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN") or os.environ.get("BOT_TOKEN", "")
ADMIN_ID = int(os.environ.get("ADMIN_CHAT_ID", "0"))
WEBAPP_URL = (os.environ.get("WEBAPP_URL") or "http://localhost:3000").rstrip("/")
FRAIS_PERCENT = 5

if not TOKEN:
    raise ValueError("Définir TELEGRAM_BOT_TOKEN (ou BOT_TOKEN) dans .env ou l'environnement.")

# ================== UTILS ==================
def verifier_reseau(operator, phone):
    prefixes = {"MTN": ("05",), "Orange": ("07",), "Moov": ("01",)}
    return phone.startswith(prefixes.get(operator, ()))


def _api_create_order(user_id, username, operator, amount, amount_total, phone):
    """Crée une commande via l'API webapp (synchrone)."""
    r = requests.post(
        f"{WEBAPP_URL}/api/orders",
        json={
            "userId": str(user_id),
            "username": username or None,
            "operator": operator,
            "amount": amount,
            "amountTotal": amount_total,
            "phone": phone,
        },
        timeout=10,
    )
    r.raise_for_status()
    return r.json().get("order")


def _api_upload_proof(order_id, photo_bytes, filename="preuve.jpg"):
    """Envoie la preuve à la webapp (qui notifie l'admin Telegram)."""
    r = requests.post(
        f"{WEBAPP_URL}/api/orders/{order_id}/proof",
        files={"proof": (filename, photo_bytes, "image/jpeg")},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


def _api_validate_order(order_id):
    r = requests.post(f"{WEBAPP_URL}/api/admin/orders/{order_id}/validate", timeout=10)
    r.raise_for_status()
    return r.json()


def _api_reject_order(order_id, reason=""):
    r = requests.post(
        f"{WEBAPP_URL}/api/admin/orders/{order_id}/reject",
        json={"reason": reason or "Rejeté par l'admin"},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


# ================== START ==================
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [InlineKeyboardButton("💳 Acheter", callback_data="buy")],
        [InlineKeyboardButton("💰 Tarifs", callback_data="prices")],
        [InlineKeyboardButton("❓ Aide", callback_data="help")],
        [InlineKeyboardButton("📊 Statut", callback_data="status")],
        [InlineKeyboardButton("❌ Annuler", callback_data="cancel")],
    ]
    text = "👋 **Bipbip Recharge CI Express**\n\nChoisissez une action 👇"
    if update.message:
        await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))
    else:
        await update.callback_query.answer()
        await update.callback_query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard))


# ================== PRICES ==================
async def prices(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = (
        "💰 **TARIFS**\n\n"
        "500 FCFA\n1000 FCFA\n2000 FCFA\n5000 FCFA\n\n"
        f"💸 Frais : {FRAIS_PERCENT}%"
    )
    if update.message:
        await update.message.reply_text(text)
    else:
        await update.callback_query.answer()
        await update.callback_query.edit_message_text(text)


# ================== AIDE ==================
async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = (
        "❓ **AIDE**\n\n"
        "• **Acheter** : choisir opérateur, montant, numéro, puis envoyer la preuve de paiement.\n"
        "• **Tarifs** : voir les montants et frais.\n"
        "• **Statut** : voir l’état de vos commandes.\n"
        "• Après validation par l’admin, vous recevrez une confirmation."
    )
    if update.message:
        await update.message.reply_text(text)
    else:
        await update.callback_query.answer()
        await update.callback_query.edit_message_text(text)


# ================== STATUT ==================
async def status_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = "📊 **Statut**\n\nVos commandes en attente seront validées par l’admin. Vous recevrez un message ici dès que c’est fait."
    if update.message:
        await update.message.reply_text(text)
    else:
        await update.callback_query.answer()
        await update.callback_query.edit_message_text(text)


# ================== ANNULER ==================
async def cancel_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.clear()
    text = "❌ Annulé. Choisissez une action 👇"
    keyboard = [
        [InlineKeyboardButton("💳 Acheter", callback_data="buy")],
        [InlineKeyboardButton("💰 Tarifs", callback_data="prices")],
        [InlineKeyboardButton("❓ Aide", callback_data="help")],
        [InlineKeyboardButton("📊 Statut", callback_data="status")],
        [InlineKeyboardButton("❌ Annuler", callback_data="cancel")],
    ]
    if update.message:
        await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard))
    else:
        await update.callback_query.answer()
        await update.callback_query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard))


# ================== BUY FLOW ==================
async def buy(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [InlineKeyboardButton("📲 MTN", callback_data="op_MTN")],
        [InlineKeyboardButton("📶 Orange", callback_data="op_Orange")],
        [InlineKeyboardButton("📡 Moov", callback_data="op_Moov")],
    ]
    await update.callback_query.answer()
    await update.callback_query.edit_message_text(
        "📡 Choisissez l'opérateur 👇",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def operator_choice(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    context.user_data.clear()
    context.user_data["operator"] = query.data.replace("op_", "")
    keyboard = [
        [InlineKeyboardButton("500", callback_data="amt_500")],
        [InlineKeyboardButton("1000", callback_data="amt_1000")],
        [InlineKeyboardButton("2000", callback_data="amt_2000")],
        [InlineKeyboardButton("5000", callback_data="amt_5000")],
    ]
    await query.edit_message_text(
        f"📲 Opérateur : {context.user_data['operator']}\n\n💰 Choisissez le montant",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def amount_choice(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    base = int(query.data.replace("amt_", ""))
    frais = base * FRAIS_PERCENT // 100
    total = base + frais
    context.user_data.update(amount=base, amount_total=total, awaiting_phone=True)
    await query.edit_message_text(
        f"💰 Montant : {base} FCFA\n"
        f"💸 Frais : {frais} FCFA\n"
        f"💰 Total : {total} FCFA\n\n"
        "📞 Entrez le numéro à recharger"
    )


# ================== PHONE / CONFIRM ==================
async def phone_input(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.user_data.get("awaiting_phone"):
        return
    phone = update.message.text.strip()
    if not phone.isdigit() or len(phone) < 8:
        await update.message.reply_text("❌ Numéro invalide.")
        return
    if not verifier_reseau(context.user_data["operator"], phone):
        await update.message.reply_text("❌ Numéro incompatible avec l'opérateur.")
        return
    context.user_data["phone"] = phone
    context.user_data["awaiting_phone"] = False
    keyboard = [[InlineKeyboardButton("✅ Confirmer", callback_data="confirm")]]
    await update.message.reply_text(
        f"📲 {context.user_data['operator']}\n"
        f"💰 {context.user_data['amount_total']} FCFA\n"
        f"📞 {phone}",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


# ================== CONFIRM → API webapp ==================
async def confirm_order(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    user = query.from_user
    try:
        order = await asyncio.to_thread(
            _api_create_order,
            user.id,
            user.username,
            context.user_data["operator"],
            context.user_data["amount"],
            context.user_data["amount_total"],
            context.user_data["phone"],
        )
    except Exception as e:
        await query.edit_message_text(f"❌ Erreur serveur : {e}")
        return

    order_id = order["id"]
    keyboard = [[InlineKeyboardButton("📸 Envoyer preuve", callback_data=f"proof_{order_id}")]]
    await query.edit_message_text(
        f"✅ Commande #{order_id} enregistrée.\nEnvoyez la preuve de paiement 👇",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    # La webapp envoie déjà la notif "Nouvelle commande" à l'admin


# ================== PROOF ==================
async def proof_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    order_id = query.data.replace("proof_", "")
    context.user_data["proof_order"] = order_id
    await query.edit_message_text("📸 Envoyez la preuve (photo) maintenant.")


async def proof_receive(update: Update, context: ContextTypes.DEFAULT_TYPE):
    order_id = context.user_data.get("proof_order")
    if not order_id:
        await update.message.reply_text("❌ Cliquez d'abord sur « Envoyer preuve » pour une commande.")
        return

    photo = update.message.photo[-1]
    try:
        file = await photo.get_file()
        buf = await file.download_as_bytearray()
    except Exception as e:
        await update.message.reply_text(f"❌ Impossible de récupérer la photo : {e}")
        return

    try:
        await asyncio.to_thread(_api_upload_proof, order_id, bytes(buf), "preuve.jpg")
        # La webapp envoie la photo à l'admin avec boutons Valider / Rejeter
        await update.message.reply_text("✅ Preuve envoyée. L'admin va vérifier et vous notifier.")
    except requests.exceptions.RequestException as e:
        await update.message.reply_text(f"❌ Erreur envoi : {e}")
    context.user_data.pop("proof_order", None)


# ================== ADMIN : Valider / Rejeter (callbacks → API webapp) ==================
async def validate_order(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    order_id = query.data.replace("validate_", "")

    try:
        await asyncio.to_thread(_api_validate_order, order_id)
        await query.answer("Commande validée")
        try:
            await query.edit_message_caption(caption=f"✅ Commande #{order_id} validée.")
        except Exception:
            try:
                await query.edit_message_text(f"✅ Commande #{order_id} validée.")
            except Exception:
                pass
    except requests.exceptions.RequestException as e:
        await query.answer(f"Erreur : {e}", show_alert=True)


async def reject_order(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    order_id = query.data.replace("reject_", "")

    try:
        await asyncio.to_thread(_api_reject_order, order_id, "Rejeté par l'admin")
        await query.answer("Commande rejetée")
        try:
            await query.edit_message_caption(caption=f"❌ Commande #{order_id} rejetée.")
        except Exception:
            try:
                await query.edit_message_text(f"❌ Commande #{order_id} rejetée.")
            except Exception:
                pass
    except requests.exceptions.RequestException as e:
        await query.answer(f"Erreur : {e}", show_alert=True)


# ================== APP ==================
app = ApplicationBuilder().token(TOKEN).build()

app.add_handler(CommandHandler("start", start))
app.add_handler(CallbackQueryHandler(buy, pattern="^buy$"))
app.add_handler(CallbackQueryHandler(prices, pattern="^prices$"))
app.add_handler(CallbackQueryHandler(help_cmd, pattern="^help$"))
app.add_handler(CallbackQueryHandler(status_cmd, pattern="^status$"))
app.add_handler(CallbackQueryHandler(cancel_cmd, pattern="^cancel$"))
app.add_handler(CallbackQueryHandler(operator_choice, pattern="^op_"))
app.add_handler(CallbackQueryHandler(amount_choice, pattern="^amt_"))
app.add_handler(CallbackQueryHandler(confirm_order, pattern="^confirm$"))
app.add_handler(CallbackQueryHandler(proof_handler, pattern="^proof_"))
app.add_handler(CallbackQueryHandler(validate_order, pattern="^validate_"))
app.add_handler(CallbackQueryHandler(reject_order, pattern="^reject_"))
app.add_handler(MessageHandler(filters.PHOTO, proof_receive))
app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, phone_input))

if __name__ == "__main__":
    print("🤖 Bot en ligne (relié à la webapp:", WEBAPP_URL, ")")
    app.run_polling()
