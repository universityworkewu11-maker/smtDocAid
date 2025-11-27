// Simple tilt effect for elements with class .tilt
// Adds inline transform based on pointer position and toggles .tilt-active on hover
// Respects prefers-reduced-motion and .no-animations on body
(function(){
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const prefersReduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const disabled = () => prefersReduce || document.body.classList.contains('no-animations');

  function attach(el){
    if (!el || el.__tiltBound) return; el.__tiltBound = true;
    const max = 8; // degrees
    const damp = 0.12;
    let raf = null;
    let targetRX = 0, targetRY = 0, rX = 0, rY = 0;

    function onMove(e){
      if (disabled()) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width/2;
      const cy = rect.top + rect.height/2;
      const dx = (e.clientX - cx) / (rect.width/2);
      const dy = (e.clientY - cy) / (rect.height/2);
      targetRY = Math.max(-1, Math.min(1, dx)) * max; // rotateY follows X
      targetRX = -Math.max(-1, Math.min(1, dy)) * max; // rotateX follows Y (invert)
      if (!raf) loop();
    }
    function loop(){
      raf = requestAnimationFrame(loop);
      rX += (targetRX - rX) * damp;
      rY += (targetRY - rY) * damp;
      el.style.transform = `perspective(800px) rotateX(${rX.toFixed(2)}deg) rotateY(${rY.toFixed(2)}deg)`;
    }
    function onEnter(){ if (!disabled()) el.classList.add('tilt-active'); }
    function onLeave(){
      el.classList.remove('tilt-active');
      targetRX = 0; targetRY = 0;
      if (!raf) loop();
      setTimeout(()=>{ cancelAnimationFrame(raf); raf = null; el.style.transform=''; }, 200);
    }

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointerleave', onLeave);
  }

  function init(){
    document.querySelectorAll('.tilt').forEach(attach);
    // Observe for dynamically added nodes
    const mo = new MutationObserver(() => {
      document.querySelectorAll('.tilt').forEach(attach);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
