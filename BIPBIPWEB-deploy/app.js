// ==================== CONFIG ====================
const CONFIG = {
    FRAIS_PERCENT: 5,
    ADMIN_ID: '6735995998',
    OPERATORS: {
        MTN: { prefix: '05', icon: '📲', color: '#ffcc00' },
        Orange: { prefix: '07', icon: '📶', color: '#ff6600' },
        Moov: { prefix: '01', icon: '📡', color: '#0066cc' }
    },
    AMOUNTS: [500, 1000, 2000, 5000, 10000, 15000, 20000, 25000]
};

// ==================== STATE ====================
let currentOrder = {
    id: null,
    operator: null,
    amount: null,
    amountTotal: null,
    phone: null,
    proof: null,
    status: 'pending',
    createdAt: null
};

let orders = JSON.parse(localStorage.getItem('bipbip_orders') || '[]');
let currentScreen = 'home';

// ==================== TELEGRAM WEBAPP ====================
let tg = window.Telegram?.WebApp;

function initTelegram() {
    if (tg) {
        tg.ready();
        tg.expand();
        
        // Appliquer le thème Telegram
        if (tg.colorScheme === 'light') {
            document.body.classList.add('light-theme');
        }
        
        // Configurer le bouton principal
        tg.MainButton.setParams({
            text: 'Fermer',
            color: '#e94560'
        });
        
        console.log('Telegram WebApp initialisé', tg.initDataUnsafe);
    }
}

// ==================== NAVIGATION ====================
function navigateTo(screen) {
    // Cacher tous les écrans
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
    });
    
    // Afficher l'écran demandé
    const targetScreen = document.getElementById(`screen-${screen}`);
    if (targetScreen) {
        targetScreen.classList.add('active');
        currentScreen = screen;
        
        // Actions spécifiques par écran
        if (screen === 'status') {
            renderOrdersList();
        }
    }
    
    // Scroll en haut
    window.scrollTo(0, 0);
}

// ==================== UTILS ====================
function generateOrderId() {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
}

