// components/dot-loader.js — dot-matrix loaders for the prototype's loading states.
//
//   Tri Orbit  (AI working: setting up, combining, updating, writing)  — every .dot-spin / .graph-loading-spinner
//   Radar Arc  (searching the web: research, explore, collecting)       — any spinner with data-dmx="radar"
//
// PORTED (rewritten in plain JS/CSS from the React originals) from Dot Matrix — https://dotmatrix.zzzzshawn.cloud,
// github.com/zzzzshawn/matrix — loaders "dotm-circular-2" (Tri Orbit) and "dotm-circular-4" (Radar Arc).
// LICENCE: Dot Matrix uses a Custom Proprietary License. It allows use in products, but forbids, without the author's
// written permission, "presenting any component from this project as a standalone reusable component, or claiming it
// as part of another component library or similar reusable component collection". This file lives in our components/
// folder, which is such a collection. The team chose to port them for this prototype knowing that (round 24).
// PROTOTYPE ONLY — get written permission from the author, or replace these loaders, before any production use or the
// hand-off to dev.
//
// The existing spinner elements are upgraded in place (a MutationObserver, so spinners drawn later are upgraded too):
// call sites don't change. Colour: the AI purple token. Reduced motion: a still frame.
(function(){
  'use strict';
  const SEL = '.dot-spin, .graph-loading-spinner, .dmx-loader';
  const CORNER = (r, c) => (r === 0 || r === 4) && (c === 0 || c === 4); // the circular mask: a 5×5 grid without its corners
  // Tri Orbit: the 12 ring cells, clockwise from the top
  const RING = [[0, 1], [0, 2], [0, 3], [1, 4], [2, 4], [3, 4], [4, 3], [4, 2], [4, 1], [3, 0], [2, 0], [1, 0]];
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function orbitHtml(){
    let h = '';
    for(let r = 0; r < 5; r++) for(let c = 0; c < 5; c++){
      if(CORNER(r, c)){ h += '<i class="dmx-dot dmx-off"></i>'; continue; }
      const o = RING.findIndex(([a, b]) => a === r && b === c);
      h += o < 0 ? `<i class="dmx-dot" style="opacity:${r === 2 && c === 2 ? 0.18 : 0.08}"></i>`
        : `<i class="dmx-dot dmx-ring" style="--o:${o};--still:${(0.28 + (o / 11) * 0.58).toFixed(3)}"></i>`;
    }
    return h;
  }
  function radarHtml(){
    let h = '';
    for(let r = 0; r < 5; r++) for(let c = 0; c < 5; c++) h += CORNER(r, c) ? '<i class="dmx-dot dmx-off"></i>' : `<i class="dmx-dot" data-r="${r}" data-c="${c}"></i>`;
    return h;
  }
  function upgrade(el){
    if(el.dataset.dmxOn) return;
    const kind = el.dataset.dmx === 'radar' ? 'radar' : 'orbit';
    el.dataset.dmxOn = kind; el.classList.add('dmx', 'dmx--' + kind); el.setAttribute('aria-hidden', 'true');
    el.innerHTML = kind === 'radar' ? radarHtml() : orbitHtml();
    if(kind === 'radar'){ paintRadar(el, 0); kick(); }
  }
  function scan(root){
    if(!root || root.nodeType !== 1) return;
    if(root.matches && root.matches(SEL)) upgrade(root);
    root.querySelectorAll && root.querySelectorAll(SEL).forEach(upgrade);
  }

  // Radar Arc: a rotating arm — bright front, soft wake, faint perimeter ring, a lit centre (one cycle ≈ 1.16 s)
  const RADAR_MS = 1800 / 1.55;
  function radarOpacity(r, c, phase){
    const cr = r - 2, cc = c - 2, radius = Math.hypot(cr, cc), th = phase * Math.PI * 2, sx = Math.cos(th), sy = Math.sin(th);
    const proj = cc * sx + cr * sy, perp = Math.abs(cc * sy - cr * sx);
    if(radius < 0.5) return 0.62;
    if(proj > 0.3 && perp < 0.55) return 0.96;
    if(proj > 0 && perp < 1.15) return 0.36;
    if(radius > 1.6 && radius < 2.3) return 0.22;
    return 0.08;
  }
  function paintRadar(el, phase){ el.querySelectorAll('.dmx-dot[data-r]').forEach(d => { d.style.opacity = radarOpacity(+d.dataset.r, +d.dataset.c, phase); }); }
  const radars = document.getElementsByClassName('dmx--radar'); // live list
  let running = false;
  function kick(){ if(running || reduced()) return; running = true; requestAnimationFrame(tick); }
  function tick(t){
    if(!radars.length){ running = false; return; } // nothing to draw: stop until a radar appears
    const phase = (t % RADAR_MS) / RADAR_MS;
    for(let i = 0; i < radars.length; i++) paintRadar(radars[i], phase);
    requestAnimationFrame(tick);
  }

  function start(){
    scan(document.body);
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(scan))).observe(document.body, { childList: true, subtree: true });
  }
  if(document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  window.DotLoader = { upgrade, html: kind => `<span class="dmx-loader"${kind === 'radar' ? ' data-dmx="radar"' : ''}></span>` };
})();
