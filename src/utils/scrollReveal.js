// Lightweight scroll reveal using IntersectionObserver
// Elements with class "reveal" will get class "visible" when entering viewport
export function initScrollReveal() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!('IntersectionObserver' in window)) {
    // Fallback: show everything
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        io.unobserve(e.target);
      }
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.15 });

  // Observe all existing .reveal nodes
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));

  // Also observe dynamically added nodes so newly-rendered content becomes visible
  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.classList && node.classList.contains('reveal')) {
          io.observe(node);
        }
        // Any descendants with .reveal
        node.querySelectorAll?.('.reveal').forEach((el) => io.observe(el));
      }
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
}

// Auto-init on DOM ready for static content; React rerenders may need manual calls in components
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initScrollReveal());
  } else {
    initScrollReveal();
  }
}
