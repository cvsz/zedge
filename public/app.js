// Zedge v2.0 - Frontend Application
document.addEventListener('DOMContentLoaded', () => {
  // Initialize theme
  const savedTheme = localStorage.getItem('zedgeTheme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = savedTheme || (prefersDark ? 'dark' : 'light');
  
  // Theme toggle
  const themeToggle = document.createElement('button');
  themeToggle.style.cssText = 'position: fixed; top: 1rem; right: 1rem; z-index: 9999;';
  themeToggle.textContent = savedTheme === 'dark' ? '☀️' : '🌙';
  themeToggle.onclick = () => {
    const html = document.documentElement;
    const newTheme = html.dataset.theme === 'dark' ? 'light' : 'dark';
    html.dataset.theme = newTheme;
    localStorage.setItem('zedgeTheme', newTheme);
    themeToggle.textContent = newTheme === 'dark' ? '☀️' : '🌙';
  };
  document.body.appendChild(themeToggle);
  
  // Simple toast
  function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed; top: 1rem; right: 1rem; padding: 0.75rem 1.25rem;
      background: ${isError ? 'rgba(220, 38, 38, 0.9)' : 'rgba(5, 150, 105, 0.9)'};
      color: white; border-radius: 0.5rem; z-index: 9999;
    `;
    toast.textContent = `${message} <button>×</button>`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }
  
  showToast('Zedge v2.0 loaded');
});
