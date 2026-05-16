/* ── Entity (Company) Switcher — Amber Office ──
   Loaded in <head> before page body renders.
   - Sets html[data-entity] immediately → correct accent theme, no flash.
   - Exposes: window.getEntity(), window.switchEntity(entity), window.initEntitySwitcher()
*/
(function () {
  const ADMIN_ROLES = ['admin', 'super_admin'];
  const role = localStorage.getItem('ao_role') || '';
  const isAdmin = ADMIN_ROLES.includes(role);

  // Ensure a default exists in storage
  if (!localStorage.getItem('ao_entity')) {
    localStorage.setItem('ao_entity', 'AOSB');
  }

  // Apply accent theme immediately to <html> — prevents colour flash on load
  document.documentElement.setAttribute('data-entity',
    (localStorage.getItem('ao_entity') || 'AOSB').toLowerCase());

  /** Returns the active entity ('AOSB' or 'ADSB') */
  window.getEntity = function () {
    return localStorage.getItem('ao_entity') || 'AOSB';
  };

  /** Switch active entity and notify the page to reload its data */
  window.switchEntity = function (entity) {
    if (!isAdmin) return;
    localStorage.setItem('ao_entity', entity);
    _updateUI(entity);
    window.dispatchEvent(new CustomEvent('entitychange', { detail: { entity } }));
  };

  function _updateUI(entity) {
    // Update <html> attribute for CSS theme
    document.documentElement.setAttribute('data-entity', entity.toLowerCase());

    // Update switcher button active states
    const btnA = document.getElementById('entity-btn-aosb');
    const btnB = document.getElementById('entity-btn-adsb');
    if (btnA) {
      btnA.classList.toggle('active-aosb', entity === 'AOSB');
      btnA.classList.remove('active-adsb');
    }
    if (btnB) {
      btnB.classList.toggle('active-adsb', entity === 'ADSB');
      btnB.classList.remove('active-aosb');
    }

    // Update compact header badge
    const badge = document.getElementById('active-entity-badge');
    if (badge && isAdmin) {
      badge.textContent = entity;
      badge.className = 'entity-header-badge entity-header-' + entity.toLowerCase();
    }

    // Production module is ADSB-only on non-production pages.
    // On the home page (/) itself we always keep production nav visible
    // so users can navigate between Dashboard / Job Orders / OEE tabs.
    var onProductionPage = window.location.pathname === '/' || window.location.pathname === '/index.html';
    document.querySelectorAll('.nav-section-production').forEach(function (el) {
      el.style.display = (entity === 'ADSB' || onProductionPage) ? '' : 'none';
    });
  }

  /** Call once after DOM is ready — shows switcher for admins and syncs UI */
  window.initEntitySwitcher = function () {
    const el = document.getElementById('entity-switcher');
    if (el && isAdmin) el.classList.remove('hidden');
    _updateUI(window.getEntity());

    // On mobile, close the sidebar whenever a nav item is clicked so the
    // backdrop never stays open and blocks the main content area.
    document.querySelectorAll('.nav-item').forEach(function (navEl) {
      navEl.addEventListener('click', function () {
        if (typeof closeSidebar === 'function') closeSidebar();
      });
    });
  };
})();
