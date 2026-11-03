// components/slide-fit.js — keeps every slide's text inside the slide.
// Slide type sizes are relative to the slide's width (cqw); a long title, many long bullets, or a photo / chart taking
// the right side can push text past the bottom. Each slide gets a fit factor (--ps-fit, used by the slide font sizes)
// that is lowered in small steps until the text fits — never below 55%. Re-fits when a slide changes size (presenter,
// panel resize) and whenever slides are (re)drawn.
(function(){
  'use strict';
  const MIN = 0.55, STEP = 0.05;
  function fit(slide){
    const inner = slide.querySelector('.pres-slide-inner'); if(!inner || !inner.clientHeight) return;
    let f = 1; slide.style.setProperty('--ps-fit', 1);
    while(f > MIN && (inner.scrollHeight > inner.clientHeight + 1 || inner.scrollWidth > inner.clientWidth + 1)){ f = Math.round((f - STEP) * 100) / 100; slide.style.setProperty('--ps-fit', f); }
  }
  const seen = new WeakSet(), ro = window.ResizeObserver ? new ResizeObserver(es => es.forEach(e => fit(e.target))) : null;
  function scan(root){
    (root.querySelectorAll ? root.querySelectorAll('.pres-slide') : []).forEach(s => { if(!seen.has(s)){ seen.add(s); if(ro) ro.observe(s); } setTimeout(() => fit(s), 0); });
    if(root.classList && root.classList.contains('pres-slide') && !seen.has(root)){ seen.add(root); if(ro) ro.observe(root); setTimeout(() => fit(root), 0); }
  }
  const start = () => { scan(document.body); new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if(n.nodeType === 1) scan(n); }))).observe(document.body, { childList: true, subtree: true }); };
  if(document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  // Printing slides (Export slides as PDF): every slide is one landscape page at the real 16:9 slide size
  // (13.333 × 7.5 in, like a widescreen deck), filling the page edge to edge — and its text is fitted at that size
  // before printing. Returns a function that undoes the page setup after printing.
  const PAGE_W = '13.333in', PAGE_H = '7.5in';
  function prepareForPrint(box){
    const css = document.createElement('style'); css.id = 'slidefit-print-page';
    css.textContent = `@page{size:${PAGE_W} ${PAGE_H};margin:0;}
      @media print{ html.pdf-printing #pdf-print{padding:0 !important;margin:0 !important;}
        html.pdf-printing #pdf-print .pdf-slide{width:${PAGE_W};height:${PAGE_H};margin:0;overflow:hidden;break-after:page;page-break-after:always;break-inside:avoid;}
        html.pdf-printing #pdf-print .pdf-slide:last-child{break-after:auto;page-break-after:auto;}
        html.pdf-printing #pdf-print .pdf-slide .pres-slide{width:100%;height:100%;aspect-ratio:auto;border:0;border-radius:0;box-shadow:none;} }`;
    document.head.appendChild(css);
    // measure and fit each slide at the printed size (off screen for a moment)
    const old = box.getAttribute('style');
    box.style.cssText = 'display:block;position:fixed;left:-40000px;top:0;';
    box.querySelectorAll('.pdf-slide').forEach(p => { p.style.width = PAGE_W; p.style.height = PAGE_H; const sl = p.querySelector('.pres-slide'); if(sl){ sl.style.width = '100%'; sl.style.height = '100%'; sl.style.aspectRatio = 'auto'; fit(sl); } });
    if(old == null) box.removeAttribute('style'); else box.setAttribute('style', old);
    return () => css.remove();
  }
  window.SlideFit = { fit, prepareForPrint };
})();