function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function verifyNetwork(operator, phone) {
    const prefix = CONFIG.OPERATORS[operator]?.prefix;
    return phone.startsWith(prefix);
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function saveOrders() {
    localStorage.setItem('bipbip_orders', JSON.stringify(orders));
}

// ==================== BUY FLOW ====================
function selectOperator(operator) {
    currentOrder = {
        id: null,
        operator: operator,
        amount: null,
        amountTotal: null,
        phone: null,
        proof: null,
        status: 'pending',
        createdAt: null
    };
    
    // Couleurs des opérateurs
    const operatorColors = {
        MTN: { bg: 'linear-gradient(135deg, #FFCC00, #FFB300)', text: '#000' },
        Orange: { bg: 'linear-gradient(135deg, #FF6600, #E65100)', text: '#fff' },
        Moov: { bg: 'linear-gradient(135deg, #0066CC, #1565C0)', text: '#fff' }
    };
    
    // Afficher l'opérateur sélectionné
    const display = document.getElementById('selected-operator-display');
    const colors = operatorColors[operator];
    display.innerHTML = `
        <span class="operator-badge-display" style="background: ${colors.bg}; color: ${colors.text}; padding: 8px 16px; border-radius: 8px; font-weight: 800; font-size: 14px;">${operator}</span>
        <span style="flex: 1; font-weight: 600;">Opérateur sélectionné</span>
        <span style="color: #4CAF50;">✓</span>
    `;
    
    navigateTo('amount');
}

function selectAmount(amount) {
    const frais = Math.floor(amount * CONFIG.FRAIS_PERCENT / 100);
    const total = amount + frais;
    
    currentOrder.amount = amount;
    currentOrder.amountTotal = total;
    
    // Afficher le résumé
    const summary = document.getElementById('order-summary-phone');
    summary.innerHTML = `
        <p><span>Opérateur</span><span>${currentOrder.operator}</span></p>
        <p><span>Montant</span><span>${formatNumber(amount)} FCFA</span></p>
        <p><span>Frais (${CONFIG.FRAIS_PERCENT}%)</span><span>${formatNumber(frais)} FCFA</span></p>
        <p><span>Total à payer</span><span>${formatNumber(total)} FCFA</span></p>
    `;
    
    // Reset phone input
    document.getElementById('phone-input').value = '';
    document.getElementById('btn-continue-phone').disabled = true;
    document.getElementById('phone-hint').textContent = 'Entrez un numéro valide';
    document.getElementById('phone-hint').className = 'input-hint';
    
    navigateTo('phone');
}

function formatPhoneInput(input) {
    // Garder seulement les chiffres
    let value = input.value.replace(/\D/g, '');
    input.value = value;
    
    const btn = document.getElementById('btn-continue-phone');
    const hint = document.getElementById('phone-hint');
    
    if (value.length >= 10) {
        if (verifyNetwork(currentOrder.operator, value)) {
            btn.disabled = false;
            hint.textContent = '✅ Numéro valide';
            hint.className = 'input-hint success';
        } else {
            btn.disabled = true;
            hint.textContent = `❌ Ce numéro ne correspond pas à ${currentOrder.operator}`;
            hint.className = 'input-hint error';
        }
    } else {
        btn.disabled = true;
        hint.textContent = `Entrez un numéro ${currentOrder.operator} (${CONFIG.OPERATORS[currentOrder.operator].prefix}...)`;
        hint.className = 'input-hint';
    }
}

function validatePhone() {
    const phone = document.getElementById('phone-input').value.trim();
    
    if (phone.length < 10) {
        showToast('Numéro invalide', 'error');
        return;
    }
    
    if (!verifyNetwork(currentOrder.operator, phone)) {
        showToast('Numéro incompatible avec l\'opérateur', 'error');
        return;
    }
    
    currentOrder.phone = phone;
    
    // Afficher les détails de confirmation
    const details = document.getElementById('confirmation-details');
    const frais = currentOrder.amountTotal - currentOrder.amount;
    
    details.innerHTML = `
        <div class="detail-row">
            <span class="detail-label">Opérateur</span>
            <span class="detail-value">${CONFIG.OPERATORS[currentOrder.operator].icon} ${currentOrder.operator}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Numéro</span>
            <span class="detail-value">+225 ${currentOrder.phone}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Montant recharge</span>
            <span class="detail-value">${formatNumber(currentOrder.amount)} FCFA</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Frais de service</span>
            <span class="detail-value">${formatNumber(frais)} FCFA</span>
        </div>
        <div class="detail-row total-row">
            <span class="detail-label">Total à payer</span>
            <span class="detail-value">${formatNumber(currentOrder.amountTotal)} FCFA</span>
        </div>
    `;
    
    navigateTo('confirm');
}

function confirmOrder() {
    // Générer l'ID de commande
    currentOrder.id = generateOrderId();
    currentOrder.createdAt = new Date().toISOString();
    
    // Sauvegarder la commande
    orders.push({...currentOrder});
    saveOrders();
    
    // Afficher l'ID de commande
    document.getElementById('order-id-display').textContent = `Commande #${currentOrder.id}`;
    
    // Reset upload
    document.getElementById('upload-area').style.display = 'block';
    document.getElementById('preview-container').style.display = 'none';
    document.getElementById('btn-send-proof').disabled = true;
    
    // Envoyer notification à l'admin via Telegram (si disponible)
    if (tg) {
        tg.sendData(JSON.stringify({
            action: 'new_order',
            order: currentOrder
        }));
    }
    
    showToast('Commande créée !', 'success');
    navigateTo('proof');
}

// ==================== PROOF UPLOAD ====================
function handleProofUpload(event) {
    const file = event.target.files[0];
    console.log('📸 Upload fichier:', file);
    
    if (!file) {
        console.log('❌ Pas de fichier sélectionné');
        return;
    }
    
    // Vérifier la taille (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
        showToast('Image trop grande (max 5MB)', 'error');
        return;
    }
    
    // Vérifier le type
    if (!file.type.startsWith('image/')) {
        showToast('Fichier invalide (image requise)', 'error');
        return;
    }
    
    showToast('Chargement de l\'image...', 'info');
    
    const reader = new FileReader();
    reader.onload = function(e) {
        console.log('✅ Image chargée');
        currentOrder.proof = e.target.result;
        
        // Afficher l'aperçu
        const previewImg = document.getElementById('proof-preview');
        const uploadArea = document.getElementById('upload-area');
        const previewContainer = document.getElementById('preview-container');
        const sendBtn = document.getElementById('btn-send-proof');
        
        if (previewImg) previewImg.src = e.target.result;
        if (uploadArea) uploadArea.style.display = 'none';
        if (previewContainer) previewContainer.style.display = 'block';
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.textContent = '📤 Envoyer la preuve';
            console.log('✅ Bouton activé');
        }
        
        showToast('Image prête !', 'success');
    };
    
    reader.onerror = function() {
        console.error('❌ Erreur lecture fichier');
        showToast('Erreur lors du chargement', 'error');
    };
    
    reader.readAsDataURL(file);
}

