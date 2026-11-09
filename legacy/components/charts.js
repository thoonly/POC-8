// components/charts.js — small SVG charts (bar, pie, line) drawn from a table's numbers. No library, file://-safe;
// colours come from tokens through CSS classes (components/charts.css), so light and dark both work.
//
//   const data = Charts.fromTable(tableEl);            // { labels, series: [{ name, values }], unit } or null
//   el.innerHTML = Charts.svg(data, 'bar', 'Budget');   // 'bar' | 'pie' | 'donut' | 'line'
//
// The table is the data: the first column holds the labels, every column whose cells are (mostly) numbers is a series.
// Cells like "¥4,000", "฿1,500 pp", "30%", "1.2k", "2.5M", "-2", "−1.9%" are read as numbers. Bar and line charts show
// negative numbers below a zero line; pie and donut need parts of a whole, so data with a negative number is drawn as bars.
(function(){
  'use strict';
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const tr = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  function num(text){
    const t = String(text || '').replace(/\s+/g, ' ').replace(/[−–—](?=\s?[\d.])/g, '-').replace(/-\s+(?=\d)/g, '-').trim(); if(!t) return null;
    const m = t.replace(/,/g, '').match(/-?\d+(?:\.\d+)?\s*([kKmMbB](?![a-z]))?/); if(!m) return null;
    let v = parseFloat(m[0]); const mult = (m[1] || '').toLowerCase();
    if(mult === 'k') v *= 1e3; else if(mult === 'm') v *= 1e6; else if(mult === 'b') v *= 1e9;
    // a cell that is mostly words (e.g. "Day 2 morning") is not a number
    const letters = t.replace(/[\d.,%\s\-–+]/g, '').replace(/^[^\p{L}]*|[^\p{L}]*$/gu, '');
    return letters.length > 6 ? null : v;
  }
  function unitOf(header, cells){
    const h = String(header || ''), u = h.match(/\(([^)]{1,8})\)/); if(u) return u[1];
    const c = cells.find(Boolean) || ''; const sym = String(c).match(/^[^\d\-\s]{1,3}|%$/); return sym ? sym[0].trim() : '';
  }
  function fromTable(table){
    if(!table || !table.rows || table.rows.length < 3) return null;
    const rows = [...table.rows], head = [...rows[0].cells].map(c => c.textContent.trim());
    let body = rows.slice(1).map(r => [...r.cells].map(c => c.textContent.trim()));
    // A total row ("Total", "Main series total", "รวม"…, or a last row that is the sum of the others) stays in the table
    // but is not drawn: next to its parts it would dwarf them and read as one more item.
    const TOTAL = /(^|\b)(grand\s+)?(sub)?totals?\b|\boverall\b|^sum\b|^all\b|รวม|ทั้งหมด|合計|総計|小計/i, totals = [];
    body = body.filter(r => { if(TOTAL.test(r[0] || '')){ totals.push(r); return false; } return true; });
    if(!totals.length && body.length >= 4){
      const col = body.map(r => num(r[1])), last = col[col.length - 1], rest = col.slice(0, -1);
      if(last != null && rest.every(v => v != null)){ const sum = rest.reduce((a, b) => a + b, 0); if(sum && Math.abs(last - sum) <= Math.abs(sum) * 0.015) totals.push(body.pop()); }
    }
    if(body.length < 2 || head.length < 2) return null;
    const series = [];
    for(let ci = 1; ci < head.length; ci++){
      const vals = body.map(r => num(r[ci])), ok = vals.filter(v => v != null).length;
      if(ok >= Math.max(2, Math.ceil(body.length * 0.6))) series.push({ name: head[ci], values: vals.map(v => v == null ? 0 : v), unit: unitOf(head[ci], body.map(r => r[ci])) });
    }
    if(!series.length) return null;
    return { labels: body.map(r => r[0]), series: series.slice(0, 4), unit: series[0].unit,
      totals: totals.map(r => ({ label: r[0], text: series.map(s => { const v = num(r[head.indexOf(s.name)]); return v == null ? '' : `${series.length > 1 ? s.name + ' ' : ''}${fmtX(v, s.unit)}`; }).filter(Boolean).join(' · ') })) };
  }
  // exact numbers on values, totals and legends (money must read exactly); shortened only on the axis
  // a word unit gets a space ("47.5 millions"); a short one sticks ("180k", "¥4,000", "30%")
  const wordUnit = u => /^\p{L}{3,}/u.test(String(u || ''));
  const withUnit = (v, s, unit) => (v < 0 ? '-' : '') + (unit === '%' ? s + '%' : !unit ? s : wordUnit(unit) ? `${s} ${unit}` : /^\p{L}/u.test(unit) ? `${s}${unit}` : `${unit}${s}`);
  const fmtX = (v, unit) => withUnit(v, (Math.round(Math.abs(v) * 100) / 100).toLocaleString(), unit);
  const fmt = (v, unit) => { const a = Math.abs(v), s = a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M' : a >= 1e4 ? Math.round(a / 1e3) + 'k' : (Math.round(a * 10) / 10).toLocaleString();
    return withUnit(Math.round(v * 10) / 10, s, unit); }; // ¥4,800 · 30% · 180k · -1.9%

  // a value axis with round steps (1, 2, 2.5, 5 × 10ⁿ) that covers lo…hi, plus room for value labels when asked
  function axis(lo, hi, room){
    if(room){ const span = (hi - lo) || 1; if(lo < 0) lo -= span * 0.14; if(hi > 0) hi += span * 0.06; }
    if(hi === lo) hi = lo + 1;
    const raw = (hi - lo) / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 2.5, 5, 10].map(m => m * p).find(x => x >= raw - 1e-12);
    const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step, ticks = [];
    for(let v = a; v <= b + step / 2; v += step) ticks.push(Math.round(v / step) * step);
    return { lo: a, hi: b, ticks };
  }
  // The hover label: a header (the label) and one line per detail. data-h = header, data-d = details ("\n"-separated),
  // data-b = which detail line is the hovered one (bold). data-k = what lights up orange.
  const tipAttrs = (h, rows, bold) => `data-h="${E(h)}" data-d="${E(rows.join('\n'))}"${bold != null ? ` data-b="${bold}"` : ''}`;
  const rowsAt = (d, i) => d.series.map(s => `${s.name}: ${fmtX(s.values[i], s.unit)}`);
  // a line chart's invisible band over a whole label's column, so the pointer only has to be near the point
  const band = (x, w, top, h, d, i) => `<rect class="cf-ch-hit" x="${x}" y="${top}" width="${w}" height="${h}" data-i="${i}" data-k="p${i}" ${tipAttrs(d.labels[i], rowsAt(d, i))}/>`;

  // a label row that doesn't fit straight slants (narrow Output, many labels)
  const slant = (step, labels) => step < 70 && labels.some(l => String(l).length * 6.5 > step - 6);
  const xLabel = (x, y, lab, i, rot, max) => rot
    ? `<text class="cf-ch-label" data-i="${i}" x="${x}" y="${y - 4}" text-anchor="end" transform="rotate(-35 ${x} ${y - 4})">${E(tr(lab, 16))}</text>`
    : `<text class="cf-ch-label" data-i="${i}" x="${x}" y="${y}" text-anchor="middle">${E(tr(lab, max))}</text>`;
  function bar(d, W){
    W = W || 640; const H0 = 300, L = 56, R = 16, T = wordUnit(d.unit) ? 26 : 16, n = d.labels.length, k = d.series.length;
    const rot = slant((W - L - R) / n, d.labels), B = rot ? 92 : 64, H = H0 + (rot ? 28 : 0);
    const vals = d.series.flatMap(s => s.values), ax = axis(Math.min(0, ...vals), Math.max(0, ...vals)), min = ax.lo, max = ax.hi;
    const step = (W - L - R) / n, bw = Math.min(46, (step * 0.72) / k);
    const y = v => T + (H - T - B) * (1 - (v - min) / (max - min)), y0 = y(0);
    let g = '', hit = '';
    const au = wordUnit(d.unit) ? '' : d.unit; if(!au && d.unit) g += `<text class="cf-ch-axis" x="${L - 8}" y="${T - 6}" text-anchor="end">${E(d.unit)}</text>`;
    ax.ticks.forEach(v => { const yy = y(v); g += `<line class="cf-ch-grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text class="cf-ch-axis" x="${L - 8}" y="${yy + 4}" text-anchor="end">${E(fmt(v, au))}</text>`; });
    d.labels.forEach((lab, i) => {
      const x0 = L + step * i + (step - bw * k) / 2;
      d.series.forEach((s, si) => { const v = s.values[i], yy = y(v), top = Math.min(yy, y0), h = Math.max(1, Math.abs(y0 - yy)), key = `b${i}-${si}`;
        g += `<rect class="cf-ch-c${si}${v < 0 ? ' cf-ch-neg' : ''}" data-i="${i}" data-k="${key}" x="${x0 + si * bw}" y="${top}" width="${bw - 2}" height="${h}" rx="3"/>`;
        // the hover area is the bar itself, a little wider and at least 24 tall, so short bars are still easy to hit
        const hx = x0 + si * bw - (k === 1 ? 6 : 1), hw = bw - 2 + (k === 1 ? 12 : 2), ht = v >= 0 ? Math.min(top, y0 - 24) : top, hb = v >= 0 ? top + h : Math.max(top + h, y0 + 24);
        hit += `<rect class="cf-ch-hit" x="${hx}" y="${ht}" width="${hw}" height="${hb - ht}" data-i="${i}" data-k="${key}" ${tipAttrs(lab, rowsAt(d, i), k > 1 ? si : null)}/>`; });
      g += xLabel(L + step * i + step / 2, H - B + 18, lab, i, rot, Math.max(4, Math.floor(step / 7)));
    });
    return { svg: `<svg viewBox="0 0 ${W} ${H}" role="img">${g}<line class="cf-ch-base" x1="${L}" x2="${W - R}" y1="${y0}" y2="${y0}"/>${hit}</svg>`, legend: k > 1 };
  }
  function line(d, W){
    W = W || 640; const L = 56, R = 20, T = wordUnit(d.unit) ? 26 : 16, n = d.labels.length;
    const rot = slant((W - L - R) / Math.max(1, n - 1), d.labels), B = rot ? 92 : 64, H = 300 + (rot ? 28 : 0);
    const vals = d.series.flatMap(s => s.values), ax = axis(Math.min(0, ...vals), Math.max(0, ...vals)), max = ax.hi, min = ax.lo, step = (W - L - R) / Math.max(1, n - 1);
    const x = i => L + step * i, y = v => T + (H - T - B) * (1 - (v - min) / (max - min || 1));
    let g = '';
    const au = wordUnit(d.unit) ? '' : d.unit; if(!au && d.unit) g += `<text class="cf-ch-axis" x="${L - 8}" y="${T - 6}" text-anchor="end">${E(d.unit)}</text>`;
    ax.ticks.forEach(v => { const yy = y(v); g += `<line class="cf-ch-grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text class="cf-ch-axis" x="${L - 8}" y="${yy + 4}" text-anchor="end">${E(fmt(v, au))}</text>`; });
    let hit = '';
    d.labels.forEach((lab, i) => { g += `<line class="cf-ch-guide" data-i="${i}" x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}"/>`; }); // a guide line on the hovered point
    d.series.forEach((s, si) => {
      g += `<polyline class="cf-ch-line cf-ch-s${si}" points="${s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>`;
      s.values.forEach((v, i) => { g += `<circle class="cf-ch-c${si} cf-ch-dot" data-i="${i}" data-k="p${i}" cx="${x(i)}" cy="${y(v)}" r="4"/>`; });
    });
    d.labels.forEach((lab, i) => { g += xLabel(x(i), H - B + 18, lab, i, rot, Math.max(4, Math.floor(step / 7)));
      const a = i ? x(i) - step / 2 : L - 12, b = i < n - 1 ? x(i) + step / 2 : W - R + 12; hit += band(a, b - a, T - 8, H - T - B + 36, d, i); });
    const zero = min < 0 ? `<line class="cf-ch-base" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>` : '';
    return { svg: `<svg viewBox="0 0 ${W} ${H}" role="img">${zero}${g}${hit}</svg>`, legend: d.series.length > 1 };
  }
  function pie(d, donut, W){
    W = W || 640;
    const s = d.series[0], vals = s.values.map(v => Math.max(0, v)), total = vals.reduce((a, b) => a + b, 0) || 1, side = W >= 520;
    const r = side ? 120 : Math.min(110, (W - 40) / 2), cx = side ? 150 : W / 2, cy = r + 20, ir = donut ? r * 0.53 : 0, lx = side ? 320 : 14, ly = side ? 40 : 2 * r + 52;
    const H = side ? Math.max(300, 60 + d.labels.length * 30) : ly + d.labels.length * 28 + 6, chars = Math.max(10, Math.floor((W - lx - 120) / 7));
    let a0 = -Math.PI / 2, g = '';
    vals.forEach((v, i) => {
      const a1 = a0 + (v / total) * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0, p = (a, rr) => `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`;
      const whole = v >= total - 1e-9; // one slice is everything: a full circle (or ring)
      const path = whole ? `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0` + (ir ? ` M ${cx - ir} ${cy} a ${ir} ${ir} 0 1 1 ${ir * 2} 0 a ${ir} ${ir} 0 1 1 ${-ir * 2} 0` : '')
        : ir ? `M ${p(a0, r)} A ${r} ${r} 0 ${big} 1 ${p(a1, r)} L ${p(a1, ir)} A ${ir} ${ir} 0 ${big} 0 ${p(a0, ir)} Z`
        : `M ${cx} ${cy} L ${p(a0, r)} A ${r} ${r} 0 ${big} 1 ${p(a1, r)} Z`;
      g += `<path class="cf-ch-c${i % 6} cf-ch-slice" style="transform-origin:${cx}px ${cy}px" d="${path}" data-i="${i}" data-k="s${i}" ${tipAttrs(d.labels[i], [`${s.name}: ${fmtX(v, s.unit)}`, `${Math.round(v / total * 100)}% of ${fmtX(total, s.unit)}`])}/>`;
      a0 = a1;
    });
    if(donut) g += `<text class="cf-ch-total" x="${cx}" y="${cy + 6}" text-anchor="middle">${E(fmtX(total, s.unit))}</text>`;
    // legend rows hover like their slice
    const lg = d.labels.map((lab, i) => `<g class="cf-ch-lg" data-i="${i}" data-k="s${i}" ${tipAttrs(lab, [`${s.name}: ${fmtX(vals[i], s.unit)}`, `${Math.round(vals[i] / total * 100)}% of ${fmtX(total, s.unit)}`])} transform="translate(${lx} ${ly + i * (side ? 30 : 28)})"><rect class="cf-ch-lgbg" x="-6" y="-7" width="${W - lx - 4}" height="28" rx="5"/><rect class="cf-ch-c${i % 6}" width="14" height="14" rx="3"/><text class="cf-ch-label" x="22" y="12">${E(tr(lab, chars))} · ${E(fmtX(vals[i], s.unit))} (${Math.round(vals[i] / total * 100)}%)</text></g>`).join('');
    return { svg: `<svg viewBox="0 0 ${W} ${H}" role="img">${g}${lg}</svg>`, legend: false };
  }

  // The chart's SVG plus a legend when there are several series. `title` becomes the accessible name.
  // opt.fit: the chart is redrawn at the width it actually has (text stays its normal size — it is never a shrunk or
  // blown-up picture); opt.width: draw it at this width.
  const specs = new Map(); let specN = 0;
  function svg(d, type, title, opt){
    if(!d) return '';
    opt = opt || {}; const W = Math.round(Math.max(260, Math.min(900, opt.width || 640)));
    d = Object.assign({}, d, { series: d.series.map(s => Object.assign({}, s, { unit: s.unit || d.unit || '' })) }); // a series without its own unit uses the chart's
    // pie / donut only for a few parts of one whole: negative numbers or many parts are drawn as bars
    const parts = (type === 'pie' || type === 'donut') && d.labels.length <= 8 && d.series[0].values.every(v => v >= 0) && d.series[0].values.some(v => v > 0);
    const t = parts ? type : type === 'line' ? 'line' : 'bar';
    const out = t === 'pie' || t === 'donut' ? pie(d, t === 'donut', W) : t === 'line' ? line(d, W) : bar(d, W);
    const svgStr = out.svg.replace('role="img">', `role="img" aria-label="${E(title || 'Chart')}"><title>${E(title || 'Chart')}</title>`);
    const legend = out.legend ? `<div class="cf-ch-legend${t === 'line' ? ' cf-ch-legend--line' : ''}">${d.series.map((s, i) => `<span><i class="cf-ch-c${i}"></i>${E(s.name)}</span>`).join('')}</div>` : '';
    // (a donut already shows the whole in its middle)
    const note = (d.totals || []).length && t !== 'donut' ? `<p class="cf-ch-totalnote">${d.totals.map(x => `${E(x.label)}: <b>${E(x.text)}</b>`).join(' · ')} — in the table, not drawn as a ${t === 'pie' || t === 'donut' ? 'slice' : t === 'line' ? 'point' : 'bar'} (it’s the whole, not one of the parts).</p>` : '';
    let id = opt.spec; if(opt.fit && !id){ id = 'c' + (++specN); specs.set(id, { d, type, title }); }
    return `<div class="cf-ch${t !== 'pie' && t !== 'donut' && d.series.length > 1 ? ' cf-ch--multi' : ''}"${id ? ` data-cf-spec="${id}" data-w="${W}"` : ''}>${svgStr}${legend}${note}</div>`;
  }
  // redraw a fitted chart at a width (its own width by default)
  function refit(el, width){
    const sp = specs.get(el.dataset.cfSpec); if(!sp) return;
    const w = Math.round(width || el.clientWidth); if(!w || Math.abs(w - (+el.dataset.w || 0)) < 8) return;
    const tmp = document.createElement('div'); tmp.innerHTML = svg(sp.d, sp.type, sp.title, { width: w, spec: el.dataset.cfSpec });
    const nu = tmp.firstElementChild; el.className = nu.className; el.dataset.w = nu.dataset.w; el.innerHTML = nu.innerHTML;
  }
  const ro = window.ResizeObserver ? new ResizeObserver(es => es.forEach(e => { if(e.target.isConnected) refit(e.target); })) : null;
  const watch = () => document.querySelectorAll('.cf-ch[data-cf-spec]:not([data-cf-obs])').forEach(el => { el.dataset.cfObs = '1'; if(ro) ro.observe(el); refit(el); });
  const startWatch = () => { new MutationObserver(() => watch()).observe(document.body, { childList: true, subtree: true }); watch(); };
  if(document.body) startWatch(); else document.addEventListener('DOMContentLoaded', startWatch);

  // Hover (or tap) a bar, slice or point: a small label shows its exact value (there are no numbers printed on the bars)
  let tip = null;
  // the label sits under the pointer (above it only when there is no room below): a bold header, then one line per detail
  const showTip = (el, cx, cy) => {
    if(!tip){ tip = document.createElement('div'); tip.className = 'cf-ch-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
    if(tip.dataset.for !== el.dataset.k){
      tip.dataset.for = el.dataset.k; tip.textContent = '';
      const h = document.createElement('div'); h.className = 'cf-ch-tip-h'; h.textContent = el.dataset.h; tip.appendChild(h);
      String(el.dataset.d || '').split('\n').filter(Boolean).forEach((t, n) => { const r = document.createElement('div'); r.className = 'cf-ch-tip-r' + (String(n) === el.dataset.b ? ' is-b' : ''); r.textContent = t; tip.appendChild(r); });
    }
    tip.classList.add('is-on');
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.round(Math.min(window.innerWidth - w - 8, Math.max(8, cx - w / 2))) + 'px';
    tip.style.top = Math.round(cy + 22 + h > window.innerHeight - 8 ? cy - h - 14 : cy + 22) + 'px';
  };
  const cool = ch => { ch.classList.remove('is-hover'); ch.querySelectorAll('.is-hot').forEach(x => x.classList.remove('is-hot')); };
  let hotKey = null;
  const hideTip = () => { if(tip){ tip.classList.remove('is-on'); tip.dataset.for = ''; } hotKey = null; document.querySelectorAll('.cf-ch.is-hover').forEach(cool); };
  // the hovered bar / point / slice turns orange, everything else turns one darker gray, and the label shows the values
  const over = e => {
    const el = e.target && e.target.closest ? e.target.closest('.cf-ch [data-h]') : null;
    if(!el){ if(hotKey) hideTip(); return; }
    const ch = el.closest('.cf-ch'), i = el.dataset.i;
    if(hotKey !== el){
      document.querySelectorAll('.cf-ch.is-hover').forEach(cool);
      ch.classList.add('is-hover'); hotKey = el;
      ch.querySelectorAll(`[data-k="${el.dataset.k}"]`).forEach(x => x.classList.add('is-hot'));
      if(i != null) ch.querySelectorAll(`.cf-ch-label[data-i="${i}"], .cf-ch-guide[data-i="${i}"]`).forEach(x => x.classList.add('is-hot'));
    }
    showTip(el, e.clientX, e.clientY);
  };
  document.addEventListener('pointermove', over, { passive: true });
  document.addEventListener('pointerdown', over, { passive: true });
  document.addEventListener('scroll', hideTip, true);
  document.addEventListener('pointerout', e => { if(!e.relatedTarget) hideTip(); }); // the pointer left the window

  window.Charts = { fromTable, svg, num, refit };
})();
