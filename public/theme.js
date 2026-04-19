(function () {
  const saved = localStorage.getItem('ao_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);

  window.toggleTheme = function () {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('ao_theme', next);
    _updateBtns(next);
  };

  function _updateBtns(theme) {
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
      btn.textContent = theme === 'dark' ? '☀ Light' : '☾ Dark';
    });
  }

  document.addEventListener('DOMContentLoaded', () => _updateBtns(saved));
})();
