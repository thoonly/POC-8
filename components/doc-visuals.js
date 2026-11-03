// components/doc-visuals.js — pictures inside node documents, so a document is easier to understand at a glance.
//
// Two markers the AI may put into the Markdown it writes (DocVisuals.rule tells it how). The shared renderer
// (renderMarkdownToHtml) is wrapped, so every document drawn with it gets them: Design mode's research and logic
// documents, a node result turned into another format, the Workstream result.
//
//   ```diagram
//   {"kind": "cycle", "title": "One combat turn", "nodes": [{"id": "a", "label": "Choose actions"}, …]}
//   ```
//     kind: "flow" (steps in order) · "cycle" (steps that repeat; the last leads back to the first) · "tree" (parts of
//     a whole — each node names its "parent"). 2-8 nodes. The AI only says WHAT is in it; this file draws it as inline
//     SVG, so it is always tidy. Strokes and text use currentColor (readable in a printed PDF too); fills come from
//     tokens in doc-visuals.css. A diagram that doesn't parse is left out.
//
//   [photo: Pokémon Red]          (on its own line)
//     A real, credited photo of one specific, named thing, from components/place-images.js (approved remote-image
//     exception — real images only, credited). Shown only when the page it came from is about that name; otherwise
//     nothing is shown.
//
// Each figure keeps its original Markdown in data-md and is not editable, so a document edited in place (and turned
// back into Markdown) keeps its diagrams and photos.
(function(){
  'use strict';
  if(typeof renderMarkdownToHtml !== 'function') return;
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let seq = 0;

  const RULE = `PICTURES — only where one makes the document easier to understand; most documents need none or one:
- A DIAGRAM when a process, a repeating loop or the parts of a whole are easier to see than to read. Put it right after the text it explains, as a fenced block:
\`\`\`diagram
{"kind": "flow", "title": "2-6 words", "nodes": [{"id": "a", "label": "2-5 words"}, {"id": "b", "label": "2-5 words"}]}
\`\`\`
"kind": "flow" = steps in order; "cycle" = steps that repeat (the last leads back to the first); "tree" = parts of a whole (every node except the first has "parent": the id of its parent). 3-8 nodes. At most 2 diagrams per document. Never repeat a table as a diagram.
- A PHOTO of one specific, real, named thing the text is about (a game, a place, a building, a product, a dish): its exact name alone on its own line, as [photo: exact name]. At most 3 per document. Never for generic things, ideas or people.
`;

  // ---------- diagram ----------
  const BOX_W = 168, LINE = 16, PAD = 10, GAP = 40;
  function wrap(label, max){
    const words = String(label).trim().split(/\s+/), lines = [];
    let cur = '';
    words.forEach(w => { if(cur && (cur + ' ' + w).length > max){ lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; });
    if(cur) lines.push(cur);
    if(lines.length > 3){ lines.length = 3; lines[2] = lines[2].replace(/.?$/, '…'); }
    return lines;
  }
  const boxH = n => PAD * 2 + n.lines.length * LINE;
  function box(n, cls){
    const x = n.x - n.w / 2, y = n.y - n.h / 2, ty = n.y - (n.lines.length - 1) * LINE / 2;
    return `<g class="dv-node${cls ? ' ' + cls : ''}"><rect x="${x}" y="${y}" width="${n.w}" height="${n.h}" rx="8" fill="none" stroke="currentColor" stroke-width="1.25"/>` +
      `<text x="${n.x}" y="${ty}" text-anchor="middle" dominant-baseline="middle" fill="currentColor">${n.lines.map((l, i) => `<tspan x="${n.x}" dy="${i ? LINE : 0}">${E(l)}</tspan>`).join('')}</text></g>`;
  }
  // where the line from a box's centre towards (tx, ty) leaves the box
  function edge(n, tx, ty){
    const dx = tx - n.x, dy = ty - n.y;
    if(!dx && !dy) return { x: n.x, y: n.y };
    const s = Math.min(dx ? (n.w / 2 + 4) / Math.abs(dx) : Infinity, dy ? (n.h / 2 + 4) / Math.abs(dy) : Infinity);
    return { x: n.x + dx * s, y: n.y + dy * s };
  }
  const arrow = (a, b, mk) => { const p = edge(a, b.x, b.y), q = edge(b, a.x, a.y); return `<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${q.x.toFixed(1)}" y2="${q.y.toFixed(1)}" stroke="currentColor" stroke-width="1.25" marker-end="url(#${mk})"/>`; };

  function parse(body){
    let d;
    try { d = JSON.parse(body); } catch(e){
      const a = body.indexOf('{'), b = body.lastIndexOf('}');
      try { d = JSON.parse(body.slice(a, b + 1)); } catch(e2){ return null; }
    }
    if(!d || !Array.isArray(d.nodes)) return null;
    const nodes = d.nodes.filter(n => n && typeof n.label === 'string' && n.label.trim()).slice(0, 8)
      .map((n, i) => ({ id: String(n.id == null ? i : n.id), label: n.label.trim(), parent: n.parent == null ? '' : String(n.parent) }));
    if(nodes.length < 2) return null;
    return { kind: ['flow', 'cycle', 'tree'].includes(d.kind) ? d.kind : 'flow', title: typeof d.title === 'string' ? d.title.trim() : '', nodes };
  }

  function layout(d){
    const ns = d.nodes;
    if(d.kind === 'cycle' && ns.length >= 3){
      ns.forEach(n => { n.w = 140; n.lines = wrap(n.label, 17); n.h = boxH(n); });
      const r = 70 + ns.length * 16, cx = r + 90, cy = r + 40;
      ns.forEach((n, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / ns.length; n.x = cx + r * Math.cos(a); n.y = cy + r * Math.sin(a); });
      return { w: cx * 2, h: cy * 2, edges: ns.map((n, i) => [n, ns[(i + 1) % ns.length]]), center: { x: cx, y: cy } };
    }
    if(d.kind === 'tree'){
      ns.forEach(n => { n.w = BOX_W - 20; n.lines = wrap(n.label, 18); n.h = boxH(n); });
      const root = ns[0], ids = new Set(ns.map(n => n.id));
      ns.slice(1).forEach(n => { if(!ids.has(n.parent) || n.parent === n.id) n.parent = root.id; });
      const kids = ns.filter(n => n !== root && n.parent === root.id);
      if(!kids.length) return null;
      const col = BOX_W;
      root.x = (kids.length * col) / 2; root.y = 10 + root.h / 2;
      let maxY = root.y + root.h / 2;
      const edges = [];
      kids.forEach((k, i) => {
        k.x = col / 2 + i * col; k.y = root.y + root.h / 2 + 50 + k.h / 2; edges.push([root, k]);
        let y = k.y + k.h / 2;
        ns.filter(n => n.parent === k.id).forEach(g => { g.x = k.x; g.y = y + 24 + g.h / 2; y = g.y + g.h / 2; edges.push([k, g]); });
        maxY = Math.max(maxY, y);
      });
      ns.filter(n => n !== root && !kids.includes(n) && n.x == null).forEach(n => { n.hidden = true; }); // deeper than two levels: left out
      return { w: Math.max(kids.length * col, BOX_W), h: maxY + 12, edges, tree: true };
    }
    // flow: side by side when it fits (4 or fewer), else one under another
    ns.forEach(n => { n.w = BOX_W; n.lines = wrap(n.label, 20); n.h = boxH(n); });
    if(ns.length <= 4){
      const h = Math.max(...ns.map(n => n.h));
      ns.forEach((n, i) => { n.x = 10 + BOX_W / 2 + i * (BOX_W + GAP); n.y = 10 + h / 2; });
      return { w: 20 + ns.length * BOX_W + (ns.length - 1) * GAP, h: h + 20, edges: ns.slice(1).map((n, i) => [ns[i], n]) };
    }
    let y = 10;
    ns.forEach(n => { n.x = 10 + BOX_W / 2; n.y = y + n.h / 2; y += n.h + 28; });
    return { w: BOX_W + 20, h: y - 18, edges: ns.slice(1).map((n, i) => [ns[i], n]) };
  }

  function diagramHtml(body, src){
    const d = parse(body); if(!d) return '';
    const L = layout(d); if(!L) return '';
    const mk = 'dv-ah-' + (++seq);
    const lines = L.edges.filter(([a, b]) => !a.hidden && !b.hidden).map(([a, b]) => L.tree
      ? `<path d="M${a.x} ${a.y + a.h / 2} V${(a.y + a.h / 2 + b.y - b.h / 2) / 2} H${b.x} V${b.y - b.h / 2 - 4}" fill="none" stroke="currentColor" stroke-width="1.25" marker-end="url(#${mk})"/>`
      : arrow(a, b, mk)).join('');
    const nodes = d.nodes.filter(n => !n.hidden).map((n, i) => box(n, d.kind === 'tree' && i === 0 ? 'dv-node--root' : '')).join('');
    const loop = d.kind === 'cycle' && L.center ? `<text class="dv-loop" x="${L.center.x}" y="${L.center.y}" text-anchor="middle" dominant-baseline="middle" fill="currentColor" aria-hidden="true">↻</text>` : '';
    const label = `${d.title || 'Diagram'}: ${d.nodes.filter(n => !n.hidden).map(n => n.label).join(d.kind === 'tree' ? ', ' : ' → ')}${d.kind === 'cycle' ? ' → back to the start' : ''}`;
    return `<figure class="dv-fig dv-fig--${d.kind}" contenteditable="false" data-md="${E(src)}">` +
      `<svg viewBox="0 0 ${Math.ceil(L.w)} ${Math.ceil(L.h)}" width="${Math.ceil(L.w)}" role="img" aria-label="${E(label)}" xmlns="http://www.w3.org/2000/svg">` +
      `<defs><marker id="${mk}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker></defs>` +
      `${loop}${lines}${nodes}</svg>${d.title ? `<figcaption>${E(d.title)}</figcaption>` : ''}</figure>`;
  }

  // ---------- photo ----------
  const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'game', 'games', 'video', 'series', 'photo', 'image', 'picture', 'official']);
  const words = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 3 && !STOP.has(w));
  // the photo is about this name only when the page it came from shares a distinctive word with it
  const about = (q, hit) => { const t = new Set(words(`${hit.title || ''} ${hit.credit || ''}`)); return words(q).some(w => t.has(w)); };
  const photoHtml = (q, src) => `<figure class="dv-photo" contenteditable="false" data-md="${E(src)}" data-q="${E(q)}" hidden></figure>`;

  function decorate(root){
    if(!window.PlaceImages || !PlaceImages.find) return;
    (root || document).querySelectorAll('figure.dv-photo:not([data-dv])').forEach(fig => {
      fig.dataset.dv = 'looking';
      const q = fig.dataset.q;
      PlaceImages.find(q).then(hit => {
        if(!hit || !hit.url || !about(q, hit)){ fig.dataset.dv = 'none'; return; } // nothing found: nothing shown
        fig.dataset.dv = 'shown';
        fig.innerHTML = `<img src="${E(hit.url)}" alt="${E(q)}" loading="lazy" referrerpolicy="no-referrer"><figcaption>${E(q)} · Photo: <a href="${E(hit.href || hit.url)}" target="_blank" rel="noopener">${E(hit.credit || 'source')}</a></figcaption>`;
        const img = fig.querySelector('img');
        img.addEventListener('error', () => { fig.hidden = true; fig.dataset.dv = 'none'; });
        fig.hidden = false;
      }).catch(() => { fig.dataset.dv = 'none'; });
    });
  }
  // documents are redrawn often: look up new photo markers after each redraw
  let t = 0;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => decorate(document), 80); }).observe(document.documentElement, { childList: true, subtree: true });

  // ---------- the renderer ----------
  const base = renderMarkdownToHtml;
  window.renderMarkdownToHtml = function(raw){
    const parts = [];
    const hold = html => { parts.push(html); return `\n\n@@DV${parts.length - 1}@@\n\n`; };
    let text = String(raw || '').replace(/\r\n/g, '\n')
      .replace(/```diagram[^\n]*\n([\s\S]*?)(?:\n```|$)/g, (m, body) => hold(diagramHtml(body, m.trim())))
      .replace(/^[ \t]*\[photo:\s*([^\]\n]{2,80})\][ \t]*$/gim, (m, q) => hold(photoHtml(q.trim(), m.trim())));
    const html = base.call(this, text);
    return parts.length ? html.replace(/<p class="answer-p">@@DV(\d+)@@<\/p>/g, (m, i) => parts[+i] || '') : html;
  };

  window.DocVisuals = { rule: RULE, diagramHtml, decorate };
})();