function removePreview() {
    currentOrder.proof = null;
    const proofInput = document.getElementById('proof-input');
    const uploadArea = document.getElementById('upload-area');
    const previewContainer = document.getElementById('preview-container');
    const sendBtn = document.getElementById('btn-send-proof');
    
    if (proofInput) proofInput.value = '';
    if (uploadArea) uploadArea.style.display = 'block';
    if (previewContainer) previewContainer.style.display = 'none';
    if (sendBtn) sendBtn.disabled = true;
}

function sendProof() {
    console.log('📤 sendProof appelé');
    console.log('📋 currentOrder:', currentOrder);
    
    const sendBtn = document.getElementById('btn-send-proof');
    
    if (!currentOrder.proof) {
        showToast('Veuillez ajouter une preuve', 'error');
        return;
    }
    
    if (!currentOrder.id) {
        showToast('Erreur: commande non trouvée', 'error');
        return;
    }
    
    // Désactiver le bouton pendant l'envoi
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.textContent = '⏳ Envoi en cours...';
    }
    
    // Mettre à jour la commande avec la preuve
    const orderIndex = orders.findIndex(o => o.id === currentOrder.id);
    console.log('📦 Order index:', orderIndex);
    
    if (orderIndex !== -1) {
        orders[orderIndex].proof = currentOrder.proof;
        orders[orderIndex].status = 'proof_sent';
        saveOrders();
        console.log('✅ Commande mise à jour');
    } else {
        // Si la commande n'existe pas, l'ajouter
        currentOrder.status = 'proof_sent';
        orders.push({...currentOrder});
        saveOrders();
        console.log('✅ Nouvelle commande ajoutée');
    }
    
    // Envoyer via Telegram (si disponible)
    if (tg) {
        try {
            tg.sendData(JSON.stringify({
                action: 'proof_sent',
                orderId: currentOrder.id,
                proof: currentOrder.proof
            }));
        } catch (e) {
            console.log('Telegram sendData error:', e);
        }
    }
    
    // Afficher les infos de succès
    const successInfo = document.getElementById('success-order-info');
    if (successInfo) {
        successInfo.innerHTML = `
            <p><strong>Commande:</strong> #${currentOrder.id}</p>
            <p><strong>Montant:</strong> ${formatNumber(currentOrder.amountTotal)} FCFA</p>
            <p><strong>Numéro:</strong> +225 ${currentOrder.phone}</p>
            <p><strong>Statut:</strong> ⏳ En attente de validation</p>
        `;
    }
    
    showToast('Preuve envoyée avec succès !', 'success');
    console.log('✅ Navigation vers success');
    navigateTo('success');
}

