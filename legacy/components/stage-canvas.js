// components/stage-canvas.js — the Cognitive Field canvas for Entry, Intent clarification, Planning and the
// Workstream result (Workstream POC, entry-v4.html). The same design as the execution-node canvas, drawn into that
// canvas's own DOM (#xc-wrap, its classes and full-space panel): About this node, one Template per stage with each
// table's Ideas below it, Inputs from the node before, post-its, cards, a Graph | Text | Sources component, Explore more,
// and voting / multi-select / Compare (components/cf-collab.js).
//
// What the Template holds, per stage (each change goes through the stage's own existing action — nothing new is
// invented about how a stage changes):
//   Entry     one section per idea category. Table = in scope (★) + "Adding" (waits for Update scope → commitInterests).
//   Intent    Who it's for · In scope · Out of scope · Deliverables — the intent document itself (ipAfterIntentChange).
//             Ideas = the intent graph's AI insights. Locked once Planning is confirmed (change it in Chat).
//   Planning  one section per lane; the table is its nodes. Adding / removing a node is asked in Planning Chat, which
//             already checks the impact on the plan (ipChatSubmit → ipPlanningChatTurn).
//   Result    one section per deliverable; the table is its done-when criteria (met / not yet), plus the nodes.
//             Changes are asked in the result Chat (exResultChatTurn).
// The page's graph for the stage (semanticAnalysis) is docked into the Graph component; Graph | Text switch in its header.
// Execution nodes keep their own canvas (exec-canvas block in the page); this one is off there.
(function(){
  'use strict';
  const need = ['ipSwitchNode', 'setCognitiveFieldMode', 'renderGraphCards', 'callClaude'];
  if(typeof IP === 'undefined' || need.some(n => typeof window[n] !== 'function') || typeof ipE !== 'function' || typeof XC_ICO === 'undefined'){ console.warn('[stage-canvas] a page function it needs is missing — off'); return; }
  const STAGES = { entry: 'Entry', intent: 'Intent clarification', planning: 'Planning', result: 'Workstream result' };
  const E = s => ipE(String(s == null ? '' : s));
  const tr = (t, n) => (typeof truncateForCard === 'function' ? truncateForCard(String(t || ''), n || 40) : String(t || '').slice(0, n || 40));
  const SC = { drag: null, mounted: false, notice: '', noticeT: 0, renderT: 0 };
  const TPL_W = 760;

  // ---------- state (per stage) ----------
  function on(){
    if(!STAGES[IP.node]) return false;
    if(IP.node === 'entry') return !!entryBase();
    return !!IP.intent;
  }
  function entryBase(){
    const b = typeof rootCategories !== 'undefined' && rootCategories && rootCategories.groundedBase ? rootCategories
      : typeof semanticAnalysis !== 'undefined' && semanticAnalysis && semanticAnalysis.groundedBase ? semanticAnalysis : null;
    return b && (b.categories || []).some(c => c && !c._skeleton) ? b : null;
  }
  const atRoot = () => typeof currentDrillIndex === 'undefined' || currentDrillIndex === -1;

  // ---------- stages: what the template shows, and how each change is applied ----------
  function chatAsk(text, done){
    if(typeof ipChatSubmit !== 'function') return notice('Chat isn’t available here.');
    if(typeof ipChatBusy !== 'undefined' && ipChatBusy) return notice('Chat is still answering — try again in a moment.');
    ipChatSubmit(text); notice(done || 'Asked in Chat — the change shows once Chat has made it.');
  }
  const ADAPT = {
    entry: {
      noun: 'scope', inLabel: '★ In scope', addLabel: 'Add to scope',
      lead: 'What goes into the workstream. Drag an idea onto a table (or double-click it), then Update scope.',
      sections(){
        const b = entryBase(); if(!b) return [];
        return b.categories.map((c, ci) => ({ c, ci })).filter(({ c }) => c && !c.hidden && !c._skeleton).map(({ c, ci }) => {
          const ts = (c.topics || []).map((t, ti) => ({ t, ti })).filter(({ t }) => t && !t._skeleton && String(t.label || '').trim());
          return { key: String(ci), label: c.label, lead: c.text || '',
            items: ts.filter(({ t }) => t.interest === 'kept' || t.interest === 'pending').map(({ t, ti }) => ({ id: String(ti), label: t.label, detail: t.detail || '', state: t.interest === 'pending' ? 'adding' : 'in', src: t.src, mine: t.origin !== 'explore' })),
            ideas: ts.filter(({ t }) => !t.interest).map(({ t, ti }) => ({ id: String(ti), label: t.label, detail: t.detail || '', why: (t.why || [])[0] || '', src: t.src })) };
        });
      },
      topic(sk, id){ const b = entryBase(), c = b && b.categories[+sk]; return c && (c.topics || [])[+id]; },
      after(){ if(typeof afterInterestChange === 'function') afterInterestChange(); if(typeof persistCategoriesChange === 'function') persistCategoriesChange(); if(typeof renderTextView === 'function') renderTextView(); render(); },
      use(sk, id){ const t = this.topic(sk, id); if(!t) return; t.interest = 'pending'; this.after(); notice(`“${tr(t.label, 40)}” will be added on Update scope.`); },
      remove(sk, id){ const t = this.topic(sk, id); if(!t) return; const was = t.interest; delete t.interest; this.after(); notice(was === 'pending' ? `“${tr(t.label, 40)}” won’t be added.` : `“${tr(t.label, 40)}” is out of scope.`); },
      leave(sk, id){
        const t = this.topic(sk, id); if(!t) return;
        if(!atRoot() || typeof markNotInterested !== 'function') return notice('Go back to the top of the graph to leave ideas out.');
        markNotInterested(`${sk}.${id}`); render();
      },
      add(sk, text, o){
        const b = entryBase(), c = b && b.categories[+sk]; if(!c) return false;
        const L = text.trim().toLowerCase(), hit = (c.topics || []).find(t => t && String(t.label).toLowerCase() === L);
        if(hit){ if(hit.interest) return notice(`“${tr(text, 40)}” is already ${hit.interest === 'kept' ? 'in scope' : 'waiting to be added'}.`), false; hit.interest = 'pending'; }
        else (c.topics = c.topics || []).push({ label: text.trim(), detail: (o && o.detail) || '', origin: o && o.ai ? 'explore' : 'grounded', interest: 'pending', why: [], _userAdded: true });
        if(typeof renderGraphCards === 'function') renderGraphCards();
        this.after(); notice(`“${tr(text, 40)}” added to ${c.label} — it goes in on Update scope.`); return true;
      },
      pending(){ return typeof pendingInterests === 'function' ? pendingInterests().length : 0; },
      commit(){ if(typeof commitInterests === 'function') commitInterests(); }
    },
    intent: {
      noun: 'intent', inLabel: 'In the intent', addLabel: 'Add to the intent',
      lead: 'The intent document itself. Drag an idea onto a table, or add your own — the document updates right away.',
      locked(){ return typeof ipLocked === 'function' && ipLocked() ? 'Planning is confirmed — the intent is locked. Ask Chat to change it.' : ''; },
      sections(){
        const it = IP.intent, ins = ((IP.intentSA || {}).categories || []).flatMap(c => (c.topics || []).filter(t => t && t.origin === 'explore')).map((t, i) => ({ id: 'x' + i, label: t.label, detail: t.detail || '' }));
        const have = new Set(it.scopeIn.map(x => x.text.trim().toLowerCase()).concat(it.scopeOut.map(x => x.trim().toLowerCase())));
        return [
          // Purpose: one post-it per point of it (a sentence), edited in place; it is the intent's Purpose field, both ways
          { key: 'purpose', label: 'Purpose', lead: 'Why this workstream exists — one point per post-it. Click a post-it to change its words.', editable: true,
            items: this.topics().map((t, i) => ({ id: String(i), label: t, state: 'in', mine: true, chip: 'Purpose' })), ideas: [] },
          { key: 'audience', label: 'Who is this outcome for?', lead: 'Who the work is for.', one: true, items: it.audience.trim() ? [{ id: '0', label: it.audience.trim(), state: 'in', mine: true }] : [], ideas: [] },
          { key: 'in', label: 'In scope', lead: 'What the workstream covers.', items: it.scopeIn.map((x, i) => ({ id: String(i), label: x.text, detail: x.fromEntry ? 'From Entry' : x.fromAI ? 'An AI idea you added' : '', state: 'in', mine: !x.fromEntry && !x.fromAI })).filter(x => x.label.trim()),
            ideas: ins.filter(x => !have.has(x.label.trim().toLowerCase()) && !(this._left || new Set()).has(x.label)) },
          { key: 'out', label: 'Out of scope', lead: 'What it deliberately leaves out.', items: it.scopeOut.map((x, i) => ({ id: String(i), label: x, state: 'in', mine: true })).filter(x => x.label.trim()), ideas: [] },
          { key: 'outputs', label: 'Deliverables', lead: 'What the workstream hands over, and when each is done.', items: it.outputs.map((o, i) => ({ id: String(i), label: o.text, detail: o.criteria.filter(Boolean).length ? `Done when: ${o.criteria.filter(Boolean).join(' · ')}` : '', state: 'in', mine: true })).filter(x => x.label.trim()), ideas: [] }
        ];
      },
      change(set){ if(typeof ipAfterIntentChange === 'function') ipAfterIntentChange(new Set(set)); render(); },
      // the Purpose as topics: split at sentence ends (and line breaks); written back as one paragraph
      topics(){ return String(IP.intent.purpose || '').split(/(?<=[.!?。])\s+|\n+/).map(x => x.trim()).filter(Boolean); },
      setTopics(ts){ IP.intent.purpose = ts.map(x => x.trim()).filter(Boolean).map(x => /[.!?。]$/.test(x) ? x : x + '.').join(' '); this.change(['purpose']); },
      edit(sk, id, text){ if(this.locked()) return notice(this.locked());
        if(sk === 'purpose'){ const ts = this.topics(); if(ts[+id] === text.trim()) return; if(text.trim()) ts[+id] = text.trim(); else ts.splice(+id, 1); this.setTopics(ts); notice('Purpose updated — the intent document shows it too.'); } },
      add(sk, text, o){
        const it = IP.intent, t = text.trim(), L = t.toLowerCase(); if(this.locked()) return notice(this.locked()), false;
        if(sk === 'purpose'){ const ts = this.topics(); if(ts.some(x => x.toLowerCase().replace(/[.!?。]$/, '') === L.replace(/[.!?。]$/, ''))) return notice('That point is already in the Purpose.'), false; this.setTopics(ts.concat(t)); notice(`Added to the Purpose — the intent document shows it too.`); return true; }
        if(sk === 'audience'){ it.audience = t; this.change(['purpose']); }
        else if(sk === 'in'){ if(it.scopeIn.some(x => x.text.trim().toLowerCase() === L)) return notice(`“${tr(t, 40)}” is already in scope.`), false; it.scopeIn.push(o && o.ai ? { text: t, fromAI: true } : { text: t }); this.change(['scope']); }
        else if(sk === 'out'){ if(it.scopeOut.some(x => x.trim().toLowerCase() === L)) return notice(`“${tr(t, 40)}” is already out of scope.`), false; it.scopeOut.push(t); this.change(['scope']); }
        else if(sk === 'outputs'){ it.outputs.push({ text: t, criteria: [], drafted: false, open: false }); this.change(['outputs']); }
        else return false;
        notice(`“${tr(t, 40)}” added to ${({ audience: 'Who is this outcome for?', in: 'In scope', out: 'Out of scope', outputs: 'Deliverables' })[sk]}.`); return true;
      },
      use(sk, id){ const x = this.sections().flatMap(s => s.ideas).find(y => y.id === id); if(x) this.add(sk === 'out' ? 'out' : 'in', x.label, { ai: true }); },
      leave(sk, id){ const x = this.sections().flatMap(s => s.ideas).find(y => y.id === id); if(!x) return; (this._left = this._left || new Set()).add(x.label); render(); notice(`“${tr(x.label, 40)}” left out — it won’t be suggested here again.`); },
      remove(sk, id){
        const it = IP.intent, i = +id; if(this.locked()) return notice(this.locked());
        if(sk === 'purpose'){ const ts = this.topics(); ts.splice(i, 1); this.setTopics(ts); }
        else if(sk === 'audience'){ it.audience = ''; this.change(['purpose']); }
        else if(sk === 'in'){ it.scopeIn.splice(i, 1); this.change(['scope']); }
        else if(sk === 'out'){ it.scopeOut.splice(i, 1); this.change(['scope']); }
        else if(sk === 'outputs'){ it.outputs.splice(i, 1); this.change(['outputs']); }
      }
    },
    planning: {
      noun: 'plan', inLabel: 'In the plan', addLabel: 'Add to the plan',
      lead: 'One table per group of the plan. Adding or removing a node is done by Planning Chat, which checks what it changes.',
      empty(){ return IP.lanes ? '' : 'There is no plan yet. Choose how to plan it in Chat, then the plan’s groups show here.'; },
      sections(){
        return (IP.lanes || []).map((l, li) => ({ key: String(li), label: `${li + 1} · ${l.title}`, lead: (l.steps[0] && l.steps[0].nodeInfo && l.steps[0].nodeInfo.sourceIntent) || '',
          items: l.steps.map((s, si) => ({ id: String(si), label: s.title, detail: `Node ${li + 1}.${si + 1}${typeof PL_TYPES !== 'undefined' && PL_TYPES[s.nodeType] ? ' · ' + PL_TYPES[s.nodeType].label : ''}`, state: 'in' })), ideas: [] }));
      },
      ref(li){ const l = IP.lanes[+li]; return `@[Group ${+li + 1} · ${l.title}]`; },
      add(sk, text){ chatAsk(`Add a node “${text.trim()}” to ${this.ref(sk)}.`); return true; },
      remove(sk, id){ const s = IP.lanes[+sk].steps[+id]; chatAsk(`Remove the node @[Node ${+sk + 1}.${+id + 1} · ${s.title}] from the plan.`); }
    },
    // The details the result is built from: what each execution node handed over (its output, line by line), or the AI's
    // estimate for a node not finished yet. Add, reword or take out a detail, then Update result rebuilds it from them
    // (exCompile). The changes are for the result only — a node's own hand-off to the nodes after it doesn't change.
    result: {
      noun: 'result', inLabel: 'Used in the result', addLabel: 'Add to the result',
      lead: 'The details the result is built from — one table per execution node. Add a detail, click one to reword it, or drag it off to take it out; then Update result.',
      own(){ return EX.scDetails || (EX.scDetails = {}); },
      dirty(){ return EX.scDirty || (EX.scDirty = new Set()); },
      base(k){ const st = EX.steps[k], so = EX.resultSim && EX.resultSim.outputs && EX.resultSim.outputs[k];
        return st && st.done && st.output ? { lines: lines(st.output), from: 'node' } : so ? { lines: lines(so), from: 'ai' } : { lines: lines(st && st.output), from: st && st.output ? 'node' : 'none' }; },
      linesOf(k){ const o = this.own()[k]; return o ? o.slice() : this.base(k).lines; },
      sections(){
        return (typeof exAllKeys === 'function' ? exAllKeys() : []).map(k => {
          const [li, si] = exParse(k), st = EX.steps[k], b = this.base(k), own = this.own()[k], ls = this.linesOf(k);
          const status = st && st.done ? 'Done — its output' : b.from === 'ai' ? 'Not finished — the AI’s estimate' : 'Not finished — no output yet';
          return { key: k, label: `${li + 1}.${si + 1} · ${exStep(k).title}`, lead: `${status}${own ? ' · adjusted by you' : ''}${this.dirty().has(k) ? ' · not in the result yet' : ''}`, editable: true,
            items: ls.map((t, i) => ({ id: String(i), label: t, state: this.dirty().has(k) ? 'adding' : 'in', mine: !!own, chip: own ? 'Adjusted' : b.from === 'ai' ? 'AI estimate' : 'From the node' })), ideas: [] };
        });
      },
      set(k, ls){ this.own()[k] = ls.filter(x => x.trim()); this.dirty().add(k); render(); },
      add(sk, text){ if(!EX.steps[sk] && !exStep(sk)) return false; this.set(sk, this.linesOf(sk).concat(text.trim())); notice('Detail added — press Update result to rebuild it with this.'); return true; },
      edit(sk, id, text){ const ls = this.linesOf(sk); if(ls[+id] === text.trim()) return; if(text.trim()) ls[+id] = text.trim(); else ls.splice(+id, 1); this.set(sk, ls); notice('Detail changed — press Update result to rebuild it.'); },
      remove(sk, id){ const ls = this.linesOf(sk); ls.splice(+id, 1); this.set(sk, ls); notice('Detail taken out — press Update result to rebuild without it.'); },
      pending(){ return this.dirty().size; },
      commit(){
        if(typeof exCompile !== 'function' || EX.resultBusy) return notice('The result is being built — try again in a moment.');
        // a node not finished yet: your details stand in for the AI's estimate, so it isn't written again
        Object.keys(this.own()).forEach(k => { if(!(EX.steps[k] && EX.steps[k].done)){ EX.resultSim = EX.resultSim || { outputs: {} }; EX.resultSim.outputs[k] = this.own()[k].join('\n'); } });
        this.dirty().clear(); notice('Rebuilding the result from these details…'); exCompile();
      }
    }
  };
  const A = () => ADAPT[IP.node];

  // ---------- per stage: "About this node", "Right now" and the Inputs from the node before ----------
  const lines = t => String(t || '').split(/\n+/).map(x => x.replace(/^[-*#>\s]+/, '').replace(/\*\*/g, '').trim()).filter(x => x.length > 2);
  const request = () => ((document.getElementById('s1-topic') || {}).value || window.__topic || '').trim();
  const INFO = {
    entry: {
      title: () => 'Entry node', kicker: () => request() || 'Your request',
      cover: 'What the workstream is about, and the ideas you want in scope.', uses: 'Intent clarification',
      now(){ const n = ADAPT.entry.pending();
        return n ? { now: `${n} idea${n === 1 ? '' : 's'} waiting — press Update scope to add ${n === 1 ? 'it' : 'them'}.`, how: ['The waiting ones are dashed on the tables (“Adding”).', 'Press Update scope in the bar at the bottom.'], why: 'Only what is in scope carries into Intent clarification.' }
          : { now: 'Pick what goes into the workstream.', how: ['Drag the ideas you want onto a table (or double-click one).', 'Missing one? Use + Add on the table.', 'Then press Update scope.'], why: 'What is in scope becomes the starting point of Intent clarification.' }; },
      inputs(){ const r = request(); return r ? [{ from: 'Your request', title: 'What you typed on the start page', lines: lines(r) }] : []; }
    },
    intent: {
      title: () => (IP.intent && IP.intent.name) || 'Intent clarification', kicker: () => (IP.intent && IP.intent.purpose) || '',
      cover: 'Purpose, who it’s for, what is in and out of scope, and the deliverables with when each is done.', uses: 'Planning',
      now(){ const it = IP.intent;
        if(ADAPT.intent.locked()) return { now: 'The intent is confirmed with the plan.', how: ['Ask Chat to change it — Chat checks what the change does to the plan.'], why: 'The plan is built from this intent.' };
        if(!it.audience.trim()) return { now: 'Say who the work is for.', how: ['Write it on “Who is this outcome for?” with + Add.'], why: 'Who it’s for shapes the deliverables and the plan.' };
        if(!it.outputs.some(o => o.text.trim())) return { now: 'Add at least one deliverable.', how: ['Use + Add on Deliverables.', 'Or drag a line from Inputs onto it.'], why: 'Planning cuts the work from the deliverables.' };
        return { now: 'Check the scope, then continue to planning.', how: ['Drag ideas into In scope or Out of scope.', 'Press “Continue to planning” in the Output.'], why: 'Planning builds the plan from this intent.' }; },
      inputs(){ const it = IP.intent; if(!it) return []; const h = window.__lastHandoff || {};
        const ls = [request() && `Request: ${request()}`, h.purpose && `Purpose: ${h.purpose}`].concat(it.scopeIn.filter(x => x.fromEntry).map(x => `In scope: ${x.text}`)).filter(Boolean);
        return [{ from: 'From Entry', title: 'What Entry handed over', lines: ls }]; }
    },
    planning: {
      title: () => 'Planning', kicker: () => IP.objective || (IP.intent && IP.intent.purpose) || '',
      cover: 'The groups (lanes) of the plan and the nodes in each, in the order they run.', uses: 'The execution nodes',
      now(){ if(!IP.lanes) return { now: 'Choose how to plan it in Chat.', how: ['Pick one of the ways in Chat, then Build the plan.'], why: 'Each way of working gives a different plan.' };
        if(!IP.planningConfirmed) return { now: 'Review the plan, then confirm it.', how: ['Each table is one group of nodes.', 'Add or take out a node here — Planning Chat makes the change.', 'Press Confirm planning in the Output.'], why: 'Confirming starts the execution nodes.' };
        return { now: 'The plan is confirmed — open the next node.', how: ['Use the stepper at the top, or the plan in the Output.'], why: 'Each node’s output feeds the nodes after it.' }; },
      inputs(){ const it = IP.intent; if(!it) return [];
        const ls = [it.purpose && `Purpose: ${it.purpose}`, it.audience && `For: ${it.audience}`].concat(it.scopeIn.map(x => `In scope: ${x.text}`), it.scopeOut.map(x => `Out of scope: ${x}`), it.outputs.filter(o => o.text.trim()).map(o => `Deliverable: ${o.text}${o.criteria.filter(Boolean).length ? ` — done when ${o.criteria.filter(Boolean).join('; ')}` : ''}`)).filter(Boolean);
        return [{ from: 'From Intent clarification', title: it.name || 'The confirmed intent', lines: ls }]; }
    },
    result: {
      title: () => (EX.result && EX.result.title) || 'Workstream result', kicker: () => (EX.result && EX.result.summary) || (IP.intent && IP.intent.purpose) || '',
      cover: 'The details each execution node handed over — the result is built from them, deliverable by deliverable.', uses: 'Whoever the workstream is for',
      now(){ const n = ADAPT.result.pending(), r = EX.result, unmet = r && r.items ? r.items.reduce((s, it) => s + it.crit.filter(c => !c.ok).length, 0) : 0;
        if(EX.resultBusy) return { now: 'Wait a moment — the result is being built from these details.', how: [], why: '' };
        if(n) return { now: `${n} node${n === 1 ? '' : 's'}’ details changed — press Update result.`, how: ['The changed tables say “not in the result yet”.', 'Update result is in the bar at the bottom.'], why: 'The result is rebuilt from the details as they are now.' };
        if(!r) return { now: 'Check the details, then generate the result.', how: ['Add a detail a node missed, or reword one.', 'Press Update result (or Generate in the Output).'], why: 'The result is written from these details only.' };
        return unmet ? { now: `${unmet} done-when point${unmet === 1 ? '' : 's'} not met yet — add the missing detail.`, how: ['Inputs lists what each deliverable must have.', 'Add the detail on the node it belongs to, then Update result.'], why: 'A result is approved deliverable by deliverable.' }
          : { now: 'Every deliverable is met — review the result in the Output.', how: ['Adjust a detail here if something reads wrong, then Update result.'], why: '' }; },
      // what the result must deliver: each deliverable and its done-when points (met or not yet) — drag one onto a node's table as a detail
      inputs(){ const it = IP.intent, r = EX.result; if(!it) return [];
        return it.outputs.filter(o => o.text.trim()).map((o, i) => { const item = r && r.items && r.items[it.outputs.indexOf(o)];
          const crit = item ? item.crit.map(c => `${c.ok ? 'Met' : 'Not met yet'}: ${c.c}`) : o.criteria.filter(Boolean).map(c => `Done when: ${c}`);
          return { from: 'Deliverable', title: o.text, lines: crit, status: crit.length ? '' : 'No done-when points' }; }); }
    }
  };

  // ---------- DOM: the execution canvas's own (#xc-wrap) — same look, same full-space panel, same voting ----------
  const wrapEl = () => document.getElementById('xc-wrap'), world = () => document.getElementById('xc-world'), vp = () => document.getElementById('xc-vp');
  if(!wrapEl()){ console.warn('[stage-canvas] no #xc-wrap — off'); return; }
  const visible = () => { const w = wrapEl(); return w && !w.classList.contains('hidden') && w.clientWidth > 40; };
  function cv(){
    const all = IP.scCv || (IP.scCv = {}), k = IP.node;
    return all[k] || (all[k] = { zoom: 0, panX: 0, panY: 0, wid: { guide: { x: 0, y: 0, w: 400 }, inputs: { x: 0, y: 460, w: 400 }, tpl: { x: 440, y: 0, w: TPL_W }, graph: { x: 440 + TPL_W + 40, y: 0, w: 520, h: 460 } }, notes: [], cards: [], seq: 1, gmode: 'graph', trayAll: {}, tool: 'select', sel: null });
  }

  // ---------- the live graph in the Graph component (Graph | Text | Sources) ----------
  function dock(onOff){
    const gw = document.getElementById('graph-canvas-wrap'), tw = document.getElementById('text-view-wrap'), park = document.getElementById('xc-park'); if(!gw || !tw) return;
    if(onOff && !SC.mounted){ wrapEl().appendChild(gw); (park || wrapEl()).appendChild(tw); tw.classList.add('xc-nscroll'); SC.mounted = true; SC.z = 0; }
    else if(!onOff && SC.mounted){
      const card = document.getElementById('graph-card'), scr = document.getElementById('scratch-wrap');
      card.insertBefore(gw, scr); card.insertBefore(tw, scr); tw.classList.remove('xc-nscroll');
      ['left', 'top', 'width', 'height'].forEach(p => { gw.style[p] = ''; }); gw.classList.remove('hidden');
      SC.mounted = false;
    }
  }
  function livePos(){
    if(!SC.mounted || !on()) return;
    const gw = document.getElementById('graph-canvas-wrap'), tw = document.getElementById('text-view-wrap'), c = cv();
    const gs = world().querySelector('[data-scslot="graph"]'), ts = world().querySelector('[data-scslot="text"]');
    if(ts){ ts.appendChild(tw); tw.classList.remove('hidden'); } else (document.getElementById('xc-park') || wrapEl()).appendChild(tw);
    if(!gs || !visible()){ gw.classList.add('hidden'); return; }
    let x = 0, y = 0, el = gs; while(el && el !== world()){ x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent; }
    const z = c.zoom || 1, v = vp();
    gw.classList.remove('hidden');
    gw.style.left = (v.offsetLeft + c.panX + x * z) + 'px'; gw.style.top = (v.offsetTop + c.panY + y * z) + 'px';
    gw.style.width = (gs.offsetWidth * z) + 'px'; gw.style.height = (gs.offsetHeight * z) + 'px';
  }
  function sources(){ // the pages this stage's searches used (the same list as the old Sources tab)
    const key = typeof srcKey === 'function' ? srcKey() : IP.node, m = new Map((typeof NODE_SOURCES !== 'undefined' && NODE_SOURCES[key]) || []);
    if(key === 'entry' && typeof lastAnswerSources !== 'undefined') (lastAnswerSources || []).forEach(s => { if(s && s.url && !m.has(s.url)) m.set(s.url, { url: s.url, title: s.title, from: new Set(['Output']) }); });
    return [...m.values()].map(s => ({ url: s.url, title: s.title, from: [...(s.from || [])] }));
  }

  // ---------- render ----------
  function render(){
    if(!on()) return;
    if(!visible()){ SC.stale = true; return; }
    if(SC.drag && SC.drag.started){ SC.renderAgain = true; return; }
    SC.stale = false; SC.drawn = IP.node;
    const c = cv(), a = A(), ae = document.activeElement, keep = ae && wrapEl().contains(ae) && ae.dataset && ae.dataset.scEdit ? [ae.dataset.scEdit, ae.value] : null;
    wrapEl().dataset.tool = c.tool || 'select';
    const hint = document.getElementById('xc-empty-hint'); if(hint) hint.classList.add('hidden');
    world().innerHTML = guideHtml(c) + tplHtml(a, c) + inputsHtml(c) + graphHtml(c) + c.cards.map(cardHtml).join('') + c.notes.map(noteHtml).join('');
    world().querySelectorAll('textarea').forEach(t => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; });
    // until moved, Inputs sits under About this node
    const g = world().querySelector('[data-wid="guide"]'), inp = world().querySelector('[data-wid="inputs"]');
    if(g && inp && !c.wid.inputs.moved){ c.wid.inputs.y = g.offsetTop + g.offsetHeight + 24; inp.style.top = c.wid.inputs.y + 'px'; }
    if(!c.zoom) home();
    apply(); bar(); snack();
    if(keep){ const m = wrapEl().querySelector(`[data-sc-edit="${keep[0]}"]`); if(m){ m.value = keep[1]; m.focus({ preventScroll: true }); } }
    if(SC.focus){ const t = wrapEl().querySelector(SC.focus); SC.focus = null; if(t) t.focus(); }
    if(window.CF) CF.afterRender(); // voting dots, selection marks, Compare tables
  }
  function soon(){ clearTimeout(SC.renderT); SC.renderT = setTimeout(render, 60); }
  function apply(){
    const c = cv(), z = c.zoom || 1; world().style.transform = `translate(${c.panX}px, ${c.panY}px) scale(${z})`;
    const n = document.getElementById('xc-zoom-n'); if(n) n.textContent = Math.round(z * 100) + '%';
    if(SC.mounted && SC.z && SC.z !== z && typeof applyGraphTransform === 'function'){ const f = z / SC.z; graphZoom *= f; graphPanX *= f; graphPanY *= f; applyGraphTransform(); }
    SC.z = z; livePos();
  }
  // The template's default width fits the canvas view at 100% (user request), never wider than its natural width;
  // drag its edge to make it narrower (down to 300).
  function fitW(natural){ const v = vp(), avail = v && v.clientWidth > 200 ? v.clientWidth - 110 : natural; return Math.round(Math.max(340, Math.min(natural, avail))); }
  // ---------- Undo / Redo (Ctrl/⌘+Z, Ctrl/⌘+Shift+Z or Ctrl+Y) ----------
  // A snapshot of what the canvas changes, taken before each change: post-its, cards and where components are, plus the
  // stage's own data the template edits (Entry: what's in scope; Intent: purpose, who for, scope, deliverables; result:
  // your adjusted details). Plan changes are made by Planning Chat and aren't undone here.
  const HIST = {};
  function stageData(){
    if(IP.node === 'entry'){ const b = entryBase(); return b ? { cats: b.categories, ni: b.notInterested || [] } : null; }
    if(IP.node === 'intent' && IP.intent){ const it = IP.intent; return { purpose: it.purpose, audience: it.audience, scopeIn: it.scopeIn, scopeOut: it.scopeOut, outputs: it.outputs }; }
    if(IP.node === 'result') return { own: EX.scDetails || {}, dirty: [...(EX.scDirty || [])] };
    return null;
  }
  const snapStr = () => { const c = cv(); return JSON.stringify({ cv: { notes: c.notes, cards: c.cards.filter(x => !x.busy), wid: c.wid }, data: stageData() }); };
  function snap(){ const h = HIST[IP.node] || (HIST[IP.node] = { u: [], r: [] }), s = snapStr(); if(h.u[h.u.length - 1] === s) return; h.u.push(s); if(h.u.length > 60) h.u.shift(); h.r = []; }
  function restoreSnap(str){
    const o = JSON.parse(str), c = cv(); c.notes = o.cv.notes; c.cards = o.cv.cards; c.wid = o.cv.wid; c.sel = null;
    if(IP.node === 'entry' && o.data){ const b = entryBase(); if(b){ b.categories.splice(0, b.categories.length, ...o.data.cats); b.notInterested = o.data.ni; }
      if(typeof persistCategoriesChange === 'function') persistCategoriesChange(); renderGraphCards(); if(typeof renderInterestSnackbar === 'function') renderInterestSnackbar(); if(typeof renderTextView === 'function') renderTextView(); }
    if(IP.node === 'intent' && o.data && IP.intent){ Object.assign(IP.intent, o.data); if(typeof ipAfterIntentChange === 'function') ipAfterIntentChange(new Set(['purpose', 'scope', 'outputs'])); }
    if(IP.node === 'result' && o.data){ EX.scDetails = o.data.own; EX.scDirty = new Set(o.data.dirty); }
    render();
  }
  function undo(redo){
    const h = HIST[IP.node], from = h && (redo ? h.r : h.u), to = h && (redo ? h.u : h.r);
    if(!from || !from.length) return notice(redo ? 'Nothing to redo.' : 'Nothing to undo here.');
    to.push(snapStr()); restoreSnap(from.pop()); notice(redo ? 'Redone.' : 'Undone — Ctrl/⌘+Shift+Z to redo.');
  }
  // first view: About + Template when there's room; in a narrow panel the template alone, readable (About is a pan away)
  function home(){ const c = cv(), v = vp(); if(!v || v.clientWidth < 40) return; const both = (v.clientWidth - 80) / (440 + TPL_W);
    if(both >= 0.55){ c.zoom = Math.min(1, both); c.panX = 56; c.panY = 54; } else { c.zoom = Math.max(0.35, Math.min(1, (v.clientWidth - 80) / fitW(TPL_W))); c.panX = 56 - c.wid.tpl.x * c.zoom; c.panY = 54; } }
  function fit(){
    const els = [...world().querySelectorAll('.xc-w, .xc-note')]; if(!els.length) return;
    const bx = els.map(el => ({ x: el.offsetLeft, y: el.offsetTop, r: el.offsetLeft + el.offsetWidth, b: el.offsetTop + el.offsetHeight }));
    const x0 = Math.min(...bx.map(b => b.x)), y0 = Math.min(...bx.map(b => b.y)), x1 = Math.max(...bx.map(b => b.r)), y1 = Math.max(...bx.map(b => b.b)), v = vp(), c = cv();
    c.zoom = Math.max(0.05, Math.min(1.2, (v.clientWidth - 90) / (x1 - x0), (v.clientHeight - 110) / (y1 - y0)));
    c.panX = 56 - x0 * c.zoom; c.panY = 54 - y0 * c.zoom; apply();
  }
  function zoomTo(id){ const el = world().querySelector(`[data-wid="${id}"]`), c = cv(), v = vp(); if(!el){ if(c.wid[id]){ c.wid[id].hidden = false; render(); return setTimeout(() => zoomTo(id), 30); } return; }
    const z = Math.max(0.5, Math.min(1, (v.clientWidth - 80) / el.offsetWidth)); c.zoom = z; c.panX = 40 - el.offsetLeft * z; c.panY = 54 - el.offsetTop * z; apply(); }
  function zoomBy(f, cx, cy){
    const c = cv(), z0 = c.zoom || 1, z = Math.max(0.05, Math.min(2.5, z0 * f)), v = vp();
    cx = cx == null ? v.clientWidth / 2 : cx; cy = cy == null ? v.clientHeight / 2 : cy;
    c.panX = cx - (cx - c.panX) * z / z0; c.panY = cy - (cy - c.panY) * z / z0; c.zoom = z; apply();
  }
  const toWorld = (x, y) => { const r = vp().getBoundingClientRect(), c = cv(), z = c.zoom || 1; return { x: (x - r.left - c.panX) / z, y: (y - r.top - c.panY) / z }; };
  function bar(){
    const c = cv();
    document.getElementById('xc-bar').innerHTML = `<span class="xc-seg" role="group" aria-label="Widgets">
        <button type="button" data-sc="zoom-w" data-wid="graph" title="Go to the Graph (Text and Sources are in its header)">Graph</button>
        <button type="button" data-sc="zoom-w" data-wid="inputs" title="Go to the Inputs from the node before">Inputs</button>
        <button type="button" data-sc="zoom-w" data-wid="tpl" title="Go to the template">Template</button>
      </span><span class="xc-bar-sp"></span>`;
    document.getElementById('xc-zoom').innerHTML = `<button type="button" data-sc="zoom-out" title="Zoom out" aria-label="Zoom out">−</button>
      <button type="button" class="xc-zoom-n" id="xc-zoom-n" data-sc="zoom-reset" title="Back to 100%">${Math.round((c.zoom || 1) * 100)}%</button>
      <button type="button" data-sc="zoom-in" title="Zoom in" aria-label="Zoom in">+</button>
      <button type="button" data-sc="fit" title="Fit everything" aria-label="Fit everything">${XC_ICO.fit}</button>`;
    document.querySelectorAll('#xc-wrap .xc-rail [data-tool]').forEach(b => { b.classList.toggle('on', b.dataset.tool === (c.tool || 'select')); b.setAttribute('aria-pressed', b.dataset.tool === (c.tool || 'select')); });
  }
  function notice(t){ SC.notice = t; clearTimeout(SC.noticeT); SC.noticeT = setTimeout(() => { SC.notice = ''; snack(); }, 6000); snack(); }
  function snack(){
    const slot = document.getElementById('xc-snack-slot'); if(!slot || !on()) return;
    const a = A(), n = a.pending ? a.pending() : 0, msg = SC.notice || (n ? `${n} change${n === 1 ? '' : 's'} to the ${a.noun}` : '');
    slot.innerHTML = msg ? `<div class="xc-snack" role="status"><span class="xc-snack-ai">${XC_ICO.spark}</span><span class="xc-snack-t">${E(msg)}</span>${n ? `<button type="button" data-sc="commit">Update ${E(a.noun)} · ${n}</button>` : ''}</div>` : '';
  }
  const selIs = (t, sk, id) => { const s = cv().sel; return !!(s && s.t === t && s.sk === sk && s.id === id); };
  const head = (id, title, sub, extra, wd, noHide) => `<div class="xc-w-h" data-whead="${id}"><span class="xc-w-t">${title}</span>${sub ? `<span class="xc-w-sub" title="${E(sub)}">${E(sub)}</span>` : ''}<span class="xc-sp"></span>${extra || ''}
      <button type="button" class="xc-icon-btn" data-sc="collapse" data-wid="${id}" aria-label="${wd.collapsed ? 'Expand' : 'Collapse'}" aria-expanded="${!wd.collapsed}">${wd.collapsed ? '▸' : '▾'}</button>${noHide ? '' : `<button type="button" class="xc-icon-btn" data-sc="hide" data-wid="${id}" aria-label="Hide">×</button>`}</div>`;
  const TPL_ICO = typeof IP_TPL_ICO !== 'undefined' ? IP_TPL_ICO : '';

  // About this node: what it is, what to do right now, and what it must cover
  function guideHtml(c){
    const wd = c.wid.guide, inf = INFO[IP.node], g = inf.now();
    return `<section class="xc-w xc-w--tpl xc-w--about xc-w--guide${wd.collapsed ? ' xc-w--collapsed' : ''}" data-wid="guide" style="left:${wd.x}px;top:${wd.y}px;width:${wd.w}px" aria-label="About this node">
      ${head('guide', `${TPL_ICO}About this node`, '', '', wd, true)}
      ${wd.collapsed ? '' : `<div class="xc-w-b"><p class="xc-tpl-title">${E(inf.title())}</p>${inf.kicker() ? `<p class="xc-tpl-kicker">${E(inf.kicker())}</p>` : ''}
        <div class="xc-now xc-now--canvas" role="status" aria-live="polite"><p class="xc-now-k">Right now · ${E(STAGES[IP.node])}</p><p class="xc-now-t">${E(g.now)}</p>${g.how && g.how.length ? `<ol class="xc-now-how">${g.how.map(x => `<li>${E(x)}</li>`).join('')}</ol>` : ''}${g.why ? `<p class="xc-now-why"><b>Why:</b> ${E(g.why)}</p>` : ''}</div>
        <details class="xc-about-more"><summary>About this node — what it must cover</summary><div class="xc-about" role="note"><dl><dt>Covers</dt><dd>${E(inf.cover)}</dd><dt>Builds on</dt><dd>${E(IP.node === 'entry' ? 'Your request' : INFO[IP.node].inputs().map(x => x.from.replace(/^From /, '')).filter((v, i, s) => s.indexOf(v) === i).join(', ') || '—')}</dd><dt>Used by</dt><dd>${E(inf.uses)}</dd></dl></div></details></div>`}</section>`;
  }
  // the template: one section per part, the table first and its ideas below (as in the execution canvas)
  function tplHtml(a, c){
    const secs = a.sections(), wd = c.wid.tpl, lock = a.locked ? a.locked() : '', empty = a.empty ? a.empty() : '';
    const body = empty ? `<p class="xc-hint">${E(empty)}</p>` : `<div class="xc-cols xc-cols--one">${secs.map((s, i) => secHtml(a, s, i, c, lock)).join('')}</div>`;
    return `<section class="xc-w xc-w--tpl${wd.collapsed ? ' xc-w--collapsed' : ''}" data-wid="tpl" style="left:${wd.x}px;top:${wd.y}px;width:${wd.w || fitW(TPL_W)}px" aria-label="Template">
      ${head('tpl', `${TPL_ICO}Template · ${E(STAGES[IP.node])}`, a.lead, '', wd, true)}
      ${wd.collapsed ? '' : `<div class="xc-w-b">${lock ? `<div class="banner ex-banner" role="note">${E(lock)}</div>` : ''}${body}</div><span class="xc-w-grip" data-sc-grip="tpl" title="Drag to change the width" aria-hidden="true"></span>`}</section>`;
  }
  function secHtml(a, s, i, c, lock){
    const ro = !!lock || s.ro, ideas = s.ideas || [], all = c.trayAll[s.key], shown = all ? ideas : ideas.slice(0, 6);
    const inN = s.items.filter(x => x.state === 'in').length, addN = s.items.filter(x => x.state === 'adding').length;
    const tray = ideas.length && !ro ? `<div class="xc-tray" aria-label="Ideas"><p class="xc-tray-h">Ideas · ${ideas.length} <span>· drag one onto the table, or double-click it · drag it onto the canvas to make it a card · select it and press Delete to leave it out</span></p>
      <div class="xc-tray-list">${shown.map(x => ideaHtml(s, x)).join('')}${ideas.length > 6 ? `<button type="button" class="ip-mini" data-sc="tray-all" data-sk="${E(s.key)}">${all ? 'Show fewer' : `+${ideas.length - 6} more`}</button>` : ''}</div></div>` : '';
    const adding = SC.adding === s.key ? `<div class="xc-pi xc-pi--user"><div class="xc-pi-top"><span class="xc-chip">You</span><span class="xc-sp"></span></div><textarea class="xc-pi-text" rows="2" data-sc-edit="new:${E(s.key)}" placeholder="Write it, then press Enter" aria-label="New item for ${E(s.label)}"></textarea></div>` : '';
    const spot = ro || (s.one && s.items.length) || SC.adding === s.key ? '' : `<button type="button" class="xc-spot" data-sc="spot" data-sk="${E(s.key)}">+ Add to ${E(s.label)}</button>`;
    const count = IP.node === 'result' ? s.lead : `${inN} ${a.inLabel.replace(/^★\s*/, '').toLowerCase()}${addN ? ` · +${addN} on update` : ''}`;
    return `<div class="xc-sec xc-sec--current" id="xc-sec-sc-${E(s.key)}" data-sec="sc-${E(s.key)}">
      <div class="xc-sec-h"><span class="xc-sec-n">${i + 1}</span><span class="xc-sec-t">${E(s.label)}</span><span class="xc-count${inN ? ' is-met' : ''}">${E(count)}</span></div>
      ${s.lead && IP.node !== 'result' ? `<p class="xc-lead">${E(s.lead)}</p>` : ''}
      <div class="xc-split${tray ? '' : ' xc-split--one'}">${tray}<div class="xc-table" data-zone="${E(s.key)}"${ro ? ' data-ro="1"' : ''} data-drop="${E(s.label)}" aria-label="${E(s.label)}">${s.items.map(x => itemHtml(a, s, x, ro)).join('')}${adding}${spot}</div></div></div>`;
  }
  function itemHtml(a, s, x, ro){
    const adding = x.state === 'adding', tone = adding ? 'draft' : x.mine ? 'user' : 'smart';
    const src = x.src && x.src.url ? `<a class="xc-chip" href="${E(x.src.url)}" target="_blank" rel="noopener">↗ ${E(typeof rsDomain === 'function' ? rsDomain(x.src.url) : x.src.url)}</a>` : '';
    return `<div class="xc-pi xc-pi--${tone}${x.warn ? ' sc-pi--warn' : ''}${selIs('pi', s.key, x.id) ? ' is-sel' : ''}" data-pi="${E(s.key)}:${E(x.id)}"${ro ? '' : ` data-drag="pi:${E(s.key)}:${E(x.id)}"`} tabindex="-1">
      <div class="xc-pi-top"><span class="xc-chip">${x.chip ? E(x.chip) : x.mine ? 'You' : adding ? 'Adding' : E(a.inLabel)}</span>${src}<span class="xc-sp"></span></div>
      ${s.editable && !ro ? `<textarea class="xc-pi-text" rows="1" data-sc-edit="edit:${E(s.key)}:${E(x.id)}" aria-label="${E(s.label)}: edit">${E(x.label)}</textarea>` : `<p class="xc-pi-p">${E(x.label)}</p>`}${x.detail ? `<p class="xc-pi-d">${E(tr(x.detail, 140))}</p>` : ''}
      ${adding ? `<div class="xc-pi-tags"><span class="xc-tag xc-tag--draft">Adds on Update ${E(a.noun)}</span></div>` : ''}</div>`;
  }
  // an idea is the same post-it it becomes on the table, only dashed: drag it on, double-click it, or Enter; Delete leaves it out
  function ideaHtml(s, x){
    return `<div class="xc-idea xc-pi xc-pi--idea-card${selIs('idea', s.key, x.id) ? ' is-sel' : ''}" data-idea="${E(s.key)}:${E(x.id)}" data-drag="idea:${E(s.key)}:${E(x.id)}" tabindex="-1" title="Drag onto the table · double-click or Enter to use · Delete to leave it out">
      <div class="xc-idea-b"><p class="xc-idea-t">${E(x.label)}</p>${x.detail ? `<p class="xc-idea-d">${E(tr(x.detail, 140))}</p>` : ''}${x.why ? `<p class="xc-idea-w">Why: ${E(x.why)}</p>` : ''}${x.src && x.src.url ? `<a class="xc-chip" href="${E(x.src.url)}" target="_blank" rel="noopener">↗ ${E(typeof rsDomain === 'function' ? rsDomain(x.src.url) : x.src.url)}</a>` : ''}</div></div>`;
  }
  // Inputs: what the node before handed over — every line can be dragged onto a table (or the canvas: a post-it)
  function inputsHtml(c){
    const wd = c.wid.inputs; if(wd.hidden) return '';
    const ins = INFO[IP.node].inputs(); SC.inLines = [];
    const body = ins.length ? ins.map(x => `<article class="xc-in xc-in-doc"><header class="xc-in-h"><span class="xc-in-from">${E(x.from)}</span><b>${E(x.title)}</b>${x.status ? `<span class="xc-hint">${E(x.status)}</span>` : ''}</header>
      ${x.lines.length ? x.lines.map((t, li) => { const i = SC.inLines.push(t) - 1, m = /^([^:]{2,40}):\s+(.+)$/.exec(t);
        return `<p class="xc-in-line${li === 0 ? ' xc-in-lead' : ''}${selIs('in', '', String(i)) ? ' is-sel' : ''}" tabindex="0" data-sc-in="${i}" data-drag="in:${i}" title="Drag onto the template to use it">${m ? `<b>${E(m[1])}:</b> ${E(m[2])}` : E(t)}</p>`; }).join('') : `<p class="xc-hint">${x.status ? 'Nothing handed over yet.' : 'Nothing here.'}</p>`}</article>`).join('')
      : `<p class="xc-hint">${IP.node === 'entry' ? 'The Entry node starts from your request.' : 'Nothing was handed over yet.'}</p>`;
    return `<section class="xc-w${wd.collapsed ? ' xc-w--collapsed' : ''}" data-wid="inputs" style="left:${wd.x}px;top:${wd.y}px;width:${wd.w}px" aria-label="Inputs">
      ${head('inputs', 'Inputs', IP.node === 'entry' ? 'Your request — drag a line onto the template' : 'What the node before settled — drag a line onto the template', '', wd)}
      ${wd.collapsed ? '' : `<div class="xc-w-b xc-scroll">${body}</div><span class="xc-w-grip" data-sc-grip="inputs" title="Drag to change the width" aria-hidden="true"></span>`}</section>`;
  }
  function graphHtml(c){
    const wd = c.wid.graph; if(wd.hidden) return '';
    const m = c.gmode || 'graph', srcs = sources();
    const seg = `<span class="xc-seg xc-gmode" role="group" aria-label="View">${['graph', 'text', 'sources'].map(x => `<button type="button" data-sc="gmode" data-m="${x}" class="${m === x ? 'on' : ''}" aria-pressed="${m === x}">${x === 'graph' ? 'Graph' : x === 'text' ? 'Text' : `Sources · ${srcs.length}`}</button>`).join('')}</span>`;
    const body = m === 'sources' ? `<div class="xc-tslot"><div class="xc-srcs xc-nscroll"><p class="xc-srcs-h">Pages this node’s searches used · ${srcs.length}</p>
        ${window.__canSearch === false ? '<p class="xc-hint">This view can’t search the web (the published claude.ai version has no web search).</p>' : ''}
        ${srcs.length ? `<ol class="xc-srcs-list">${srcs.map(s => `<li><a href="${E(s.url)}" target="_blank" rel="noopener">${E(s.title || s.url)} ↗</a><span class="xc-hint">${E(typeof rsDomain === 'function' ? rsDomain(s.url) : s.url)}${s.from.length ? ' · ' + s.from.map(E).join(', ') : ''}</span></li>`).join('')}</ol>` : `<p class="xc-hint">No pages yet. When this node searches the web (ideas, chat research), the pages appear here.</p>`}</div></div>`
      : m === 'text' ? '<div class="xc-tslot" data-scslot="text"></div>' : '<div class="xc-gslot" data-scslot="graph"></div>';
    return `<section class="xc-w xc-w--live is-active${wd.collapsed ? ' xc-w--collapsed' : ''}" data-wid="graph" data-graph="1" style="left:${wd.x}px;top:${wd.y}px;width:${wd.w}px;height:${wd.collapsed ? 'auto' : wd.h + 'px'}" aria-label="Graph">
      ${head('graph', 'Graph', STAGES[IP.node], seg, wd)}
      ${wd.collapsed ? '' : `<div class="xc-w-b">${body}</div><span class="xc-w-grip" data-sc-grip="graph" title="Drag to resize" aria-hidden="true"></span>`}</section>`;
  }
  function cardHtml(k){
    const a = A(), pts = k.points ? `<ul class="sc-pts">${k.points.map((p, i) => `<li><b>${E(p.label)}</b>${p.detail ? ` — ${E(p.detail)}` : ''} <button type="button" class="ip-mini" data-sc="pt-note" data-id="${k.id}" data-i="${i}">Make post-it</button></li>`).join('')}</ul>` : '';
    const state = k.busy ? '<p class="xc-hint" role="status">Exploring…</p>' : k.err ? `<div class="banner ex-banner" role="alert">Couldn’t explore it — ${E(k.err)} <button type="button" class="ip-mini" data-sc="card-explore" data-id="${k.parent || k.id}">Try again</button></div>` : '';
    return `<section class="xc-w xc-w--card" data-wid="${k.id}" data-card="${k.id}" style="left:${k.x}px;top:${k.y}px" aria-label="${E(k.kind)}: ${E(k.label)}">
      <div class="xc-w-h" data-whead="${k.id}"><span class="xc-w-t">${E(k.kind)}</span><span class="xc-sp"></span><button type="button" class="xc-icon-btn" data-sc="card-close" data-id="${k.id}" aria-label="Remove ${E(k.label)}">×</button></div>
      <div class="xc-w-b"><p class="xc-card-t">${E(k.label)}</p>${k.detail ? `<p class="xc-card-d">${E(k.detail)}</p>` : ''}${state}${pts}
        ${k.sk != null ? `<button type="button" class="xc-card-from" data-sc="card-tpl" data-id="${k.id}" title="Go to its table on the template"><svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2"/><circle cx="8" cy="8" r="5.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2"/></svg><span>From ${E(k.from)}</span><b>Show on template</b></button>` : ''}</div>
      ${k.points ? '' : `<div class="xc-card-foot">${k.sk != null && !(a.locked && a.locked()) ? `<button type="button" class="btn ip-btn-sm xc-card-main" data-sc="card-add" data-id="${k.id}" title="Or drag the card onto a table">${E(a.addLabel)}</button>` : ''}
        <div class="xc-card-row"><button type="button" class="ip-mini" data-sc="card-note" data-id="${k.id}">Make post-it</button><button type="button" class="ip-mini" data-sc="card-explore" data-id="${k.id}">Explore more →</button></div></div>`}</section>`;
  }
  function noteHtml(n){
    return `<div class="xc-note" data-note="${n.id}" style="left:${n.x}px;top:${n.y}px"><div class="xc-pi xc-pi--${n.ai ? 'smart' : 'user'}${selIs('note', '', n.id) ? ' is-sel' : ''}" data-drag="note:${n.id}">
      <div class="xc-pi-top"><span class="xc-chip">${E(n.from || (n.ai ? 'AI' : 'You'))}</span><span class="xc-sp"></span></div>
      <textarea class="xc-pi-text" rows="3" data-sc-edit="note:${n.id}" aria-label="Post-it text" placeholder="Write here… then drag it onto a table">${E(n.text)}</textarea></div></div>`;
  }

  // ---------- Explore more: one AI call, 3-5 angles on the item (as a card; nothing changes until you use a point) ----------
  async function explore(k){
    const c = cv(), x = { id: 'card' + (++c.seq), kind: 'Explore', label: k.label, parent: k.id, busy: true, x: k.x + 320, y: k.y, points: [] };
    c.cards.push(x); render();
    try {
      const it = IP.intent, about = it ? `${it.name}: ${it.purpose}` : request();
      const res = await callClaude(`A person is shaping a workstream ("${about}") at the ${STAGES[IP.node]} stage and wants to explore "${k.label}"${k.detail ? ` (${k.detail})` : ''}.
Give 3-5 distinct, concrete angles worth considering for it — each a short label (2-6 words) and one short sentence. Never invent facts, prices or names that may not exist.
${typeof ipLang === 'function' ? ipLang() : ''}
Respond ONLY with {"points": [{"label": "", "detail": ""}]}.`, { maxTokens: 700 });
      x.points = (res && Array.isArray(res.points) ? res.points : []).filter(p => p && typeof p.label === 'string' && p.label.trim()).slice(0, 5).map(p => ({ label: p.label.trim(), detail: String(p.detail || '').trim() }));
      if(!x.points.length) throw new Error('nothing came back');
    } catch(err){
      x.err = (err && err.message) || 'the AI request failed';
      if(err && err.code === 'NO_KEY' && window.AI && AI.openSettings) AI.openSettings();
    }
    x.busy = false; render();
  }

  // ---------- events (each listener does nothing outside the four stages) ----------
  const W = wrapEl();
  const sel = s => { cv().sel = s; world().querySelectorAll('.is-sel').forEach(el => el.classList.remove('is-sel'));
    const el = !s ? null : s.t === 'pi' ? world().querySelector(`[data-pi="${s.sk}:${s.id}"]`) : s.t === 'idea' ? world().querySelector(`[data-idea="${s.sk}:${s.id}"]`) : s.t === 'note' ? world().querySelector(`[data-note="${s.id}"] .xc-pi`) : s.t === 'in' ? world().querySelector(`[data-sc-in="${s.id}"]`) : null;
    if(el){ el.classList.add('is-sel'); if(s.t !== 'note') el.focus({ preventScroll: true }); } };
  function newNote(x, y, text, o){ const c = cv(), p = x == null ? { x: 40, y: 900 } : toWorld(x, y), n = Object.assign({ id: 'n' + (++c.seq), text: text || '', x: Math.round(p.x - 80), y: Math.round(p.y - 30) }, o || {}); c.notes.push(n); if(!text) SC.focus = `[data-note="${n.id}"] textarea`; render(); return n; }
  W.addEventListener('click', e => {
    if(!on() || SC.justDragged) return;
    const t = e.target, b = t.closest('[data-sc], [data-xc-act="tool"]'), c = cv(), a = A();
    if(!b){ // a click selects a post-it, an idea or an Inputs line
      const pi = t.closest('#xc-world [data-pi]'), idea = t.closest('#xc-world [data-idea]'), note = t.closest('#xc-world [data-note]'), ln = t.closest('#xc-world [data-sc-in]');
      if(t.closest('a, textarea, input')) return;
      if(pi){ const [sk, id] = pi.dataset.pi.split(':'); return sel({ t: 'pi', sk, id }); }
      if(idea){ const [sk, id] = idea.dataset.idea.split(':'); return sel({ t: 'idea', sk, id }); }
      if(note) return sel({ t: 'note', sk: '', id: note.dataset.note });
      if(ln) return sel({ t: 'in', sk: '', id: ln.dataset.scIn });
      if(t === vp() || t === world()) sel(null);
      return;
    }
    if(b.dataset.xcAct === 'tool'){ c.tool = b.dataset.tool; return bar(), (W.dataset.tool = c.tool); }
    const id = b.dataset.id, card = () => c.cards.find(x => x.id === id), wd = b.dataset.wid && c.wid[b.dataset.wid];
    if(/^(card-close|card-note|card-add|pt-note|hide|collapse)$/.test(b.dataset.sc || '')) snap();
    switch(b.dataset.sc){
      case 'zoom-in': return zoomBy(1.2);
      case 'zoom-out': return zoomBy(1 / 1.2);
      case 'zoom-reset': return zoomBy(1 / (c.zoom || 1));
      case 'fit': return fit();
      case 'zoom-w': return zoomTo(b.dataset.wid);
      case 'collapse': if(wd){ wd.collapsed = !wd.collapsed; render(); } return;
      case 'hide': if(wd){ wd.hidden = true; render(); notice('Hidden — bring it back from the bar at the top of the canvas.'); } return;
      case 'commit': SC.notice = ''; return a.commit && a.commit(), setTimeout(soon, 50);
      case 'spot': SC.adding = b.dataset.sk; SC.focus = `[data-sc-edit="new:${b.dataset.sk}"]`; return render();
      case 'tray-all': c.trayAll[b.dataset.sk] = !c.trayAll[b.dataset.sk]; return render();
      case 'gmode': c.gmode = b.dataset.m; render(); if(c.gmode === 'graph') setTimeout(renderGraphCards, 0); return;
      case 'card-close': c.cards = c.cards.filter(x => x.id !== id); return render();
      case 'card-note': { const k = card(); if(k){ c.notes.push({ id: 'n' + (++c.seq), text: k.label, x: k.x, y: k.y + 240, ai: true, from: 'From a card' }); render(); } return; }
      case 'card-add': { const k = card(); if(k && a.add(k.sk, k.label, { detail: k.detail, ai: true }) !== false){ c.cards = c.cards.filter(x => x !== k); render(); } return; }
      case 'card-explore': { const k = card(); if(k){ c.cards = c.cards.filter(x => !(x.parent === k.id && x.err)); explore(k); } return; }
      case 'card-tpl': { const k = card(), el = k && document.getElementById(`xc-sec-sc-${k.sk}`); if(!el) return notice('That part isn’t on the template any more.');
        const tpl = world().querySelector('[data-wid="tpl"]'), z = Math.max(1, c.zoom || 1); c.zoom = z; c.panX = 60 - (tpl.offsetLeft + el.offsetLeft) * z; c.panY = 60 - (tpl.offsetTop + el.offsetTop) * z; apply();
        el.classList.remove('xc-flash'); void el.offsetWidth; el.classList.add('xc-flash'); return; }
      case 'pt-note': { const k = card(), p = k && k.points[+b.dataset.i]; if(p){ c.notes.push({ id: 'n' + (++c.seq), text: p.label, x: k.x + 20 * (+b.dataset.i), y: k.y + 300 + 20 * (+b.dataset.i), ai: true, from: 'From Explore' }); render(); notice(`“${tr(p.label, 40)}” is a post-it — drag it onto a table to use it.`); } return; }
    }
  });
  W.addEventListener('dblclick', e => {
    if(!on()) return;
    const idea = e.target.closest('#xc-world [data-idea]'); if(idea){ e.stopPropagation(); const [sk, id] = idea.dataset.idea.split(':'); if(A().use){ snap(); A().use(sk, id); } return; }
    if(e.target === vp() || e.target === world()){ snap(); newNote(e.clientX, e.clientY); }
  });
  W.addEventListener('keydown', e => {
    if(!on()) return;
    const t = e.target, a = A();
    const typing = t.matches && (t.matches('input, select') || (t.matches('textarea') && document.activeElement === t));
    if((e.ctrlKey || e.metaKey) && /^[zZy]$/.test(e.key) && !typing){ e.preventDefault(); return undo(e.shiftKey || e.key === 'y'); }
    if(t.matches && t.matches('[data-sc-edit^="note:"]') && e.key === 'Enter' && !e.shiftKey && !e.isComposing){ e.preventDefault(); t.blur(); notice('Post-it made — drag it onto a table to use it.'); return; } // Enter finishes the post-it
    if(t.matches && t.matches('[data-sc-edit^="new:"]')){
      if(e.key === 'Escape'){ SC.adding = null; return render(); }
      if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); const sk = t.dataset.scEdit.slice(4), v = t.value.trim(); SC.adding = null; if(v){ snap(); a.add(sk, v); } else render(); }
      return;
    }
    if(t.matches && t.matches('[data-sc-edit^="edit:"]')){ // rewording a post-it in place: Enter keeps it, Esc puts the words back
      if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); commitEdit(t); t.blur(); }
      else if(e.key === 'Escape'){ t.value = t.defaultValue; t.blur(); }
      return;
    }
    if(t.matches && t.matches('textarea, input')) return;
    const s = cv().sel; if(!s) return;
    if(e.key === 'Delete' || e.key === 'Backspace'){
      e.preventDefault(); snap();
      if(s.t === 'pi' && !(a.locked && a.locked())) return sel(null), a.remove(s.sk, s.id);
      if(s.t === 'idea' && a.leave) return sel(null), a.leave(s.sk, s.id);
      if(s.t === 'note'){ cv().notes = cv().notes.filter(n => n.id !== s.id); sel(null); return render(); }
    }
    if(e.key === 'Enter' && s.t === 'idea' && a.use){ e.preventDefault(); snap(); return a.use(s.sk, s.id); }
    if(e.key === 'Escape') sel(null);
  });
  W.addEventListener('focusout', e => { const t = e.target; if(!on() || !t.matches) return;
    if(t.matches('[data-sc-edit^="new:"]') && !t.value.trim()){ SC.adding = null; setTimeout(render, 0); }
    if(t.matches('[data-sc-edit^="edit:"]')) commitEdit(t); });
  function commitEdit(t){ if(!t.isConnected || t.value === t.defaultValue || !A().edit) return; const [, sk, id] = t.dataset.scEdit.split(':'); snap(); t.defaultValue = t.value; A().edit(sk, id, t.value); }
  W.addEventListener('input', e => { const t = e.target; if(on() && t.matches && t.matches('[data-sc-edit^="edit:"]')){ t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
    if(on() && t.matches && t.matches('[data-sc-edit^="note:"]')){ const n = cv().notes.find(x => x.id === t.dataset.scEdit.slice(5)); if(n) n.text = t.value; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; } });
  // drag: pan, components, resize, post-its, ideas, Inputs lines (tables are outlined while dragging)
  W.addEventListener('pointerdown', e => {
    if(!on() || e.button !== 0) return;
    const t = e.target, c = cv();
    if(t.closest('.xc-bar, .xc-rail, .xc-zoom, #xc-snack-slot, #xc-selbar-slot, #graph-canvas-wrap, .xc-tslot') || t.closest('input, select, a, button')) return;
    if(t.closest('textarea') && !t.closest('[data-note]')) return;
    if(c.tool === 'note' && (t === vp() || t === world())){ newNote(e.clientX, e.clientY); c.tool = 'select'; bar(); W.dataset.tool = 'select'; return; }
    const grip = t.closest('[data-sc-grip]'), src = t.closest('[data-drag]'), head = t.closest('[data-whead]');
    if(t.closest('textarea') && document.activeElement === t) return; // editing a post-it's text
    let d = null;
    if(grip){ const wd = c.wid[grip.dataset.scGrip], el = grip.closest('.xc-w'); d = { type: 'resize', id: grip.dataset.scGrip, wd, w0: wd.w || el.offsetWidth, h0: wd.h || el.offsetHeight }; }
    else if(src) d = { type: 'item', src: src.dataset.drag, el: src };
    else if(head) d = { type: 'widget', id: head.dataset.whead };
    else if(t === vp() || t === world()) d = { type: 'pan', px: c.panX, py: c.panY };
    if(!d) return;
    if(d.type === 'widget'){ d.obj = c.cards.find(x => x.id === d.id) || c.wid[d.id]; if(!d.obj) return; d.wx = d.obj.x; d.wy = d.obj.y; }
    if(d.type === 'item' && d.src.startsWith('note:')){ d.note = c.notes.find(n => n.id === d.src.slice(5)); if(!d.note) return; d.wx = d.note.x; d.wy = d.note.y; }
    Object.assign(d, { x0: e.clientX, y0: e.clientY, pid: e.pointerId, started: false });
    SC.drag = d;
  });
  const zoneAt = (x, y, skip) => { if(skip) skip.style.pointerEvents = 'none'; const el = document.elementFromPoint(x, y); if(skip) skip.style.pointerEvents = ''; const z = el && el.closest('#xc-world .xc-table[data-zone]'); return z && !z.dataset.ro ? z : null; };
  window.addEventListener('pointermove', e => {
    const d = SC.drag; if(!d || e.pointerId !== d.pid) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0, c = cv(), z = c.zoom || 1;
    if(!d.started){
      if(Math.abs(dx) + Math.abs(dy) < 5) return; d.started = true; if(d.type !== 'pan') snap(); // one undo step per drag
      if(d.type === 'pan') vp().classList.add('is-panning');
      if(d.type === 'item'){ const r = d.el.getBoundingClientRect(), g = d.ghost = d.el.cloneNode(true); g.classList.add('xc-ghost'); g.style.width = (r.width / z) + 'px'; g.style.transform = `scale(${z})`; g.style.left = r.left + 'px'; g.style.top = r.top + 'px'; d.ox = d.x0 - r.left; d.oy = d.y0 - r.top; document.body.appendChild(g); d.el.classList.add('is-dragging'); W.classList.add('is-dropping'); }
    }
    if(d.type === 'pan'){ c.panX = d.px + dx; c.panY = d.py + dy; apply(); }
    else if(d.type === 'widget'){ d.obj.moved = true; d.obj.x = Math.round(d.wx + dx / z); d.obj.y = Math.round(d.wy + dy / z); const el = world().querySelector(`[data-wid="${d.id}"]`); if(el){ el.style.left = d.obj.x + 'px'; el.style.top = d.obj.y + 'px'; } livePos(); }
    else if(d.type === 'resize'){ const el = world().querySelector(`[data-wid="${d.id}"]`); d.wd.w = Math.max(d.id === 'tpl' ? 300 : 280, Math.round(d.w0 + dx / z)); if(el) el.style.width = d.wd.w + 'px';
      if(d.id === 'graph'){ d.wd.h = Math.max(220, Math.round(d.h0 + dy / z)); if(el) el.style.height = d.wd.h + 'px'; } livePos(); }
    else if(d.type === 'item'){
      d.ghost.style.left = (e.clientX - d.ox) + 'px'; d.ghost.style.top = (e.clientY - d.oy) + 'px';
      const zn = zoneAt(e.clientX, e.clientY, d.ghost); if(d.over !== zn){ if(d.over) d.over.classList.remove('is-over'); d.over = zn; if(zn) zn.classList.add('is-over'); }
    }
  });
  const insideVp = e => { const r = vp().getBoundingClientRect(); return e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom; };
  window.addEventListener('pointerup', e => {
    const d = SC.drag; if(!d || e.pointerId !== d.pid) return;
    SC.drag = null; vp().classList.remove('is-panning'); W.classList.remove('is-dropping');
    if(!d.started){ if(SC.renderAgain){ SC.renderAgain = false; render(); } return; }
    SC.justDragged = true; setTimeout(() => { SC.justDragged = false; }, 0);
    if(d.ghost) d.ghost.remove(); if(d.el) d.el.classList.remove('is-dragging'); if(d.over) d.over.classList.remove('is-over');
    const c = cv(), a = A(), zone = d.over, sk = zone && zone.dataset.zone;
    const hit = document.elementFromPoint(e.clientX, e.clientY), empty = insideVp(e) && !(hit && hit.closest('.xc-w, .xc-note'));
    const p = () => toWorld(e.clientX - (d.ox || 0) + 10, e.clientY - (d.oy || 0) + 10);
    if(d.type === 'item'){
      const [type, k1, k2] = d.src.split(':');
      if(type === 'idea'){
        const s0 = a.sections().find(y => y.key === k1), x = s0 && s0.ideas.find(y => y.id === k2);
        if(zone){ if(a.use && sk === k1) a.use(k1, k2); else if(x) a.add(sk, x.label, { detail: x.detail, ai: true }); }
        else if(empty && x){ const q = p(); c.cards.push({ id: 'card' + (++c.seq), kind: 'Idea', label: x.label, detail: x.detail || '', sk: k1, from: `Template ideas · ${s0.label}`, x: Math.round(q.x), y: Math.round(q.y) }); }
      } else if(type === 'pi'){ // a post-it dragged off the table: it comes out (and stays on the canvas as a post-it, so nothing is lost)
        const s0 = a.sections().find(y => y.key === k1), x = s0 && s0.items.find(y => y.id === k2);
        if(x && zone && sk !== k1) a.add(sk, x.label, { detail: x.detail });
        else if(x && empty && !(a.locked && a.locked())){ const q = p(); c.notes.push({ id: 'n' + (++c.seq), text: x.label, x: Math.round(q.x), y: Math.round(q.y), from: `Out of ${s0.label}` }); a.remove(k1, k2); }
      } else if(type === 'in'){
        const text = (SC.inLines || [])[+k1] || ''; if(!text) return render();
        if(zone) a.add(sk, text.replace(/^[^:]{2,40}:\s+/, ''), { detail: '' });
        else if(empty){ const q = p(); c.notes.push({ id: 'n' + (++c.seq), text, x: Math.round(q.x), y: Math.round(q.y), from: IP.node === 'entry' ? 'Your request' : 'From Inputs' }); }
      } else if(type === 'note' && d.note){
        if(zone){ if(!d.note.text.trim()) notice('Write something on the post-it first.'); else if(a.add(sk, d.note.text, { ai: d.note.ai }) !== false) c.notes = c.notes.filter(n => n !== d.note); }
        else { d.note.x = Math.round(d.wx + (e.clientX - d.x0) / (c.zoom || 1)); d.note.y = Math.round(d.wy + (e.clientY - d.y0) / (c.zoom || 1)); }
      }
      return render();
    }
    if(d.type === 'widget' && d.obj && d.obj.label != null && !d.obj.points){ // a card dropped on a table: added there
      const el = world().querySelector(`[data-wid="${d.id}"]`), zn = zoneAt(e.clientX, e.clientY, el);
      if(zn){ d.obj.x = d.wx; d.obj.y = d.wy; if(a.add(zn.dataset.zone, d.obj.label, { detail: d.obj.detail, ai: true }) !== false) c.cards = c.cards.filter(x => x !== d.obj); return render(); }
    }
    if(SC.renderAgain){ SC.renderAgain = false; render(); }
  });
  // mouse wheel zooms around the pointer; a trackpad's two-finger scroll pans; pinch / Ctrl+scroll zooms
  W.addEventListener('wheel', e => {
    if(!on() || !e.target.closest || !e.target.closest('#xc-vp') || e.target.closest('.xc-tslot, .xc-scroll, textarea')) return;
    e.preventDefault();
    const r = vp().getBoundingClientRect(), mouse = typeof wheelIsMouse === 'function' && wheelIsMouse(e);
    if(e.ctrlKey || e.metaKey || mouse) zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
    else { const c = cv(); c.panX -= e.deltaX; c.panY -= e.deltaY; apply(); }
  }, { passive: false });
  if(window.ResizeObserver) new ResizeObserver(() => { if(on() && visible()){ if(SC.stale || SC.drawn !== IP.node) render(); else livePos(); } }).observe(W);

  // voting, multi-select and Compare (components/cf-collab.js) work here as in the execution canvas
  if(window.CF && CF.use) CF.use({
    on: () => on() && visible(),
    state: () => cv(),
    render: () => render(),
    deselect: () => sel(null),
    zoom: () => { const c = cv(); return { zoom: c.zoom || 1, panX: c.panX, panY: c.panY }; },
    toWorld: (x, y) => toWorld(x, y),
    notice: t => notice(t),
    makeNote: (text, detail, x, y) => { cv().notes.push({ id: 'n' + (++cv().seq), text, x: Math.round(x), y: Math.round(y), ai: true, from: 'From Compare' }); render(); },
    addToOutput: (label, detail) => { const s = A().sections().find(x => !x.ro && !(x.one && x.items.length)); if(s) A().add(s.key, label, { detail, ai: true }); else notice('There is no table to add it to.'); },
    get addLabel(){ return A() ? A().addLabel : 'Add to template'; },
    ctx: () => ({ request: (IP.intent && IP.intent.purpose) || request(), title: STAGES[IP.node] })
  });

  // ---------- hooks: on in the four stages; keep in step with each stage's data ----------
  // The canvas uses the execution canvas's own tab ("Canvas") and DOM; that canvas is off outside execution nodes.
  function sync(){
    const isOn = on();
    if(isOn) document.body.dataset.xc = '1';
    if(isOn && ipCurrentMode() !== 'chat') setCognitiveFieldMode('stage');
    else if(!isOn && SC.shown) setCognitiveFieldMode('graph');
  }
  const ipCurrentMode = () => (typeof ipCurrentCfMode === 'function' ? ipCurrentCfMode() : 'graph');
  const execOn = () => typeof EX !== 'undefined' && EX.cur && typeof xcOn === 'function' && xcOn(EX.cur);
  // Full space, as in the execution node: one mode (the canvas), so no mode icons and no Refresh — in 3 panels the row
  // above the canvas goes (Chat is its own column); in 2 panels only Canvas | Chat stays. Nothing needs a manual Refresh:
  // the graph and the template follow every change by themselves (chat, edits, plan changes, node results).
  function fullSpace(onOff){
    const tb = document.querySelector('#graph-card > .graph-toolbar'), three = typeof layoutMode !== 'undefined' && layoutMode === '3panel', rb = document.getElementById('graph-analyze-btn');
    if(onOff){ if(tb) tb.style.display = three ? 'none' : ''; W.style.marginTop = three ? '0' : ''; if(rb) rb.classList.add('hidden'); SC.full = true; }
    else if(SC.full){ SC.full = false; if(!execOn()){ if(tb) tb.style.display = ''; W.style.marginTop = ''; if(rb) rb.classList.remove('hidden'); } }
  }
  const __switch = ipSwitchNode;
  ipSwitchNode = function(){ dock(false); const from = IP.node, r = __switch.apply(this, arguments); if(IP.node !== from){ SC.stale = true; SC.adding = null; if(STAGES[IP.node]) world().innerHTML = ''; } sync(); return r; }; // undock first: the execution canvas docks the graph itself
  const __setCF = setCognitiveFieldMode;
  setCognitiveFieldMode = function(mode){
    const isOn = on(), btn = document.getElementById('cf-mode-canvas');
    if(mode === 'chat' && typeof layoutMode !== 'undefined' && layoutMode === '3panel') return __setCF.call(this, mode);
    if(isOn && mode === 'sources'){ cv().gmode = 'sources'; mode = 'stage'; }
    if(isOn && (mode === 'graph' || mode === 'text' || mode === 'scratch' || mode === 'canvas')) mode = 'stage';
    if(mode === 'stage' && !isOn) mode = 'graph';
    if(mode === 'stage'){
      const r = __setCF.call(this, 'graph'); // (the execution canvas hides #xc-wrap here, as it is off)
      document.body.dataset.xc = '1';
      dock(true); SC.shown = true;
      document.getElementById('cf-mode-graph').classList.remove('active');
      if(btn) btn.classList.add('active');
      W.classList.remove('hidden'); fullSpace(true);
      setTimeout(() => { render(); if(typeof renderGraphCards === 'function') renderGraphCards(); livePos(); }, 0);
      return r;
    }
    if(SC.shown){ SC.shown = false; dock(false); fullSpace(false); if(!(typeof EX !== 'undefined' && EX.cur && typeof xcOn === 'function' && xcOn(EX.cur))){ W.classList.add('hidden'); if(btn) btn.classList.remove('active'); } }
    if(!isOn && !(typeof EX !== 'undefined' && EX.cur && typeof xcOn === 'function' && xcOn(EX.cur))) document.body.dataset.xc = ''; // neither canvas is on
    return __setCF.apply(this, [mode]);
  };
  // redraw the template when the stage's data changes (never while dragging)
  ['renderGraphCards', 'ipRenderIntent', 'ipRenderPlanning', 'exRenderResult', 'renderInterestSnackbar', 'commitInterests', 'renderSourcesPanel'].forEach(name => {
    const f = window[name]; if(typeof f !== 'function') return;
    window[name] = function(){ const r = f.apply(this, arguments); if(on() && visible()) soon(); return r; };
  });
  if(typeof setLayoutMode === 'function'){ const __lay = setLayoutMode; setLayoutMode = function(){ const r = __lay.apply(this, arguments); if(SC.shown) fullSpace(true); return r; }; }
  // the intent document and the canvas are one: typing in the Output's Purpose (or any field) updates the template
  const iv = document.getElementById('intent-view');
  if(iv) ['input', 'change'].forEach(ev => iv.addEventListener(ev, () => { if(IP.node === 'intent' && on() && visible()) setTimeout(soon, 0); }));
  // The result is built from the details on the canvas: a node whose details you adjusted goes in with your version
  // (for the result only; the node's own hand-off is unchanged). Same line format as the page's exResultOuts.
  if(typeof exResultOuts === 'function'){
    const __outs = exResultOuts;
    exResultOuts = function(){
      const own = EX.scDetails || {}; if(!Object.keys(own).length) return __outs.apply(this, arguments);
      return exAllKeys().map(k => { const st = EX.steps[k], so = EX.resultSim && EX.resultSim.outputs[k];
        if(own[k]) return `- [id ${k}] ${exStep(k).title}: (details checked and adjusted by the user for the result) ${own[k].join('; ')}`;
        return `- [id ${k}] ${exStep(k).title}: ${st && st.done && st.output ? st.output : so ? `(written by the AI, not researched — an estimate) ${so}` : (st && st.output) || '(no output)'}`; }).join('\n');
    };
  }
  // Ctrl/⌘+Z undoes on the canvas wherever the focus is (a text field keeps its own text undo)
  document.addEventListener('keydown', e => {
    if(!(e.ctrlKey || e.metaKey) || !/^[zZy]$/.test(e.key) || !on() || !visible()) return;
    const t = e.target; if(t && t.closest && t.closest('#xc-wrap')) return; // the canvas's own handler
    if(t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return;
    e.preventDefault(); undo(e.shiftKey || e.key === 'y');
  });
  // Entry: the graph appears after the request is analysed — switch the canvas on then
  setInterval(() => { const isOn = on(); if(isOn !== !!SC.shown && (isOn ? ipCurrentMode() !== 'chat' : true)) sync(); }, 700);
  window.StageCanvas = { render, sync, on };
})();
