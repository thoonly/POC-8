/* components/plan-ways.js — "How do you want to plan it?" (shared by entry-v4 and entry-v5).

   Entering Planning no longer builds a plan right away. Planning opens on Chat (Output closed) with a card that offers
   2–3 big-picture ways of working (A, B, C — e.g. a book "Outline first" vs "Chapter by chapter"), the recommended one
   first, each optionally "Based on" a named framework, plus "My own way". The user picks one and presses Build; the
   planner then gets everything from before plus the chosen way, and the plan's STRUCTURE follows it (a lane per
   repeated part, visible revision rounds, parallel tracks…), not only its order.

   Each way keeps its own plan (with the user's edits): clicking a way that is already built shows it at once — no AI
   call, no chat message, no scroll. Only a confirmed plan asks before switching away (it goes back to Draft and the
   work done in its nodes is cleared).

   Hooks in the pages: Continue (Intent) → PlanWays.enter() · empty Planning output → emptyHtml() · Send with an empty
   box in Planning → sendEmpty() · ipPlanningPrompt → promptBlock() · after a plan is built → afterBuild().
   State lives in IP.ways. Tokens only; light and dark through the page's tokens. */
(function(){
  'use strict';
  const E = s => ipE(s);
  const LETTERS = 'ABC';
  const W = () => IP.ways || (IP.ways = { sig: '', list: [], loading: false, err: '', sel: '', shown: '', own: '', built: {}, building: '' });
  const str = v => typeof v === 'string' ? v.trim() : '';

  // what the ways depend on: when the purpose or the deliverables change, the ways are worked out again
  function sigOf(){ const it = IP.intent || {}; return JSON.stringify([it.purpose, (it.outputs || []).map(o => o.text)]); }
  function youGet(){
    const it = IP.intent || {}, outs = (it.outputs || []).map(o => o.text).filter(Boolean);
    return str(it.summary) || (outs.length ? `You’ll get ${outs.join(', ')}.` : '');
  }
  const wayById = id => id === 'own' ? { id: 'own', title: 'My own way', own: true } : W().list.find(x => x.id === id);
  // a way's plan is fresh when it was built from the intent as it is now (the page's plAligned; else the version)
  const fresh = b => !!(b && IP.intent && (typeof plAligned === 'function' ? plAligned(b) : b.lanesVersion === IP.intent.version));

  // ---------- the ways (one AI call) ----------
  async function loadWays(){
    const w = W(), it = IP.intent; if(!it) return;
    w.loading = true; w.err = ''; render();
    try {
      const deliv = typeof plCoverParts === 'function' ? plCoverParts().map(x => `${x.id}. ${x.label}`).join('\n') : (it.outputs || []).map(o => o.text).join('\n');
      const res = await callClaude(`You help a user decide HOW to plan a piece of work before the plan is drafted.
${typeof ipFocusBlock === 'function' ? ipFocusBlock() : ''}
Purpose: "${it.purpose}"
Audience: "${str(it.audience) || '(not stated)'}"
${typeof ledgerBlock === 'function' ? ledgerBlock() : ''}
In scope: ${JSON.stringify((it.scopeIn || []).map(x => x.text).filter(Boolean))}
Out of scope: ${JSON.stringify((it.scopeOut || []).filter(Boolean))}
Deliverables:
${deliv || '(none stated)'}

Give 2-3 genuinely different BIG-PICTURE WAYS OF WORKING for this — not the same steps reordered. Example for writing a book: "Outline first" (plan every chapter, then write) versus "Chapter by chapter" (write and revise one chapter at a time) versus "Discovery draft" (write freely, then restructure).
At least ONE way must follow a real, well-known, named framework or method that genuinely fits this kind of work (e.g. the Snowflake method for a novel, a vertical slice for a game prototype, Double Diamond for a design project); name it in "based_on". Never invent a framework name. The other ways may follow one too, else "".
Put the one that fits this user's situation best FIRST and mark it "recommended": true (only that one).

For each way:
- "title": 2-4 words;
- "based_on": the named framework, or "";
- "best_when": one line about THIS user's situation, starting "Best when …" (e.g. "Best when you already have a picture of each chapter");
- "flow": 3-4 steps IN ORDER — how the work goes from start to finish, each a short phrase starting with a verb (they are shown numbered 1, 2, 3);
- "structure": one sentence on how the plan is shaped by it — e.g. one lane per chapter, revision rounds as their own nodes, or parallel tracks that meet at a review.
${typeof ipLang === 'function' ? ipLang() : ''}
Respond ONLY with {"ways": [{"title": "", "based_on": "", "recommended": false, "best_when": "", "flow": [], "structure": ""}]}.`, { maxTokens: 1400 });
      const list = (Array.isArray(res && res.ways) ? res.ways : []).filter(x => x && str(x.title)).slice(0, 3)
        .map((x, i) => ({ id: 'w' + i + '_' + Date.now().toString(36), title: str(x.title), based: str(x.based_on), recommended: x.recommended === true, bestWhen: str(x.best_when), flow: (Array.isArray(x.flow) ? x.flow : []).map(str).filter(Boolean).slice(0, 4), structure: str(x.structure) }));
      if(!list.length) throw new Error('no ways came back');
      // the recommended one first, and only one of them
      list.sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0)); list.forEach((x, i) => { x.recommended = i === 0; });
      w.list = list; w.sig = sigOf();
      if(!w.sel || (w.sel !== 'own' && !wayById(w.sel))) w.sel = list[0].id;
    } catch(e){ w.err = e.message || 'the AI request failed'; }
    w.loading = false; render();
  }

  // ---------- the card in Planning's chat ----------
  function cardHtml(){
    const w = W(), get = youGet();
    const head = `${get ? `<p class="pw-get"><b>What you’ll get:</b> ${E(get)}</p>` : ''}<p class="pw-q">How do you want to plan it?</p>`;
    if(w.loading) return `${head}<p class="pw-state"><span class="dot-spin"></span> Working out ways to plan this…</p><div class="pw-skel"><i></i><i></i><i></i></div>`;
    if(w.err && !w.list.length) return `${head}<div class="banner pw-err">Couldn’t work out ways to plan it — ${E(w.err)}.</div><div class="pw-acts"><button type="button" class="btn ip-btn-sm" data-pw="retry">Try again</button><button type="button" class="ip-mini" data-pw="pick" data-id="own">Describe my own way</button></div>`;
    const ways = w.list.map((x, i) => wayHtml(x, LETTERS[i] || String(i + 1))).join('') + wayHtml({ id: 'own', title: 'My own way', own: true }, '');
    return `${head}<div class="pw-ways" role="radiogroup" aria-label="Ways to plan it">${ways}</div>`;
  }
  function wayHtml(x, letter){
    const w = W(), sel = w.sel === x.id, b = w.built[x.id], ready = !!b, shown = w.shown === x.id && IP.lanes && !IP.planningBuilding;
    const chips = `${ready ? '<span class="pw-chip pw-chip--ready">Plan ready</span>' : ''}${shown && w.sel !== x.id && !w.built[w.sel] ? '<span class="pw-chip">Selected</span>' : ''}`;
    let body = '';
    if(sel){
      const building = w.building === x.id;
      let btn = '';
      if(building) btn = `<button type="button" class="btn pw-build" disabled aria-busy="true"><span class="dot-spin"></span> ${w.refining ? 'Checking your steps…' : 'Building the plan…'}</button>`;
      else if(!ready) btn = `<button type="button" class="btn pw-build" data-pw="build"${x.own && !str(w.own) ? ' disabled' : ''}>Build the plan: ${E(x.title)}</button>`;
      else if(!fresh(b)) btn = `<button type="button" class="btn pw-build" data-pw="build">Update the plan: ${E(x.title)}</button>`;
      else if(!shown) btn = `<button type="button" class="btn pw-build" data-pw="show">Show the plan: ${E(x.title)}</button>`;
      body = x.own
        ? `<label class="pw-own-l" for="pw-own">Describe how you usually work — or type it into Chat</label><textarea class="ip-field ip-grow pw-own" id="pw-own" rows="3" placeholder="e.g. I draft everything quickly, then do two review rounds with my editor">${E(w.own)}</textarea>${btn}`
        : `${x.bestWhen ? `<p class="pw-best">${E(x.bestWhen)}</p>` : ''}${x.flow.length ? `<ol class="pw-flow pw-steps" aria-label="Steps">${x.flow.map(f => `<li>${E(f)}</li>`).join('')}</ol>` : ''}${btn}`;
    }
    return `<div class="pw-way${sel ? ' is-sel' : ''}${x.own ? ' pw-way--own' : ''}">
      <button type="button" class="pw-way-h" role="radio" aria-checked="${sel}" data-pw="pick" data-id="${x.id}">
        <span class="pw-dot" aria-hidden="true"></span>${letter ? `<span class="pw-letter">${letter}</span>` : ''}<span class="pw-title">${E(x.title)}</span>${x.recommended ? '<span class="pw-chip pw-chip--rec">Recommended</span>' : ''}${chips}
        ${x.based ? `<span class="pw-based">Based on ${E(x.based)}</span>` : ''}</button>
      ${body ? `<div class="pw-way-b">${body}</div>` : ''}</div>`;
  }
  // the card is one chat message, redrawn in place (no new message, no scrolling)
  function render(){
    if(!IP.intent) return;
    const host = typeof ipChatEl === 'function' && ipChatEl('planning'); if(!host) return;
    let m = host.querySelector('#pw-card');
    if(!m){ m = ipAddMsg('planning', 'assistant', '<div id="pw-card" class="pw-card"></div>'); m = m.querySelector('#pw-card'); }
    const focusOwn = document.activeElement && document.activeElement.id === 'pw-own', caret = focusOwn ? document.activeElement.selectionStart : 0;
    m.innerHTML = cardHtml();
    if(focusOwn){ const t = m.querySelector('#pw-own'); if(t){ t.focus(); t.setSelectionRange(caret, caret); } }
    if(typeof ipGrowAll === 'function') ipGrowAll(m);
  }

  // ---------- plans per way ----------
  function snap(){ return { lanes: IP.lanes, objective: IP.objective, lanesVersion: IP.lanesVersion, lanesIntent: IP.lanesIntent, lanesMode: IP.lanesMode, cam: IP.plCam, coverage: IP.coverage ? IP.coverage.planning : null }; }
  function keepShown(){ const w = W(); if(w.shown && IP.lanes) w.built[w.shown] = snap(); } // the plan in Output, with its edits
  function restore(b){
    IP.lanes = b.lanes; IP.objective = b.objective; IP.lanesVersion = b.lanesVersion; IP.lanesIntent = b.lanesIntent; IP.lanesMode = b.lanesMode; IP.plCam = b.cam;
    if(IP.coverage){ IP.coverage.planning = b.coverage; if(typeof ipRenderCoverage === 'function') ipRenderCoverage('planning'); }
    if(typeof ipBuildPlanningSA === 'function') ipBuildPlanningSA();
    if(IP.node === 'planning' && typeof renderGraphCards === 'function'){ semanticAnalysis = IP.planningSA; renderGraphCards(); }
    ipRenderPlanning(); if(typeof ipRenderNav === 'function') ipRenderNav(); if(typeof ipUpdatePlanningFooter === 'function') ipUpdatePlanningFooter();
  }
  // a confirmed plan asks before it is put aside: switching takes it back to Draft and clears its nodes' work
  function leaveConfirmed(){
    if(!IP.planningConfirmed) return true;
    if(!window.confirm('Switch away from the confirmed plan?\n\nIt goes back to Draft, and the work done in its nodes is cleared.')) return false;
    IP.planningConfirmed = false;
    if(typeof EX !== 'undefined'){ EX.steps = {}; EX.cur = null; EX.resultSim = null; EX.resultDone = false; }
    return true;
  }
  function show(id){
    const w = W(), b = w.built[id]; if(!b || w.shown === id) return;
    if(!leaveConfirmed()) return render();
    keepShown(); w.shown = id; restore(b);
    if(typeof forceExpandPanel === 'function') forceExpandPanel('output');
    render();
  }
  // ---------- My own way: keep the user's steps, and add only what clearly helps (user request) ----------
  // Their steps stay in their order and words. A step is added only where something the intent needs has no step
  // (a review the deliverables call for, a step another one depends on), never from outside what the user and the
  // intent say. Each added step says why; Chat then offers "Remove …" to build the plan from their steps only.
  const splitSteps = t => String(t || '').split(/\s*(?:\n+|→|->|>|;|,\s*then\s+|\bthen\b)\s*/i).map(str).filter(x => x.length > 1);
  async function refineOwn(w){
    const it = IP.intent || {}, mine = splitSteps(w.own);
    try {
      const res = await callClaude(`A user described their own way of working for this piece of work, in their words: "${str(w.own)}"
Purpose: "${it.purpose || ''}"
Deliverables: ${JSON.stringify((it.outputs || []).map(o => o.text).filter(Boolean))}
In scope: ${JSON.stringify((it.scopeIn || []).map(x => x.text).filter(Boolean))}
Out of scope: ${JSON.stringify((it.scopeOut || []).filter(Boolean))}
Write their way as ordered steps. Keep EVERY step they gave, in their order and their words (only tidied). Add a step ONLY where something the purpose or deliverables above clearly need has no step of its own — for example a review the deliverables call for, or a step another of their steps depends on. Add at most 3, never anything outside what they and the intent say, and none if their steps already cover it. For each added step, "why": one short sentence saying what it helps with in THIS work.
${typeof ipLang === 'function' ? ipLang() : ''}
Respond ONLY with {"steps": [{"step": "short phrase", "added": false, "why": ""}]}.`, { maxTokens: 700 });
      const steps = (Array.isArray(res && res.steps) ? res.steps : []).filter(x => x && str(x.step)).slice(0, 12).map(x => ({ step: str(x.step), added: x.added === true, why: x.added === true ? str(x.why) : '' }));
      if(steps.filter(x => !x.added).length) return steps;
    } catch(e){ if(e && e.code === 'NO_KEY') throw e; }
    return mine.map(step => ({ step, added: false, why: '' })); // the AI couldn't: their own steps, as written
  }
  const addedNames = steps => steps.filter(x => x.added).map(x => x.step);
  const joinNames = a => a.length < 2 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  async function build(id, o){
    const w = W(), way = wayById(id); o = o || {}; if(!way || w.building || IP.planningBuilding) return;
    if(way.own && !str(w.own)){ const t = document.getElementById('pw-own'); if(t) t.focus(); return; }
    if(!leaveConfirmed()) return;
    keepShown();
    if(way.own && !o.keepSteps){
      w.building = id; w.refining = true; render();
      try { w.ownSteps = await refineOwn(w); } catch(e){ w.building = ''; w.refining = false; render(); if(e && e.code === 'NO_KEY' && window.AI && AI.openSettings) AI.openSettings(); return; }
      w.building = ''; w.refining = false;
    }
    IP.planWay = way.own ? { title: 'My own way', own: true, text: str(w.own), steps: (w.ownSteps || []).slice() } : way;
    w.building = id; render();
    // Output opens straight away, showing the plan being built (user test: "open the output right away, not only the button")
    if(typeof forceExpandPanel === 'function') forceExpandPanel('output');
    await ipBuildPlanning({ keepDrafts: true });
    w.building = '';
    if(IP.lanes && !IP.planningBuilding){
      w.built[id] = snap(); w.shown = id;
      const n = IP.lanes.reduce((s, l) => s + l.steps.length, 0);
      const steps = way.own ? IP.planWay.steps || [] : [], added = steps.filter(x => x.added);
      const ownHtml = steps.length ? `<ol class="pw-flow pw-steps">${steps.map(x => `<li>${E(x.step)}${x.added ? ' <span class="pw-chip">Added</span>' : ''}</li>`).join('')}</ol>` : '';
      const why = added.length ? `<p>I added ${E(joinNames(added.map(x => `“${x.step}”`)))}: ${added.map(x => `<b>${E(x.step)}</b> — ${E(x.why || 'it fills a gap the deliverables need')}`).join('; ')}.</p><div class="pw-acts"><button type="button" class="ip-link" data-pw="own-drop">Remove ${E(joinNames(addedNames(steps)))}</button></div>` : '';
      ipAddMsg('planning', 'assistant', `Here is the plan — ${IP.lanes.length} lane${IP.lanes.length === 1 ? '' : 's'}, ${n} node${n === 1 ? '' : 's'}, built ${way.own ? 'your own way' : `the <b>${E(way.title)}</b> way`}${steps.length ? ':' : '.'}${ownHtml}${why}<p>It’s in Output: check it, edit it, then confirm.</p>`);
      if(typeof forceExpandPanel === 'function') forceExpandPanel('output');
    }
    render();
  }
  // every successful build (also a rebuild from the mode menu or an answer in chat) is kept for the way in use
  function afterBuild(){ const w = W(), id = w.building || w.shown; if(id && IP.lanes) w.built[id] = snap(); setTimeout(render, 0); } // while a new way is building, the plan belongs to that way (not to the one still marked as shown)

  // ---------- entering Planning ----------
  function enter(){
    const w = W(), it = IP.intent;
    ipSwitchNode('planning');
    // the intent changed after a plan was built: Continue rebuilds it the way already chosen
    if(w.shown && IP.lanes && !fresh(snap())){ w.sel = w.shown; render(); return build(w.shown, { keepSteps: true }); }
    if(!IP.lanes){
      if(typeof forceExpandPanel === 'function') forceExpandPanel('chat');
      if(typeof forceCollapsePanel === 'function') forceCollapsePanel('output');
    }
    ipRenderPlanning();
    if(w.sig !== sigOf() || !w.list.length) loadWays(); else render();
  }
  function emptyHtml(){
    return `<div class="pw-empty"><p class="pw-empty-t">Choose how to plan it in Chat</p><p class="pw-empty-d">Pick a way of working there — the plan is built from it.</p><button type="button" class="btn ip-btn-sm" data-pw="open-chat">Open Chat</button></div>`;
  }
  // Send with an empty box = the card's main button
  function sendEmpty(){
    const w = W(), b = w.built[w.sel];
    if(!w.sel || w.loading || w.building) return false;
    if(b && fresh(b)) show(w.sel); else build(w.sel);
    return true;
  }

  // "or type it into Chat": with My own way selected and no plan yet, what the user types is their way
  function chatText(text){
    const w = W(); if(w.sel !== 'own' || w.built.own || w.building || IP.planningBuilding) return false; // My own way picked and not built yet
    w.own = text; ipAddMsg('planning', 'user', E(text)); build('own'); return true;
  }

  // ---------- what the planner gets ----------
  function promptBlock(){
    const way = IP.planWay; if(!way) return '';
    if(way.own) return `HOW THE USER WANTS TO PLAN IT — their own way of working, in their words: "${way.text}"
${way.steps && way.steps.length ? `Its steps, in order (follow them; the ones marked "added" were suggested to fill a gap and the user kept them):\n${way.steps.map((x, i) => `${i + 1}. ${x.step}${x.added ? ` (added — ${x.why})` : ''}`).join('\n')}\n` : ''}Map it onto everything above (Entry picks, intent, scope, deliverables, answers): the plan's STRUCTURE must follow this way of working — its phases, rounds, repeated parts or parallel tracks become lanes and nodes — not just its order.

`;
    return `HOW THE USER WANTS TO PLAN IT — the way they chose: "${way.title}"${way.based ? ` (based on ${way.based})` : ''}.
How the work flows: ${way.flow.map(f => `- ${f}`).join(' ')}
Plan structure: ${way.structure || '(follow the flow above)'}
The plan's STRUCTURE must follow this way of working, not just its order: e.g. one lane per repeated part (one per chapter), visible revision rounds as their own nodes, or parallel tracks that meet — whatever this way describes. Keep everything from above (Entry picks, intent, scope, deliverables, answers).

`;
  }

  // ---------- events ----------
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-pw]'); if(!b || b.disabled) return;
    const w = W(), act = b.dataset.pw;
    if(act === 'pick'){ const id = b.dataset.id; w.sel = id; if(w.built[id] && fresh(w.built[id])) return show(id); render(); if(id === 'own') setTimeout(() => { const t = document.getElementById('pw-own'); if(t) t.focus(); }, 0); return; }
    if(act === 'build') return build(w.sel);
    if(act === 'own-drop'){ // "Remove C and E": the plan is built again from the user's own steps only
      const names = addedNames(w.ownSteps || []); if(!names.length || w.building || IP.planningBuilding) return;
      w.ownSteps = w.ownSteps.filter(x => !x.added); delete w.built.own; b.disabled = true;
      ipAddMsg('planning', 'user', E(`Remove ${joinNames(names)}`));
      ipAddMsg('planning', 'assistant', `Building the plan again from your steps only — without ${E(joinNames(names.map(x => `“${x}”`)))}.`);
      w.sel = 'own'; return build('own', { keepSteps: true });
    }
    if(act === 'show') return show(w.sel);
    if(act === 'retry') return loadWays();
    if(act === 'open-chat'){ if(typeof forceExpandPanel === 'function') forceExpandPanel('chat'); if(typeof layoutMode !== 'undefined' && layoutMode !== '3panel' && typeof setCognitiveFieldMode === 'function') setCognitiveFieldMode('chat'); const c = document.getElementById('pw-card'); if(c) c.scrollIntoView({ block: 'nearest' }); return; }
  });
  document.addEventListener('input', e => {
    if(e.target && e.target.id === 'pw-own'){ W().own = e.target.value; const btn = e.target.parentNode.querySelector('[data-pw="build"]'); if(btn) btn.disabled = !e.target.value.trim(); }
  });
  // the purpose or deliverables changed: the ways are worked out again next time Planning opens

  window.PlanWays = { enter, emptyHtml, sendEmpty, chatText, promptBlock, afterBuild, render, show, build };
})();
