// components/design-mode.js — "Design" mode for an execution node (Research node type).
// For a node that DESIGNS something made of several parts (e.g. a game's encounters, capture, battle and levelling;
// a travel, expense and leave policy). The way a designer studies competitors, on the Cognitive Field canvas:
//
//   Research documents (left of the first template) → Template (one per part) → Logic document → next Template …
//
//   · Research documents: one component per reference (e.g. Pokémon, Dragon Quest) — a full explainer written from one
//     live web search, citing the pages it used, with images where some can be found. Like an uploaded document, it is
//     not part of any template: the user drags a section (by its heading) or a key idea onto a template, or selects any
//     text → one menu: Ask AI · Explore more (researched deeper, in place) · Turn into a sticky note · Add to <part>.
//     Each document can be exported as a PDF.
//   · Template (per part), three collapsible stages: 1 How others do it (the research, as a list) · 2 Pick ideas ·
//     3 Your logic — a drop area holding the picked ideas (drag key ideas, sections or sticky notes in) and
//     "Combine into my logic".
//   · Logic document (per part, between this template and the next, joined by the AI lines): the AI combines the picked
//     ideas into one logic. The user edits it, asks for changes, checks gaps, exports it, and — when it looks right —
//     carries it into the next part (whose research and logic then build on it).
//
// History: round 18 (research per reference instead of one search for five, which found nothing), round 20 (documents
// on the canvas), round 21 (one selection menu, images + PDF, collapsible stages, logic drop area, logic document).
// Loaded after the execution-node canvas script; it wraps the shared functions (same pattern the canvas uses).
(function(){
  if(typeof exRsSteps !== 'function' || typeof xcSecHtml !== 'function') return;
  const E = s => ipE(s == null ? '' : String(s));
  const dz = w => w.design || (w.design = { refNoun: 'example', refNouns: 'examples', parts: [] });
  const isDz = key => typeof key === 'string' && key.indexOf('dz-') === 0;
  const partByKey = (w, pk) => dz(w).parts.find(p => p.key === pk);
  const partOfStep = (w, key) => isDz(key) ? partByKey(w, key.slice(3)) : null;
  const curPart = w => partOfStep(w, exRsStepKey(w));
  const MAX_AUTO = 3; // references researched straight away when a part opens
  const DOC_W = 560, DOC_H = 640, LDOC_W = 600, LDOC_H = 680;
  const allIdeas = p => p.games.flatMap(g => g.ideas.map(i => Object.assign({ from: g.name }, i))).concat(p.ownIdeas.map(i => Object.assign({ from: i.src || 'Your idea' }, i)));
  const picked = p => allIdeas(p).filter(i => i.picked);
  const hasLogic = p => !!String(p.logic.md || '').trim();
  const partDone = p => hasLogic(p) && !p.logic.busy && settled(p) && !openQs(p).length; // decided, written, and nothing left open
  const others = (w, p) => dz(w).parts.filter(x => x !== p && hasLogic(x)).map(x => ({ part: x.label, logic: x.logic.md.trim().slice(0, 1500) }));
  const refresh = k => exRsRefresh(k);
  // the template of a part: its own step template, or the single template when the node has one part (user test: the
  // research lines never reached a one-part node's template, because they looked only for step templates)
  const tplSel = (w, p) => dz(w).parts.length > 1 ? `section[data-wid="step-dz-${p.key}"]` : 'section[data-wid="tpl"]';
  const tag = (cls, t) => `<span class="dz-tag dz-tag--${cls}">${E(t)}</span>`;
  const spin = () => (typeof IP_ICO !== 'undefined' && IP_ICO.spin) || '';
  const radar = () => '<span class="dot-spin" data-dmx="radar"></span>'; // searching the web (components/dot-loader.js)
  const DOC_ICO = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2h5.5L12.5 5v9h-8.5z"/><path d="M9.5 2v3h3M6 8h4M6 10.5h4"/></svg>';
  const PDF_ICO = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8M5 7l3 3 3-3M3 12.5h10"/></svg>';

  // ---------- set-up (called from exRsStart when the AI picks "design") ----------
  function newGame(name, why, own){ return { id: rsId('gm'), name, why: why || '', own: !!own, state: 'idle', err: '', md: '', sources: [], live: null, ideas: [], more: [], images: null, view: 'doc', at: 0 }; }
  window.dzSetup = function(w, res){
    const dd = (res && res.design) || {}, s = v => typeof v === 'string' ? v.trim() : '';
    const parts = (Array.isArray(dd.parts) ? dd.parts : []).filter(p => p && s(p.label)).slice(0, 6).map((p, i) => {
      const aspects = (Array.isArray(p.aspects) ? p.aspects : []).filter(a => a && s(a.label)).slice(0, 6).map((a, j) => ({ id: `p${i}a${j}`, label: s(a.label), hint: s(a.hint) }));
      const seen = new Set(), games = (Array.isArray(p.references) ? p.references : []).map(r => typeof r === 'string' ? { name: r } : r).filter(r => r && s(r.name) && !seen.has(s(r.name).toLowerCase()) && seen.add(s(r.name).toLowerCase())).slice(0, 6).map(r => newGame(s(r.name), s(r.why)));
      return { key: 'p' + i, label: s(p.label), question: s(p.question), aspects, games, ownIdeas: [], fold: {},
        logic: { md: '', busy: false, err: '', at: 0, from: [] }, editing: false, check: null, checkBusy: false, pickBusy: false, suggBusy: false, opened: false, suggErr: '' };
    });
    if(!parts.length) throw new Error('the parts to design didn’t come back');
    w.design = { refNoun: s(dd.ref_noun) || 'example', refNouns: s(dd.ref_noun_plural) || s(dd.ref_noun) || 'examples', parts };
  };
  function dzOpenPart(k, p){
    if(!p || p.opened || exState(k).done) return; p.opened = true;
    if(p.aspects.length && !p.optsAsked){ p.optsAsked = true; dzOptions(k, p.key); } // the choices to settle come first
    if(!p.games.length) return dzSuggestRefs(k, p.key, true);
    p.games.slice(0, MAX_AUTO).forEach(g => dzResearch(k, p.key, g.id));
  }
  window.dzAfterStart = function(k){ const w = exRsW(k); if(EX.cur === k && typeof ipSyncChat === 'function') ipSyncChat(); dzOpenPart(k, curPart(w)); };

  // ---------- AI plumbing: a call that returns TEXT (+ the pages a live search really returned) ----------
  async function dzAsk(prompt, maxTokens, search, from){
    const live = !!search && await aiCanSearch();
    const data = await callClaudeRaw(live ? prompt + `\n\nUse the web search results. Cite pages inline as [1], [2]… in the order of the source list you were given; never write a URL yourself.` : prompt,
      live ? { maxTokens, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }] } : { maxTokens });
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const sources = live ? chatExtractSources(data, 50) : [];
    if(live && sources.length && typeof srcAdd === 'function' && EX.cur) srcAdd('exec:' + EX.cur, sources, from || 'Research');
    return { text, sources, live };
  }
  const aiErr = err => { if(err && err.code === 'NO_KEY' && window.AI && AI.openSettings) AI.openSettings(); return (err && err.message) || 'the AI request failed'; };
  const redraw = k => { refresh(k); if(typeof xcRender === 'function' && EX.cur === k) xcRender(); };

  function dzSuggestRefs(k, pk, autoResearch){
    const w = exRsW(k), d = dz(w), p = partByKey(w, pk); if(!p) return;
    p.suggBusy = true; p.suggErr = ''; refresh(k);
    return callClaude(`${exCtx(k)}

The user is designing "${p.label}" for their own ${d.refNoun}${p.question ? ` — ${p.question}` : ''}. Name ${p.games.length ? 3 : 5} well-known ${d.refNouns} whose approach to "${p.label}" is worth studying — different approaches, not the same idea five times. ${p.games.length ? `Already listed (do not repeat): ${JSON.stringify(p.games.map(g => g.name))}.` : ''} Each: "name" (exact title), "why" (one short sentence: what is distinctive about how it does ${p.label}).
${ipLang()}

Respond ONLY with {"items": [{"name": "...", "why": "..."}]}.`, { maxTokens: 600 }).then(res => {
      const have = new Set(p.games.map(g => g.name.toLowerCase()));
      const add = (res && Array.isArray(res.items) ? res.items : []).filter(x => x && String(x.name || '').trim() && !have.has(String(x.name).trim().toLowerCase())).slice(0, 5).map(x => newGame(String(x.name).trim(), String(x.why || '').trim()));
      p.games.push(...add);
      if(!add.length) p.suggErr = 'No new references came back. Add one you know.';
      p.suggBusy = false; refresh(k);
      if(autoResearch) return Promise.all(add.slice(0, MAX_AUTO).map(g => dzResearch(k, pk, g.id)));
    }).catch(err => { p.suggBusy = false; p.suggErr = `Couldn’t suggest references — ${aiErr(err)}.`; refresh(k); });
  }

  // ---------- research: one full document per reference ----------
  function dzResearch(k, pk, gid){
    const w = exRsW(k), d = dz(w), p = partByKey(w, pk), g = p && p.games.find(x => x.id === gid); if(!g || g.state === 'busy') return Promise.resolve();
    g.state = 'busy'; g.err = ''; redraw(k); // its document appears on the canvas right away (loading)
    const covers = p.aspects.map(a => a.label + (a.hint ? ` (${a.hint})` : '')).join('; ');
    const prompt = `${exCtx(k)}

The user is designing "${p.label}" for their own ${d.refNoun}${p.question ? ` — ${p.question}` : ''}. Research how ${g.name} does ${p.label}, so they can borrow ideas from it.
Write a complete explainer document in Markdown, like a thorough guide article a designer would study:
# ${g.name} — ${p.label}
## Overview — 2-3 sentences.
## How it works, step by step — a numbered list of what the ${d.refNoun} checks and does, in order.
## The numbers — rates, formulas, probabilities, tables (use a Markdown table where it helps), exactly as the sources state them.
## What changes it — conditions, items, abilities, time, place; where versions or generations differ, say which.
## Why it works, and its trade-offs — for a designer.
${covers ? `Make sure it covers, where the sources do: ${covers}.\n` : ''}Only state what the research supports. Where the sources disagree or don't say, write that. Never invent a mechanic or a number.
Then list 3-6 IDEAS a designer could borrow from ${g.name} for "${p.label}" — each one distinct mechanic.
${window.DocVisuals ? `${DocVisuals.rule}(This document already shows photos of ${g.name} itself — no [photo] of it.)\n` : ''}${ipLang()}

Answer in EXACTLY this format, nothing before or after:
===DOCUMENT===
(the Markdown document)
===IDEAS===
- Idea title (3-8 words) :: one or two sentences — what it is and why it's worth borrowing`;
    return dzAsk(prompt, 3800, true, `${g.name} · ${p.label}`).then(({ text, sources, live }) => {
      const parts = text.split(/===\s*IDEAS\s*===/i), doc = (parts[0] || '').replace(/===\s*DOCUMENT\s*===/i, '').trim();
      if(doc.length < 120) throw new Error('the document came back empty');
      g.md = doc; g.sources = sources.map(s => ({ url: s.url, title: s.title || rsDomain(s.url) })); g.live = live; g.at = Date.now();
      g.ideas = String(parts[1] || '').split('\n').map(l => l.replace(/^\s*[-*\d.)]+\s*/, '').trim()).filter(Boolean).slice(0, 6).map(l => { const [t, ...r] = l.split('::'); return { id: rsId('id'), title: t.replace(/\*\*/g, '').trim(), detail: r.join('::').trim(), picked: false }; }).filter(i => i.title);
      g.state = 'done';
      dzImages(k, p, g);
    }).catch(err => { g.state = 'error'; g.err = `Couldn’t research ${g.name} — ${aiErr(err)}.`; }).then(() => redraw(k));
  }
  // images for a research document: real, credited images found by a lookup (components/place-images.js — the approved
  // remote-image exception); when none is found, nothing is shown.
  function dzImages(k, p, g){
    if(g.images || !window.PlaceImages || !PlaceImages.find) return;
    g.images = [];
    Promise.all([`${g.name} ${p.label}`, g.name].map(q => PlaceImages.find(q).catch(() => null))).then(hits => {
      const seen = new Set(); g.images = hits.filter(h => h && h.url && !seen.has(h.url) && seen.add(h.url)).slice(0, 2);
      if(g.images.length && EX.cur === k) xcRender();
    });
  }

  // ---------- documents: sections, citations ----------
  const sectionsOf = md => { const out = []; let cur = null;
    String(md || '').split('\n').forEach(line => { const m = /^(#{1,4})\s+(.*)$/.exec(line);
      if(m && m[1].length === 1 && !out.length && !cur) return; // the document's own title: the component header shows it
      if(m){ cur = { full: m[2].trim(), body: [] }; out.push(cur); return; }
      if(!cur){ if(!line.trim()) return; cur = { full: 'Overview', body: [] }; out.push(cur); }
      cur.body.push(line); });
    return out.map(s => ({ full: s.full, body: s.body.join('\n').trim() })).filter(s => s.body); };
  const plain = md => String(md || '').replace(/\[(\d{1,2})\]/g, '').replace(/[*_`>#|]/g, ' ').replace(/-{3,}/g, ' ').replace(/\s+/g, ' ').trim();
  const citeHtml = (html, sources) => html.replace(/\[(\d{1,2})\]/g, (m, n) => { const s = sources[+n - 1]; return s ? `<a class="dz-cite" href="${E(s.url)}" target="_blank" rel="noopener" title="${E(s.title || s.url)}">[${n}]</a>` : m; });
  const srcList = sources => sources.length ? `<details class="dz-srcs"><summary>Sources · ${sources.length}</summary><ol>${sources.map(s => `<li><a href="${E(s.url)}" target="_blank" rel="noopener">${E(s.title || rsDomain(s.url))}</a> <span class="rs-w">${E(rsDomain(s.url))}</span></li>`).join('')}</ol></details>` : '';

  // ---------- combine the picked ideas into the part's logic ----------
  function dzCombine(k, pk, instr, opts){
    const w = exRsW(k), d = dz(w), p = partByKey(w, pk); if(!p || p.logic.busy) return Promise.resolve();
    const ideas = picked(p); if(!instr && !canCombine(p)) return Promise.resolve(); // every must-settle choice is made first
    const first = !hasLogic(p);
    p.logic.busy = true; p.logic.err = ''; redraw(k);
    const prev = hasLogic(p) ? p.logic.md.trim() : '';
    const prompt = `${exCtx(k)}

The user is designing "${p.label}" for their own ${d.refNoun}${p.question ? ` — ${p.question}` : ''}.
${decisionsText(p).length ? `They DECIDED (fixed — build on these exactly, never reopen them):\n${decisionsText(p).map(x => `- ${x}`).join('\n')}\n` : ''}${(p.answers || []).length ? `They ANSWERED (fixed):\n${p.answers.map(x => `- ${x.q} → ${x.a}`).join('\n')}\n` : ''}${ideas.length ? `After studying other ${d.refNouns}, they picked these ideas to build from:\n${ideas.map((i, n) => `${n + 1}. ${i.title}${i.detail ? ` — ${String(i.detail).slice(0, 700)}` : ''} (from ${i.from})`).join('\n')}\n` : ''}${p.aspects.length ? `The logic must settle: ${p.aspects.map(a => a.label + (a.hint ? ` (${a.hint})` : '')).join('; ')}.\n` : ''}${others(w, p).length ? `Stay consistent with the parts already designed: ${JSON.stringify(others(w, p))}\n` : ''}
Write ONE coherent logic for "${p.label}" in THEIR ${d.refNoun} from the decisions and picked ideas above — they are the building blocks: connect them, resolve where they clash, and fill only the small gaps needed to make it work — mark anything you added yourself with "(added to connect)". Don't copy another ${d.refNoun} wholesale.
Write it as a design spec in Markdown:
## How it works — a numbered flow, step by step.
## Rules — numbered, concrete enough to build. Where a number is needed, propose a starting value and mark it "(starting value — tune in playtest)".
## Built from — one bullet per decision and per picked idea: what it is, where it came from, and how it is used here.
${window.DocVisuals ? `${DocVisuals.rule}A loop the ${d.refNoun} repeats (a turn, a round, a day) is a "cycle" diagram right under "How it works".\n` : ''}
No "Open questions" section: settle small things yourself (mark them "(added to connect)"). Only when the logic truly depends on a choice the USER must make, list it AFTER the Markdown, as:
===QUESTIONS===
[{"q": "the question, one sentence", "options": ["2-4 concrete answers"]}]
When there is nothing the user must decide, end with ===QUESTIONS=== and [].
${prev ? `\nCURRENT VERSION (the user may have edited it — keep their edits and everything they didn't ask to change):\n"""\n${prev.slice(0, 6000)}\n"""\n${instr ? `The user asks: "${instr}"` : 'Work in the picked ideas that are new since this version.'}\n` : ''}${ipLang()}

Respond with the Markdown, then the ===QUESTIONS=== block.`;
    return dzAsk(prompt, 3800, false).then(({ text }) => {
      const [mdPart, qPart] = text.split(/===\s*QUESTIONS\s*===/i);
      const md = mdPart.replace(/^```(?:markdown|md)?\s*|```\s*$/g, '').replace(/(^|\n)#{1,3}\s*Open questions[^\n]*\n[\s\S]*?(?=\n#{1,3}\s|$)/i, '$1').trim(); if(md.length < 80) throw new Error('the logic came back empty');
      let qs = []; try { const m = /\[[\s\S]*\]/.exec(qPart || ''); qs = m ? JSON.parse(m[0]) : []; } catch(e){ qs = []; }
      p.questions = (Array.isArray(qs) ? qs : []).filter(q => q && String(q.q || '').trim()).slice(0, 5).map(q => ({ id: rsId('q'), q: String(q.q).trim(), options: (Array.isArray(q.options) ? q.options : []).map(x => String(x).trim()).filter(Boolean).slice(0, 4), answer: '', other: '', own: false }));
      p.logic.dec = decisionsText(p).join('|');
      p.logic.md = md; p.logic.at = Date.now(); p.logic.from = ideas.map(i => i.id); p.editing = false; if(p.check) p.check.stale = true;
    }).catch(err => { p.logic.err = `Couldn’t combine the ideas — ${aiErr(err)}.`; }).then(() => {
      p.logic.busy = false; if(opts && opts.cascade) p.cascade = null; redraw(k); nextSync(w);
      if(first && hasLogic(p) && !(opts && opts.quiet)) setTimeout(() => dzShow(k, 'ldoc-' + p.key), 60); // the new logic document, in view
      if(hasLogic(p) && !(opts && opts.cascade)) dzCascade(k, p.key);
    });
  }
  // A part changed: every later part that already has a logic is updated to stay consistent with it — one after another,
  // each glowing (template + logic document) while the AI works, the line into it animated (user test: "when I update
  // step 1, the steps after it that are already active should update too"). Background work never opens AI settings.
  // An earlier NODE changed its output (it was edited and completed again): every part of this node that has a logic is
  // updated from the new input, in order, glowing while the AI works (called by exUpdateFromInput).
  window.dzRefreshFromInput = async function(k, from){
    const w = exRsW(k); if(!isDesign(w)) return;
    const parts = dz(w).parts.filter(p => hasLogic(p) && !p.logic.busy); if(!parts.length) return;
    parts.forEach(p => { p.cascade = from; }); redraw(k);
    for(const p of parts){
      if(exRsW(k) !== w) return;
      await dzCombine(k, p.key, `An earlier node, "${from}", has just changed its output (see the inputs above). Update this logic so it stays consistent with the new input — change only what that requires and keep everything else, including the user's own edits.`, { cascade: true, quiet: true });
    }
  };
  async function dzCascade(k, pk){
    const w = exRsW(k), parts = dz(w).parts, i = parts.findIndex(p => p.key === pk), src = parts[i];
    if(i < 0 || exState(k).done || (window.AI && AI.settings && !AI.settings.apiKey)) return;
    const later = parts.slice(i + 1).filter(p => hasLogic(p) && !p.logic.busy); if(!later.length) return;
    later.forEach(p => { p.cascade = src.label; }); redraw(k);
    for(const p of later){
      if(exRsW(k) !== w) return;
      await dzCombine(k, p.key, `The ${src.label} logic has just changed (it is under "parts already designed"). Update this logic so it stays consistent with it — change only what that requires and keep everything else, including the user's own edits.`, { cascade: true, quiet: true });
    }
  }
  function dzCheck(k, pk){
    const w = exRsW(k), p = partByKey(w, pk); if(!p || !hasLogic(p) || p.checkBusy) return Promise.resolve();
    p.checkBusy = true; redraw(k);
    return callClaude(`${exCtx(k)}

Review this logic for "${p.label}". Point out only:
- "gap": something it must settle but doesn't (failure cases, ties, limits, edge cases), or a rule too vague to build from;
- "conflict": rules that contradict each other, or the parts already designed.
Each point: "kind", "text" (one short plain sentence). At most 6, most important first. [] if it is solid.
${p.aspects.length ? `It must settle: ${JSON.stringify(p.aspects.map(a => a.label))}\n` : ''}LOGIC:
"""
${p.logic.md.slice(0, 6000)}
"""
Other parts already designed: ${JSON.stringify(others(w, p))}
${ipLang()}

Respond ONLY with {"points": [{"kind": "gap", "text": "..."}]}.`, { maxTokens: 900 }).then(res => {
      p.check = { at: Date.now(), err: '', stale: false, points: (res && Array.isArray(res.points) ? res.points : []).filter(x => x && String(x.text || '').trim()).slice(0, 6).map(x => ({ id: rsId('pt'), kind: x.kind === 'conflict' ? 'conflict' : 'gap', text: String(x.text).trim(), off: false })) };
    }).catch(err => { p.check = { at: Date.now(), points: [], stale: false, err: `Couldn’t check the logic — ${aiErr(err)}.` }; }).then(() => { p.checkBusy = false; redraw(k); });
  }
  // research one section (or a selected passage) in more depth, added under it
  function dzExplore(k, pk, gid, at, about){
    const w = exRsW(k), d = dz(w), p = partByKey(w, pk), g = p && p.games.find(x => x.id === gid); if(!g) return;
    const s = at >= 0 ? sectionsOf(g.md)[at] : null;
    const m = { id: rsId('mo'), at, about: about || (s ? s.full : ''), state: 'busy', md: '', sources: [], err: '' };
    (g.more = g.more || []).push(m); redraw(k);
    return dzAsk(`${exCtx(k)}

The user is designing "${p.label}" for their own ${d.refNoun} and is studying how ${g.name} does it. Go deeper into this:
"${m.about}"
${s ? `What the document already says (don't repeat it):\n"""\n${plain(s.body).slice(0, 1500)}\n"""\n` : ''}Write 150-400 words of Markdown with what a designer would want next: the specifics, exact numbers or formulas where the sources give them, edge cases, how it differs between versions, and a short example. Only what the research supports; say where sources disagree or are silent.
${ipLang()}`, 1600, true, `${g.name} · ${p.label}`).then(({ text, sources }) => {
      if(text.length < 60) throw new Error('nothing more came back');
      m.md = text; m.sources = sources.map(x => ({ url: x.url, title: x.title || rsDomain(x.url) })); m.state = 'done';
    }).catch(err => { m.state = 'error'; m.err = `Couldn’t explore this further — ${aiErr(err)}.`; }).then(() => redraw(k));
  }

  // ---------- must-settle choices (user test: "I need to SELECT the art style — with images — and the colour palette as
  // colours, not as text ideas; and if there are still open questions, let me answer them, don't write them in the doc") ----------
  // Every aspect a part must settle is a choice: the AI offers options shown the way they are judged — a visual look as
  // a picture, a palette as its colours, anything else as an option card. One pick per aspect; the logic is written from
  // these decisions, and it can't be written before all of them are made.
  const HEX = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i;
  const chOf = (p, a) => (p.choices = p.choices || {})[a.id] || (p.choices[a.id] = { kind: 'choice', options: [], pick: null, busy: false, err: '', byAi: false, aiWhy: '' });
  const pickOf = (p, a) => { const c = chOf(p, a); return c.options.find(o => o.id === c.pick) || null; };
  const unsettled = p => p.aspects.filter(a => !pickOf(p, a));
  const settled = p => !unsettled(p).length;
  const openQs = p => p.questions || [];
  const decisionsText = p => p.aspects.map(a => { const o = pickOf(p, a); return o ? `${a.label}: ${o.label}${o.detail ? ` — ${o.detail}` : ''}${o.colors && o.colors.length ? ` (colours ${o.colors.join(' ')})` : ''}` : null; }).filter(Boolean);
  let imgT = 0; const soon = k => { clearTimeout(imgT); imgT = setTimeout(() => { if(EX.cur === k) redraw(k); }, 250); };
  function dzOptImage(k, o){
    if(!window.PlaceImages || !PlaceImages.find){ o.img = null; return; }
    o.img = 'busy';
    (async () => { for(const q of [o.q, o.label].filter(Boolean)){ try { const h = await PlaceImages.find(q); if(h && h.url){ o.img = h; break; } } catch(e){} } if(o.img === 'busy') o.img = null; soon(k); })();
  }
  function dzOptions(k, pk, only){
    const w = exRsW(k), d = dz(w), p = partByKey(w, pk); if(!p || !p.aspects.length) return Promise.resolve();
    const list = only ? p.aspects.filter(a => a.id === only) : p.aspects.filter(a => !chOf(p, a).options.some(o => !o.own) && !chOf(p, a).busy);
    if(!list.length) return Promise.resolve();
    list.forEach(a => { const c = chOf(p, a); c.busy = true; c.err = ''; }); redraw(k);
    const research = p.games.filter(g => g.state === 'done').map(g => `${g.name}: ${g.ideas.map(i => i.title).join('; ')}`).join('\n');
    return callClaude(`${exCtx(k)}

The user is designing "${p.label}" for their own ${d.refNoun}${p.question ? ` — ${p.question}` : ''}. Before its logic is written they must SETTLE each of these by picking one option:
${list.map((a, i) => `${i + 1}. ${a.label}${a.hint ? ` (${a.hint})` : ''}${only ? ` — already offered: ${JSON.stringify(chOf(p, a).options.map(o => o.label))}; offer different ones` : ''}`).join('\n')}
${others(w, p).length ? `Parts already designed (stay consistent with them): ${JSON.stringify(others(w, p))}\n` : ''}${research ? `What the research found so far:\n${research}\n` : ''}
For EACH, offer 4 clearly different options that fit THIS project. Say how the options are best judged, as "kind":
- "image": a visual look best judged by seeing an example (an art style, a rendering style, a character or creature style). Each option also gives "image_query": the exact title of an English Wikipedia article whose main picture shows this look — a well-known artwork, artist, art movement or game that is the textbook example.
- "palette": a set of colours. Each option also gives "colors": 4-6 hex codes, e.g. "#1f6feb".
- "choice": anything else.
Each option: "label" (2-5 words) and "detail" (one sentence: what it means for this project).
${ipLang()}

Respond ONLY with {"aspects": [{"n": 1, "kind": "image", "options": [{"label": "...", "detail": "...", "image_query": "...", "colors": []}]}]}.`, { maxTokens: 2400 }).then(res => {
      (res && Array.isArray(res.aspects) ? res.aspects : []).forEach((x, j) => { const a = list[(parseInt(x && x.n, 10) || j + 1) - 1]; if(!a || !x) return; const c = chOf(p, a);
        if(!c.options.some(o => !o.own)) c.kind = ['image', 'palette', 'choice'].includes(x.kind) ? x.kind : 'choice';
        const opts = (Array.isArray(x.options) ? x.options : []).filter(o => o && String(o.label || '').trim()).slice(0, 5).map(o => ({ id: rsId('op'), label: String(o.label).trim(), detail: String(o.detail || '').trim(), q: String(o.image_query || '').trim(),
          colors: (Array.isArray(o.colors) ? o.colors : []).map(s => String(s).trim()).filter(s => HEX.test(s)).slice(0, 6), img: undefined }));
        c.options = c.options.concat(opts);
        if(c.kind === 'image') opts.forEach(o => dzOptImage(k, o));
      });
      list.forEach(a => { const c = chOf(p, a); if(!c.options.length) c.err = 'No options came back.'; });
    }).catch(err => { list.forEach(a => { chOf(p, a).err = `Couldn’t suggest options — ${aiErr(err)}.`; }); })
      .then(() => { list.forEach(a => { chOf(p, a).busy = false; }); redraw(k); nextSync(w); });
  }
  // "Let me help" on undecided aspects: one pick each, with a reason
  async function dzSuggestChoices(k, p){
    const list = unsettled(p).filter(a => chOf(p, a).options.length); if(!list.length) return 0;
    const res = await callClaude(`${exCtx(k)}

The user is designing "${p.label}". For each thing to settle below, pick the option that fits THIS project best and works with the others. For each give "why": ONE short concrete sentence (never "it is relevant").
${list.map((a, i) => `${i + 1}. ${a.label}: ${chOf(p, a).options.map((o, j) => `(${j + 1}) ${o.label}${o.detail ? ` — ${o.detail}` : ''}`).join(' ')}`).join('\n')}
${decisionsText(p).length ? `Already decided: ${decisionsText(p).join('; ')}\n` : ''}${ipLang()}

Respond ONLY with {"picks": [{"n": 1, "option": 2, "why": "..."}]}.`, { maxTokens: 700 });
    let n = 0;
    (res && Array.isArray(res.picks) ? res.picks : []).forEach(x => { const a = list[(parseInt(x && x.n, 10) || 0) - 1]; if(!a) return; const c = chOf(p, a), o = c.options[(parseInt(x.option, 10) || 0) - 1]; if(!o) return;
      c.pick = o.id; c.byAi = true; c.aiWhy = String(x.why || '').trim(); n++;
      if(c.aiWhy && typeof xcWhyLog === 'function') xcWhyLog(exRsW(k), `${a.label}: ${o.label}`, c.aiWhy, 'dz-' + p.key); });
    return n;
  }
  function optHtml(p, a, c, o, ro){
    const on = c.pick === o.id;
    const vis = c.kind === 'image' && !o.own ? (o.img === 'busy' ? '<span class="dz-opt-img dz-opt-img--load" aria-hidden="true"></span>' : o.img && o.img.url ? `<span class="dz-opt-img"><img src="${E(o.img.url)}" alt="${E(o.label)} — example picture" loading="lazy" onerror="this.parentNode.remove()"></span>` : '')
      : c.kind === 'palette' && o.colors && o.colors.length ? `<span class="dz-sw" role="img" aria-label="Colours ${E(o.colors.join(', '))}">${o.colors.filter(h => HEX.test(h)).map(h => `<i style="background:${h}" title="${h}"></i>`).join('')}</span>` : '';
    const credit = o.img && o.img.url ? `<a class="dz-opt-cr" href="${E(o.img.href || o.img.url)}" target="_blank" rel="noopener">${E(o.img.credit || rsDomain(o.img.url))}</a>` : '';
    return `<li class="dz-opt-li"><button type="button" class="dz-opt${on ? ' is-on' : ''}"${ro ? '' : ` data-dz-drag="opt:${p.key}:${a.id}:${o.id}" title="Choose it — or drag it onto the canvas"`} role="radio" aria-checked="${on}" data-dz-act="choose" data-p="${p.key}" data-a="${a.id}" data-id="${o.id}"${ro ? ' disabled' : ''}>${vis}<span class="dz-opt-t"><b>${E(o.label)}</b>${o.detail ? `<span>${E(o.detail)}</span>` : ''}${on && c.byAi && c.aiWhy ? `<span class="dz-idea-ai">✦ Suggested — ${E(c.aiWhy)}</span>` : ''}</span><span class="dz-opt-mark" aria-hidden="true">${on ? '✓' : ''}</span></button>${credit}</li>`;
  }
  function settleHtml(w, p, ro){
    if(!p.aspects.length) return '';
    const left = unsettled(p);
    const body = p.aspects.map(a => { const c = chOf(p, a), o = pickOf(p, a);
      return `<fieldset class="dz-set${o ? ' is-set' : ''}"><legend class="dz-set-h"><b>${E(a.label)}</b>${a.hint ? `<span class="dz-set-hint">${E(a.hint)}</span>` : ''}${o ? tag('ok', 'Decided') : tag('warn', 'To decide')}</legend>
        ${c.options.length ? `<ul class="dz-opts dz-opts--${c.kind}" role="radiogroup" aria-label="${E(a.label)}">${c.options.map(x => optHtml(p, a, c, x, ro)).join('')}</ul>` : ''}
        ${c.busy ? `<div class="xc-busy" role="status">${spin()}${c.options.length ? 'Finding more options…' : `Finding options for ${E(a.label.toLowerCase())}…`}</div>${c.options.length ? '' : '<div class="dz-opts-skel" aria-hidden="true"><i></i><i></i><i></i><i></i></div>'}` : ''}
        ${c.err ? `<div class="banner ex-banner" role="alert">${E(c.err)}${ro ? '' : ` <button type="button" class="ip-mini" data-dz-act="opts" data-p="${p.key}" data-a="${a.id}">Try again</button>`}</div>` : ''}
        ${ro ? '' : `<div class="dz-set-acts">${c.options.length && !c.busy ? `<button type="button" class="ip-mini ip-mini-ai" data-dz-act="opts" data-p="${p.key}" data-a="${a.id}">More options</button>` : ''}<form class="rs-add dz-add" data-dz-add="opt" data-p="${p.key}" data-a="${a.id}"><input class="ip-field rs-add-input" type="text" placeholder="Or describe your own ${E(a.label.toLowerCase())}…" aria-label="Your own ${E(a.label)}"><button type="submit" class="ip-mini">Use it</button></form></div>`}
      </fieldset>`; }).join('');
    return stage(p, 'settle', 2, 'Decide what must be settled', left.length ? `${p.aspects.length - left.length} of ${p.aspects.length} decided — pick one for each` : 'All decided — your logic is written from these', body, left.length ? `${left.length} still to decide` : `All ${p.aspects.length} decided`);
  }
  // decisions as chips (the logic document and the Output panel)
  const decidedHtml = p => p.aspects.length && decisionsText(p).length ? `<div class="dz-decided" aria-label="Decided">${p.aspects.map(a => { const o = pickOf(p, a); return o ? `<span class="dz-dchip"><span class="dz-dchip-k">${E(a.label)}</span>${o.colors && o.colors.length ? `<span class="dz-sw dz-sw--sm" aria-hidden="true">${o.colors.filter(h => HEX.test(h)).map(h => `<i style="background:${h}"></i>`).join('')}</span>` : ''}<b>${E(o.label)}</b></span>` : ''; }).join('')}</div>` : '';
  // open questions the logic still depends on: answered with controls, never left as text in the document
  function qsHtml(p, ro){
    const qs = openQs(p); if(!qs.length) return '';
    const ready = qs.every(q => String(q.answer || '').trim());
    return `<div class="dz-qs" role="group" aria-label="Still to decide"><p class="dz-qs-h">${tag('warn', 'To decide')}<b>${qs.length === 1 ? 'One thing' : `${qs.length} things`} this logic still needs from you</b> — answer ${qs.length === 1 ? 'it' : 'them'} to finish this template.</p>
      <ol class="dz-qlist">${qs.map(q => `<li class="dz-q"><fieldset><legend>${E(q.q)}</legend><div class="dz-qopts">${q.options.map(o => `<label class="dz-qopt"><input type="radio" name="dzq-${q.id}" value="${E(o)}" data-dz-q="${p.key}:${q.id}"${!q.own && q.answer === o ? ' checked' : ''}${ro ? ' disabled' : ''}><span>${E(o)}</span></label>`).join('')}
        <label class="dz-qopt dz-qopt--own"><input type="radio" name="dzq-${q.id}" value="__own" data-dz-q="${p.key}:${q.id}"${q.own ? ' checked' : ''}${ro ? ' disabled' : ''}><span>Something else:</span><input class="ip-field" type="text" data-dz-qown="${p.key}:${q.id}" value="${E(q.other || '')}" placeholder="Your answer" aria-label="Your own answer: ${E(q.q)}"${ro ? ' disabled' : ''}></label></div></fieldset></li>`).join('')}</ol>
      ${ro ? '' : `<div class="ip-row-actions"><button type="button" class="btn ip-btn-sm" data-dz-act="answer" data-p="${p.key}"${ready && !p.logic.busy ? '' : ' disabled'}>Apply my answers to the logic</button><span class="dz-hint" data-dz-qhint="${p.key}">${ready ? '' : 'Answer every question first.'}</span></div>`}</div>`;
  }
  const canCombine = p => settled(p) && (picked(p).length > 0 || p.aspects.length > 0);

  // ---------- "Let me help": research → suggest picks → combine → check ----------
  async function dzSuggestPicks(k, p){
    const ideas = allIdeas(p); if(!ideas.length) return 0;
    p.pickBusy = true; refresh(k);
    try {
      const res = await callClaude(`${exCtx(k)}

The user is designing "${p.label}". These ideas come from studying other ${dz(exRsW(k)).refNouns}:
${ideas.map((i, n) => `${n + 1}. ${i.title} — ${String(i.detail || '').slice(0, 300)} (from ${i.from})`).join('\n')}
Suggest the 3-6 that fit THIS project best AND work together (cover different needs, don't duplicate). The user will ask why: for each pick give "why" — ONE short sentence naming the concrete reason (what it settles for this part, what it adds that the others don't). Never "it is relevant".
${ipLang()}

Respond ONLY with {"pick": [{"n": 1, "why": "..."}]}.`, { maxTokens: 700 });
      const picks = (res && Array.isArray(res.pick) ? res.pick : []).map(x => typeof x === 'object' && x ? { n: parseInt(x.n, 10) - 1, why: String(x.why || '').trim() } : { n: parseInt(x, 10) - 1, why: '' }).filter(x => x.n >= 0 && x.n < ideas.length);
      picks.forEach(({ n, why }) => { const src = p.games.flatMap(g => g.ideas).concat(p.ownIdeas).find(x => x.id === ideas[n].id); if(src){ src.picked = true; src.byAi = true; src.aiWhy = why; if(why && typeof xcWhyLog === 'function') xcWhyLog(exRsW(k), src.title, why, 'dz-' + p.key); } });
      return picks.length;
    } finally { p.pickBusy = false; refresh(k); }
  }
  const waitFor = async (cond, ms) => { for(let t = 0; t < (ms || 180000) && !cond(); t += 300) await new Promise(r => setTimeout(r, 300)); };
  async function dzHelp(){
    const k = EX.cur, w = exRsW(k), p = curPart(w); if(!p || XC.run || exState(k).done) return;
    const cv = xcCv(w), run = XC.run = { k, stop: false, status: '', added: 0, carrying: false };
    const say = t => { run.status = t; xcSnack(); };
    // the AI cursor visits what it is working on, and the template glows meanwhile (user test: the animation was sometimes missing)
    const go = async sel => { const el = typeof sel === 'string' ? xcWorld().querySelector(sel) : sel; if(!el || typeof xcCursorTo !== 'function') return; if(typeof xcEnsureVisible === 'function') await xcEnsureVisible(el); await xcCursorTo(el); };
    let text = '';
    p.helping = true; redraw(k);
    try {
      forceExpandPanel('graph');
      await go(`${tplSel(w, p)} .dz-stage`);
      if(p.aspects.length && unsettled(p).length){
        if(unsettled(p).some(a => !chOf(p, a).options.length)){ say('Finding options for what you must settle…'); await dzOptions(k, p.key); }
        say('Picking one option for each — with a reason…'); await go(`${tplSel(w, p)} .dz-set`);
        const n = await dzSuggestChoices(k, p); redraw(k); nextSync(w);
        text = n ? `Picked ${n} — each says why. Change any you disagree with, then press Write my logic` : 'No suggestion came back — pick them yourself';
      } else if(!p.aspects.length && !p.games.some(g => g.state === 'done')){
        if(!p.games.length){ say(`Finding ${dz(w).refNouns} worth studying…`); await dzSuggestRefs(k, p.key, false); }
        const todo = p.games.filter(g => g.state !== 'done').slice(0, MAX_AUTO);
        if(todo.length){ say(`Researching how ${todo.map(g => g.name).join(', ')} do ${p.label.toLowerCase()}…`); const jobs = todo.map(g => g.state === 'busy' ? waitFor(() => g.state !== 'busy') : dzResearch(k, p.key, g.id)); await go(`section[data-wid="doc-${todo[0].id}"]`); await Promise.all(jobs); }
        const ok = p.games.filter(g => g.state === 'done').length;
        text = ok ? `Researched ${ok} ${ok === 1 ? dz(w).refNoun : dz(w).refNouns} — take ideas from the documents, or ask me again to suggest some` : 'The research didn’t come back — try again';
      } else if(!p.aspects.length && !picked(p).length){
        say('Picking ideas that fit your project and work together…');
        const n = await dzSuggestPicks(k, p);
        for(const i of picked(p).slice(0, 6)) await go(`${tplSel(w, p)} [data-dz-act="pick"][data-id="${i.id}"]`);
        text = n ? `Suggested ${n} idea${n === 1 ? '' : 's'} — change any, then combine them` : 'No suggestion came back — pick the ideas yourself';
      } else if(!hasLogic(p)){
        say(`Combining your ${picked(p).length} ideas into one logic…`);
        await go(`${tplSel(w, p)} [data-dz-act="combine"]`);
        const job = dzCombine(k, p.key); await go(`section[data-wid="ldoc-${p.key}"]`); await job;
        text = hasLogic(p) ? 'Combined your ideas into a logic document — edit it, or ask for changes' : 'Combining didn’t work — try again';
      } else if(openQs(p).length){
        await go(`section[data-wid="ldoc-${p.key}"] .dz-qs`);
        text = `${openQs(p).length === 1 ? 'One question is' : `${openQs(p).length} questions are`} yours to answer — see the logic document`;
      } else {
        say('Checking the logic for gaps and conflicts…');
        await go(`section[data-wid="ldoc-${p.key}"] [data-dz-act="check"]`);
        await dzCheck(k, p.key);
        const n = p.check ? p.check.points.length : 0;
        text = n ? `Found ${n} thing${n === 1 ? '' : 's'} to look at — see the logic document` : 'No gaps or conflicts found';
      }
    } catch(err){ console.error('[Design help]', err); text = `That didn’t work — ${aiErr(err)}`; }
    finally { p.helping = false; if(XC.run === run) XC.run = null; cv.aiLast = { text, step: w.step, run: true }; if(typeof xcCursorHome === 'function') xcCursorHome(); xcSnack(); redraw(k); }
  }

  // ---------- the part template: three collapsible stages ----------
  // A stage header is a button that folds it; folded, it says in one line what is inside.
  function stage(p, key, n, title, sub, body, summary){
    const open = !p.fold[key];
    return `<div class="dz-stage${open ? '' : ' is-folded'}"><button type="button" class="dz-stage-h dz-fold" data-dz-act="fold" data-p="${p.key}" data-s="${key}" aria-expanded="${open}"><span class="dz-stage-n">${n}</span>${title}<span class="dz-stage-sub">${open ? sub : summary}</span><span class="dz-fold-i" aria-hidden="true">${open ? '▾' : '▸'}</span></button>${open ? body : ''}</div>`;
  }
  function researchHtml(w, p, ro){
    const d = dz(w), done = p.games.filter(x => x.state === 'done').length;
    const row = g => `<li class="dz-rrow"><span class="dz-rrow-n">${g.state === 'busy' ? radar() : g.state === 'done' ? (typeof IP_CHECK_ICO !== 'undefined' ? IP_CHECK_ICO : '✓') : ''}<b>${E(g.name)}</b>${g.why && g.state === 'idle' ? `<span class="dz-rrow-why">${E(g.why)}</span>` : ''}</span>
      ${g.state === 'done' ? tag('ok', 'Researched') : g.state === 'busy' ? '<span class="dz-rrow-s">Researching…</span>' : g.state === 'error' ? tag('err', 'Failed') : '<span class="dz-rrow-s">Not yet</span>'}
      ${g.state === 'idle' ? (ro ? '' : `<button type="button" class="ip-mini ip-mini-ai" data-dz-act="research" data-p="${p.key}" data-id="${g.id}">Research</button>`)
        : `${g.state === 'error' && !ro ? `<button type="button" class="ip-mini" data-dz-act="research" data-p="${p.key}" data-id="${g.id}">Try again</button>` : ''}<button type="button" class="ip-mini" data-dz-act="show" data-show="doc-${g.id}">Show on canvas</button>`}</li>`;
    const body = `${p.games.length ? `<ul class="dz-rlist">${p.games.map(row).join('')}</ul>` : p.suggBusy ? `<div class="xc-busy" role="status">${radar()}Finding ${E(d.refNouns)} worth studying…</div>` : `<p class="dz-empty">No ${E(d.refNouns)} to study yet.${ro ? '' : ` <button type="button" class="ip-mini ip-mini-ai" data-dz-act="suggest" data-p="${p.key}">Suggest ${E(d.refNouns)} to study</button>`}</p>`}
      ${done ? '<p class="dz-hint">The documents are on the canvas, left of the first template. Drag a section by its heading, or a key idea, onto this template — or select any text in a document.</p>' : ''}
      ${p.suggErr ? `<p class="dz-hint">${E(p.suggErr)}</p>` : ''}
      ${ro ? '' : `<div class="ip-row-actions">${p.games.length ? `<button type="button" class="ip-mini ip-mini-ai" data-dz-act="suggest" data-p="${p.key}"${p.suggBusy ? ' disabled' : ''}>${p.suggBusy ? spin() : ''}Suggest more ${E(d.refNouns)}</button>` : ''}
        <form class="rs-add dz-add" data-dz-add="game" data-p="${p.key}"><input class="ip-field rs-add-input" type="text" placeholder="Research another ${E(d.refNoun)}…" aria-label="Research another ${E(d.refNoun)}"><button type="submit" class="ip-mini">Research</button></form></div>`}`;
    return stage(p, 'research', 1, 'How others do it', `${done} of ${p.games.length} researched · each is a document on the canvas`, body, `${done} of ${p.games.length} researched`);
  }
  function ideaCard(p, i, ro){
    return `<li><button type="button" class="dz-idea${i.picked ? ' is-on' : ''}"${ro ? '' : ` data-dz-drag="pick:${p.key}:${i.id}:" title="Pick it — or drag it onto the canvas"`} data-dz-act="pick" data-p="${p.key}" data-id="${i.id}" aria-pressed="${!!i.picked}"${ro ? ' disabled' : ''}><span class="dz-idea-box" aria-hidden="true">${i.picked ? '✓' : ''}</span><span class="dz-idea-t"><b>${E(i.title)}</b>${i.detail ? `<span>${E(xcTr(i.detail, 160))}</span>` : ''}${i.byAi && i.picked ? `<span class="dz-idea-ai">✦ Suggested by AI${i.aiWhy ? ` — ${E(i.aiWhy)}` : ''}</span>` : ''}</span></button></li>`;
  }
  function ideasHtml(w, p, ro){
    const srcs = [...new Set(p.ownIdeas.map(i => i.src || ''))];
    const groups = p.games.map(g => ({ name: g.name, ideas: g.ideas.concat(p.ownIdeas.filter(i => i.src === g.name)) })).concat(srcs.filter(x => !p.games.some(g => g.name === x)).map(x => ({ name: x || 'Your ideas', ideas: p.ownIdeas.filter(i => (i.src || '') === x) }))).filter(gr => gr.ideas.length);
    const n = picked(p).length, all = allIdeas(p).length;
    const body = `${groups.length ? groups.map(gr => `<div class="dz-ideagrp"><p class="dz-ideagrp-h">${E(gr.name)}</p><ul class="dz-ideas">${gr.ideas.map(i => ideaCard(p, i, ro)).join('')}</ul></div>`).join('') : `<p class="dz-empty">${p.games.some(g => g.state === 'busy') ? 'Ideas appear here as each document comes in.' : 'Research a reference above — each document ends with key ideas worth borrowing.'}</p>`}
      ${p.pickBusy ? `<div class="xc-busy" role="status">${spin()}Picking ideas that work together…</div>` : ''}`;
    const opt = p.aspects.length > 0; // with choices to settle, borrowing ideas is optional
    return stage(p, 'ideas', opt ? 3 : 2, opt ? 'Borrow ideas (optional)' : 'Pick ideas', n ? `${n} of ${all} picked — they collect in “Your logic” below` : opt ? 'Anything else from the research you want in your logic' : 'Pick the ones you want to build from — from any document', body, `${n} of ${all} picked`);
  }
  // Your logic: a drop area holding the picked ideas, and the button that combines them into the logic document
  function logicHtml(w, p, ro){
    const ideas = picked(p), n = ideas.length, L = p.logic;
    const changed = hasLogic(p) && (n !== L.from.length || ideas.some(i => !L.from.includes(i.id)) || (p.aspects.length > 0 && (L.dec || '') !== decisionsText(p).join('|')));
    const cards = ideas.map(i => `<li class="dz-pk"><span class="dz-pk-t"${ro ? '' : ` data-dz-drag="pick:${p.key}:${i.id}:" title="Drag it onto the canvas or another template"`}><b>${E(i.title)}</b><span>${E(i.from)}</span></span>${ro ? '' : `<button type="button" class="ip-link" data-dz-act="pick" data-p="${p.key}" data-id="${i.id}" aria-label="Take ${E(i.title)} out">Take out</button>`}</li>`).join('');
    const body = `<div class="dz-drop" data-zone="dzlogic:${p.key}" data-drop="${E(p.label)} — your logic">
        ${n ? `<ul class="dz-pks">${cards}</ul>` : '<p class="dz-drop-empty">Drag key ideas, document sections or your sticky notes here — or pick ideas above.</p>'}</div>
      ${ro ? '' : `<form class="rs-add dz-add dz-ownidea" data-dz-add="idea" data-p="${p.key}"><input class="ip-field rs-add-input" type="text" placeholder="Add your own idea…" aria-label="Add your own idea"><button type="submit" class="ip-mini">Add</button></form>`}
      ${L.err ? `<div class="banner ex-banner" role="alert">${E(L.err)}${ro ? '' : ` <button type="button" class="ip-mini" data-dz-act="combine" data-p="${p.key}">Try again</button>`}</div>` : ''}
      ${L.busy ? `<div class="xc-busy" role="status">${spin()}Combining ${n} idea${n === 1 ? '' : 's'} into one logic…</div>` : ''}
      ${ro || L.busy ? '' : `<div class="ip-row-actions">${!hasLogic(p) ? `<button type="button" class="btn ip-btn-sm" data-dz-act="combine" data-p="${p.key}"${canCombine(p) ? '' : ' disabled'}>${p.aspects.length ? 'Write my logic' : 'Combine into my logic'}</button>`
        : `${changed ? `<button type="button" class="btn ip-btn-sm" data-dz-act="combine" data-p="${p.key}"${canCombine(p) ? '' : ' disabled'}>${p.aspects.length ? 'Update my logic' : 'Update my logic with these ideas'}</button>` : ''}<button type="button" class="ip-mini" data-dz-act="show" data-show="ldoc-${p.key}">Open the logic document</button>`}</div>`}
      ${!ro && !settled(p) ? `<p class="dz-hint">Decide ${E(unsettled(p).map(a => a.label.toLowerCase()).join(', '))} first — step 2 above.</p>` : ''}
      ${openQs(p).length && !L.busy ? `<p class="dz-hint dz-warnline">${openQs(p).length === 1 ? 'One question' : `${openQs(p).length} questions`} in the logic document still need${openQs(p).length === 1 ? 's' : ''} your answer before this template is done.</p>` : ''}
      ${hasLogic(p) && !L.busy ? `<p class="dz-hint">${changed ? 'Your choices changed since the logic was made. ' : ''}The logic document sits right of this template — edit it there, then carry it on.</p>` : ''}`;
    return stage(p, 'logic', p.aspects.length ? 4 : 3, `Your logic${hasLogic(p) ? '' : ` ${tag('warn', 'Not combined yet')}`}`, 'The ideas you build from — drop more in, then combine', body, hasLogic(p) ? `Logic ready · ${n} idea${n === 1 ? '' : 's'}` : `${n} idea${n === 1 ? '' : 's'} · not combined yet`);
  }
  function dzSecHtml(k, sec, ro, preview){
    const w = exRsW(k), p = partOfStep(w, sec.key); if(!p) return '';
    const state = preview ? 'open' : xcSecState(w, sec.i, ro), r = ro || preview;
    if(!r && p.aspects.length && !p.optsAsked){ p.optsAsked = true; setTimeout(() => dzOptions(k, p.key), 0); } // a part opened before choices existed
    const n = `<span class="xc-sec-n">${state === 'done' ? IP_CHECK_ICO : (sec.n || sec.i + 1)}</span>`;
    const count = `<span class="xc-count${partDone(p) ? ' is-met' : ''}">${partDone(p) ? 'Logic ready' : `${picked(p).length} idea${picked(p).length === 1 ? '' : 's'} picked`}</span>`;
    const fix = state === 'current' && w.fixFor ? `<div class="xc-fix" role="status"><b>Needed for done:</b> ${E(w.fixFor.text)}${w.fixFor.note ? ` — ${E(w.fixFor.note)}` : ''}</div>` : '';
    return `<div class="xc-sec xc-sec--${state} dz-sec" id="xc-sec-${sec.key}" data-sec="${sec.key}">
      <div class="xc-sec-h">${n}<span class="xc-sec-t">${E(sec.label)}</span>${count}</div>${fix}
      ${p.question ? `<p class="xc-lead">${E(p.question)}${p.aspects.length ? ` <span class="dz-covers">Must settle: ${p.aspects.map(a => E(a.label)).join(' · ')}</span>` : ''}</p>` : ''}
      ${researchHtml(w, p, r)}${settleHtml(w, p, r)}${ideasHtml(w, p, r)}${logicHtml(w, p, r)}
      ${state === 'current' && !preview ? xcContinue(k) : ''}</div>`;
  }

  // ---------- canvas components: research documents and logic documents ----------
  function wid(w, id, def){ const cv = xcCv(w); return cv.wid[id] || (cv.wid[id] = Object.assign({ collapsed: false, hidden: false }, def)); }
  const head = (id, title, sub, extra, wd) => `<div class="xc-w-h" data-whead="${id}"><span class="xc-w-t">${DOC_ICO}${title}</span><span class="xc-w-sub">${sub}</span><span class="xc-sp"></span>${extra}
      ${wd.collapsed ? '' : `<button type="button" class="xc-icon-btn dz-full-btn" data-dz-act="full" data-wid="${id}" title="Full screen" aria-label="Open full screen">⤢</button>`}
      <button type="button" class="xc-icon-btn" data-xc-act="collapse" data-wid="${id}" aria-label="${wd.collapsed ? 'Expand' : 'Collapse'}" aria-expanded="${!wd.collapsed}">${wd.collapsed ? '▸' : '▾'}</button></div>`;
  const pdfBtn = (what, p, id) => `<button type="button" class="xc-icon-btn dz-pdf" data-dz-act="pdf" data-what="${what}" data-p="${p}" data-id="${id || ''}" title="Export as PDF" aria-label="Export as PDF">${PDF_ICO}</button>`;
  function docHtml(k, w, p, pi, g, ro){
    const id = 'doc-' + g.id, wd = wid(w, id, { x: 0, y: 0, w: DOC_W, h: DOC_H, auto: true }), view = g.view === 'ideas' ? 'ideas' : 'doc'; // auto: placed under its template (placeDocs)
    const extra = g.state === 'done' ? `<span class="dz-seg" role="group" aria-label="View"><button type="button" class="${view === 'doc' ? 'is-on' : ''}" aria-pressed="${view === 'doc'}" data-dz-act="view" data-v="doc" data-p="${p.key}" data-id="${g.id}">Document</button><button type="button" class="${view === 'ideas' ? 'is-on' : ''}" aria-pressed="${view === 'ideas'}" data-dz-act="view" data-v="ideas" data-p="${p.key}" data-id="${g.id}">Key ideas · ${g.ideas.length}</button></span>${pdfBtn('doc', p.key, g.id)}` : '';
    let body;
    if(g.state === 'busy') body = `<div class="xc-busy" role="status">${radar()}Researching how ${E(g.name)} does ${E(p.label.toLowerCase())} — reading the web and writing it up…</div><div class="xc-skel"><i style="width:45%"></i><i></i><i style="width:85%"></i><i style="width:70%"></i><i></i><i style="width:60%"></i></div>`;
    else if(g.state === 'error') body = `<div class="banner ex-banner" role="alert">${E(g.err)}${ro ? '' : ` <button type="button" class="ip-mini" data-dz-act="research" data-p="${p.key}" data-id="${g.id}">Try again</button>`}</div>`;
    else if(view === 'ideas') body = `<p class="dz-hint">Drag an idea by its title onto a template, or add it to ${E(p.label)}.</p><ul class="dz-kideas">${g.ideas.map(i => `<li class="dz-kidea${i.picked ? ' is-on' : ''}"><div class="dz-drag-h" data-dz-drag="idea:${p.key}:${g.id}:${i.id}" title="Drag onto a template"><b>${E(i.title)}</b></div>${i.detail ? `<p>${E(i.detail)}</p>` : ''}
        ${ro ? '' : `<button type="button" class="ip-mini" data-dz-act="pick" data-p="${p.key}" data-id="${i.id}" aria-pressed="${!!i.picked}">${i.picked ? `✓ In ${E(p.label)}` : `Add to ${E(p.label)}`}</button>`}</li>`).join('')}</ul>`;
    else {
      const imgs = (g.images || []).map(im => `<figure class="dz-img"><img src="${E(im.url)}" alt="${E(im.title || g.name)}" loading="lazy" onerror="this.closest('figure').remove()"><figcaption><a href="${E(im.href || im.url)}" target="_blank" rel="noopener">${E(im.credit || rsDomain(im.url))}</a></figcaption></figure>`).join('');
      body = `${g.live === false ? '<p class="dz-hint dz-warnline">Web search is off, so this comes from the AI’s general knowledge, not checked against sources.</p>' : ''}
        ${imgs ? `<div class="dz-imgs">${imgs}</div>` : ''}
        ${sectionsOf(g.md).map((s, i) => `<section class="dz-docsec"><div class="dz-docsec-h"><span class="dz-drag-h" data-dz-drag="sec:${p.key}:${g.id}:${i}" title="Drag this section onto a template">${E(s.full)}</span>${allIdeas(p).some(x => x.secKey === `${g.id}:${i}`) ? `<span class="dz-insec">In ${E(p.label)}</span>` : ''}</div>
            <div class="dz-docsec-b answer-display">${citeHtml(renderMarkdownToHtml(s.body), g.sources)}</div>${moreHtml(g, i)}</section>`).join('')}
        ${moreHtml(g, -1)}
        ${srcList(g.sources) || (g.live ? '<p class="dz-hint">The search returned no pages for this — treat it as unchecked.</p>' : '')}`;
    }
    return `<section class="xc-w dz-docw${wd.collapsed ? ' xc-w--collapsed' : ''}" data-wid="${id}" data-dz-doc="${p.key}:${g.id}" style="left:${wd.x}px;top:${wd.y}px;width:${wd.w || DOC_W}px;${wd.collapsed ? '' : `height:${wd.h || DOC_H}px;`}" aria-label="Research document: ${E(g.name)}, ${E(p.label)}">
      ${head(id, E(g.name), `Research · ${E(p.label)}${g.sources.length ? ` · ${g.sources.length} source${g.sources.length === 1 ? '' : 's'}` : ''}`, extra, wd)}${wd.collapsed ? '' : `<div class="xc-w-b dz-docw-b xc-scroll">${body}</div><span class="xc-w-grip" data-xc-grip="${id}" title="Drag to resize" aria-hidden="true"></span>`}</section>`;
  }
  function moreHtml(g, at){
    return (g.more || []).filter(m => m.at === at).map(m => `<div class="dz-more"><p class="dz-more-h">Explored further${m.about ? `: <span>${E(xcTr(m.about, 80))}</span>` : ''}</p>
      ${m.state === 'busy' ? `<div class="xc-busy" role="status">${radar()}Researching this in more depth…</div>` : m.state === 'error' ? `<div class="banner ex-banner" role="alert">${E(m.err)}</div>`
        : `<div class="answer-display">${citeHtml(renderMarkdownToHtml(m.md), m.sources)}</div>${m.sources.length ? `<p class="dz-hint">Sources: ${m.sources.map((s, n) => `<a href="${E(s.url)}" target="_blank" rel="noopener">[${n + 1}] ${E(rsDomain(s.url))}</a>`).join(' · ')}</p>` : ''}`}</div>`).join('');
  }
  // the logic document: between this part's template and the next, joined by the AI lines.
  // Edited inline (click anywhere in the text); the actions sit in a footer that is always visible.
  function ldocHtml(k, w, p, pi, ro){
    const id = 'ldoc-' + p.key, parts = dz(w).parts, next = parts[pi + 1];
    const wd = wid(w, id, { x: 0, y: 320, w: LDOC_W, h: LDOC_H, auto: true });
    const L = p.logic, c = p.check, open = c ? c.points.filter(x => !x.off) : [], isCur = curPart(w) === p, n = picked(p).length, locked = xcSecState(w, pi, ro) === 'locked';
    const from = allIdeas(p).filter(i => L.from.includes(i.id)), empty = !hasLogic(p);
    let body, foot = '';
    if(empty && !L.busy) body = `<div class="dz-ldoc-ph"><p><b>Your ${E(p.label.toLowerCase())} logic will appear here.</b></p><p>${locked ? `It opens after the parts before it.` : p.aspects.length ? `Decide what must be settled on the template, then press <b>Write my logic</b>.` : `Take ideas from the research into “Your logic” on the template, then press <b>Combine into my logic</b>.`}</p></div>`;
    else if(empty) body = `<div class="xc-busy" role="status">${spin()}Combining ${n} idea${n === 1 ? '' : 's'} into one logic…</div><div class="xc-skel"><i style="width:55%"></i><i></i><i style="width:80%"></i><i></i></div>`;
    else {
      const editable = !ro && !L.busy;
      body = `${L.busy ? `<div class="xc-busy" role="status">${spin()}${p.cascade ? `Updating it to match the ${E(p.cascade)} logic…` : 'Updating the logic…'}</div>` : ''}
        ${decidedHtml(p)}
        ${from.length ? `<p class="dz-insp"><span>Built from</span>${from.map(i => `<span class="dz-chip" title="${E(i.from)}">${E(i.title)}</span>`).join('')}</p>` : ''}
        <article class="dz-doc dz-logic answer-display${editable ? ' is-editable' : ''}"${editable ? ` contenteditable="true" spellcheck="true" data-dz-ed="${p.key}" aria-label="Your ${E(p.label)} logic — click to edit"` : ''}>${renderMarkdownToHtml(L.md)}</article>
        ${editable ? '<p class="dz-hint">Click anywhere in the text to edit it.</p>' : ''}
        ${qsHtml(p, ro)}
        ${p.checkBusy ? `<div class="xc-busy" role="status">${spin()}Reading the logic${others(w, p).length ? ' and the other parts' : ''}…</div>` : ''}
        ${c && c.err ? `<div class="banner ex-banner" role="alert">${E(c.err)} <button type="button" class="ip-mini" data-dz-act="check" data-p="${p.key}">Try again</button></div>` : ''}
        ${c && !c.err && !p.checkBusy ? (open.length ? `<ul class="dz-points" aria-label="Points to look at">${open.map(x => `<li class="dz-pt">${tag(x.kind === 'conflict' ? 'err' : 'warn', x.kind === 'conflict' ? 'Conflict' : 'Gap')}<span class="dz-pt-t">${E(x.text)}</span>${ro ? '' : `<button type="button" class="ip-link" data-dz-act="fix" data-p="${p.key}" data-id="${x.id}">Fix it</button><button type="button" class="ip-link" data-dz-act="dismiss" data-p="${p.key}" data-id="${x.id}">Dismiss</button>`}</li>`).join('')}</ul>` : `<p class="dz-ok">${c.points.length ? 'All points dismissed.' : 'No gaps or conflicts found.'}</p>`) + (c.stale ? '<p class="dz-hint">The logic changed since this check — run it again to be sure.</p>' : '') : ''}`;
      if(!ro) foot = `<div class="dz-ldoc-foot">
          <form class="dz-instr" data-dz-add="instr" data-p="${p.key}"><input class="ip-field" type="text" placeholder="Ask for a change — e.g. make rare ones rarer at night" aria-label="Ask for a change to the logic"${L.busy ? ' disabled' : ''}><button type="submit" class="ip-mini ip-mini-ai"${L.busy ? ' disabled' : ''}>Update</button></form>
          <div class="dz-ldoc-acts"><button type="button" class="ip-mini" data-dz-act="check" data-p="${p.key}"${p.checkBusy || L.busy ? ' disabled' : ''}>Check for gaps</button><span class="xc-sp"></span>
            ${isCur ? `<button type="button" class="btn ip-btn-sm" data-dz-act="carry" data-p="${p.key}"${L.busy || !partDone(p) ? ' disabled' : ''}${openQs(p).length ? ' title="Answer the open questions first"' : ''}>${next ? `Looks right — carry into ${E(next.label)} →` : 'Looks right — go to the Result →'}</button>` : `<span class="dz-hint">${parts.indexOf(curPart(w) || p) > pi ? `Carried into ${E((next || p).label)} — edits here update the parts after it.` : ''}</span>`}</div></div>`;
    }
    return `<section class="xc-w dz-docw dz-ldocw${empty && !L.busy ? ' dz-ldocw--empty' : ''}${L.busy ? ' xc-w--loading' : ''}${wd.collapsed ? ' xc-w--collapsed' : ''}" data-wid="${id}" style="left:${wd.x}px;top:${wd.y}px;width:${wd.w || LDOC_W}px;${wd.collapsed ? '' : `height:${wd.h || LDOC_H}px;`}" aria-label="Logic document: ${E(p.label)}"${L.busy ? ' aria-busy="true"' : ''}>
      ${head(id, `${E(p.label)} logic`, empty ? 'Not combined yet' : `Your logic · ${from.length} idea${from.length === 1 ? '' : 's'}${L.at ? ` · ${E(new Date(L.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}` : ''}`, hasLogic(p) ? pdfBtn('logic', p.key) : '', wd)}${wd.collapsed ? '' : `<div class="xc-w-b dz-docw-b xc-scroll">${body}</div>${foot}<span class="xc-w-grip" data-xc-grip="${id}" title="Drag to resize" aria-hidden="true"></span>`}</section>`;
  }
  // the AI lines: template → its logic document → the next template (or straight on, before a logic exists)
  function flowLab(from, to, t, sub, later, live){
    return `<div class="xc-flow${later ? ' xc-flow--later' : ''}${live ? ' is-carrying' : ''}" data-flow="${from}>${to}" role="note" aria-label="${E(t)} — ${E(sub.replace(/<[^>]+>/g, ''))}"><span class="xc-flow-in"><span class="xc-flow-t">✦ ${E(t)}</span><span class="xc-flow-to">${sub}</span></span></div>`;
  }
  // Every part always has its logic document on the canvas (a placeholder until combined), so the lines are always
  // template → logic document → next template, and nothing moves when a logic is made (user test).
  function dzFlows(k, w){
    const parts = dz(w).parts, ro = exState(k).done;
    return parts.map((p, i) => { const next = parts[i + 1], nextOpen = next && xcSecState(w, i + 1, ro) !== 'locked', n = picked(p).length;
      return flowLab(parts.length > 1 ? 'dz-' + p.key : '@tpl', '@ldoc-' + p.key, p.aspects.length ? `Your ${p.aspects.length} decision${p.aspects.length === 1 ? '' : 's'}${n ? ` + ${n} idea${n === 1 ? '' : 's'}` : ''}` : n ? `${n} picked idea${n === 1 ? '' : 's'}` : 'Your picked ideas', p.logic.busy ? 'AI is writing your logic…' : p.aspects.length ? 'AI writes your logic from them' : 'AI combines them into your logic', !hasLogic(p) && !p.logic.busy, p.logic.busy)
        + (next ? flowLab('@ldoc-' + p.key, 'dz-' + next.key, `Your ${p.label.toLowerCase()} logic`, next.logic.busy && next.cascade ? `is updating <b>${E(next.label)}</b>…` : `carries into <b>${E(next.label)}</b>`, !nextOpen || !hasLogic(p), !!(next.logic.busy && next.cascade)) : ''); }).join('');
  }
  function dzCanvasHtml(k){
    const w = exRsW(k), ro = exState(k).done, parts = dz(w).parts;
    return parts.map((p, pi) => p.games.filter(g => g.state !== 'idle').map(g => docHtml(k, w, p, pi, g, ro)).join('')).join('')
      + parts.map((p, pi) => ldocHtml(k, w, p, pi, ro)).join('') + dzFlows(k, w);
  }
  // Components not moved by the user follow their template: its logic document right of it (top-aligned), its research
  // documents in two columns under it (user test: on step 3 the research was far away, left of the first template).
  function placeLdocs(){
    const k = EX.cur, w = k && exRsW(k); if(!w || w.mode !== 'design') return false;
    const world = xcWorld(), cv = xcCv(w); let moved = false;
    const put = (wd, el, x, y) => { if(wd.x !== x || wd.y !== y){ wd.x = x; wd.y = y; el.style.left = x + 'px'; el.style.top = y + 'px'; moved = true; } };
    dz(w).parts.forEach(p => { const t = world.querySelector(tplSel(w, p)); if(!t) return;
      const wd = cv.wid['ldoc-' + p.key], el = world.querySelector(`section[data-wid="ldoc-${p.key}"]`);
      if(wd && wd.auto && el) put(wd, el, t.offsetLeft + t.offsetWidth + XC_FLOW_W, t.offsetTop);
      p.games.filter(g => g.state !== 'idle').forEach((g, j) => { const dw = cv.wid['doc-' + g.id], de = world.querySelector(`section[data-wid="doc-${g.id}"]`); if(!dw || !dw.auto || !de) return;
        put(dw, de, t.offsetLeft + (j % 2) * (DOC_W + 40), t.offsetTop + t.offsetHeight + 140 + Math.floor(j / 2) * (DOC_H + 40)); }); });
    return moved;
  }
  // Lines from each research document to its template: grey = linked (it was researched for this template),
  // AI colour = some of its ideas are in the template's logic. From the document's top to the template's bottom.
  function drawDocLines(){
    const k = EX.cur, w = k && exRsW(k); if(!w || w.mode !== 'design' || typeof xcFlowLine !== 'function') return;
    const world = xcWorld(), svg = world.querySelector('#xc-flowsvg');
    world.querySelectorAll(':scope > .dz-docline').forEach(el => el.remove());
    dz(w).parts.forEach(p => { const t = world.querySelector(tplSel(w, p)); if(!t) return;
      const used = new Set(picked(p).map(i => i.from)), T = xcBox(t);
      p.games.filter(g => g.state !== 'idle').forEach(g => { const d = world.querySelector(`section[data-wid="doc-${g.id}"]`); if(!d) return; const D = xcBox(d);
        const below = D.y > T.y + T.h, cx = D.x + D.w / 2;
        const p1 = below ? { x: cx, y: D.y } : { x: D.x + D.w < T.x ? D.x + D.w : D.x, y: D.y + 40 };
        const p2 = below ? { x: Math.max(T.x + 40, Math.min(T.x + T.w - 40, cx)), y: T.y + T.h + 2 } : { x: D.x + D.w < T.x ? T.x - 2 : T.x + T.w + 2, y: Math.min(T.y + T.h - 20, Math.max(T.y + 20, p1.y)) };
        const bend = Math.max(40, Math.abs((below ? p2.y - p1.y : p2.x - p1.x)) / 2);
        const c1 = below ? { x: p1.x, y: p1.y - bend } : { x: p1.x + Math.sign(p2.x - p1.x) * bend, y: p1.y }, c2 = below ? { x: p2.x, y: p2.y + bend } : { x: p2.x - Math.sign(p2.x - p1.x) * bend, y: p2.y };
        const on = used.has(g.name), line = xcFlowLine(p1, c1, c2, p2, !on);
        line.classList.add('dz-docline'); if(!on) line.classList.add('dz-docline--idle');
        line.title = on ? `Ideas from ${g.name} are in ${p.label}` : `${g.name} was researched for ${p.label}`;
        if(svg) world.insertBefore(line, svg); else world.appendChild(line); }); });
  }
  // ---------- a document full screen, inside the Cognitive Field ----------
  // User request: open a research or logic document over the whole canvas area to read and work in it (the Output and
  // Chat stay visible, like the graph's full screen). The canvas redraws its components from scratch, so after every
  // redraw the fresh document is moved into the full-screen layer (dzFullSync, hooked on xcRender below). Exit with the
  // bar at the top or Esc. Everything in it works as on the canvas (sections, Key ideas, Explore more, Add to …).
  const DZF = { k: null, id: null, focus: false };
  function dzFull(k, id){ DZF.k = id ? k : null; DZF.id = id || null; DZF.focus = !!id; if(!id && DZF.back){ const b = DZF.back; DZF.back = null; setTimeout(() => { const el = document.querySelector(`#xc-world [data-dz-act="full"][data-wid="${b}"]`); if(el) el.focus(); }, 0); } if(id) DZF.back = id; xcRender(); dzFullSync(); } // (xcRender syncs too; the second call covers a canvas that didn't redraw)
  function dzFullSync(){
    const wrap = document.getElementById('xc-wrap'); let layer = document.getElementById('dz-full');
    const on = DZF.id && EX.cur === DZF.k && typeof xcOn === 'function' && xcOn(EX.cur) && wrap && !wrap.classList.contains('hidden');
    const fresh = on && document.querySelector(`#xc-world section.dz-docw[data-wid="${DZF.id}"]`);
    if(!fresh && on && layer && layer.querySelector(`section.dz-docw[data-wid="${DZF.id}"]`)) return; // already full screen, no redraw since
    const doc = fresh;
    if(!doc){ if(layer) layer.remove(); if(DZF.id && EX.cur === DZF.k && on) DZF.id = null; return; } // the document is gone (or collapsed): back to the canvas
    if(!layer){ layer = document.createElement('div'); layer.id = 'dz-full'; layer.className = 'dz-full'; layer.setAttribute('role', 'dialog'); layer.setAttribute('aria-modal', 'false'); wrap.appendChild(layer); }
    layer.setAttribute('aria-label', doc.getAttribute('aria-label') || 'Document');
    layer.innerHTML = `<div class="xc-full-bar dz-full-bar"><span>${E(doc.getAttribute('aria-label') || 'Document')}</span><button type="button" data-dz-full-exit>Exit full screen</button></div>`;
    doc.classList.add('dz-docw--full'); doc.querySelectorAll('[data-whead]').forEach(h => h.removeAttribute('data-whead')); // not draggable here
    layer.appendChild(doc);
    if(DZF.focus){ DZF.focus = false; layer.querySelector('[data-dz-full-exit]').focus(); }
  }
  document.addEventListener('click', e => { if(e.target.closest && e.target.closest('[data-dz-full-exit]')) dzFull(EX.cur, null); });
  document.addEventListener('keydown', e => { if(e.key === 'Escape' && document.getElementById('dz-full') && !(typeof XC !== 'undefined' && XC.live && XC.live.full)) dzFull(EX.cur, null); });
  // choose an option of "Decide what must be settled" (from a card or a drag back onto its template)
  function dzChoose(k, opt){
    const w = exRsW(k), p = partByKey(w, opt.pk), a = p && p.aspects.find(x => x.id === opt.a); if(!a || exState(k).done) return false;
    const c = chOf(p, a), o = c.options.find(x => x.id === opt.o); if(!o) return false;
    c.pick = o.id; c.byAi = false; c.aiWhy = ''; redraw(k); nextSync(w); dzFlash(`${a.label}: “${xcTr(o.label, 40)}” chosen.`); return true;
  }
  function dzShow(k, id){ const w = exRsW(k), wd = xcCv(w).wid[id]; if(!wd) return; if(wd.collapsed){ wd.collapsed = false; xcRender(); } setTimeout(() => xcZoomWidget(id), 30); }

  // ---------- export a document as a PDF (print → Save as PDF; only the document is printed) ----------
  let pdfDone = null; // a print still being cleaned up finishes first (two exports in a row restore the page correctly)
  function dzPdf(title, kicker, html){
    if(pdfDone) pdfDone();
    document.getElementById('pdf-print')?.remove();
    const box = document.createElement('div'); box.id = 'pdf-print';
    box.innerHTML = `<p class="pdf-meta">${E(kicker)} · exported ${E(new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }))}</p><article class="answer-display rs-nodedoc dz-print"><h1>${E(title)}</h1>${html}</article>`;
    box.querySelectorAll('img').forEach(im => im.removeAttribute('loading'));
    document.body.appendChild(box);
    const root = document.documentElement, theme = root.getAttribute('data-theme'), t0 = document.title;
    root.setAttribute('data-theme', 'light'); root.classList.add('pdf-printing'); document.title = title.replace(/[\\/:*?"<>|]+/g, ' ');
    const done = () => { if(pdfDone !== done) return; pdfDone = null; window.removeEventListener('afterprint', done); root.classList.remove('pdf-printing'); if(theme) root.setAttribute('data-theme', theme); else root.removeAttribute('data-theme'); document.title = t0; box.remove(); };
    pdfDone = done; window.addEventListener('afterprint', done); window.print();
    setTimeout(() => { if(root.classList.contains('pdf-printing') && !matchMedia('print').matches) done(); }, 1500);
  }
  // on paper a [n] can't be clicked: print the site it came from next to the number, and every full address at the end
  const printCite = (html, sources) => html.replace(/\[(\d{1,2})\]/g, (m, n) => { const s = sources[+n - 1]; return s ? `<span class="dz-pcite">[${n} · ${E(rsDomain(s.url))}]</span>` : m; });
  const printSrcs = sources => sources.length ? `<h3>Sources</h3><ol class="dz-psrcs">${sources.map(s => `<li>${E(s.title || rsDomain(s.url))}<br><span>${E(s.url)}</span></li>`).join('')}</ol>` : '';
  function dzExport(w, what, pk, gid){
    const p = partByKey(w, pk); if(!p) return;
    if(what === 'logic'){ const from = allIdeas(p).filter(i => p.logic.from.includes(i.id));
      const used = p.games.filter(g => g.state === 'done' && from.some(i => i.from === g.name)), srcs = []; used.forEach(g => g.sources.forEach(x => { if(!srcs.some(y => y.url === x.url)) srcs.push({ url: x.url, title: `${g.name} — ${x.title || rsDomain(x.url)}` }); }));
      return dzPdf(`${exStep(EX.cur).title} — ${p.label} logic`, `Logic document · ${p.label}`, renderMarkdownToHtml(p.logic.md) + (from.length ? `<h3>Ideas it was built from</h3><ul>${from.map(i => `<li><b>${E(i.title)}</b> — ${E(i.from)}</li>`).join('')}</ul>` : '') + (srcs.length ? printSrcs(srcs).replace('<h3>Sources</h3>', '<h3>Research it draws on</h3>') : '')); }
    const g = p.games.find(x => x.id === gid); if(!g) return;
    const imgs = (g.images || []).map(im => `<figure class="dz-img"><img src="${E(im.url)}" alt="${E(im.title || g.name)}"><figcaption>${E(im.credit || '')}</figcaption></figure>`).join('');
    const more = (g.more || []).filter(m => m.state === 'done'), extra = [];
    more.forEach(m => m.sources.forEach(x => { if(!g.sources.some(y => y.url === x.url) && !extra.some(y => y.url === x.url)) extra.push(x); }));
    dzPdf(`${g.name} — ${p.label}`, `Research document · ${p.label}`, `${imgs ? `<div class="dz-imgs">${imgs}</div>` : ''}${printCite(renderMarkdownToHtml(g.md), g.sources)}${more.map(m => `<h3>Explored further: ${E(xcTr(m.about, 90))}</h3>${printCite(renderMarkdownToHtml(m.md), m.sources)}`).join('')}${printSrcs(g.sources.concat(extra))}`);
  }

  // ---------- the part in the Output panel ----------
  function dzPanelHtml(k, p){
    const done = p.games.filter(g => g.state === 'done');
    return `<div class="dz-out">
      <p class="dz-stage-h">Your logic</p>${decidedHtml(p)}${hasLogic(p) ? `<article class="dz-doc answer-display">${renderMarkdownToHtml(p.logic.md)}</article>` : `<p class="dz-empty">Not combined yet — ${picked(p).length ? `${picked(p).length} idea${picked(p).length === 1 ? '' : 's'} picked on the canvas.` : 'pick ideas on the canvas.'}</p>`}
      ${done.length ? `<p class="dz-stage-h">Research</p>${done.map(g => `<details class="rs-acc dz-out-refs"><summary>${E(g.name)}${g.sources.length ? ` · ${g.sources.length} source${g.sources.length === 1 ? '' : 's'}` : ''}</summary><article class="dz-doc answer-display">${citeHtml(renderMarkdownToHtml(g.md), g.sources)}</article></details>`).join('')}` : ''}
    </div>`;
  }

  // ---------- result: the rulebook ----------
  const demote = md => md.replace(/^(#{1,5})\s/gm, (m, h) => '#'.repeat(Math.min(6, h.length + 1)) + ' ');
  function dzMd(k){
    const w = exRsW(k), s = exStep(k), d = dz(w), L = [`# ${s.title}`, ''], srcs = [];
    d.parts.forEach((p, i) => {
      L.push(`## ${i + 1}. ${p.label}`, '');
      if(decisionsText(p).length) L.push('**Decided:**', ...decisionsText(p).map(x => `- ${x}`), '');
      L.push(hasLogic(p) ? demote(p.logic.md.trim()) : '*Not designed yet.*', '');
      p.games.filter(g => g.state === 'done').forEach(g => g.sources.forEach(x => { if(!srcs.some(y => y.url === x.url)) srcs.push({ title: `${g.name} (${p.label}) — ${x.title}`, url: x.url }); }));
    });
    if(srcs.length){ L.push('## Research sources', ''); srcs.forEach(x => L.push(`- ${x.title} — ${x.url}`)); }
    return L.join('\n').trim();
  }
  const dzCompose = k => dz(exRsW(k)).parts.map(p => `${p.label}:\n${decisionsText(p).length ? `Decided: ${decisionsText(p).join('; ')}\n` : ''}${hasLogic(p) ? p.logic.md.trim().slice(0, 1800) : '(not designed yet)'}`).join('\n\n');
  function dzHero(k){
    const d = dz(exRsW(k));
    return `<div class="rs-final-hero"><p class="rs-final-k">Rulebook</p><ul class="rs-hero-list">${d.parts.map(p => { const from = [...new Set(picked(p).map(i => i.from))]; return `<li><b>${E(p.label)}</b> — ${hasLogic(p) ? `${picked(p).length} idea${picked(p).length === 1 ? '' : 's'} combined${from.length ? ` from ${E(from.join(', '))}` : ''}` : 'not designed yet'}</li>`; }).join('')}</ul></div>`;
  }

  // ---------- wrap the shared functions ----------
  const W = (name, fn) => { const orig = window[name]; if(typeof orig !== 'function') return; window[name] = function(){ return fn.call(this, orig, arguments); }; };
  const isDesign = w => !!(w && w.mode === 'design' && w.design);
  W('exRsSteps', (o, a) => { const w = a[0]; return isDesign(w) ? dz(w).parts.map(p => ({ key: 'dz-' + p.key, label: p.label })).concat({ key: 'result', label: 'Result' }) : o.apply(null, a); });
  W('exRsStepDone', (o, a) => { const [w, key] = a; if(isDesign(w) && isDz(key)){ const p = partOfStep(w, key); return !!p && partDone(p); } return o.apply(null, a); });
  W('exRsBlocker', (o, a) => { const w = a[0], p = isDesign(w) && curPart(w); if(!p) return o.apply(null, a);
    if(p.logic.busy) return 'Writing your logic…';
    if(unsettled(p).length) return `Decide ${unsettled(p).map(a => a.label.toLowerCase()).join(', ')} first.`;
    if(hasLogic(p) && openQs(p).length) return `Answer the ${openQs(p).length === 1 ? 'open question' : `${openQs(p).length} open questions`} in the logic document.`;
    return p.aspects.length ? 'Press “Write my logic”.' : picked(p).length ? 'Combine your picked ideas into your logic.' : p.games.some(g => g.state === 'done') ? 'Take ideas from the research documents, then combine them.' : 'Research how others do it, then pick ideas.'; });
  W('xcSecHtml', (o, a) => { const [k, sec, ro, preview] = a, w = exRsW(k);
    if(!isDesign(w) || !isDz(sec.key)) return o.apply(null, a);
    if(!preview && xcSecState(w, sec.i, ro) === 'locked') return o.apply(null, a); // its locked look (calls back here for the preview)
    return dzSecHtml(k, sec, ro, preview); });
  W('xcFlowHtml', (o, a) => isDesign(a[0]) ? '' : o.apply(null, a)); // Design draws its own lines (through the logic documents)
  W('xcRender', (o, a) => { const r = o.apply(null, a); dzFullSync(); return r; });
  // A card (or post-it) put on a Design template — "Add to template", or dropped on it: an option card chooses its option
  // on its own part; anything else becomes a picked idea of the part it lands on (the logic area), else the current part.
  W('xcAddObj', (o, a) => {
    const [obj, zoneKey] = a, k = EX.cur, w = k && exRsW(k); if(!isDesign(w)) return o.apply(null, a);
    const pk = zoneKey && String(zoneKey).startsWith('dzlogic:') ? String(zoneKey).slice(8) : (curPart(w) || {}).key; if(!pk) return;
    const cv = xcCv(w), card = (cv.cards || []).find(c => c.dz && c.label === obj.label);
    const ok = card && card.dz.opt && card.dz.opt.pk === pk ? dzChoose(k, card.dz.opt)
      : dzAddTo(k, pk, { title: obj.label, detail: obj.detail || '', src: obj.fromNode || 'Canvas', ideaId: card && card.dz.pick ? card.dz.pick.id : '' });
    if(ok && card){ cv.cards = cv.cards.filter(c => c !== card); xcRender(); }
  });
  // "Show on template" on a card made from a Design choice: go to its part's template
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-xc-act="card-tpl"]'); if(!b || !EX.cur) return;
    const w = exRsW(EX.cur), c = isDesign(w) && (xcCv(w).cards || []).find(x => x.id === b.dataset.id); if(!c || !c.dz) return;
    e.stopPropagation(); const pk = (c.dz.opt || c.dz.pick).pk;
    if(typeof xcPanToSec === 'function') xcPanToSec('dz-' + pk);
    const el = document.getElementById('xc-sec-dz-' + pk); if(el){ el.classList.remove('xc-flash'); void el.offsetWidth; el.classList.add('xc-flash'); }
  }, true); // keep a full-screen document full screen through redraws
  W('xcTplHtml', (o, a) => { const k = a[0], w = exRsW(k); let html = o.apply(null, a); if(!isDesign(w)) return html;
    // a template the AI is working on glows (Let me help, or an update carried in from an earlier part)
    dz(w).parts.forEach(p => { if(!(p.helping || (p.logic.busy && p.cascade))) return; html = html.replace(new RegExp(`<section class="([^"]*)"([^>]*data-wid="step-dz-${p.key}")`), (m, c, rest) => `<section class="${c.indexOf('xc-w--loading') < 0 ? c + ' xc-w--loading' : c}" aria-busy="true"${rest}`); });
    if(html.indexOf('id="xc-flowsvg"') < 0) html += '<svg class="xc-flowsvg" id="xc-flowsvg" aria-hidden="true"></svg>'; // a one-part node has no step arrows: the lines still need their layer
    return html + dzCanvasHtml(k); });
  W('xcFlowLayout', (o, a) => { const r = o.apply(null, a); if(placeLdocs()) o.apply(null, a); drawDocLines(); return r; }); // documents follow their templates, then the lines are drawn again
  W('xcStepPitch', (o, a) => isDesign(a[0]) ? XC_STEP_W + XC_FLOW_W + LDOC_W + XC_FLOW_W : o.apply(null, a)); // room for the logic document between templates
  W('xcCarryText', (o, a) => { const [w, from] = a, p = isDesign(w) && partOfStep(w, from.key); return p ? `Your ${p.label.toLowerCase()} logic` : o.apply(null, a); });
  W('xcOutCount', (o, a) => { const [w, key] = a, p = isDesign(w) && partOfStep(w, key); if(!p) return o.apply(null, a); return `<span class="xc-count${partDone(p) ? ' is-met' : ''}">${partDone(p) ? 'Logic ready' : `${picked(p).length} picked`}</span>`; });
  W('exRsPanel', (o, a) => { const [k, key] = a, w = exRsW(k), p = isDesign(w) && partOfStep(w, key); return p ? dzPanelHtml(k, p) : o.apply(null, a); });
  W('exRsComposeBody', (o, a) => isDesign(exRsW(a[0])) ? dzCompose(a[0]) : o.apply(null, a));
  W('exRsResultMd', (o, a) => isDesign(exRsW(a[0])) ? dzMd(a[0]) : o.apply(null, a));
  W('exRsSummaryHero', (o, a) => isDesign(exRsW(a[0])) ? dzHero(a[0]) : o.apply(null, a));
  W('exRsSourcesHtml', (o, a) => isDesign(exRsW(a[0])) ? '' : o.apply(null, a));
  W('exRsStateText', (o, a) => { const w = a[0]; if(!isDesign(w)) return o.apply(null, a);
    return JSON.stringify({ mode: 'design', step: exRsStepKey(w), aiChoices_why: (w.aiWhy || []).slice(-12), parts: dz(w).parts.map(p => ({ part: p.label, researched: p.games.filter(g => g.state === 'done').map(g => g.name), decided: decisionsText(p), openQuestions: openQs(p).map(q => q.q), pickedIdeas: picked(p).map(i => `${i.title} (${i.from})`), logic: hasLogic(p) ? p.logic.md.slice(0, 1500) : '' })) }); });
  W('exRsStepSA', (o, a) => { const [k, lensKey] = a, w = exRsW(k); if(!isDesign(w)) return o.apply(null, a);
    const s = exStep(k), base = { anchorSummary: `${s.title} — ${s.nodeInfo.purpose}`, anchorLongSummary: null, lens: null, lensOptions: [], anchorHighlights: [] };
    const p = partOfStep(w, lensKey || exRsStepKey(w));
    const idea = i => ({ label: i.title, detail: i.detail || '', origin: 'explore', role: 'scope', why: [], interest: i.picked ? 'kept' : undefined });
    if(p) return Object.assign({ categories: p.games.map(g => ({ label: g.name, text: g.state === 'done' ? `${g.ideas.length} ideas` : g.state === 'busy' ? 'Researching…' : 'Not researched yet', terms: [], topics: g.ideas.map(idea) })) }, base);
    return Object.assign({ categories: dz(w).parts.map(x => ({ label: x.label, text: hasLogic(x) ? 'Logic ready' : x.question || '', terms: [], topics: picked(x).map(idea) })) }, base); });
  W('exRsFix', (o, a) => { const [k, i] = a, w = exRsW(k); if(!isDesign(w)) return o.apply(null, a);
    const st = exState(k), text = exStep(k).nodeInfo.dod[i]; if(!text) return;
    w.fixFor = { i, text, note: (st.dod[i] && st.dod[i].note) || '' };
    w.step = Math.max(0, dz(w).parts.findIndex(p => !partDone(p))); exRsRefresh(k, true); });
  W('exRsGo', (o, a) => { const r = o.apply(null, a), k = a[0], w = exRsW(k); if(isDesign(w)) setTimeout(() => dzOpenPart(k, curPart(w)), 0); return r; });
  W('xcHelp', (o, a) => { const w = EX.cur && exRsW(EX.cur); if(!(isDesign(w) && curPart(w))) return o.apply(null, a); if(typeof xcSnap === 'function' && !XC.run) xcSnap(EX.cur); return dzHelp(); }); // the whole run is one undo step (it ends with Keep / Undo)
  // sticky notes can be dropped into a template's "Your logic" area
  W('xcAccepts', (o, a) => { const [z, src] = a; if(String(z).indexOf('dzlogic:') === 0) return String(src).indexOf('note:') === 0; return o.apply(null, a); });
  W('xcDropZone', (o, a) => { const [x, y, d] = a, el = document.elementFromPoint(x, y), zone = el && el.closest('[data-zone^="dzlogic:"]'); if(zone) return String(d.src).indexOf('note:') === 0 ? zone : null; return o.apply(null, a); });
  W('xcPaste', (o, a) => { const [sel, toKey] = a; if(String(toKey).indexOf('dzlogic:') !== 0) return o.apply(null, a);
    const k = EX.cur, w = exRsW(k), cv = xcCv(w), n = sel && sel.t === 'note' && cv.notes.find(x => x.id === sel.id); if(!n || !String(n.text || '').trim()) return;
    const ok = dzAddTo(k, toKey.slice(8), { title: xcTr(n.text.trim(), 70), detail: n.text.trim(), src: (n.source && n.source.fromNode) || 'Your sticky notes' });
    if(ok){ cv.notes = cv.notes.filter(x => x !== n); xcRender(); } });
  W('xcLead', (o, a) => { const [w, key] = a, p = isDesign(w) && partOfStep(w, key); return p ? `Read the research documents under this template (how other ${dz(w).refNouns} do ${p.label.toLowerCase()}), drag the ideas you like into “Your logic” — sections, key ideas or sticky notes — then combine them. The logic document appears to the right: edit it, check it, and carry it on.` : o.apply(null, a); });
  W('xcNow', (o, a) => { const k = a[0], w = exRsW(k), p = isDesign(w) && !exState(k).done && curPart(w); if(!p) return o.apply(null, a);
    const parts = dz(w).parts, i = parts.indexOf(p), next = parts[i + 1], d = dz(w), n = picked(p).length, ready = p.games.filter(g => g.state === 'done').length, busy = p.games.some(g => g.state === 'busy');
    const base = { step: `Template ${i + 1} of ${parts.length} · ${p.label}`, then: next ? `Then: ${next.label}` : 'Then: the Result' };
    if(p.aspects.length){ const left = unsettled(p);
      if(left.length) return Object.assign(base, { now: `Decide ${left.length === p.aspects.length ? 'what must be settled' : left.map(a => a.label.toLowerCase()).join(', ')} — pick one option for each.`, how: ['Each option shows what it looks like: a picture for a style, the colours for a palette.', 'Not sure? Press Let me help — I pick one for each and say why.', 'None fits? Describe your own under the options.'], why: `Your ${p.label.toLowerCase()} logic is written from these decisions.` });
      if(!hasLogic(p)) return Object.assign(base, { now: p.logic.busy ? 'Wait a moment — I’m writing your logic from your decisions.' : 'Press “Write my logic”.', how: ['Your decisions are fixed in it; ideas you borrowed from the research are added too.', 'The logic document appears right of this template.'], why: 'The logic document is what carries into the next part.' }); }
    if(hasLogic(p) && openQs(p).length) return Object.assign(base, { now: `Answer the ${openQs(p).length === 1 ? 'question' : `${openQs(p).length} questions`} in the logic document.`, how: ['Pick an answer for each — or write your own.', 'Press “Apply my answers to the logic”.'], why: 'Nothing open may carry into the result — it couldn’t be built otherwise.' });
    if(!ready) return Object.assign(base, { now: busy ? `Wait a moment — I’m researching how other ${d.refNouns} do ${p.label.toLowerCase()}.` : `Research how other ${d.refNouns} do ${p.label.toLowerCase()}.`, how: busy ? ['Each research document appears under this template as soon as it is written.'] : ['Press Research next to a reference in the template, or Let me help.'], why: `You build your ${p.label.toLowerCase()} from ideas that already work elsewhere.` });
    if(!n) return Object.assign(base, { now: `Take the ideas you like into “Your logic”.`, how: [`Read the research documents under the template (${ready} ready).`, 'Drag a section or a key idea onto the template — or select text and choose Add.', 'Not sure? Press Let me help to suggest some, each with a reason.'], why: 'Your logic is combined only from the ideas you choose.' });
    if(!hasLogic(p)) return Object.assign(base, { now: p.logic.busy ? 'Wait a moment — I’m combining your ideas.' : `Combine your ${n} idea${n === 1 ? '' : 's'} into your logic.`, how: ['Press “Combine into my logic” at the bottom of the template.', 'Add or take out ideas first if you want.'], why: 'The logic document is what carries into the next part.' });
    return Object.assign(base, { now: `Review your ${p.label.toLowerCase()} logic, then carry it on.`, how: ['Read the logic document right of this template — click the text to edit it.', 'Use “Check for gaps” if you are unsure.', `Press “Looks right — carry into ${next ? next.label : 'the Result'}”.`], why: next ? `${next.label} builds on it.` : 'It goes into the rulebook.' }); });
  if(typeof XC_MODE === 'object') XC_MODE.design = 'Design';

  // ---------- put something from a document into a part's template, as a picked idea ----------
  function dzAddTo(k, toKey, item){
    const w = exRsW(k), tp = partByKey(w, toKey); if(!tp || exState(k).done) return false;
    const si = dz(w).parts.indexOf(tp); if(xcSecState(w, si, false) === 'locked'){ dzFlash(`“${tp.label}” isn’t open yet — finish the template before it first.`); return false; }
    if(item.secKey && allIdeas(tp).some(x => x.secKey === item.secKey)){ dzFlash(`Already in ${tp.label}.`); return false; }
    if(item.ideaId){ const own = tp.games.flatMap(g => g.ideas).concat(tp.ownIdeas).find(x => x.id === item.ideaId); if(own){ if(own.picked){ dzFlash(`Already picked in ${tp.label}.`); return true; } own.picked = true; own.byAi = false; redraw(k); nextSync(w); dzFlash(`Added to ${tp.label}.`); return true; } }
    tp.ownIdeas.push({ id: rsId('id'), title: item.title, detail: item.detail || '', picked: true, src: item.src || '', secKey: item.secKey || '' });
    redraw(k); nextSync(w); dzFlash(`Added to ${tp.label}.`); return true;
  }
  const dzItem = (w, kind, pk, gid, ref) => {
    // the template's own choices: an option of "Decide what must be settled" (opt:part:aspect:option), or an idea to
    // borrow / a picked one (pick:part:idea)
    if(kind === 'opt'){ const p = partByKey(w, pk), a = p && p.aspects.find(x => x.id === gid), o = a && chOf(p, a).options.find(x => x.id === ref);
      return o ? { title: o.label, detail: o.detail || '', src: a.label, opt: { pk, a: a.id, o: o.id }, colors: (o.colors || []).filter(h => HEX.test(h)) } : null; }
    if(kind === 'pick'){ const p = partByKey(w, pk), i = p && allIdeas(p).find(x => x.id === gid);
      return i ? { title: i.title, detail: i.detail || '', src: i.from || i.src || p.label, ideaId: i.id, pick: { pk, id: i.id } } : null; }
    const p = partByKey(w, pk), g = p && p.games.find(x => x.id === gid); if(!g) return null;
    if(kind === 'sec'){ const s = sectionsOf(g.md)[+ref]; return s ? { title: s.full, detail: plain(s.body).slice(0, 700), src: g.name, secKey: `${g.id}:${ref}` } : null; }
    const i = g.ideas.find(x => x.id === ref); return i ? { title: i.title, detail: i.detail, src: g.name, ideaId: i.id } : null;
  };
  function dzFlash(t){ const k = EX.cur, w = k && exRsW(k); if(!w) return; xcCv(w).aiLast = { text: t, step: w.step }; if(typeof xcSnack === 'function') xcSnack(); }

  // ---------- events ----------
  function nextSync(w){
    const ok = exRsStepDone(w, exRsStepKey(w)) && !w.busy;
    document.querySelectorAll('#xc-wrap [data-xc-act="next"]').forEach(b => { b.disabled = !ok; const h = b.parentNode && b.parentNode.querySelector('.xc-hint'); if(h) h.textContent = ok ? '' : exRsBlocker(w); });
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-dz-act]'); if(!b || b.disabled || !EX.cur) return;
    const k = EX.cur, w = exRsW(k); if(!isDesign(w)) return;
    const act = b.dataset.dzAct;
    if(act === 'show') return dzShow(k, b.dataset.show);
    if(act === 'pdf') return dzExport(w, b.dataset.what, b.dataset.p, b.dataset.id);
    if(act === 'full') return dzFull(k, b.dataset.wid);
    if(exState(k).done) return;
    const p = partByKey(w, b.dataset.p); if(!p) return;
    const id = b.dataset.id;
    switch(act){
      case 'fold': p.fold[b.dataset.s] = !p.fold[b.dataset.s]; return redraw(k);
      case 'research': return dzResearch(k, p.key, id);
      case 'suggest': return dzSuggestRefs(k, p.key, false);
      case 'view': { const g = p.games.find(x => x.id === id); if(g) g.view = b.dataset.v; return redraw(k); }
      case 'pick': { const x = p.games.flatMap(g => g.ideas).concat(p.ownIdeas).find(i => i.id === id); if(x){ x.picked = !x.picked; x.byAi = false; } redraw(k); return nextSync(w); }
case 'combine': return dzCombine(k, p.key);
case 'choose': { const a = p.aspects.find(x => x.id === b.dataset.a); if(!a) return; const c = chOf(p, a); c.pick = c.pick === id ? null : id; c.byAi = false; c.aiWhy = ''; redraw(k); return nextSync(w); }
case 'opts': return dzOptions(k, p.key, b.dataset.a);
case 'answer': { const qs = openQs(p); if(!qs.length || !qs.every(q => String(q.answer || '').trim()) || p.logic.busy) return;
  const have = new Set((p.answers || []).map(x => x.q)); p.answers = (p.answers || []).concat(qs.filter(q => !have.has(q.q)).map(q => ({ q: q.q, a: q.answer.trim() })));
  return dzCombine(k, p.key, 'Work the user’s answers (under ANSWERED) into the logic. Keep everything else, including their own edits.'); }
      case 'edit': p.editing = !p.editing; redraw(k); if(p.editing) setTimeout(() => { const t = document.querySelector(`#xc-wrap [data-dz-edit="logic"][data-p="${p.key}"]`); if(t){ if(typeof xcGrow === 'function') xcGrow(t); t.focus(); } }, 30); return;
      case 'check': return dzCheck(k, p.key);
      case 'dismiss': { const x = p.check && p.check.points.find(y => y.id === id); if(x) x.off = true; return redraw(k); }
      case 'fix': { const x = p.check && p.check.points.find(y => y.id === id); if(!x) return; x.off = true; return dzCombine(k, p.key, `Fix this ${x.kind}: ${x.text}`); }
      case 'carry': { if(curPart(w) !== p || !partDone(p)) return; p.editing = false; return exRsGo(k, w.step + 1); }
    }
  });
  // the logic document is edited in place: its HTML is turned back into Markdown (the format the AI and the result use)
  function htmlToMd(root){
    const inl = n => n.nodeType === 3 ? n.nodeValue : n.nodeType !== 1 ? '' : (() => { const t = [...n.childNodes].map(inl).join(''), tg = n.tagName;
      return tg === 'B' || tg === 'STRONG' ? (t.trim() ? `**${t.trim()}**` : '') : tg === 'EM' || tg === 'I' ? (t.trim() ? `*${t.trim()}*` : '') : tg === 'BR' ? '\n' : t; })();
    const out = [];
    const block = n => { if(n.nodeType === 3){ if(n.nodeValue.trim()) out.push(n.nodeValue.trim()); return; } if(n.nodeType !== 1) return; const tg = n.tagName;
      if(n.dataset && n.dataset.md){ out.push(n.dataset.md, ''); return; } // a diagram or photo (doc-visuals.js) goes back as the Markdown it came from
      if(/^H[1-6]$/.test(tg)) out.push(`## ${inl(n).trim()}`);
      else if(tg === 'UL' || tg === 'OL') [...n.children].forEach((li, i) => out.push(`${tg === 'OL' ? `${i + 1}.` : '-'} ${inl(li).replace(/\s+/g, ' ').trim()}`));
      else if(tg === 'TABLE'){ [...n.querySelectorAll('tr')].forEach((tr, i) => { out.push(`| ${[...tr.children].map(c => inl(c).trim()).join(' | ')} |`); if(i === 0) out.push(`|${[...tr.children].map(() => '---').join('|')}|`); }); }
      else if(tg === 'P' || tg === 'LI') out.push(inl(n).trim());
      else [...n.childNodes].forEach(block); out.push(''); };
    [...root.childNodes].forEach(block);
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  let edT = null;
  document.addEventListener('input', e => {
    const t = e.target.closest && e.target.closest('[data-dz-ed]'); if(!t || !EX.cur) return;
    const w = exRsW(EX.cur), p = isDesign(w) && partByKey(w, t.dataset.dzEd); if(!p) return;
    if(p.check) p.check.stale = true;
    clearTimeout(edT); edT = setTimeout(() => { p.logic.md = htmlToMd(t); nextSync(w); if(typeof xcOutputSoon === 'function') xcOutputSoon(); }, 400);
  });
// answering an open question (radio or own text) — no re-render, so typing keeps its focus
function qSync(p){ const ready = openQs(p).every(q => String(q.answer || '').trim());
  document.querySelectorAll(`[data-dz-act="answer"][data-p="${p.key}"]`).forEach(b => { b.disabled = !ready || p.logic.busy; });
  document.querySelectorAll(`[data-dz-qhint="${p.key}"]`).forEach(h => { h.textContent = ready ? '' : 'Answer every question first.'; }); }
const qFind = ref => { const [pk, qid] = String(ref).split(':'), w = EX.cur && exRsW(EX.cur), p = w && isDesign(w) && partByKey(w, pk), q = p && openQs(p).find(x => x.id === qid); return q ? { p, q, qid } : null; };
document.addEventListener('change', e => { const t = e.target.closest && e.target.closest('[data-dz-q]'); if(!t) return; const r = qFind(t.dataset.dzQ); if(!r) return;
  r.q.own = t.value === '__own'; r.q.answer = r.q.own ? String(r.q.other || '') : t.value; qSync(r.p);
  if(r.q.own){ const i = document.querySelector(`[data-dz-qown="${t.dataset.dzQ}"]`); if(i) i.focus(); } });
document.addEventListener('input', e => { const t = e.target.closest && e.target.closest('[data-dz-qown]'); if(!t) return; const r = qFind(t.dataset.dzQown); if(!r) return;
  r.q.other = t.value; r.q.own = true; r.q.answer = t.value; const rb = document.querySelector(`input[name="dzq-${r.qid}"][value="__own"]`); if(rb) rb.checked = true; qSync(r.p); });
  document.addEventListener('focusin', e => { const t = e.target.closest && e.target.closest('[data-dz-ed]'); if(t) t.dataset.was = t.innerText; });
  document.addEventListener('focusout', e => {
    const t = e.target.closest && e.target.closest('[data-dz-ed]'); if(!t || !EX.cur) return;
    const k = EX.cur, w = exRsW(k), p = isDesign(w) && partByKey(w, t.dataset.dzEd); if(!p) return;
    clearTimeout(edT); p.logic.md = htmlToMd(t);
    if(t.innerText !== t.dataset.was){ p.logic.edited = Date.now(); dzFlash(`Saved your edit to the ${p.label} logic.`); dzCascade(k, p.key); }
  });
  document.addEventListener('submit', e => {
    const f = e.target.closest && e.target.closest('[data-dz-add]'); if(!f || !EX.cur) return;
    e.preventDefault();
    const k = EX.cur, w = exRsW(k), p = isDesign(w) && partByKey(w, f.dataset.p), inp = f.querySelector('input'), v = inp ? inp.value.trim() : '';
    if(!p || !v || exState(k).done) return;
    const kind = f.dataset.dzAdd;
    if(kind === 'game'){ let g = p.games.find(x => x.name.toLowerCase() === v.toLowerCase()); if(!g){ g = newGame(v, '', true); p.games.push(g); } return dzResearch(k, p.key, g.id).then(() => dzShow(k, 'doc-' + g.id)); }
if(kind === 'opt'){ const a = p.aspects.find(x => x.id === f.dataset.a); if(!a) return; const c = chOf(p, a), cols = (v.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) || []).slice(0, 6);
  const o = { id: rsId('op'), label: v, detail: 'Your own', own: true, colors: cols, q: '', img: null }; c.options.push(o); c.pick = o.id; c.byAi = false; c.aiWhy = ''; redraw(k); return nextSync(w); }
    if(kind === 'idea'){ p.ownIdeas.push({ id: rsId('id'), title: v, detail: '', picked: true, src: '' }); return redraw(k); }
    if(kind === 'instr') return dzCombine(k, p.key, v);
  });
  // "Line them up" also puts each logic document back beside its template
  document.addEventListener('click', e => { const b = e.target.closest('[data-xc-act="lineup"]'), w = b && EX.cur && exRsW(EX.cur); if(!isDesign(w)) return; dz(w).parts.forEach(p => { const wd = xcCv(w).wid['ldoc-' + p.key]; if(wd) wd.auto = true; }); }, true);

  // ---------- drag from a document onto a template (the canvas's own pointer drag, with a ghost) ----------
  let DD = null;
  const dropTarget = (x, y) => { const el = document.elementFromPoint(x, y), w = EX.cur && exRsW(EX.cur), one = w && isDesign(w) && dz(w).parts.length === 1;
    const t = el && (el.closest('.xc-w--step[data-steptpl^="dz-"]') || (one && el.closest('section[data-wid="tpl"]'))); return t && !t.classList.contains('xc-w--step-locked') ? t : null; };
  const dropKey = t => t.dataset.steptpl ? t.dataset.steptpl.slice(3) : dz(exRsW(EX.cur)).parts[0].key;
  document.addEventListener('pointerdown', e => {
    const h = e.button === 0 && e.target.closest('[data-dz-drag]'), ctl = e.target.closest('button, a, input, textarea');
    if(!h || (ctl && ctl !== h && !h.contains(ctl)) || e.target.closest('a, input, textarea') || !EX.cur) return; // a choice button is its own handle (a click still chooses it)
    const w = exRsW(EX.cur); if(!isDesign(w) || exState(EX.cur).done) return;
    const [kind, pk, gid, ref] = h.dataset.dzDrag.split(':'), item = dzItem(w, kind, pk, gid, ref); if(!item) return;
    e.preventDefault(); e.stopPropagation(); // a heading is a handle, not text to select; the canvas doesn't pan
    DD = { item, x0: e.clientX, y0: e.clientY, pid: e.pointerId, started: false, ghost: null, over: null };
  }, true);
  window.addEventListener('pointermove', e => {
    if(!DD || e.pointerId !== DD.pid) return;
    if(!DD.started){ if(Math.abs(e.clientX - DD.x0) + Math.abs(e.clientY - DD.y0) < 5) return; DD.started = true;
      const g = DD.ghost = document.createElement('div'); g.className = 'dz-ghost'; g.textContent = `${DD.item.src} · ${xcTr(DD.item.title, 48)}`; document.body.appendChild(g);
      document.querySelectorAll('.xc-w--step[data-steptpl^="dz-"]:not(.xc-w--step-locked), #xc-wrap section[data-wid="tpl"]').forEach(t => { if(t.dataset.steptpl || dz(exRsW(EX.cur)).parts.length === 1) t.classList.add('dz-drop-ok'); }); }
    DD.ghost.style.left = (e.clientX + 12) + 'px'; DD.ghost.style.top = (e.clientY + 10) + 'px';
    const t = dropTarget(e.clientX, e.clientY);
    if(t !== DD.over){ if(DD.over) DD.over.classList.remove('dz-drop-on'); DD.over = t; if(t) t.classList.add('dz-drop-on'); }
  });
  window.addEventListener('pointerup', e => {
    if(!DD || e.pointerId !== DD.pid) return;
    const d = DD; DD = null;
    if(d.ghost) d.ghost.remove();
    document.querySelectorAll('.dz-drop-ok, .dz-drop-on').forEach(t => t.classList.remove('dz-drop-ok', 'dz-drop-on'));
    if(!d.started) return;
    const t = dropTarget(e.clientX, e.clientY), el = document.elementFromPoint(e.clientX, e.clientY), lockedT = el && el.closest('.xc-w--step-locked[data-steptpl^="dz-"]');
    if(t && d.item.opt && dropKey(t) === d.item.opt.pk) dzChoose(EX.cur, d.item.opt); // an option back on its own template: choose it
    else if(t) dzAddTo(EX.cur, dropKey(t), d.item);
    else if(lockedT){ const lp = partByKey(exRsW(EX.cur), lockedT.dataset.steptpl.slice(3)); dzFlash(`${lp ? `“${lp.label}”` : 'That template'} isn’t open yet — finish the template before it first.`); }
    else { // on the empty canvas: it becomes a sticky note there (user test)
      const vp = typeof xcVp === 'function' && xcVp(), r = vp && vp.getBoundingClientRect(), inVp = r && e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom;
      if(inVp && !(el && el.closest('.xc-w, .xc-note, .cf-w')) && typeof xcToWorld === 'function' && (d.item.opt || d.item.pick)){
        // a template choice (an option to settle, an idea to borrow) becomes a card: an object on the canvas, with
        // Show on template and Add to template / Choose it (user request: "every choice can be an object on the canvas")
        const pt = xcToWorld(e.clientX, e.clientY), it = d.item, w0 = exRsW(EX.cur), p0 = partByKey(w0, (it.opt || it.pick).pk);
        xcDo(w2 => { const cv2 = xcCv(w2); (cv2.cards || (cv2.cards = [])).push({ id: 'card' + (++cv2.seq), x: Math.round(pt.x - 20), y: Math.round(pt.y - 20),
          kind: it.opt ? `Choice · ${it.src}` : 'Idea', label: it.title, detail: it.detail, parent: null, kids: it.colors || [], from: `${p0 ? p0.label : 'Template'} template`, fromTpl: true, dz: it.opt ? { opt: it.opt } : { pick: it.pick } }); });
        dzFlash(`“${xcTr(it.title, 40)}” is a card on the canvas — drag it back onto a template, or use its buttons.`);
      } else if(inVp && !(el && el.closest('.xc-w, .xc-note, .cf-w')) && typeof xcToWorld === 'function'){
        const pt = xcToWorld(e.clientX, e.clientY), it = d.item, text = xcTr(`${it.title}${it.detail && it.detail !== it.title ? ` — ${it.detail}` : ''}`, 400);
        xcDo(w2 => xcNote(w2, text, pt.x - 90, pt.y - 20, 'smart', { fromNode: it.src })); dzFlash('Made a sticky note — drag it into “Your logic” when you want it.');
      } else dzFlash('Drop it on a template, or on the empty canvas to make a sticky note.');
    }
  });

  // ---------- select text in a research document → ONE menu: Ask AI · Explore more · Sticky note · Add to template ----------
  // (replaces the canvas's own "Ask AI" bubble there, which used to overlap a second menu — user test)
  let SEL = null;
  const selMenu = () => { let m = document.getElementById('dz-selmenu'); if(!m){ m = document.createElement('div'); m.id = 'dz-selmenu'; m.className = 'dz-selmenu'; m.setAttribute('role', 'toolbar'); m.setAttribute('aria-label', 'Selected text'); m.hidden = true; m.addEventListener('mousedown', e => e.preventDefault()); document.body.appendChild(m); } return m; };
  const hideSel = () => { SEL = null; const m = document.getElementById('dz-selmenu'); if(m) m.hidden = true; };
  const showSel = () => {
    const s = window.getSelection(), txt = s ? String(s).replace(/\s+/g, ' ').trim() : '';
    const node = s && s.rangeCount && s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement);
    const host = node && node.closest && node.closest('[data-dz-doc]');
    if(!host || txt.length < 3 || !EX.cur){ const m = document.getElementById('dz-selmenu'); if(m && !m.hidden && !host) hideSel(); return; }
    const w = exRsW(EX.cur), [pk, gid] = host.dataset.dzDoc.split(':'), p = partByKey(w, pk), g = p && p.games.find(x => x.id === gid); if(!g) return hideSel();
    const ask = document.getElementById('cf-ask'); if(ask) ask.classList.remove('is-on'); // one menu here, not two
    const ro = exState(EX.cur).done, cur = curPart(w) || p, r = s.getRangeAt(0).getBoundingClientRect(), m = selMenu();
    SEL = { pk, gid, text: txt.slice(0, 900), to: cur.key, rect: { x: r.right, y: r.top } };
    m.innerHTML = `<button type="button" data-dzsel="ask">✦ Ask AI</button>${ro ? '' : `<button type="button" data-dzsel="explore">Explore more</button><button type="button" data-dzsel="note">Turn into a sticky note</button><button type="button" data-dzsel="add">Add to ${E(cur.label)}</button>`}`;
    m.hidden = false;
    m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.left + r.width / 2 - m.offsetWidth / 2)) + 'px'; m.style.top = Math.max(8, r.top - m.offsetHeight - 8) + 'px';
  };
  document.addEventListener('mouseup', e => { if(e.target.closest && e.target.closest('#dz-selmenu')) return; setTimeout(showSel, 20); }); // after the canvas's own Ask AI bubble (0 ms), which it then hides
  document.addEventListener('mousedown', e => { if(!e.target.closest || !e.target.closest('#dz-selmenu')) hideSel(); });
  document.addEventListener('keydown', e => { if(e.key === 'Escape') hideSel(); });
  document.addEventListener('scroll', e => { if(SEL && !(e.target.closest && e.target.closest('[data-dz-doc]'))) hideSel(); }, true);
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-dzsel]'); if(!b || !SEL || !EX.cur) return;
    const k = EX.cur, w = exRsW(k), s = SEL, p = partByKey(w, s.pk), g = p && p.games.find(x => x.id === s.gid); hideSel(); const sel = window.getSelection(); if(sel) sel.removeAllRanges(); if(!g) return;
    const a = b.dataset.dzsel;
    if(a === 'ask'){ if(window.CF && CF.ask) return CF.ask(s.text, `${g.name} research · ${p.label}`); return; } // a reference in the chat box; the user asks
    if(exState(k).done) return;
    if(a === 'add') return dzAddTo(k, s.to, { title: xcTr(s.text, 70), detail: s.text, src: g.name });
    if(a === 'explore') return dzExplore(k, s.pk, s.gid, -1, s.text);
    if(a === 'note'){ // beside the document it came from, in a free spot
      const doc = xcCv(w).wid['doc-' + g.id] || { x: 0, y: 0, w: DOC_W }, pt = typeof xcToWorld === 'function' ? xcToWorld(s.rect.x, s.rect.y) : { y: doc.y };
      const spot = typeof xcFreeSpot2 === 'function' ? xcFreeSpot2(doc.x + (doc.w || DOC_W) + 32, Math.round(pt.y), 200, 120) : { x: doc.x + (doc.w || DOC_W) + 32, y: pt.y };
      xcDo(w2 => xcNote(w2, xcTr(s.text, 400), spot.x, spot.y, 'smart', { fromNode: g.name }));
      return dzFlash('Turned into a sticky note — drag it into “Your logic” on a template.');
    }
  });
})();
