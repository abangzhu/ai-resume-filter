/**
 * CVFilterX - Toast Notification
 * Replaces alert() with non-blocking toast messages
 */

function showToast(message, type = 'info', duration = 3000) {
  const existing = document.getElementById('cvfx-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'cvfx-toast';
  toast.className = `cvfx-toast cvfx-toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('cvfx-toast-visible'));

  setTimeout(() => {
    toast.classList.remove('cvfx-toast-visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    // Fallback removal if transitionend doesn't fire
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
