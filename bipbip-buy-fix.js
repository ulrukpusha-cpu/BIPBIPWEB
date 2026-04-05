/**
 * BIPBIPWEB - Fix boutons "Acheter"
 * Ajoute event delegation UNIQUEMENT pour les boutons amount et operator
 * qui n'ont pas d'onclick inline.
 * NOTE: #btn-continue-phone a déjà onclick="validatePhone()" dans le HTML
 *       + event delegation dans initApp() — pas besoin de doublon ici.
 */

(function() {
  'use strict';

  console.log('[BIPBIP FIX] Chargement du fix boutons amount...');

  function init() {
    // ============================================
    // FIX 1: Boutons Amount (data-amount)
    // ============================================
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('.amount-btn');
      if (!btn) return;

      var amount = btn.getAttribute('data-amount');
      if (!amount) return;

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

    // FIX 3 supprimé : #btn-continue-phone a déjà onclick="validatePhone()"
    // L'ancien handler document-level causait un double-appel de validatePhone()

    console.log('[BIPBIP FIX] Event listeners ajoutés avec succès');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
