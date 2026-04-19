(function () {
  const THEMES = ['light', 'dark', 'green'];
  const LABELS = { light: '☾ Dark', dark: '🌿 Green', green: '☀ Light' };
  const saved = localStorage.getItem('ao_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);

  window.toggleTheme = function () {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('ao_theme', next);
    _updateBtns(next);
  };

  function _updateBtns(theme) {
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
      btn.textContent = LABELS[theme] || '☾ Dark';
    });
  }

  document.addEventListener('DOMContentLoaded', () => _updateBtns(saved));
})();
