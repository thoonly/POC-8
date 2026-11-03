// components/cf-collab.js — Cognitive Field canvas: multi-select, Compare tables and dot voting.
// One module for every Cognitive Field canvas (the execution-node canvas in the Workstream POC and the Output
// canvas in the Output POC). Both canvases use the same DOM (#xc-wrap / #xc-vp / #xc-world, .xc-rail) and the
// same item classes, so this file finds post-its, node cards, template items and ideas itself; each canvas only
// registers a small adapter:
//   CF.use({
//     on()             → is the canvas showing and usable?
//     state()          → an object kept with the canvas (CF stores its compare tables and votes in state().cf)
//     render()         → re-render the canvas (CF.afterRender() must be called at the end of it)
//     deselect()       → clear the canvas's own single selection / item menu
//     zoom()           → { zoom, panX, panY } of the canvas
//     toWorld(cx, cy)  → canvas (world) coordinates of a screen point
//     notice(text)     → a message in the canvas snackbar
//     makeNote(text, detail, x, y) → put a post-it on the canvas
//     addToOutput?(label, detail)  → optional: add an item to the output / template (addLabel: its button text)
//     ctx()            → { request, title } to give the AI context
//     dropText?(info, cx, cy) / dropHint?(phase, cx, cy) → optional: a row dragged out of a Text view (as a graph node)
//   })
// Prototype only: AI calls go through the page's webJson / callClaude (components/ai.js underneath).
(function(){
  'use strict';
  const CF = window.CF = { a: null, sel: new Set(), marquee: null, wired: false };
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const tr = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
  const $ = id => document.getElementById(id);
  const ICO = {
    vote: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="5" cy="5" r="2.2"/><circle cx="11" cy="5" r="2.2"/><circle cx="8" cy="11" r="2.2"/></svg>',
    compare: '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M6 2.5v11M2 6.5h12"/></svg>',
    spin: '<span class="cf-spin" aria-hidden="true"></span>'
  };
  const st = () => { const s = CF.a.state(); return s.cf || (s.cf = { cmps: [], vote: null, seq: 0 }); };
  const on = () => !!(CF.a && CF.a.on());

  // ---------- the votable / selectable items on the canvas ----------
  // { key, el, label, detail, kind } for post-its, node cards, template items and ideas.
  function items(){
    const world = $('xc-world'); if(!world) return [];
    const out = [], txt = el => (el ? (el.value != null && el.tagName === 'TEXTAREA' ? el.value : el.textContent) : '').trim();
    world.querySelectorAll('[data-note]').forEach(n => { const el = n.querySelector('.xc-pi'); if(el) out.push({ key: 'note:' + n.dataset.note, el, label: txt(n.querySelector('textarea')), detail: '', kind: 'Post-it' }); });
    world.querySelectorAll('[data-card]').forEach(el => out.push({ key: 'card:' + el.dataset.card, el, label: txt(el.querySelector('.xc-card-t')), detail: txt(el.querySelector('.xc-card-d')), kind: 'Card' }));
    world.querySelectorAll('.xc-w--tpl .xc-pi[data-pi]').forEach(el => { const label = txt(el.querySelector('textarea.xc-pi-text, .xc-pi-p')); if(label) out.push({ key: 'item:' + label.toLowerCase(), el, label, detail: txt(el.querySelector('.xc-pi-d')), kind: 'Item' }); });
    world.querySelectorAll('[data-idea]').forEach(el => { const label = txt(el.querySelector('.xc-idea-t')); if(label) out.push({ key: 'idea:' + label.toLowerCase(), el, label, detail: txt(el.querySelector('.xc-idea-d')), kind: 'Idea' }); });
    return out;
  }
  const itemOf = el => { const host = el && el.closest && el.closest('.xc-pi, [data-card], [data-idea]'); if(!host) return null; return items().find(x => x.el === host || x.el.contains(host) || host.contains(x.el)) || null; };

  // ---------- render hooks ----------
  // Several canvases can share #xc-wrap (in the Workstream POC: the execution node's, and the stage canvas for Entry,
  // Intent, Planning and the result). Each registers its adapter; CF.a is the one that is on right now.
  const adapters = [];
  Object.defineProperty(CF, 'a', { configurable: true, get(){ return adapters.find(x => { try { return x.on(); } catch(e){ return false; } }) || adapters[0] || null; } });
  CF.use = function(adapter){ adapters.push(adapter); wire(); };
  // The graph key of a node by its label (cat-ci / topic-ci-ti / sub-ci-ti-si / ex-ci-ti-si-ei), e.g. for a Text-view row.
  CF.keyByLabel = function(sa, label){
    const norm = x => String(x || '').replace(/ · (must-have|nice to have)$/, '').trim().toLowerCase(), L = norm(label), same = x => x && norm(x.label) === L;
    const cats = (sa && sa.categories) || [];
    for(let ci = 0; ci < cats.length; ci++){ const c = cats[ci]; if(same(c)) return `cat-${ci}`;
      for(let ti = 0; ti < (c.topics || []).length; ti++){ const t = c.topics[ti]; if(same(t)) return `topic-${ci}-${ti}`;
        for(let si = 0; si < ((t && t.subtopics) || []).length; si++){ const sb = t.subtopics[si]; if(same(sb)) return `sub-${ci}-${ti}-${si}`;
          for(let ei = 0; ei < ((sb && sb.examples) || []).length; ei++) if(same(sb.examples[ei])) return `ex-${ci}-${ti}-${si}-${ei}`; } } }
    return null;
  };
  CF.afterRender = function(){
    if(!CF.a) return;
    const world = $('xc-world'); if(!world) return;
    world.querySelectorAll('.cf-w').forEach(el => el.remove());
    if(on()) world.insertAdjacentHTML('beforeend', st().cmps.map(cmpHtml).join(''));
    if(CF.focusCrit){ const inp = world.querySelector(`[data-cf-crit="${CF.focusCrit}"]`); CF.focusCrit = null; if(inp) inp.focus({ preventScroll: true }); }
    CF.decorate();
  };
  // Selection marks, vote dots and the overlay (selection bar, voting panel) — no canvas re-render needed.
  CF.decorate = function(){
    if(!CF.a) return;
    const wrap = $('xc-wrap'); if(!wrap) return;
    const its = items(), keys = new Set(its.map(x => x.key));
    [...CF.sel].forEach(k => { if(!keys.has(k)) CF.sel.delete(k); });
    its.forEach(x => {
      x.el.classList.toggle('cf-msel', CF.sel.has(x.key));
      const old = x.el.querySelector(':scope > .cf-dots'); if(old) old.remove();
      const v = st().vote; if(!v || !on()) return;
      const mine = v.mine[x.key] || 0, team = v.reveal && v.team ? (v.team[x.key] || 0) : 0;
      if(!mine && !team && !v.on) return;
      const dots = '<span class="cf-dot cf-dot--me"></span>'.repeat(mine) + '<span class="cf-dot cf-dot--team"></span>'.repeat(team);
      x.el.insertAdjacentHTML('beforeend', `<span class="cf-dots${mine + team ? '' : ' is-empty'}" title="${mine} from you${v.reveal ? `, ${team} from the team` : ''}">${dots || '<span class="cf-dot cf-dot--ghost"></span>'}${mine + team ? `<b>${mine + team}</b>` : ''}${v.on && mine ? `<button type="button" class="cf-dot-x" data-cf-unvote="${E(x.key)}" aria-label="Take back a dot from ${E(tr(x.label, 30))}">−</button>` : ''}</span>`);
    });
    wrap.dataset.cfVote = st().vote && st().vote.on && on() ? '1' : '0';
    railBtn(); tips(); textSize(); ideasToggle();
    const tw = $('text-view-wrap'); if(tw && CF.tvTop != null && tw.closest('#xc-wrap')){ const t = CF.tvTop; tw.scrollTop = t; setTimeout(() => { if(tw.scrollTop !== t) tw.scrollTop = t; }, 80); }
    overlay();
  };

  // ---------- template: each section's ideas are a panel on its right that collapses to a slim tab ----------
  const secKey = sec => sec.id || sec.dataset.sec || sec.dataset.ci || '';
  // Open the (collapsed) ideas panel an idea sits in — e.g. before the AI cursor picks it, so the user sees where it
  // comes from. Returns true when it had to open it.
  CF.openIdeasFor = function(el){
    const split = el && el.closest && el.closest('.xc-split.cf-tray-closed'); if(!split) return false;
    const sec = split.closest('.xc-sec'), k = sec ? secKey(sec) : ''; const m = st().ideasClosed || (st().ideasClosed = {});
    m[k] = false; CF.decorate(); return true;
  };
  function ideasToggle(){
    const closed = st().ideasClosed || {};
    // every template (each step is its own) gets its own "Collapse ideas" switch, in its own header
    document.querySelectorAll('#xc-world .xc-w--tpl').forEach(tpl => {
      const trays = [...tpl.querySelectorAll('.xc-split > .xc-tray')];
      trays.forEach(tray => {
        const split = tray.parentElement, sec = split.closest('.xc-sec'), k = sec ? secKey(sec) : '', n = tray.querySelectorAll('[data-idea]').length, shut = !!closed[k];
        split.classList.toggle('cf-tray-closed', shut);
        const h = tray.querySelector('.xc-tray-h');
        if(h && !h.querySelector('[data-cf="tray"]')) h.insertAdjacentHTML('beforeend', `<button type="button" class="cf-icon cf-tray-x" data-cf="tray" data-k="${E(k)}" aria-label="Fold the ideas away" data-tip="Fold the ideas away" data-tip-pos="below">▴</button>`);
        let tab = tray.querySelector(':scope > .cf-tray-tab');
        if(!tab){ tray.insertAdjacentHTML('afterbegin', `<button type="button" class="cf-tray-tab" data-cf="tray" data-k="${E(k)}" aria-label="Show the ideas"><span aria-hidden="true">▾</span><span class="cf-tray-tab-t">Ideas · ${n} — show</span></button>`); tab = tray.querySelector(':scope > .cf-tray-tab'); }
        tab.setAttribute('aria-expanded', !shut);
      });
      const head = tpl.querySelector(':scope > .xc-w-h'); if(!head) return;
      let b = head.querySelector('[data-cf="ideas"]');
      if(!trays.length){ if(b) b.remove(); return; }
      const allShut = trays.every(t => t.parentElement.classList.contains('cf-tray-closed'));
      if(!b){ b = document.createElement('button'); b.type = 'button'; b.className = 'cf-btn cf-ideas-btn'; b.dataset.cf = 'ideas'; const sp = head.querySelector('.xc-sp'); if(sp) sp.after(b); else head.appendChild(b); }
      b.textContent = allShut ? 'Show ideas' : 'Collapse ideas'; b.dataset.all = allShut ? 'open' : 'close';
      b.dataset.tip = allShut ? 'Show the ideas beside the table' : 'Fold the ideas away to focus on what is in use'; b.dataset.tipPos = 'below';
    });
  }

  // ---------- hover tips on the canvas controls (what each one is for) ----------
  const TIPS = {
    select: ['Select', 'click to pick · Shift-click or Shift-drag for more', 'V'],
    note: ['Post-it', 'click the canvas to place one', 'N'],
    vote: ['Dot voting', 'give the best ideas a dot'],
    'zoom-out': ['Zoom out', '', '−'], 'zoom-in': ['Zoom in', '', '+'], 'zoom-reset': ['Back to 100%', ''], fit: ['Fit everything', 'show the whole canvas', '0']
  };
  function tips(){
    document.querySelectorAll('#xc-wrap .xc-rail button, #xc-wrap .xc-zoom button').forEach(b => {
      const k = b.dataset.tool || (b.dataset.cf === 'vote' ? 'vote' : '') || b.dataset.oc || b.dataset.xcAct || '', t = TIPS[k]; if(!t) return;
      const tip = t[0] + (t[2] ? ` (${t[2]})` : '') + (t[1] ? ` — ${t[1]}` : '');
      if(b.dataset.tip === tip) return;
      b.dataset.tip = tip; b.removeAttribute('title'); // our tip replaces the slow native one
      if(!b.getAttribute('aria-label')) b.setAttribute('aria-label', t[0]);
    });
  }
  // ---------- text size in a graph component's Text view (A− / A+), kept per component ----------
  function textSize(){
    const zs = st().tvZoom || {};
    document.querySelectorAll('#xc-world .xc-w--live[data-wid]').forEach(sec => {
      const id = sec.dataset.wid, z = zs[id] || 1, textOn = sec.querySelector('.xc-gmode [data-m="text"].on');
      sec.style.setProperty('--cf-tv-zoom', z);
      let ctl = sec.querySelector('.cf-tsize');
      if(!textOn){ if(ctl) ctl.remove(); return; }
      if(!ctl){ const seg = sec.querySelector('.xc-gmode'); if(!seg) return;
        seg.insertAdjacentHTML('afterend', `<span class="xc-seg cf-tsize" role="group" aria-label="Text size"><button type="button" data-cf="tsize" data-id="${E(id)}" data-d="-1" data-tip="Smaller text" data-tip-pos="below" aria-label="Smaller text">A−</button><span class="cf-tsize-n" aria-live="polite"></span><button type="button" data-cf="tsize" data-id="${E(id)}" data-d="1" data-tip="Bigger text" data-tip-pos="below" aria-label="Bigger text">A+</button></span>`);
        ctl = sec.querySelector('.cf-tsize'); }
      ctl.querySelector('.cf-tsize-n').textContent = Math.round(z * 100) + '%';
    });
  }

  // ---------- overlay: selection bar + voting panel ----------
  function overlay(){
    const wrap = $('xc-wrap'); let ui = $('cf-ui');
    if(!ui){ ui = document.createElement('div'); ui.id = 'cf-ui'; ui.className = 'cf-ui'; wrap.appendChild(ui); }
    if(!on()){ ui.innerHTML = ''; return; }
    const n = CF.sel.size, v = st().vote;
    let html = '';
    if(n >= 2) html += `<div class="cf-bar" role="toolbar" aria-label="Selection"><span class="cf-bar-n">${n} selected</span>
      <button type="button" class="cf-btn cf-btn--pri" data-cf="compare">${ICO.compare}Compare</button>
      <button type="button" class="cf-btn" data-cf="clear-sel" aria-label="Clear selection">×</button></div>`;
    else if(n === 1) html += `<div class="cf-bar cf-bar--hint" role="status"><span class="cf-bar-n">1 selected</span><span class="cf-bar-tip">Shift-click another to compare</span><button type="button" class="cf-btn" data-cf="clear-sel" aria-label="Clear selection">×</button></div>`;
    if(v && (v.on || v.reveal)) html += votePanel(v);
    ui.innerHTML = html;
  }
  function votePanel(v){
    const used = Object.values(v.mine).reduce((a, b) => a + b, 0), left = v.dots - used;
    const head = `<div class="cf-vp-h"><span class="cf-vp-t">${ICO.vote}Dot voting</span><button type="button" class="cf-icon" data-cf="vote-close" aria-label="Close voting">×</button></div>`;
    if(!v.reveal) return `<div class="cf-vp" role="region" aria-label="Dot voting">${head}
      <p class="cf-vp-p">Click a post-it, card or item to give it a dot. You have <b>${left} of ${v.dots}</b> left.</p>
      <div class="cf-vp-dots" aria-hidden="true">${'<span class="cf-dot cf-dot--me"></span>'.repeat(used)}${'<span class="cf-dot cf-dot--ghost"></span>'.repeat(Math.max(0, left))}</div>
      <div class="cf-vp-acts">${used ? '<button type="button" class="cf-btn" data-cf="vote-reset">Take all back</button>' : ''}<button type="button" class="cf-btn cf-btn--pri" data-cf="vote-reveal"${used ? '' : ' disabled'}>Show results</button></div></div>`;
    const all = {}; Object.keys(v.labels).forEach(k => { all[k] = (v.mine[k] || 0) + ((v.team || {})[k] || 0); });
    const rank = Object.keys(all).filter(k => all[k]).sort((a, b) => all[b] - all[a]), max = Math.max(1, ...rank.map(k => all[k]));
    return `<div class="cf-vp cf-vp--res" role="region" aria-label="Voting results">${head}
      <ol class="cf-res">${rank.map((k, i) => `<li class="${i === 0 ? 'is-top' : ''}"><span class="cf-res-l" title="${E(v.labels[k])}">${E(tr(v.labels[k], 34))}</span><span class="cf-res-bar"><span style="width:${Math.round(all[k] / max * 100)}%"></span></span><b>${all[k]}</b></li>`).join('') || '<li class="cf-res-none">No dots yet.</li>'}</ol>
      <p class="cf-vp-note">Your dots plus ${v.teamN} teammates’ — teammates’ votes are mock data in this prototype.</p>
      <div class="cf-vp-acts"><button type="button" class="cf-btn" data-cf="vote-again">Vote again</button>${v.on ? '<button type="button" class="cf-btn cf-btn--pri" data-cf="vote-end">End voting</button>' : ''}</div></div>`;
  }
  function railBtn(){
    const rail = document.querySelector('#xc-wrap .xc-rail'); if(!rail) return;
    let b = rail.querySelector('[data-cf="vote"]');
    if(!b){ b = document.createElement('button'); b.type = 'button'; b.dataset.cf = 'vote'; b.title = 'Dot voting: give items dots'; b.setAttribute('aria-label', 'Dot voting'); b.innerHTML = ICO.vote; rail.appendChild(b); }
    const v = st().vote, pressed = !!(v && v.on);
    b.classList.toggle('on', pressed); b.setAttribute('aria-pressed', pressed);
  }

  // ---------- voting ----------
  function voteStart(){ const s = st(); if(!s.vote || !s.vote.on) s.vote = { on: true, dots: 3, mine: {}, labels: {}, team: null, teamN: 3, reveal: false }; CF.sel.clear(); CF.a.deselect(); CF.decorate(); }
  function voteGive(x){
    const v = st().vote, used = Object.values(v.mine).reduce((a, b) => a + b, 0);
    if(!x.label) return CF.a.notice('That post-it has no text yet — write something on it first.');
    if(used >= v.dots) return CF.a.notice(`You’ve used all ${v.dots} dots. Take one back (−) to move it.`);
    v.mine[x.key] = (v.mine[x.key] || 0) + 1; v.labels[x.key] = x.label; CF.decorate();
  }
  // Mock teammates: each puts 3 dots on the items on the canvas (seeded, so the same canvas gives the same result).
  function voteReveal(){
    const v = st().vote, its = items().filter(x => x.label); its.forEach(x => { v.labels[x.key] = v.labels[x.key] || x.label; });
    if(!v.team){ v.team = {}; let seed = its.reduce((a, x) => a + x.key.length * 31, 7);
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      for(let m = 0; m < v.teamN; m++) for(let d = 0; d < 3; d++){ if(!its.length) break; const pick = its[Math.floor(rnd() * Math.min(its.length, 6))]; v.team[pick.key] = (v.team[pick.key] || 0) + 1; } }
    v.reveal = true; CF.decorate();
  }

  // ---------- compare ----------
  function compareStart(){
    const its = items().filter(x => CF.sel.has(x.key)), named = its.filter(x => x.label);
    if(named.length < 2) return CF.a.notice('Select at least two things with text to compare.');
    if(named.length > 6) return CF.a.notice('Compare up to 6 at a time — deselect a few.');
    // place the table beside what was compared, in free space (right of it, else below it, else further down)
    const rs = named.map(x => x.el.getBoundingClientRect()), w = cmpW(named.length), h = 140 + 36 * 6;
    const tl = CF.a.toWorld(Math.min(...rs.map(r => r.left)), Math.min(...rs.map(r => r.top))), br = CF.a.toWorld(Math.max(...rs.map(r => r.right)), Math.max(...rs.map(r => r.bottom)));
    const p = freeSpot([{ x: br.x + 40, y: tl.y }, { x: tl.x, y: br.y + 40 }], w, h);
    const s = st(), c = { id: 'cmp' + (++s.seq), x: Math.round(p.x), y: Math.round(p.y), items: named.map(x => ({ key: x.key, label: x.label, detail: x.detail, kind: x.kind })), busy: true, err: '', title: '', criteria: [], cells: [], summary: '', best: [], sources: [] };
    s.cmps.push(c); CF.sel.clear(); CF.afterRender(); focusCmp(c.id);
    return compareRun(c);
  }
  async function compareRun(c){
    c.busy = true; c.err = ''; CF.afterRender();
    const ctx = CF.a.ctx ? CF.a.ctx() : {};
    const guard = typeof LANGUAGE_PURITY_GUARD !== 'undefined' ? LANGUAGE_PURITY_GUARD : '';
    const prompt = `Compare these ${c.items.length} things side by side for this situation.
The user's request: "${ctx.request || ''}"${ctx.title ? `\nWhat is being made: "${ctx.title}"` : ''}
THINGS: ${JSON.stringify(c.items.map((x, i) => ({ i, name: x.label, detail: x.detail })))}
First decide if they can be compared: they must be the same kind of thing or real alternatives for the same choice (two restaurants, two places to visit, two train passes). If not, return {"comparable": false, "why_not": "one short sentence saying what each is"}.
If they can: pick 4-6 criteria that matter for THIS situation (e.g. for restaurants: cuisine, price range, distance or area, opening hours, booking; for places: what it is, travel time, cost, best for). For each criterion give one short value per thing (a few words, in the same order as THINGS). Never invent prices, hours or distances — if you don't know, write "Not sure". Then "summary": one or two sentences on how they differ, and "best_for": one entry per thing — who or when it is the better pick.
Respond in the same language as the request. ${guard}
Also give "more_criteria": 4 other criteria the user might want to add for this situation (short, 1-3 words, not already used).
Respond ONLY with {"comparable": true, "title": "2-5 words", "criteria": ["…"], "cells": [["value for thing 0", "value for thing 1", …], …one row per criterion], "summary": "…", "best_for": ["…", "…"], "more_criteria": ["…"], "source_urls": ["…"]}`;
    try {
      let res, urls = new Map();
      if(typeof webJson === 'function'){ const r = await webJson(prompt + ((typeof aiCanSearch === 'function' && await aiCanSearch()) ? '\n\nWeb search results are available: base the values on them and list the URLs you used in "source_urls".' : ''), 1800, null, 'Compare'); res = r.res; urls = r.urls || urls; }
      else res = await callClaude(prompt, { maxTokens: 1800 });
      if(!res || res.comparable === false){ removeCmp(c.id); CF.a.notice(`Can’t compare these: ${String((res && res.why_not) || 'they aren’t the same kind of thing').replace(/\.$/, '')}. Select things that are alternatives for the same choice.`); return; }
      const crit = (Array.isArray(res.criteria) ? res.criteria : []).map(x => String(x || '').trim()).filter(Boolean).slice(0, 6);
      c.criteria = crit; c.cells = crit.map((_, ri) => c.items.map((_, ci) => String(((res.cells || [])[ri] || [])[ci] || '—').trim()));
      c.title = String(res.title || 'Comparison').trim(); c.summary = String(res.summary || '').trim();
      c.best = c.items.map((_, i) => String((res.best_for || [])[i] || '').trim());
      c.more = (Array.isArray(res.more_criteria) ? res.more_criteria : []).map(x => String(x || '').trim()).filter(Boolean).slice(0, 5);
      c.sources = (Array.isArray(res.source_urls) ? res.source_urls : []).map(u => { const m = typeof rsUrl === 'function' ? rsUrl(urls, u) : null; return m ? { url: m.url, title: m.title || m.url } : null; }).filter(Boolean).slice(0, 6);
      if(!crit.length) throw new Error('nothing came back to compare');
    } catch(err){
      console.warn('[Compare]', err);
      // without the AI: still a table, from what the items say about themselves
      c.title = 'Side by side'; c.criteria = ['What it is']; c.cells = [c.items.map(x => x.detail || x.kind)];
      c.summary = ''; c.best = []; c.err = /key/i.test(String(err && err.message)) ? 'Add your OpenRouter key in AI settings to compare by criteria.' : `Couldn’t compare by criteria — ${String((err && err.message) || 'the AI request failed').replace(/\.$/, '')}.`;
    } finally { c.busy = false; CF.afterRender(); focusCmp(c.id); }
  }
  const cmpW = n => Math.min(900, 170 + 190 * n);
  // world boxes of everything on the canvas, to keep a new table clear of them
  function boxes(){ const world = $('xc-world'), out = []; if(!world) return out;
    world.querySelectorAll('.xc-w, .xc-note, .cf-w').forEach(el => { const r = el.getBoundingClientRect(), a = CF.a.toWorld(r.left, r.top), b = CF.a.toWorld(r.right, r.bottom); out.push({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }); }); return out; }
  function freeSpot(tries, w, h){
    const bs = boxes(), hit = p => bs.some(b => p.x < b.x + b.w + 24 && p.x + w + 24 > b.x && p.y < b.y + b.h + 24 && p.y + h + 24 > b.y);
    for(const t of tries){ for(let i = 0; i < 30; i++){ const p = { x: t.x, y: t.y + i * 60 }; if(!hit(p)) return p; } }
    for(let ring = 1; ring < 12; ring++) for(let j = 0; j <= ring; j++){ const p = { x: tries[0].x + ring * (w + 40), y: tries[0].y + j * 80 }; if(!hit(p)) return p; } // further right
    return { x: tries[0].x, y: Math.max(tries[0].y, ...bs.map(b => b.y + b.h)) + 48 }; // else below everything — never on top of something
  }
  // pan (and zoom out if it doesn't fit) so the table is in view — never zoom in past where the user is
  function focusCmp(id){ const el = document.querySelector(`[data-cf-w="${id}"]`); if(!el || !CF.a.focusBox) return; CF.a.focusBox({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }); }
  function removeCmp(id){ const s = st(); s.cmps = s.cmps.filter(x => x.id !== id); CF.afterRender(); }
  function cmpHtml(c){
    const add = !!CF.a.addToOutput, v = st().vote;
    const head = `<div class="cf-w-h" data-cf-drag="${c.id}"><span class="cf-w-t">${ICO.compare}Compare${c.title ? ' · ' + E(c.title) : ''}</span><span class="cf-sp"></span>
      ${c.busy ? '' : `<button type="button" class="cf-icon" data-cf="cmp-redo" data-id="${c.id}" title="Compare again" aria-label="Compare again">↻</button>`}<button type="button" class="cf-icon" data-cf="cmp-close" data-id="${c.id}" aria-label="Close comparison">×</button></div>`;
    if(c.busy) return `<section class="cf-w cf-cmp" data-cf-w="${c.id}" style="left:${c.x}px;top:${c.y}px" aria-busy="true">${head}<div class="cf-w-b"><p class="cf-busy" role="status">${ICO.spin}Comparing ${c.items.map(x => `“${E(tr(x.label, 24))}”`).join(', ')}…</p></div></section>`;
    const cols = c.items.length;
    return `<section class="cf-w cf-cmp" data-cf-w="${c.id}" style="left:${c.x}px;top:${c.y}px;width:${c.w || cmpW(cols)}px" aria-label="Comparison">${head}
      <div class="cf-w-b"${c.h ? ` style="min-height:${c.h}px"` : ''}>${(c.filling || []).length ? `<p class="cf-ai-note" role="status">${ICO.spin}AI is filling in ${c.filling.map(i => `“${E(c.criteria[i] || '')}”`).join(', ')} for each column…</p>` : ''}${c.err ? `<p class="cf-err" role="alert">${E(c.err)}</p>` : ''}
      <table class="cf-table" style="--cols:${cols}"><thead><tr><th scope="col"><span class="cf-vh">Criteria</span></th>${c.items.map((x, i) => `<th scope="col"><span class="cf-th-l">${E(x.label)}</span><span class="cf-th-k">${E(x.kind)}</span>
        <span class="cf-th-acts">${add ? `<button type="button" class="cf-mini" data-cf="cmp-add" data-id="${c.id}" data-i="${i}">＋ ${E(CF.a.addLabel || 'Add to output')}</button>` : ''}<button type="button" class="cf-mini" data-cf="cmp-note" data-id="${c.id}" data-i="${i}">＋ Post-it</button></span></th>`).join('')}</tr></thead>
      <tbody>${c.criteria.map((k, ri) => `<tr><th scope="row"><span class="cf-crit">${E(k)}<button type="button" class="cf-crit-x" data-cf="crit-del" data-id="${c.id}" data-i="${ri}" aria-label="Remove the criterion ${E(k)}" data-tip="Remove this criterion" data-tip-pos="below">×</button></span></th>${c.cells[ri].map(v2 => (c.filling || []).includes(ri) ? `<td class="cf-filling" aria-busy="true"><span class="cf-ai-work">${ICO.spin}<span>AI is finding this…</span></span></td>` : `<td>${E(v2)}</td>`).join('')}</tr>`).join('')}
      ${c.best.some(Boolean) ? `<tr class="cf-best"><th scope="row">Best for</th>${c.best.map(b => `<td>${E(b)}</td>`).join('')}</tr>` : ''}</tbody></table>
      ${critForm(c)}
      ${c.summary ? `<p class="cf-sum">${E(c.summary)}</p>` : ''}
      ${c.sources.length ? `<p class="cf-src">Sources: ${c.sources.map(s2 => `<a href="${E(s2.url)}" target="_blank" rel="noopener">${E(tr(s2.title, 40))} ↗</a>`).join(' · ')}</p>` : ''}</div><span class="cf-grip" data-cf-grip="${c.id}" title="Drag to resize" aria-hidden="true"></span></section>`;
  }
  // "+ Add criterion": a button; when open, a field with suggestions to add in one click.
  const CRIT_FALLBACK = ['Price', 'Location', 'Opening hours', 'Reviews', 'How to get there'];
  function critForm(c){
    if(!c.adding) return `<div class="cf-crit-bar"><button type="button" class="cf-btn" data-cf="crit-open" data-id="${c.id}">＋ Add criterion</button><span class="cf-crit-tip">Compare them on something else too</span></div>`;
    const have = new Set(c.criteria.map(k => k.toLowerCase())), sugg = (c.more && c.more.length ? c.more : CRIT_FALLBACK).filter(k => !have.has(k.toLowerCase())).slice(0, 5);
    return `<div class="cf-crit-form" role="group" aria-label="Add a criterion"><label class="cf-crit-l" for="cf-crit-${c.id}">What else should they be compared on?</label>
      <div class="cf-crit-row"><input type="text" class="cf-crit-in" id="cf-crit-${c.id}" data-cf-crit="${c.id}" placeholder="e.g. Opening hours"><button type="button" class="cf-btn cf-btn--pri" data-cf="crit-add" data-id="${c.id}">Add</button><button type="button" class="cf-btn" data-cf="crit-cancel" data-id="${c.id}">Cancel</button></div>
      ${sugg.length ? `<div class="cf-crit-sugg"><span>Suggestions:</span>${sugg.map(k => `<button type="button" class="cf-mini" data-cf="crit-sugg" data-id="${c.id}" data-k="${E(k)}">＋ ${E(k)}</button>`).join('')}</div>` : ''}</div>`;
  }
  // A criterion the user adds: its row appears at once, the AI fills one value per thing.
  async function critAdd(c, v){
    v = String(v || '').trim(); if(!v) return;
    if(c.criteria.some(k => k.toLowerCase() === v.toLowerCase())) return CF.a.notice(`“${tr(v, 40)}” is already a criterion in this table.`);
    c.criteria.push(v); c.cells.push(c.items.map(() => '…')); const ri = c.criteria.length - 1;
    c.filling = (c.filling || []).concat(ri); CF.focusCrit = c.id; CF.afterRender();
    const ctx = CF.a.ctx ? CF.a.ctx() : {}, guard = typeof LANGUAGE_PURITY_GUARD !== 'undefined' ? LANGUAGE_PURITY_GUARD : '';
    const prompt = `For each thing below, give a short value (a few words) for the criterion "${v}", for this situation: "${ctx.request || ''}".\nTHINGS: ${JSON.stringify(c.items.map((x, i) => ({ i, name: x.label, detail: x.detail })))}\nNever invent prices, hours or distances — write "Not sure" when you don't know. Same language as the request. ${guard}\nRespond ONLY with {"values": ["value for thing 0", "value for thing 1", …]}`;
    let vals = null, err = '';
    try { const r = typeof webJson === 'function' ? (await webJson(prompt, 600, null, 'Compare')).res : await callClaude(prompt, { maxTokens: 600 }); vals = r && Array.isArray(r.values) ? r.values : null; if(!vals) throw new Error('no values came back'); }
    catch(e){ err = /key/i.test(String(e && e.message)) ? 'Add your OpenRouter key in AI settings to fill it in.' : 'Couldn’t fill it in this time — press ↻ to compare again.'; }
    const at = c.criteria.indexOf(v); if(at < 0) return; // removed meanwhile
    c.cells[at] = c.items.map((_, i) => vals ? String(vals[i] || 'Not sure').trim() : '—');
    c.filling = (c.filling || []).filter(x => x !== at);
    if(err) CF.a.notice(`“${tr(v, 40)}” was added. ${err}`);
    CF.afterRender();
  }

  // ---------- events ----------
  function wire(){
    if(CF.wired) return; const wrap = $('xc-wrap'); if(!wrap) return; CF.wired = true;
    // The canvas moves by pan/zoom only: focusing a control near an edge must never scroll the canvas box itself.
    wrap.addEventListener('scroll', () => { if(wrap.scrollLeft || wrap.scrollTop){ wrap.scrollLeft = 0; wrap.scrollTop = 0; } });
    // Shift-drag on empty canvas: a selection box (instead of panning)
    wrap.addEventListener('pointerdown', e => {
      if(!on() || e.button !== 0) return;
      const t = e.target, vp = $('xc-vp'), world = $('xc-world');
      const grip = t.closest && t.closest('[data-cf-grip]');
      if(grip){ e.stopPropagation(); e.preventDefault(); return resizeCmp(e, grip.dataset.cfGrip); }
      const tvRow = t.closest && t.closest(TV_ROWS);
      if(tvRow && !t.closest('button, a') && CF.a.dropText){ return textHold(e, tvRow); } // press and hold the name to drag it
      const cmp = t.closest && t.closest('[data-cf-drag]');
      if(cmp && !t.closest('button')){ e.stopPropagation(); return dragCmp(e, cmp.dataset.cfDrag); }
      if(t.closest && t.closest('.cf-w')){ e.stopPropagation(); return; }
      if(!e.shiftKey || (t !== vp && t !== world)) return;
      e.stopPropagation(); e.preventDefault();
      const r0 = wrap.getBoundingClientRect(), box = document.createElement('div'); box.className = 'cf-marquee'; wrap.appendChild(box);
      const m = CF.marquee = { x0: e.clientX, y0: e.clientY, box, add: new Set(CF.sel) };
      const move = ev => { const x1 = Math.min(m.x0, ev.clientX), y1 = Math.min(m.y0, ev.clientY), x2 = Math.max(m.x0, ev.clientX), y2 = Math.max(m.y0, ev.clientY);
        Object.assign(box.style, { left: (x1 - r0.left) + 'px', top: (y1 - r0.top) + 'px', width: (x2 - x1) + 'px', height: (y2 - y1) + 'px' });
        CF.sel = new Set(m.add); items().forEach(x => { const r = x.el.getBoundingClientRect(); if(r.right > x1 && r.left < x2 && r.bottom > y1 && r.top < y2) CF.sel.add(x.key); });
        CF.decorate(); };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); box.remove(); CF.marquee = null; if(CF.sel.size) CF.a.deselect(); CF.decorate(); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    }, true);
    // Shift/⌘/Ctrl-click on an item selects it — don't let the browser select text instead
    wrap.addEventListener('mousedown', e => { const v = on() && st().vote; if(on() && (e.shiftKey || e.metaKey || e.ctrlKey || (v && v.on && !v.reveal)) && itemOf(e.target) && !e.target.closest('input, .cf-w')) e.preventDefault(); }, true); // also no caret in a post-it while voting
    // Clicks: our own controls; voting mode; Shift/⌘/Ctrl-click to multi-select
    wrap.addEventListener('click', e => {
      if(!CF.a) return;
      const b = e.target.closest && e.target.closest('[data-cf], [data-cf-unvote]');
      if(b && wrap.contains(b)){ e.stopPropagation(); return act(b); }
      if(!on()) return;
      const v = st().vote, x = itemOf(e.target);
      if(v && v.on && !v.reveal && x && !e.target.closest('.cf-w')){ e.stopPropagation(); e.preventDefault(); return voteGive(x); }
      if(x && (e.shiftKey || e.metaKey || e.ctrlKey) && !e.target.closest('input')){
        e.stopPropagation(); e.preventDefault();
        if(!CF.sel.size){ const cur = items().find(y => y.el.classList.contains('is-sel') || y.el.closest('.is-sel')); if(cur && cur.key !== x.key) CF.sel.add(cur.key); }
        if(CF.sel.has(x.key)) CF.sel.delete(x.key); else CF.sel.add(x.key);
        CF.a.deselect(); return CF.decorate();
      }
      if(CF.sel.size && !e.target.closest('#cf-ui')){ CF.sel.clear(); CF.decorate(); }
    }, true);
    document.addEventListener('keydown', e => { if(e.key === 'Escape' && CF.sel.size && on()){ CF.sel.clear(); CF.decorate(); } });
    wrap.addEventListener('scroll', e => { if(e.target && e.target.id === 'text-view-wrap') CF.tvTop = e.target.scrollTop; }, true);
    document.addEventListener('mouseup', () => setTimeout(askMenu, 0));
    document.addEventListener('keyup', e => { if(e.shiftKey || e.key === 'Shift') setTimeout(askMenu, 0); });
    document.addEventListener('mousedown', e => { if(!e.target.closest || !e.target.closest('#cf-ask')) hideAsk(); }, true);
    document.addEventListener('keydown', e => { if(e.key !== 'Shift') hideAsk(); }, true); // typing (e.g. correcting the selected words) closes it
    document.addEventListener('scroll', hideAsk, true); window.addEventListener('wheel', hideAsk, { passive: true });
    // + Add a criterion: Enter, or leaving the field, adds it
    wrap.addEventListener('keydown', e => { const t = e.target; if(!t.matches || !t.matches('.cf-crit-in')) return; e.stopPropagation(); if(e.key !== 'Enter' || e.isComposing) return; e.preventDefault(); const c = st().cmps.find(x => x.id === t.dataset.cfCrit), v = t.value; t.value = ''; if(c) critAdd(c, v); }, true);
    wrap.addEventListener('focusout', e => { const t = e.target; if(!t.matches || !t.matches('.cf-crit-in') || !t.value.trim()) return; const to = e.relatedTarget && e.relatedTarget.dataset && e.relatedTarget.dataset.cf; if(/^crit-(cancel|add|sugg)$/.test(to || '')) return; /* those buttons decide */ const c = st().cmps.find(x => x.id === t.dataset.cfCrit), v = t.value; t.value = ''; if(c) critAdd(c, v); });
  }
  // ---------- Ask AI about highlighted text (canvas and Output) ----------
  // Highlight any words → a small "Ask AI" button above them → Chat opens and asks what they mean.
  function askMenu(){
    const sel = window.getSelection(), text = sel && sel.rangeCount ? (sel.getRangeAt(0).toString() || String(sel)).replace(/\s+/g, ' ').trim() : '';
    if(!text || text.length > 300 || !sel.rangeCount){ return hideAsk(); }
    const n = sel.anchorNode, el = n && (n.nodeType === 3 ? n.parentElement : n);
    // where: the canvas, Chat messages, and the Output's document text (only the document — not the rest of the Output).
    // The document can be corrected in place, so its editable text counts too.
    const inDoc = !!el.closest('#doc-answer-display');
    if(!el || !el.closest('#xc-wrap, #doc-answer-display, .msg') || el.closest('textarea, input, select, #cf-ask, .source-chip') || (!inDoc && el.closest('[contenteditable="true"]'))) return hideAsk();
    const inChat = !!el.closest('.msg');
    const r = sel.getRangeAt(0).getBoundingClientRect(); if(!r.width && !r.height) return hideAsk();
    let m = $('cf-ask');
    if(!m){ m = document.createElement('div'); m.id = 'cf-ask'; m.className = 'cf-ask'; m.setAttribute('role', 'toolbar'); m.setAttribute('aria-label', 'Selected text'); document.body.appendChild(m);
      m.addEventListener('mousedown', e => e.preventDefault()); // keep the highlight while clicking
      m.addEventListener('click', e => { const b = e.target.closest('button'); if(!b) return; if(b.dataset.note != null) return noteFromChat(b.dataset.note); ask(b.dataset.q); }); }
    // in Chat: ask more about the words, or put them on the canvas as a post-it
    // Ask AI puts the words in Chat as a reference tag — the user writes the question (it isn't asked for them)
    m.innerHTML = `<button type="button" data-q="${E(tr(text, 120))}" title="Reference these words in Chat, then ask your question">✦ Ask AI</button>`
      + (inChat ? `<button type="button" class="cf-ask-2" data-note="${E(tr(text, 200))}" title="Put these words on the Cognitive Field canvas as a post-it">＋ Make a post-it</button>` : '');
    m.style.top = Math.round(r.top) + 'px'; m.classList.add('is-on');
    const hw = m.offsetWidth / 2 + 8; m.style.left = Math.round(Math.min(window.innerWidth - hw, Math.max(hw, r.left + r.width / 2))) + 'px'; // stays on screen
  }
  function hideAsk(){ const m = $('cf-ask'); if(m) m.classList.remove('is-on'); }
  // the highlighted Chat words become a post-it in the middle of what the canvas shows (a little lower each time)
  let noteN = 0;
  function noteFromChat(text){
    hideAsk(); const sel = window.getSelection(); if(sel) sel.removeAllRanges();
    if(!on() || !CF.a.makeNote){ if(typeof addChatMsg === 'function') addChatMsg('assistant', 'Open the Cognitive Field canvas first, then highlight the words again to make a post-it.'); return; }
    const vp = $('xc-vp'), r = vp ? vp.getBoundingClientRect() : null;
    const c = r ? CF.a.toWorld(r.left + r.width / 2, r.top + r.height / 2) : { x: 0, y: 0 }, k = noteN++ % 6;
    const p = freeSpot([{ x: c.x - 88 + k * 24, y: c.y - 20 + k * 24 }], 180, 110); // a free spot near the middle of the view
    CF.a.makeNote(text, '', p.x, p.y);
  }
  CF.ask = ask;
  // The highlighted words go into the chat box as a reference tag — @[“…”] (or @[Source · “…”]), the same kind of tag
  // as @[Node 2.1 · …] — at the caret, and the box is focused so the user asks what they want (user request: Ask AI is
  // a reference, not an automatic question).
  function ask(text, src){
    hideAsk(); const sel = window.getSelection(); if(sel) sel.removeAllRanges();
    if(typeof forceExpandPanel === 'function'){ if(typeof layoutMode !== 'undefined' && layoutMode === '3panel') forceExpandPanel('chat'); else if(typeof setCognitiveFieldMode === 'function'){ forceExpandPanel('graph'); setCognitiveFieldMode('chat'); } }
    const inp = $('uib-input'); if(!inp) return;
    const tok = `@[${src ? `${String(src).replace(/[\[\]]/g, '')} · ` : ''}“${tr(String(text).replace(/[\[\]]/g, ''), 120)}”]`;
    const v = inp.value, at = typeof inp.selectionStart === 'number' && document.activeElement === inp ? inp.selectionStart : v.length;
    const pre = v.slice(0, at), ins = (pre && !/\s$/.test(pre) ? ' ' : '') + tok + ' ';
    inp.value = pre + ins + v.slice(at); inp.dispatchEvent(new Event('input', { bubbles: true }));
    setTimeout(() => { inp.focus(); const p = (pre + ins).length; try { inp.setSelectionRange(p, p); } catch(e){} }, 60);
  }
  function act(b){
    const s = st();
    if(b.dataset.cfUnvote){ const k = b.dataset.cfUnvote; if(s.vote && s.vote.mine[k]){ s.vote.mine[k]--; if(!s.vote.mine[k]) delete s.vote.mine[k]; } return CF.decorate(); }
    const id = b.dataset.id, c = id && s.cmps.find(x => x.id === id), i = +b.dataset.i;
    switch(b.dataset.cf){
      case 'vote': if(s.vote && s.vote.on){ s.vote.on = false; if(!s.vote.reveal) s.vote = null; } else voteStart(); return CF.decorate();
      case 'vote-close': s.vote = null; return CF.decorate();
      case 'vote-reset': if(s.vote) s.vote.mine = {}; return CF.decorate();
      case 'vote-reveal': return voteReveal();
      case 'vote-again': s.vote = null; return voteStart();
      case 'vote-end': if(s.vote) s.vote.on = false; return CF.decorate();
      case 'tsize': { const zs = s.tvZoom || (s.tvZoom = {}), z = zs[id] || 1; zs[id] = Math.max(0.7, Math.min(3, Math.round((z + (+b.dataset.d) * 0.15) * 100) / 100)); return CF.decorate(); }
      case 'tray': { const m = s.ideasClosed || (s.ideasClosed = {}), k = b.dataset.k; m[k] = !m[k]; return CF.decorate(); }
      case 'ideas': { const m = s.ideasClosed || (s.ideasClosed = {}), shut = b.dataset.all === 'close'; (b.closest('.xc-w--tpl') || document).querySelectorAll('.xc-split > .xc-tray').forEach(t => { const sec = t.closest('.xc-sec'); if(sec) m[secKey(sec)] = shut; }); return CF.decorate(); }
      case 'compare': return compareStart();
      case 'clear-sel': CF.sel.clear(); return CF.decorate();
      case 'cmp-close': return removeCmp(id);
      case 'cmp-redo': if(c) compareRun(c); return;
      case 'crit-open': if(c){ c.adding = true; CF.focusCrit = c.id; CF.afterRender(); } return;
      case 'crit-cancel': if(c){ c.adding = false; CF.afterRender(); } return;
      case 'crit-add': if(c){ const inp = document.querySelector(`[data-cf-crit="${c.id}"]`), v = inp ? inp.value : ''; if(!v.trim()){ if(inp) inp.focus(); return; } inp.value = ''; critAdd(c, v); } return;
      case 'crit-sugg': if(c) critAdd(c, b.dataset.k); return;
      case 'crit-del': if(c){ c.criteria.splice(i, 1); c.cells.splice(i, 1); c.filling = (c.filling || []).filter(x => x !== i).map(x => x > i ? x - 1 : x); CF.afterRender(); } return;
      case 'cmp-note': if(c && c.items[i]){ const x = c.items[i]; CF.a.makeNote(x.label, x.detail, c.x, c.y + (($(`xc-world`).querySelector(`[data-cf-w="${c.id}"]`) || {}).offsetHeight || 260) + 24 + i * 10); } return;
      case 'cmp-add': if(c && c.items[i] && CF.a.addToOutput) CF.a.addToOutput(c.items[i].label, c.items[i].detail); return;
    }
  }
  function resizeCmp(e, id){
    const c = st().cmps.find(x => x.id === id), el = document.querySelector(`[data-cf-w="${id}"]`); if(!c || !el) return;
    const body = el.querySelector('.cf-w-b'), z = CF.a.zoom().zoom || 1, x0 = e.clientX, y0 = e.clientY, w0 = el.offsetWidth, h0 = body.offsetHeight;
    const move = ev => { c.w = Math.max(320, Math.round(w0 + (ev.clientX - x0) / z)); c.h = Math.max(120, Math.round(h0 + (ev.clientY - y0) / z)); el.style.width = c.w + 'px'; body.style.minHeight = c.h + 'px'; }; // taller = taller rows; never shorter than the content
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  // ---------- drag a row out of a graph component's Text view (same as dragging a node out of the graph) ----------
  document.addEventListener('dragstart', e => { const n = e.target && (e.target.nodeType === 3 ? e.target.parentElement : e.target); if(n && n.closest && n.closest('#xc-world .xc-tslot')) e.preventDefault(); }, true);
  const TV_ROWS = '#xc-world .xc-tslot .tv-category-label, #xc-world .xc-tslot .tv-topic-label'; // the headers: categories and topics
  const tvLabel = el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').replace(/\s+/g, ' ').replace(/^\s*(\d+\.|[A-Z]\.|·|◦)\s*/, '').trim();
  function tvDetail(el){
    if(el.classList.contains('tv-subtopic')){ const d = el.querySelector('.tv-subtopic-detail'); return d ? d.textContent.replace(/^\s*—\s*/, '').trim() : ''; }
    const nx = el.nextElementSibling; return nx && /-detail$/.test(nx.classList[0] || '') ? nx.textContent.trim() : '';
  }
  // A header's name (category or topic) is a handle: hovering shows a grab hand and "Drag to the canvas"; press and move
  // drags it out like a graph node. A click without moving turns that header into ordinary text (I-beam cursor) until the
  // pointer leaves it, so its words can still be selected (and Ask AI used on them).
  function textHold(e, row){
    if(!tvLabel(row) || (CF.tvDragging && Date.now() - CF.tvDragging < 15000)) return; // one drag at a time (a drag lost by the browser no longer blocks)
    if(row.classList.contains('cf-tv-text')) return; // clicked once: plain text now
    e.preventDefault(); // no text selection from a press on the handle
    const sel0 = window.getSelection(); if(sel0 && sel0.rangeCount && !sel0.isCollapsed) sel0.removeAllRanges();
    const x0 = e.clientX, y0 = e.clientY;
    const unarm = () => { row.classList.remove('cf-tv-armed'); document.body.classList.remove('cf-nosel'); };
    const stop = () => { window.removeEventListener('pointermove', early); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); };
    const early = ev => { if(Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 6) return; stop(); row.classList.add('cf-tv-armed'); document.body.classList.add('cf-nosel'); textDrag(row, ev, unarm); };
    const end = ev => { stop(); unarm(); if(ev.type !== 'pointerup') return;
      row.classList.add('cf-tv-text'); row.addEventListener('pointerleave', () => row.classList.remove('cf-tv-text'), { once: true }); };
    window.addEventListener('pointermove', early); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  }
  function textDrag(row, ev0, unarm){
    const label = tvLabel(row); if(!label) return unarm();
    const info = { label, detail: tvDetail(row) }; CF.tvDragging = Date.now();
    const ghost = document.createElement('div'); ghost.className = 'xc-gghost'; ghost.textContent = `＋ ${tr(label, 40)} — drop on the canvas or on a table`; document.body.appendChild(ghost);
    if(CF.a.dropHint) CF.a.dropHint('start');
    const move = ev => {
      const sel = window.getSelection(); if(sel && sel.rangeCount) sel.removeAllRanges();
      ghost.style.left = (ev.clientX + 12) + 'px'; ghost.style.top = (ev.clientY - 36) + 'px';
      if(CF.a.dropHint) CF.a.dropHint('move', ev.clientX, ev.clientY);
    };
    move(ev0);
    const done = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', cancel);
      ghost.remove(); unarm(); CF.tvDragging = 0; if(CF.a.dropHint) CF.a.dropHint('end'); };
    const cancel = () => done(); // the browser took the pointer away (or the window lost focus): end the drag, drop nothing
    const up = ev => { done();
      const over = document.elementFromPoint(ev.clientX, ev.clientY);
      if(over && over.closest && over.closest('.xc-w--live') === row.closest('.xc-w--live')){ if(CF.a.notice) CF.a.notice('Drop it outside the graph — on the canvas or on a table.'); return; } // dropped back on its own graph
      CF.a.dropText(info, ev.clientX, ev.clientY); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel); window.addEventListener('blur', cancel);
  }
  function dragCmp(e, id){
    const c = st().cmps.find(x => x.id === id), el = document.querySelector(`[data-cf-w="${id}"]`); if(!c || !el) return;
    const z = CF.a.zoom().zoom || 1, x0 = e.clientX, y0 = e.clientY, cx = c.x, cy = c.y;
    const move = ev => { c.x = Math.round(cx + (ev.clientX - x0) / z); c.y = Math.round(cy + (ev.clientY - y0) / z); el.style.left = c.x + 'px'; el.style.top = c.y + 'px'; };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
})();
