// Lightweight parallax for hero blobs; respects reduced motion and animation toggle
(() => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const prefersReduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animDisabled = () => document.body.classList.contains('no-animations');

  const trackers = new Map(); // heroEl -> state

  function attach(hero) {
    if (!hero || trackers.has(hero)) return;
    const layer = hero.querySelector('.hero-parallax-layer');
    if (!layer) return;
    const blobA = layer.querySelector('.blob.indigo');
    const blobB = layer.querySelector('.blob.cyan');
    if (!blobA || !blobB) return;

    const state = { x: 0, y: 0, raf: 0, rect: hero.getBoundingClientRect() };
    trackers.set(hero, state);

    const onMove = (e) => {
      if (prefersReduced() || animDisabled()) return;
      const rect = (state.rect = hero.getBoundingClientRect());
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const x = (e.clientX - cx) / rect.width; // -0.5..0.5
      const y = (e.clientY - cy) / rect.height;
      state.x = Math.max(-0.6, Math.min(0.6, x));
      state.y = Math.max(-0.6, Math.min(0.6, y));
      schedule();
    };

    const onScroll = () => {
      if (prefersReduced() || animDisabled()) return;
      // slight vertical drift with scroll
      const drift = (window.scrollY % 300) / 300 - 0.5; // -0.5..0.5
      state.y = drift * 0.3;
      schedule();
    };

    function schedule() {
      if (state.raf) return;
      state.raf = requestAnimationFrame(() => {
        state.raf = 0;
        const dxA = state.x * 28, dyA = state.y * 28;
        const dxB = -state.x * 36, dyB = -state.y * 36;
        blobA.style.transform = `translate3d(${dxA}px, ${dyA}px, 0) scale(1.05)`;
        blobB.style.transform = `translate3d(${dxB}px, ${dyB}px, 0) scale(1.08)`;
      });
    }

    const opts = { passive: true };
    window.addEventListener('mousemove', onMove, opts);
    window.addEventListener('scroll', onScroll, opts);

    // Seed an initial slight offset
    schedule();

    // Store cleanup
    state.cleanup = () => {
      window.removeEventListener('mousemove', onMove, opts);
      window.removeEventListener('scroll', onScroll, opts);
      if (state.raf) cancelAnimationFrame(state.raf);
      trackers.delete(hero);
    };
  }

  function scan() {
    document.querySelectorAll('.hero').forEach(attach);
  }

  const mo = new MutationObserver((muts) => {
    if (prefersReduced() || animDisabled()) return;
    for (const m of muts) {
      if (m.type === 'childList') {
        scan();
      }
    }
  });

  function init() {
    if (prefersReduced()) return; // respect OS setting
    scan();
    try { mo.observe(document.body, { childList: true, subtree: true }); } catch (_) {}
    window.addEventListener('beforeunload', () => {
      for (const st of trackers.values()) st.cleanup?.();
      mo.disconnect();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
