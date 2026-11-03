// components/compare-check.js — Compare in a decision node (Workstream POC, entry-v4.html): check the data first,
// then the scores, in words people read (user request).
//
//   1. Check the data — every option's value on every criterion (what the AI found: a price, a time, a fact), editable,
//      with where it comes from. Criteria can be added or taken out here. Nothing is scored on screen yet.
//   2. "Looks right — calculate the scores" — values you changed are scored again from your words (one AI call, no web
//      search); then the scores show. "Check the data again" goes back to step 1.
//   Scores stay 1–5 inside (fit %, ranking, the AI) but are SHOWN as the criterion's own scale: a cost as Low / Medium /
//   High cost, a time in minutes or hours (the value) with Quick … Slow, yes / no as Yes … No, anything else as
//   Poor … Excellent. The score picker uses the same words.
// "What matters" is a template step on the canvas in every decision node (it used to be set in Chat first).
// Hooks: xcCompareSec (canvas) and the Output's compare step call CmpCheck.html; exRsStepDone / exRsBlocker wait for the
// data to be checked; exRsScore gets the unit rule for values. If a page function it needs is missing, it stays off.
(function(){
  'use strict';
  const need = ['exRsW', 'exStep', 'exRsScore', 'exRsRefresh', 'rsScore', 'rsFit', 'rsMissingScores', 'callClaude'];
  if(need.some(n => typeof window[n] !== 'function') || typeof rsKeptCrit !== 'function' || typeof ipE !== 'function'){ console.warn('[compare-check] a page function it needs is missing — off'); return; }
  const E = s => ipE(s == null ? '' : String(s));

  // ---------- the scale of a criterion, and a score in its words ----------
  const SCALES = {
    cost:  { name: 'Cost', words: { 5: 'Low cost', 4: 'Low–medium cost', 3: 'Medium cost', 2: 'Medium–high cost', 1: 'High cost' } },
    time:  { name: 'Time', words: { 5: 'Very quick', 4: 'Quick', 3: 'Average', 2: 'Slow', 1: 'Very slow' } },
    yesno: { name: 'Yes / no', words: { 5: 'Yes', 4: 'Mostly', 3: 'Partly', 2: 'Barely', 1: 'No' } },
    level: { name: 'Quality', words: { 5: 'Excellent', 4: 'Good', 3: 'OK', 2: 'Weak', 1: 'Poor' } }
  };
  function scaleOf(c){
    if(c && SCALES[c.scale]) return c.scale;
    const t = String((c && c.label) || '').toLowerCase();
    if(/(price|cost|budget|fee|rate|money|cheap|expens|afford|ราคา|ค่าใช้จ่าย|งบ)/.test(t)) return 'cost';
    if(/(time|duration|minute|hour|travel|commute|distance|how long|quick|fast|speed|wait|lead time|เวลา|ระยะทาง)/.test(t)) return 'time';
    if(/^(has|is|can|does|offers?|includes?|allows?)\b|available|included|\?$|parking|wi-?fi|pet[- ]friendly|ที่จอด|มี/.test(t)) return 'yesno';
    return 'level';
  }
  const word = (c, score) => (SCALES[scaleOf(c)].words[Math.max(1, Math.min(5, Math.round(score) || 0))] || '—');
  window.rsScoreLabel = (c, score) => score ? word(c, score) : '—'; // also used by the result document

  const isDecide = w => !!(w && w.mode === 'decide' && !w.light);
  const checked = w => !!w.cmpOk;

  // ---------- the view (Output and canvas) ----------
  function srcLine(s){
    if(!s) return '';
    return s.ai === false || s.userValue ? '<p class="rs-src">Source: you</p>' : s.web ? `<p class="rs-src">Source: <a href="${E(s.web.url)}" target="_blank" rel="noopener">${E(typeof rsDomain === 'function' ? rsDomain(s.web.url) : s.web.url)} ↗</a></p>` : s.source === 'input' ? '<p class="rs-src">Source: earlier node</p>' : '<p class="rs-src"><span class="rs-unverified">⚠ AI estimate</span> — check it</p>';
  }
  function html(k, ro, busy, where){
    const w = exRsW(k), crit = rsKeptCrit(w), opts = rsKeptOpt(w), canvas = where === 'canvas';
    if(!crit.length || !opts.length) return `<p class="${canvas ? 'xo-none' : 'ip-hint'}">Keep what matters and at least two options first.</p>`;
    const scoring = busy === 'score' || busy === 'rescore';
    const head = `<ol class="cmp-steps" aria-label="Compare in two steps"><li class="${checked(w) ? 'is-done' : 'is-cur'}">Check the data</li><li class="${checked(w) ? 'is-cur' : ''}">Scores</li></ol>`;
    const addCrit = ro || checked(w) ? '' : `<form class="cmp-add" data-cmp-add="crit"><input class="ip-field" type="text" placeholder="+ Add something to compare on…" aria-label="Add a criterion"><button type="submit" class="ip-mini">Add</button></form>`;
    const critCell = c => `<td class="cmp-crit"><b>${E(c.label)}</b><span class="rs-w">${c.weight === 'must' ? 'Must-have' : 'Nice to have'} · ${E(SCALES[scaleOf(c)].name)}</span>${c.fromDod ? '<span class="rs-dod-tag">Needed for done</span>' : ''}${ro || checked(w) || crit.length < 2 ? '' : `<button type="button" class="ip-link cmp-rm" data-cmp="rm-crit" data-c="${c.id}" aria-label="Don’t compare on ${E(c.label)}">Take out</button>`}</td>`;
    if(!checked(w)){
      // 1. the data, no scores
      const cell = (o, c) => { const s = rsScore(w, o.id, c.id) || {};
        return `<td data-cell="${o.id}:${c.id}">${ro ? `<p class="rs-value">${E(s.value || '—')}</p>` : `<input class="ip-field cmp-val" type="text" data-cmp="val" data-o="${o.id}" data-c="${c.id}" value="${E(s.value || '')}" placeholder="${scaleOf(c) === 'time' ? 'e.g. 15 min' : scaleOf(c) === 'cost' ? 'e.g. 4,000 THB' : scaleOf(c) === 'yesno' ? 'Yes / No' : 'What it is like'}" aria-label="${E(o.label)} — ${E(c.label)}">`}
          ${s.edited ? '<p class="rs-src">Changed by you — scored again when you calculate</p>' : srcLine(s.value ? s : null)}${s.note && !s.edited ? `<p class="rs-note">${E(s.note)}</p>` : ''}</td>`; };
      const missing = rsMissingScores(w).length;
      return `${head}<p class="${canvas ? 'xc-lead' : 'rs-lead'}">First check what was found for each option — correct anything that’s wrong, and add or take out what you compare on. The scores come after.</p>
        ${scoring ? (typeof exSpin === 'function' ? exSpin(busy === 'rescore' ? 'Scoring from your data…' : 'Finding the data for each option…') : '<p class="xc-busy">Working…</p>') : ''}
        <div class="${canvas ? 'xc-matrix-wrap' : 'ex-table-wrap'}"><table class="${canvas ? 'xc-matrix' : 'ex-table rs-matrix'} cmp-table"><thead><tr><th>What matters</th>${opts.map(o => `<th>${E(o.label)}</th>`).join('')}</tr></thead>
          <tbody>${crit.map(c => `<tr>${critCell(c)}${opts.map(o => cell(o, c)).join('')}</tr>`).join('')}</tbody></table></div>
        ${addCrit}
        ${ro ? '' : `<div class="${canvas ? 'xc-sec-foot' : 'ip-row-actions'}">${missing && !scoring ? `<button type="button" class="ip-mini ip-mini-ai" data-cmp="fill">Find the missing data</button>` : ''}<span class="xc-sp"></span><button type="button" class="btn ip-btn-sm" data-cmp="calc"${scoring || missing ? ' disabled' : ''}>Looks right — calculate the scores</button></div>`}
        ${missing && !scoring && !ro ? `<p class="ip-hint">${missing} value${missing === 1 ? '' : 's'} still missing — find them, or type them in.</p>` : ''}`;
    }
    // 2. the scores, in each criterion's own words
    const pick = (o, c, s) => { const sc = SCALES[scaleOf(c)], cur = s.score || 0;
      const attr = canvas ? `data-xc-score data-o="${o.id}" data-c="${c.id}"` : `class="rs-score" data-rq="score" data-o="${o.id}" data-c="${c.id}"`;
      return `<select ${attr} aria-label="${E(o.label)} on ${E(c.label)}"${ro ? ' disabled' : ''}>${[5, 4, 3, 2, 1].map(n => `<option value="${n}"${n === cur ? ' selected' : ''}>${E(sc.words[n])}</option>`).join('')}</select>`; };
    const cell = (o, c) => { const s = rsScore(w, o.id, c.id) || {};
      return `<td data-cell="${o.id}:${c.id}">${s.value ? `<p class="rs-value">${E(s.value)}</p>` : ''}${pick(o, c, s)}${srcLine(s)}${s.note ? `<p class="rs-note">${E(s.note)}</p>` : ''}</td>`; };
    return `${head}<p class="${canvas ? 'xc-lead' : 'rs-lead'}">How each option does on what matters, in plain words. Change any you disagree with — the ranking updates.</p>
      ${scoring && typeof exSpin === 'function' ? exSpin('Scoring…') : ''}
      <div class="${canvas ? 'xc-matrix-wrap' : 'ex-table-wrap'}"><table class="${canvas ? 'xc-matrix' : 'ex-table rs-matrix'} cmp-table"><thead><tr><th>What matters</th>${opts.map(o => `<th>${E(o.label)}</th>`).join('')}</tr></thead>
        <tbody>${crit.map(c => `<tr>${critCell(c)}${opts.map(o => cell(o, c)).join('')}</tr>`).join('')}
        <tr class="${canvas ? 'xc-fitrow' : 'rs-fit-row'}"><td><b>Fit</b></td>${opts.map(o => `<td><b>${rsFit(w, o.id)}%</b></td>`).join('')}</tr></tbody></table></div>
      ${ro ? '' : `<div class="${canvas ? 'xc-sec-foot' : 'ip-row-actions'}"><button type="button" class="ip-mini" data-cmp="recheck">Check the data again</button></div>`}`;
  }

  // ---------- actions ----------
  const ro = k => typeof exState === 'function' && exState(k).done;
  const refresh = k => { exRsRefresh(k); if(typeof xcRender === 'function') xcRender(); };
  const snap = k => { if(typeof xcSnap === 'function') xcSnap(k); };
  // values the user changed are scored again from their words (no web search) — the rest keep their score
  async function calc(k){
    const w = exRsW(k), crit = rsKeptCrit(w), opts = rsKeptOpt(w);
    const edited = []; opts.forEach(o => crit.forEach(c => { const s = rsScore(w, o.id, c.id); if(s && s.edited) edited.push({ o: o.id, c: c.id, option: o.label, criterion: c.label, scale: scaleOf(c), value: s.value }); }));
    if(edited.length){
      w.busy = 'rescore'; refresh(k);
      try {
        const res = await callClaude(`${typeof exCtx === 'function' ? exCtx(k) : ''}

The user checked the data for a comparison and corrected these values. Score each one from 1 (poor) to 5 (excellent) for THIS decision, using ONLY the value given — consistent with how the other options would be scored. Direction: for a "cost" criterion a lower cost scores higher; for a "time" criterion a shorter time scores higher; "yesno": yes = 5, no = 1, partly = 3; "level": how good it is. One short "note" on why.
${JSON.stringify(edited)}
${typeof ipLang === 'function' ? ipLang() : ''}
Respond ONLY with {"scores": [{"o": "", "c": "", "score": 3, "note": ""}]}.`, { maxTokens: 900 });
        (Array.isArray(res && res.scores) ? res.scores : []).forEach(x => { const s = rsScore(w, String(x && x.o), String(x && x.c)); const n = Math.max(1, Math.min(5, parseInt(x && x.score, 10) || 0));
          if(s && s.edited && n){ s.score = n; s.note = String(x.note || '').trim(); s.edited = false; s.ai = false; } });
        const left = edited.filter(x => (rsScore(w, x.o, x.c) || {}).edited);
        if(left.length) throw new Error(`${left.length} value${left.length === 1 ? '' : 's'} couldn’t be scored`);
      } catch(err){
        w.busy = null; w.err = `Couldn’t score your data — ${err.message || 'the AI request failed'}. Try again, or pick the scores yourself.`;
        if(err && err.code === 'NO_KEY' && window.AI && AI.openSettings) AI.openSettings();
        return refresh(k);
      }
      w.busy = null;
    }
    w.cmpOk = true; refresh(k);
  }
  document.addEventListener('change', e => {
    const t = e.target; if(!t.matches || !t.matches('[data-cmp="val"]') || !EX.cur || ro(EX.cur)) return;
    const k = EX.cur, w = exRsW(k), o = t.dataset.o, c = t.dataset.c, v = t.value.trim(), s = rsScore(w, o, c);
    if(s && (s.value || '') === v) return;
    snap(k);
    const cell = (w.scores[o] = w.scores[o] || {})[c] = Object.assign(s || { score: 0, evidence: [] }, { value: v, userValue: true, edited: true, ai: false, web: null });
    if(!s) cell.score = 0;
    refresh(k);
  });
  document.addEventListener('submit', e => {
    const f = e.target.closest && e.target.closest('[data-cmp-add="crit"]'); if(!f || !EX.cur || ro(EX.cur)) return;
    e.preventDefault(); const inp = f.querySelector('input'), v = inp.value.trim(); if(!v) return;
    const k = EX.cur, w = exRsW(k);
    if(w.criteria.some(c => c.kept && c.label.trim().toLowerCase() === v.toLowerCase())){ inp.value = ''; return; }
    snap(k);
    const old = w.criteria.find(c => c.label.trim().toLowerCase() === v.toLowerCase());
    if(old){ old.kept = true; old.out = false; } else w.criteria.push({ id: typeof rsId === 'function' ? rsId('c') : 'c' + Date.now(), label: v, detail: '', why: '', weight: 'nice', kept: true, own: true });
    inp.value = ''; refresh(k);
    exRsScore(k); // find the data for the new criterion (shown in step 1, scored when you calculate)
  });
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-cmp]'); if(!b || b.matches('input') || b.disabled || !EX.cur) return;
    const k = EX.cur, w = exRsW(k); if(!isDecide(w) || ro(k)) return;
    const act = b.dataset.cmp;
    if(act === 'rm-crit'){ const c = w.criteria.find(x => x.id === b.dataset.c); if(c && rsKeptCrit(w).length > 1){ snap(k); c.kept = false; refresh(k); } return; }
    if(act === 'fill') return exRsScore(k);
    if(act === 'calc') return calc(k);
    if(act === 'recheck'){ snap(k); w.cmpOk = false; return refresh(k); }
  });

  // ---------- hooks ----------
  const W = (name, fn) => { const orig = window[name]; if(typeof orig !== 'function') return; window[name] = function(){ return fn.call(this, orig, arguments); }; };
  // the canvas's Compare template and the Output's compare step draw this view
  W('xcCompareSec', (o, a) => { const [k, r] = a, w = exRsW(k); return isDecide(w) ? html(k, r, w.busy, 'canvas') : o.apply(null, a); });
  window.CmpCheck = { html, scaleOf, word };
  // Compare is done once the data is checked and every pair has a score
  W('exRsStepDone', (o, a) => { const [w, key] = a; if(key === 'compare' && isDecide(w) && !checked(w)) return false; return o.apply(null, a); });
  W('exRsBlocker', (o, a) => { const w = a[0]; if(isDecide(w) && typeof exRsStepKey === 'function' && exRsStepKey(w) === 'compare' && !checked(w)) return 'Check the data, then press “Looks right — calculate the scores”.'; return o.apply(null, a); });
  // "What matters" is a template step on the canvas (user request), not a question in Chat
  if(typeof xcCritInChat === 'function') window.xcCritInChat = () => false;
})();
