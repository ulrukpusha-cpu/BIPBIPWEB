/**
 * BIPBIPWEB - Fix boutons "Acheter"
 * Boss demandé : ajoute event listeners pour selectAmount et autres actions
 * Date: 2026-04-04
 */

(function() {
  'use strict';
  
  console.log('[BIPBIP FIX] Chargement du fix boutons amount...');
  
  // Attendre que le DOM soit prêt
  function init() {
    // ============================================
    // FIX 1: Boutons Amount (data-amount)
    // ============================================
    // Les boutons ont data-amount mais pas d'onclick
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('.amount-btn');
      if (!btn) return;
      
      var amount = btn.getAttribute('data-amount');
      if (!amount) return;
      
      // Appeler selectAmount si elle existe (définie dans app.js)
      if (typeof selectAmount === 'function') {
        selectAmount(parseInt(amount, 10));
      } else {
        console.warn('[BIPBIP FIX] selectAmount() non disponible encore');
      }
    });
    
    // ============================================
    // FIX 2: Boutons Operator (event delegation aussi)
    // ============================================
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('.operator-btn');
      if (!btn) return;
      
      var operator = btn.getAttribute('data-operator');
      if (!operator) return;
      
      if (typeof selectOperator === 'function') {
        selectOperator(operator);
      }
    });
    
    // ============================================
    // FIX 3: Bouton Continue Phone
    // ============================================
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('#btn-continue-phone');
      if (!btn) return;
      
      if (typeof validatePhone === 'function') {
        validatePhone();
      }
    });
    
    // ============================================
    // DEBUG: Log des clics pour voir si ça marche
    // ============================================
    if (location.search.includes('debug=1')) {
      document.addEventListener('click', function(e) {
        var target = e.target.closest('[data-amount], [data-operator], .amount-btn, .operator-btn');
        if (target) {
          console.log('[BIPBIP DEBUG] Click sur:', target.className, 'data:', target.dataset);
        }
      });
    }
    
    console.log('[BIPBIP FIX] Event listeners ajoutés avec succès');
  }
  
  // Lancer immédiatement ou attendre DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
})();