// ==================== ORDERS LIST ====================
function renderOrdersList() {
    const container = document.getElementById('orders-list');
    
    if (orders.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">📭</span>
                <p>Aucune commande pour le moment</p>
            </div>
        `;
        return;
    }
    
    // Trier par date (plus récent en premier)
    const sortedOrders = [...orders].reverse();
    
    container.innerHTML = sortedOrders.map(order => `
        <div class="order-card">
            <div class="order-card-header">
                <span class="order-id">#${order.id}</span>
                <span class="order-status ${order.status === 'validated' ? 'validated' : 'pending'}">
                    ${getStatusLabel(order.status)}
                </span>
            </div>
            <div class="order-details">
                <p>${CONFIG.OPERATORS[order.operator]?.icon || '📱'} ${order.operator} - ${formatNumber(order.amount)} FCFA</p>
                <p>📞 +225 ${order.phone}</p>
                <p>💰 Total: ${formatNumber(order.amountTotal)} FCFA</p>
                <p>📅 ${formatDate(order.createdAt)}</p>
            </div>
        </div>
    `).join('');
}

function getStatusLabel(status) {
    const labels = {
        'pending': '⏳ En attente',
        'proof_sent': '📤 Preuve envoyée',
        'validated': '✅ Validée',
        'rejected': '❌ Rejetée'
    };
    return labels[status] || status;
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// ==================== ADMIN FUNCTIONS ====================
function switchAdminTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    renderAdminOrders(tab);
}

function renderAdminOrders(filter = 'pending') {
    const container = document.getElementById('admin-orders');
    
    const filteredOrders = orders.filter(o => {
        if (filter === 'pending') {
            return o.status === 'pending' || o.status === 'proof_sent';
        }
        return o.status === 'validated';
    });
    
    if (filteredOrders.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">📭</span>
                <p>Aucune commande ${filter === 'pending' ? 'en attente' : 'validée'}</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = filteredOrders.map(order => `
        <div class="admin-order-card">
            <div class="order-card-header">
                <span class="order-id">#${order.id}</span>
                <span class="order-status ${order.status === 'validated' ? 'validated' : 'pending'}">
                    ${getStatusLabel(order.status)}
                </span>
            </div>
            <div class="order-details">
                <p><strong>👤 User ID:</strong> ${order.userId || 'N/A'}</p>
                <p><strong>${CONFIG.OPERATORS[order.operator]?.icon || '📱'} Opérateur:</strong> ${order.operator}</p>
                <p><strong>💰 Montant:</strong> ${formatNumber(order.amountTotal)} FCFA</p>
                <p><strong>📞 Numéro:</strong> +225 ${order.phone}</p>
                <p><strong>📅 Date:</strong> ${formatDate(order.createdAt)}</p>
            </div>
            ${order.proof ? `<img class="proof-img" src="${order.proof}" alt="Preuve">` : '<p style="color: var(--accent-warning);">⚠️ Pas de preuve</p>'}
            ${filter === 'pending' ? `
                <div class="admin-actions">
                    <button class="btn-validate" onclick="validateOrder('${order.id}')">✅ Valider</button>
                    <button class="btn-reject" onclick="rejectOrder('${order.id}')">❌ Rejeter</button>
                </div>
            ` : ''}
        </div>
    `).join('');
}

function validateOrder(orderId) {
    const orderIndex = orders.findIndex(o => o.id === orderId);
    if (orderIndex !== -1) {
        orders[orderIndex].status = 'validated';
        saveOrders();
        
        // Envoyer notification via Telegram
        if (tg) {
            tg.sendData(JSON.stringify({
                action: 'order_validated',
                orderId: orderId
            }));
        }
        
        showToast('Commande validée !', 'success');
        renderAdminOrders('pending');
    }
}

function rejectOrder(orderId) {
    const orderIndex = orders.findIndex(o => o.id === orderId);
    if (orderIndex !== -1) {
        orders[orderIndex].status = 'rejected';
        saveOrders();
        
        showToast('Commande rejetée', 'error');
        renderAdminOrders('pending');
    }
}

// ==================== KEYBOARD SHORTCUTS ====================
document.addEventListener('keydown', (e) => {
    // Admin access: Ctrl + Shift + A
    if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        navigateTo('admin');
    }
});

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
    initTelegram();
    navigateTo('home');
    
    console.log('🚀 Bipbip Recharge CI - WebApp initialisée');
});
