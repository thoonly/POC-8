// components/node-template.js — the node's template is decided before it shows (round 84, user test: "think about the
// template before you show the execution node: does this objective need a brainstorm, a choice, or is it a clear thing
// to fill in? Which choices must show as a picture or a colour palette? Which parts are there by default — not left
// for the user to switch on").
//
// The same setup call that picks the Kind also returns "template" — no extra call:
//   work  — brainstorm (go wide, keep the best) · pick (one or several) · fill (the items are known: fill in their
//           details) · answer (questions from sources) · design (design mode's own pickers)
//   show  — how each option / collected item looks: photo · logo · image (an example picture) · palette (its colours)
//           · slot (a time) · text
//   parts — the parts the template always has, set up by default (gather: the kinds are kept and the node goes
//           straight to collecting; define: its sections, see round 83)
// The user never chooses the template; "How this node works" under "In this node" says what was set up and why.
// Photos and logos stay with components/option-images.js — this tells it which one, so it no longer guesses.
// Loaded after exec-kinds.js; wraps ExKinds and exRsStart (same pattern as design-mode.js / exec-kinds.js).
(function(){
  'use strict';
  if(!window.ExKinds || typeof exRsW !== 'function') return;
  const E = s => ipE(s == null ? '' : String(s));
  const WORK = ['brainstorm', 'pick', 'fill', 'answer', 'design'];
  const SHOW = ['photo', 'logo', 'image', 'palette', 'slot', 'text'];
  const HEX = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i;
  const str = v => typeof v === 'string' ? v.trim() : '';

  // ---------- asked in the node's setup call ----------
  const BLOCK = `
TEMPLATE — decide how THIS node's template works before the user sees it. The user never chooses it, so get it right:
- "work": "brainstorm" when the items are open ideas to generate widely and keep the best (names, ideas, angles, concepts); "pick" when the user chooses among options or collected items; "fill" when the items are already clear from the request, the intent or the Kind and the user only fills in their details (the fields of a form, the agenda items named, the goals of each period, the line items of a known list) — then the "define" "items" are exactly those items, nothing extra; "answer" for questions answered from sources (engine "find"); "design" for engine "design".
- "pick": "one" or "several" — how many the user ends with when "work" is "pick".
- "show": how each option or collected item looks, so it is judged the way it should be: "photo" for real, named places (a hotel, venue, restaurant, city, attraction); "logo" for real, named companies, products, apps, brands; "image" for a visual look best judged by seeing an example (an art, illustration, interior, architecture or photo style, a mood); "palette" for colour schemes; "slot" for dates or time slots; "text" for everything else (wording, subject lines, names, approaches, strategies, rules).
- "parts": the parts the template must ALWAYS have, set up by default — only when the request, the intent or the Definition of done names them, or they are standard for this work (a 30-60-90 day plan → the three periods; things to do on a trip → the kinds of things asked for; a weekly status → done / doing / blocked). 0-6 short labels, else []. For engine "define" they are the same as "define"."sections"; for engine "gather" they are the "groups" the user wants.
- "why": one short plain sentence on why this template fits the node.
Add to the JSON: "template": {"work": "pick", "pick": "one", "show": "text", "parts": [], "why": "..."}.`;
  const origRouting = ExKinds.routingPrompt;
  ExKinds.routingPrompt = function(){ return origRouting.apply(this, arguments) + BLOCK; };

  // a fallback when the model gives no template: from the engine and the item type
  const SHOW_BY_ITEM = [[/^(place|area|property|route)/i, 'photo'], [/^(company|software|vendor|investor|product)/i, 'logo'], [/^colour palette/i, 'palette'], [/^(typography|layout)/i, 'image'], [/^(event|time slot)/i, 'slot']];
  function norm(t, w, mode){
    t = t && typeof t === 'object' ? t : {};
    let work = WORK.includes(t.work) ? t.work : '';
    // the engine decides what is possible: choosing → pick, questions → answer, design → design, a list → brainstorm or fill
    if(mode === 'decide' || mode === 'gather') work = 'pick';
    else if(mode === 'find') work = 'answer';
    else if(mode === 'design') work = 'design';
    else if(work !== 'fill') work = 'brainstorm';
    let show = SHOW.includes(t.show) ? t.show : '';
    if(!show){ const hit = SHOW_BY_ITEM.find(([re]) => re.test(w.itemType || '')); show = hit ? hit[1] : 'text'; }
    if(mode !== 'decide' && mode !== 'gather') show = 'text';
    const parts = (Array.isArray(t.parts) ? t.parts : []).map(x => str(typeof x === 'string' ? x : x && x.label)).filter(Boolean).slice(0, 6);
    return { work, pick: t.pick === 'several' ? 'several' : 'one', show, parts, why: str(t.why) };
  }
  const origApply = ExKinds.apply;
  ExKinds.apply = function(w, res){ const mode = origApply.apply(this, arguments); w.tpl = norm(res && res.template, w, mode); return mode; };

  // ---------- what the template sets up by default ----------
  const origAfter = ExKinds.afterStart;
  ExKinds.afterStart = function(w){
    origAfter.apply(this, arguments);
    const t = w.tpl; if(!t) return;
    if(w.mode === 'decide' && t.pick === 'several' && (!w.pick || w.pick.max <= 1)) w.pick = { min: 2, max: Math.max(3, Math.ceil((w.optCount || 6) / 2)), fromDod: false };
    if(w.mode === 'decide' && t.pick === 'one' && w.pick && w.pick.max > 1 && !w.pick.fromDod) w.pick = { min: 1, max: 1, fromDod: false };
    // a clear list to fill in: its items are on the list from the start, the user fills in the details
    if(w.mode === 'define' && t.work === 'fill'){
      const cv = xcCv(w);
      rsDef(w).items.forEach(x => { x.kept = true; x.fresh = false; x.xo = ++cv.seq; });
    }
    // collecting: the parts are the kinds, kept from the start — the user isn't asked which ones they want
    if(w.mode === 'gather' && t.parts.length && w.gather){
      const g = w.gather, have = new Map((g.groups || []).map(x => [x.label.toLowerCase(), x]));
      g.groups = t.parts.map((label, i) => Object.assign({ id: 'gr' + i, label, detail: '' }, have.get(label.toLowerCase()) || {}, { kept: true, byTpl: true }));
    }
  };
  // a collecting node with its kinds set up starts on collecting, not on "What interests you"
  const origStart = window.exRsStart;
  window.exRsStart = function(k){
    const r = origStart.apply(this, arguments);
    return Promise.resolve(r).then(v => {
      const w = exRsW(k);
      if(w && w.tpl && w.mode === 'gather' && w.tpl.parts.length && exRsStepKey(w) === 'interests' && rsKeptGroups(w).length) exRsGo(k, w.step + 1);
      return v;
    });
  };

  // ---------- every later call for this node knows the template ----------
  const origCtx = window.exCtx;
  window.exCtx = function(k){
    const base = origCtx.apply(this, arguments), w = exState(k) && exState(k).w, t = w && w.tpl; if(!t) return base;
    const look = { photo: 'a real, named place (a photo is fetched)', logo: 'a real, named company or product (its logo is fetched)', image: 'a visual look: also give "image_query", the exact title of an English Wikipedia article whose main picture shows it', palette: 'a colour scheme: also give "colors", 4-6 hex codes that ARE this palette', slot: 'a date or time slot (say the day, time and time zone in the label)', text: 'text' }[t.show];
    return `${base}
TEMPLATE: ${t.work}${t.work === 'pick' ? ` (${t.pick})` : ''}.${(w.mode === 'decide' || w.mode === 'gather') ? ` Each option or item is ${look}.` : ''}${t.parts.length ? ` Parts set up by default: ${t.parts.join(', ')}.` : ''}`;
  };

  // ---------- the look of each choice ----------
  // the reply shape asks for what the look needs; the answer keeps it on the item
  function ask(w){
    const t = w && w.tpl; if(!t) return '';
    if(t.show === 'palette') return ', "colors": ["#1f6feb", "…4-6 hex codes that ARE this option"]';
    if(t.show === 'image') return ', "image_query": "the exact title of an English Wikipedia article whose main picture shows this option"';
    return '';
  }
  function from(x){
    const out = {}, cs = (Array.isArray(x && x.colors) ? x.colors : []).map(str).filter(h => HEX.test(h)).slice(0, 6), q = str(x && x.image_query);
    if(cs.length) out.colors = cs;
    if(q) out.q = q;
    return out;
  }
  let redrawT = 0;
  const redraw = k => { clearTimeout(redrawT); redrawT = setTimeout(() => { if(EX.cur === k) exRsRefresh(k, true); }, 250); };
  function fetchImg(k, item){
    if(!window.PlaceImages || !PlaceImages.find){ item.img = null; return; }
    item.img = 'busy';
    (async () => { for(const q of [item.q, item.label].filter(Boolean)){ try { const h = await PlaceImages.find(q); if(h && h.url){ item.img = { url: h.url, credit: h.credit || '', href: h.href || h.url }; break; } } catch(e){} }
      if(item.img === 'busy') item.img = null; redraw(k); })();
  }
  // where: 'card' (canvas card), 'idea' (canvas idea), 'row' (Output list)
  function vis(item, where){
    const k = typeof EX !== 'undefined' && EX.cur, w = k && exRsW(k), t = w && w.tpl; if(!t || !item) return '';
    if(t.show === 'palette'){
      if(item.colors && item.colors.length) return `<span class="nt-sw nt-sw--${where}" role="img" aria-label="Colours ${E(item.colors.join(', '))}">${item.colors.map(h => `<i style="background:${h}" title="${h}"></i>`).join('')}</span>`;
      return item.own ? '' : `<span class="nt-none">No colours given</span>`;
    }
    if(t.show === 'image'){
      if(item.img === undefined && !item.own) fetchImg(k, item);
      if(item.img === 'busy') return `<span class="nt-img nt-img--${where} nt-img--load" aria-hidden="true"></span>`;
      if(item.img && item.img.url) return `<figure class="nt-img nt-img--${where}"><img src="${E(item.img.url)}" alt="${E(item.label)} — example picture" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"><figcaption>Example · ${E(item.img.credit || 'Wikimedia')}</figcaption></figure>`;
      return item.own ? '' : `<span class="nt-none">No example picture found</span>`;
    }
    if(t.show === 'slot') return `<span class="nt-slot">${ICO.slot}Time slot</span>`;
    return '';
  }

  // ---------- "How this node works" ----------
  const svg = d => `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const ICO = {
    brainstorm: svg('M8 2.5a4 4 0 0 0-2.3 7.3V11.5h4.6V9.8A4 4 0 0 0 8 2.5zM6.3 13.5h3.4'),
    pick: svg('M3 8.5l3 3 7-7'),
    fill: svg('M3 4h10M3 8h10M3 12h6'),
    answer: svg('M6 6a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2v.5M8 12.5h.01'),
    design: svg('M3 13l2.5-.5 7-7-2-2-7 7zM9.5 4.5l2 2'),
    photo: svg('M2.5 4.5h11v8h-11zM2.5 10.5l3-3 3 3 2-2 3 3'),
    logo: svg('M8 2.5l5 2.5v6L8 13.5 3 11V5z'),
    image: svg('M2.5 4.5h11v8h-11zM6 8a1 1 0 1 0 0-.01M2.5 11l3.5-3 3 2.5 2-1.5 2.5 2'),
    palette: svg('M8 2.5a5.5 5.5 0 1 0 0 11c.8 0 1.2-.6 1-1.3-.3-.8.3-1.7 1.2-1.7H12a1.5 1.5 0 0 0 1.5-1.5A5.5 5.5 0 0 0 8 2.5zM5 7.5h.01M7.5 5h.01M10.5 6h.01'),
    slot: svg('M3 4h10v9H3zM3 7h10M6 2.5v3M10 2.5v3'),
    text: svg('M3 4h10M8 4v9'),
    parts: svg('M2.5 3.5h4.5v4h-4.5zM9 3.5h4.5v4H9zM2.5 9.5h4.5v3h-4.5zM9 9.5h4.5v3H9z')
  };
  const WORK_T = { brainstorm: 'Brainstorm, then keep the best', fill: 'Fill in a ready-made list', answer: 'Answer the questions from sources', design: 'Settle each part, then write its rules' };
  const SHOW_T = { photo: 'Choices shown with photos', logo: 'Choices shown with logos', image: 'Choices shown as example pictures', palette: 'Choices shown as colour palettes', slot: 'Choices shown as time slots', text: 'Choices shown as text cards' };
  function partsOf(w){
    if(w.mode === 'define' && typeof rsSecs === 'function' && rsSecs(w).length) return rsSecs(w).map(s => s.label);
    if(w.mode === 'gather' && w.gather) return (w.gather.groups || []).filter(g => g.kept).map(g => g.label);
    return w.tpl.parts;
  }
  function card(w){
    const t = w && w.tpl; if(!t || !w.mode) return '';
    const work = t.work === 'pick' ? (t.pick === 'several' ? 'Pick the ones you want' : 'Pick one') : WORK_T[t.work];
    const parts = partsOf(w);
    const chips = [`<li>${ICO[t.work] || ''}${E(work)}</li>`];
    if((w.mode === 'decide' || w.mode === 'gather') && SHOW_T[t.show]) chips.push(`<li>${ICO[t.show] || ''}${E(SHOW_T[t.show])}</li>`);
    if(parts.length) chips.push(`<li>${ICO.parts}${parts.length} part${parts.length === 1 ? '' : 's'} set up: ${parts.map(E).join(' · ')}</li>`);
    return `<div class="nt-card" role="note" aria-label="How this node works"><p class="nt-k">How this node works</p><ul class="nt-chips">${chips.join('')}</ul>${t.why ? `<p class="nt-why">${E(t.why)}</p>` : ''}</div>`;
  }

  window.NodeTpl = { ask, from, vis, card, norm };
})();
