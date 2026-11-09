/* components/complexity-v2.js — "Node complexity v2" (the CollabiQ complexity concept), shared by entry-v4 and entry-v5.
   Everything here is OFF unless the confirmed plan was made in Planning mode "Node complexity v2" (IP.lanesMode ===
   'complexity2' and the node has a level). Standard and Node complexity plans are untouched.

   Planning side (used by the pages' planning code): PL_V2_RULES (the prompt rules), PL_LEVEL / PL_LEVEL_TIP / PL_LEAD
   (labels), plV2Notes (intent, background work and "what would change this plan" in Planning's chat).

   Execution side (window.CxV2, called from small hooks in the pages):
   - onOpen(k)        first visit: the panels this level starts with; every visit: what changed since the last one
   - panels(k)        the level's panel defaults (exDefaultPanels)
   - briefHtml(k)     the node brief: substeps in order (widening / narrowing, who leads, what unlocks the next, what
                      each settled), what was handed over, what's still missing; on re-entry only what changed
   - gateHtml(k)      the gate that fits the level: approval of exceptions (known), sign-off (complicated), decision
                      record (complex), readiness check of the question (unknown)
   - missing(k)       the gate, as one more thing to finish before "Complete node" (exMissing)
   - ctx(k)           how the AI works in this node (exCtx) — never shown to the user
   Level names are shown in Planning only; inside a node, substeps say who leads ("I'll do this", "You check"…). */

const PL_V2_RULES = `NODE COMPLEXITY V2 MODE — how to cut the work into nodes. These rules OVERRIDE "one node by default / split only when" in rule 1 and the lane/step counts in rule 3 where they conflict.
How much the AI does in a node, and how, depends on how complex the work in that node is. People must stay in the loop: they must always be able to understand, judge and correct what the AI does. When unsure, do less and ask more.
Every node has exactly ONE level, decided by asking these questions IN ORDER — the first that applies decides:
1. Can the people involved state the question and what a good result looks like? If NOT: "unknown".
2. Can an expert check whether the answer is right BEFORE acting on it? If NOT: "complex".
3. Does reaching or checking the answer need expertise or analysis? If YES: "complicated".
4. Otherwise a known rule decides it the same way each time: "known".
What the levels mean:
- "known": the answer follows a known rule, the same way every time (payroll, invoices, routine filings); no expertise is needed to reach or check it. The AI does most of the work, collects missing items, keeps a short work log and flags exceptions; the person supplies what only they know and approves (an approval showing only exceptions and what changed, with a deadline).
- "complicated": several valid answers exist and an expert can tell them apart against agreed criteria (financial models, legal checks, weighted comparisons). The AI proposes options with trade-offs, drafts, shows how each result was built and where each value came from, and flags decisive assumptions; the person chooses with reasons, verifies and signs off.
- "complex": nobody can check the answer in advance — the criteria are disputed, or only outcomes will show what works (a hire's fit, a board's reaction). The AI drafts several options or readings, all as suggestions, never one as the right answer; the person or team explores, tries, decides together and states what would make them revisit the decision.
- "unknown": the question itself is not clear yet; people cannot state it or what a good result looks like. The AI captures, groups and connects what people gather and suggests questions to explore, NEVER answers. It ends when the framed question is clear, and then starts a new node at a lower level. (If a good question appears after a short clarification, that is the intent stage, not an unknown node.)
Tie-breaks: the number of people does not decide the level (several people applying shared criteria = complicated; competing views with no shared criteria = complex). An approval by someone outside the node is a gate inside the node, not its level. Judging a result counts as a human step even when producing it is mechanical. The level belongs to this node in THIS case, not to its type.
Separating work into nodes:
1. Steps with no human input (copying, calculating, sending, waiting, outside parties) are NOT nodes: list them in "background" (kind "background", "event" or "gate").
2. A node's level is the level of its hardest human decision.
3. If one stretch of work holds human decisions at two different levels that need different interfaces or different people, split it into separate nodes; otherwise keep one node at the higher level.
4. A hand-off to another owner, or a formal approval, is a natural node boundary.
5. Making criteria and using criteria belong in different nodes: complex nodes produce criteria, complicated nodes apply them.
6. Expect roughly 5-8 nodes in all (still at most 6 lanes and 3 nodes per lane), each with 1-4 substeps. Many more means routine work is being turned into nodes; many fewer means levels are being mixed. Routine "known" work often needs no full node: prefer a background item with an approval gate, and make it a node only when a case breaks the rules.
Substeps inside each node ("substeps", 1-4, in order), often from a known method (e.g. weights, scales, gather, compare, verify):
- each is "widen" (gathering, exploring, generating options) or "narrow" (choosing, checking, deciding). Known and complicated nodes mostly narrow after one short widening substep; complex nodes widen several times before narrowing; unknown nodes widen for long and narrow only on the question.
- each says who leads it: "ai" (the AI does it), "check" (the person checks), "decide" (the person decides) or "together" (people decide together). A substep can sit at or below the node's level, never above it: easier substeps are where the AI does more; harder ones are where the person judges or decides. NEVER use level names in substep titles.
- each says what unlocks the next one ("unlocks").
Before a method runs it needs context: list in "contextNeeded" what the node needs, each with "have": true if the known facts above already give it, false if not. Anything missing that would change the result must also be asked in "ask_user" — never assumed.
Each node also says what it hands over to the next node ("handover"), and gives "levelWhy": one line that answers the placement question that decided its level (e.g. "An expert can check the shortlist against the agreed criteria before anyone books").
For the whole plan also give: "intent" (one sentence, in the person's own words), "background" (work, events and gates that are not nodes: [{"what", "kind": "background" | "event" | "gate"}]) and "replanIf" (1-3 things that would make you change this plan).
Never present a guess as certain. Never invent facts, people or constraints; ask instead.

`;
const PL_LEVEL = { known: 'Known', complicated: 'Complicated', complex: 'Complex', unknown: 'Unknown' };
const PL_LEVEL_TIP = { known: 'A known rule decides it the same way each time — the AI does most of it, you approve the exceptions', complicated: 'Several valid answers; an expert can check them before acting — the AI drafts options with sources, you choose and sign off', complex: 'Nobody can check the answer in advance — the AI drafts options as suggestions, you try and decide together', unknown: 'The question isn’t clear yet — the AI organises what you gather and suggests questions, never answers' };
const PL_LEAD = { ai: 'I’ll do this', check: 'You check', decide: 'You decide', together: 'You decide together' };

// Planning's chat, once the draft is made: the intent in the person's words, the work that is not a node, and what would
// change the plan.
function plV2Notes(raw){
  const str = v => typeof v === 'string' ? v.trim() : '';
  const KIND = { background: 'Background', event: 'Event', gate: 'Gate' };
  const bg = (Array.isArray(raw && raw.background) ? raw.background : []).filter(x => x && str(x.what)).slice(0, 8);
  const re = (Array.isArray(raw && raw.replanIf) ? raw.replanIf : []).map(str).filter(Boolean).slice(0, 3);
  const intent = str(raw && raw.intent);
  if(!intent && !bg.length && !re.length) return;
  ipAddMsg('planning', 'assistant', `${intent ? `<p><strong>Intent:</strong> ${ipE(intent)}</p>` : ''}${bg.length ? `<p><strong>Not nodes — runs in the background:</strong></p><ul>${bg.map(x => `<li>${ipE(KIND[x.kind] || 'Background')}: ${ipE(str(x.what))}</li>`).join('')}</ul>` : ''}${re.length ? `<p><strong>What would change this plan:</strong></p><ul>${re.map(x => `<li>${ipE(x)}</li>`).join('')}</ul>` : ''}<p class="pl-source">Each node shows its level on the card — open Node information to confirm or change it.</p>`);
}

(function(){
  'use strict';
  // The page functions this file relies on. If one is renamed, say so clearly instead of failing quietly.
  const NEEDS = ['exStep', 'exState', 'exInputs', 'exParse', 'exRsRefresh', 'forceExpandPanel', 'forceCollapsePanel', 'ipE'];
  function ready(){ const miss = NEEDS.filter(n => { try { return typeof eval(n) !== 'function'; } catch(e){ return true; } }); if(miss.length){ console.warn('[complexity-v2] off — page functions missing:', miss.join(', ')); return false; } return true; }
  let ok = null; const can = () => ok === null ? (ok = ready()) : ok;

  // ---------- is this a v2 node? ----------
  function on(k){
    if(!can() || !k || typeof IP === 'undefined' || IP.lanesMode !== 'complexity2') return null;
    const s = exStep(k); const lv = s && s.nodeInfo && s.nodeInfo.level;
    return PL_LEVEL[lv] ? { s, ni: s.nodeInfo, lv } : null;
  }
  function cx(k){ const st = exState(k); return st.cx || (st.cx = { cur: 0, settled: [], seen: null, changes: [], reentry: false, panesSet: false, gate: {} }); }
  const E = s => ipE(s);
  const subs = ni => Array.isArray(ni.substeps) ? ni.substeps : [];

  // ---------- panels per level ----------
  // known: chat leads, board closed · complicated: chat collapsed, guided board · complex: board central + chat for the
  // team · unknown: chat collapsed (the AI takes notes), open board. The Output stays open (the node's guided work lives
  // there); for an unknown node its result is locked until the question passes the readiness check (see missing()).
  const PANELS = { known: { chat: true, graph: false, output: true }, complicated: { chat: false, graph: true, output: true }, complex: { chat: true, graph: true, output: true }, unknown: { chat: false, graph: true, output: true } };
  function panels(k){ const v = on(k); return v ? Object.assign({}, PANELS[v.lv]) : null; }
  function applyPanels(want){
    const keys = typeof layoutPanelKeys === 'function' ? layoutPanelKeys() : ['chat', 'graph', 'output'];
    keys.forEach(p => { if(want[p]) forceExpandPanel(p); });   // expand first, so the last-panel guard never blocks
    keys.forEach(p => { if(!want[p]) forceCollapsePanel(p); });
  }

  // ---------- what changed since the last visit ----------
  function snapshot(k){
    const st = exState(k);
    return { at: Date.now(), stale: !!st.stale, inputs: exInputs(k).map(x => ({ k: x.k, title: x.step.title, done: !!(x.st && x.st.done), out: String((x.st && x.st.output) || '') })) };
  }
  function onOpen(k){
    const v = on(k); if(!v) return;
    const st = exState(k), c = cx(k), now = snapshot(k);
    if(!c.panesSet){ c.panesSet = true; applyPanels(PANELS[v.lv]); }
    c.changes = []; c.reentry = !!c.seen; c.showFull = false;
    if(c.seen){
      const was = new Map(c.seen.inputs.map(x => [x.k, x]));
      now.inputs.forEach(x => { const p = was.get(x.k);
        if(x.done && !(p && p.done)) c.changes.push(`“${x.title}” is done — what it hands over is now in your inputs.`);
        else if(x.done && p && p.out.trim() !== x.out.trim()) c.changes.push(`“${x.title}” changed what it hands over.`); });
      if(now.stale && !c.seen.stale) c.changes.push('An input changed after you worked on this node.');
      const sub = subs(v.ni)[Math.min(c.cur, Math.max(0, subs(v.ni).length - 1))];
      if(c.changes.length && sub) c.changes.push(`It affects substep ${Math.min(c.cur, subs(v.ni).length - 1) + 1}: “${sub.title}”.`);
    }
    c.seen = now;
    try { if(EX.cur === k && IP.node === 'exec') exRsRefresh(k); } catch(e){} // the view was drawn before this ran: draw it again with the brief
  }

  // ---------- the node brief ----------
  const REOPEN = { known: 'Reopens only when a case breaks the rule.', complicated: 'Reopens when an input changes (new data, a new rule) — only what the change affects is redone.', complex: 'Reopens when outcomes arrive (a meeting, a test, a trial period).', unknown: 'Ends when the question passes the readiness check below; it then starts a new node.' };
  function briefHtml(k){
    const v = on(k); if(!v) return '';
    const st = exState(k), c = cx(k), list = subs(v.ni), ro = !!st.done;
    const cur = Math.min(c.cur, list.length);
    const items = list.map((x, i) => {
      const state = i < cur ? 'done' : i === cur ? 'now' : 'next';
      const settled = c.settled[i];
      return `<li class="cx-sub cx-sub--${state}">
        <span class="cx-sub-top"><span class="cx-sub-mark" aria-hidden="true">${state === 'done' ? '✓' : i + 1}</span><span class="cx-sub-kind">${x.kind === 'narrow' ? 'Narrowing' : 'Widening'}</span><span class="cx-sub-t">${E(x.title)}</span><span class="pl-tag pl-tag--lead">${E(PL_LEAD[x.lead] || PL_LEAD.ai)}</span>${state === 'now' ? '<span class="cx-now">Now</span>' : ''}</span>
        ${state === 'done' && settled ? `<span class="cx-sub-note">Settled: ${E(settled)}</span>` : ''}
        ${state === 'now' && x.unlocks ? `<span class="cx-sub-note">Unlocks the next: ${E(x.unlocks)}</span>` : ''}
        ${state === 'now' && !ro ? `<span class="cx-sub-act"><label class="sr-only" for="cx-settle-${i}">What did this substep settle?</label><input class="ip-field cx-settle" id="cx-settle-${i}" type="text" placeholder="What did this settle? (optional)"><button type="button" class="ip-mini" data-cx-act="sub-done" data-i="${i}">Mark done</button></span>` : ''}
        ${state === 'done' && i === cur - 1 && !ro ? `<button type="button" class="ip-mini cx-undo" data-cx-act="sub-undo" data-i="${i}">Undo</button>` : ''}
      </li>`; }).join('');
    const ins = exInputs(k);
    const handed = ins.map(x => x.st && x.st.done
      ? `<li><strong>${E(x.step.title)}</strong>${x.step.nodeInfo && x.step.nodeInfo.handover ? ` — ${E(x.step.nodeInfo.handover)}` : ''}<span class="cx-sub-note">${E(String(x.st.output || '').split('\n')[0])}</span></li>`
      : `<li><strong>${E(x.step.title)}</strong> — not handed over yet</li>`).join('');
    const missing = (v.ni.contextNeeded || []).filter(x => !x.have);
    const changes = c.reentry && c.changes.length ? `<div class="cx-changed" role="status"><p class="cx-h">Since your last visit</p><ul>${c.changes.map(x => `<li>${E(x)}</li>`).join('')}</ul></div>` : '';
    const body = `${list.length ? `<p class="cx-h">Substeps${cur >= list.length ? ' · all done' : ''}</p><ol class="cx-subs">${items}</ol>` : ''}
      ${handed ? `<p class="cx-h">Handed over to you</p><ul class="cx-list">${handed}</ul>` : ''}
      ${missing.length ? `<p class="cx-h">Still needed before the method runs</p><ul class="cx-list">${missing.map(x => `<li>${E(x.item)} — ask for it rather than assume it</li>`).join('')}</ul>` : ''}
      <p class="cx-reopen">${E(REOPEN[v.lv])}</p>`;
    // first visit: the whole brief, open; re-entry: only what changed, the rest folded away (concept: "on re-entry show
    // only what changed since the last visit, and name the substep it affects")
    // (a button, not <details>: the page keeps <details> open across redraws, which would undo the fold)
    const fold = c.reentry && c.changes.length && !c.showFull;
    return `<section class="cx-brief" aria-label="Node brief">${changes}
      ${c.reentry && c.changes.length ? `<button type="button" class="cx-toggle" data-cx-act="brief-toggle" aria-expanded="${!fold}">${fold ? 'Show the full brief' : 'Hide the full brief'}</button>` : '<p class="cx-h cx-h--top">Where this node stands</p>'}
      ${fold ? '' : `<div class="cx-more">${body}</div>`}</section>`;
  }

  // ---------- the gate ----------
  const today = () => new Date().toISOString().slice(0, 10);
  function gateHtml(k){
    const v = on(k); if(!v) return '';
    const st = exState(k), g = cx(k).gate, ro = !!st.done, dis = ro ? ' disabled' : '';
    const missing = (v.ni.contextNeeded || []).filter(x => !x.have).map(x => x.item);
    const field = (key, label, ph, rows) => `<label class="ip-label" for="cx-g-${key}">${label}</label><textarea class="ip-field ip-grow" id="cx-g-${key}" data-cx-g="${key}" rows="${rows || 2}" placeholder="${E(ph)}"${ro || g.ok ? ' readonly' : ''}>${E(g[key] || '')}</textarea>`;
    const done = g.ok ? `<p class="cx-gate-ok" role="status">✓ ${E(g.okText || 'Done')} · ${E(new Date(g.at).toLocaleString())}${ro ? '' : ` <button type="button" class="ip-mini" data-cx-act="gate-undo">Change</button>`}</p>` : '';
    let inner = '';
    if(v.lv === 'known'){
      const ex = missing.concat(cx(k).changes.filter(x => !/^It affects/.test(x)));
      inner = `<p class="cx-h">Approval — only the exceptions and what changed</p>
        ${ex.length ? `<ul class="cx-list">${ex.map(x => `<li>${E(x)}</li>`).join('')}</ul>` : '<p class="ip-hint">No exceptions flagged. Everything else followed the rule.</p>'}
        ${field('changes', 'Anything else that changed since last time', 'e.g. two new starters this month')}
        <label class="ip-label" for="cx-g-deadline">Approve by</label><input class="ip-field cx-date" id="cx-g-deadline" type="date" data-cx-g="deadline" value="${E(g.deadline || '')}" min="${today()}"${ro || g.ok ? ' readonly' : ''}>
        ${g.ok ? '' : `<div class="ip-row-actions"><button type="button" class="btn ip-btn-sm" data-cx-act="gate-ok" data-t="Approved"${dis}>Approve</button></div>`}`;
    } else if(v.lv === 'complicated'){
      inner = `<p class="cx-h">Sign-off — review only what matters</p>
        ${missing.length ? `<p class="ip-hint">Check these first — they would change the result:</p><ul class="cx-list">${missing.map(x => `<li>${E(x)}</li>`).join('')}</ul>` : '<p class="ip-hint">No decisive gaps flagged. Check the exceptions in the steps above, then sign off.</p>'}
        <p class="ip-hint">Done when: ${(v.ni.dod || []).map(E).join(' · ') || '—'}</p>
        ${field('why', 'Why this result (your reasons)', 'e.g. best on the two criteria that matter most; the cheaper option fails on access')}
        ${g.ok ? '' : `<div class="ip-row-actions"><button type="button" class="btn ip-btn-sm" data-cx-act="gate-ok" data-t="Signed off"${dis}>Sign off</button></div>`}`;
    } else if(v.lv === 'complex'){
      const opts = st.w && Array.isArray(st.w.options) ? st.w.options.map(o => o.label).filter(Boolean) : [];
      if(!g.considered && opts.length) g.considered = opts.join('\n');
      const can = (g.decision || '').trim() && (g.revisit || '').trim();
      inner = `<p class="cx-h">Decision record</p><p class="ip-hint">Everything the AI drafted here is a suggestion. Record what you decided together, and what would make you look at it again.</p>
        ${field('considered', 'Options considered', 'One per line', 3)}${field('decision', 'What we decided', 'e.g. try option B for one quarter')}${field('why', 'Why', 'The reasons, including where people disagreed')}${field('revisit', 'What would make us revisit it', 'e.g. if the pilot team’s feedback is negative after 6 weeks')}
        ${g.ok ? '' : `<div class="ip-row-actions"><button type="button" class="btn ip-btn-sm" data-cx-act="gate-ok" data-t="Decision recorded"${can && !ro ? '' : ' disabled'}>Record decision</button><span class="ip-hint">${can ? '' : 'Needs the decision and what would make you revisit it.'}</span></div>`}`;
    } else {
      const can = (g.question || '').trim() && (g.good || '').trim() && g.c1 && g.c2;
      inner = `<p class="cx-h">Readiness check — is the question clear?</p><p class="ip-hint">This node can’t be completed until the question passes. Then it starts a new node in Planning.</p>
        ${field('question', 'The question', 'Write it as one question')}${field('good', 'What a good result would look like', 'e.g. a shortlist we would act on')}
        <label class="ex-check"><input type="checkbox" data-cx-g="c1"${g.c1 ? ' checked' : ''}${ro || g.ok ? ' disabled' : ''}><span>Everyone involved can state this question the same way</span></label>
        <label class="ex-check"><input type="checkbox" data-cx-g="c2"${g.c2 ? ' checked' : ''}${ro || g.ok ? ' disabled' : ''}><span>We know what a good result looks like</span></label>
        ${g.ok ? '<div class="ip-row-actions"><button type="button" class="ip-mini" data-ex-act="to-plan">Start a new node for it in Planning →</button></div>' : `<div class="ip-row-actions"><button type="button" class="btn ip-btn-sm" data-cx-act="gate-ok" data-t="Question is ready"${can && !ro ? '' : ' disabled'}>The question is ready</button><span class="ip-hint">${can ? '' : 'Needs the question, a good result, and both ticks.'}</span></div>`}`;
    }
    const lock = g.ok || ro ? '' : `<p class="ip-hint cx-lock">“Complete node” unlocks after ${GATE_NAME[v.lv]}.</p>`;
    return `<section class="cx-gate" aria-label="Gate">${inner}${done}${lock}</section>`;
  }
  // the gate is one more thing to finish before "Complete node" (exMissing)
  const GATE_NAME = { known: 'the approval', complicated: 'the sign-off', complex: 'the decision record', unknown: 'the readiness check' };
  function missing(k){ const v = on(k); return v && !cx(k).gate.ok ? [GATE_NAME[v.lv]] : []; }

  // ---------- how the AI works here (hidden) ----------
  const AI = {
    known: 'This node follows a known rule, the same way every time. Do most of the work: collect missing items, calculate, prepare, keep a short work log, and flag exceptions with the reason. Ask the user only for what only they know (this cycle\'s changes).',
    complicated: 'Several valid answers exist and an expert can tell them apart against agreed criteria. Propose options with their trade-offs, show how each result was built and where each value came from, check consistency across sources, and say which assumptions are decisive (would change the result: ask) and which are harmless (record them and move on). The user chooses with reasons and signs off.',
    complex: 'Nobody can check the answer in advance (criteria are disputed, or only outcomes will show what works). Draft several options or readings and present ALL of them as suggestions — never one as the right answer. Connect evidence and keep a record of what was tried and why. The user or team decides together.',
    unknown: 'The question itself is not clear yet. Capture, group and connect what the user gathers, and suggest questions to explore. Do NOT suggest answers.'
  };
  function ctx(k){
    const v = on(k); if(!v) return '';
    const c = cx(k), list = subs(v.ni), sub = list[Math.min(c.cur, list.length - 1)];
    return `\n\nHOW TO WORK IN THIS NODE (follow it; never mention levels to the user): ${AI[v.lv]}${sub ? `\nCurrent substep: "${sub.title}" — ${sub.kind === 'narrow' ? 'narrowing (choosing, checking, deciding)' : 'widening (gathering, exploring, generating options)'}; led by ${({ ai: 'you (the AI)', check: 'the user, who checks', decide: 'the user, who decides', together: 'the people involved, deciding together' })[sub.lead] || 'you (the AI)'}.` : ''}${c.settled.filter(Boolean).length ? `\nAlready settled in earlier substeps: ${JSON.stringify(c.settled.filter(Boolean))}.` : ''}
Mark everything you add as a suggestion until the user accepts it. Never present a guess as certain; say what you don't know. Link every value and claim to its source.`;
  }

  // ---------- events ----------
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-cx-act]'); if(!b || b.disabled || typeof EX === 'undefined' || !EX.cur) return;
    const k = EX.cur, v = on(k); if(!v) return;
    const c = cx(k), act = b.dataset.cxAct, i = +b.dataset.i;
    if(act === 'sub-done'){ const inp = document.getElementById('cx-settle-' + i); c.settled[i] = inp ? inp.value.trim() : ''; c.cur = i + 1; c.changes = []; c.reentry = false; }
    else if(act === 'sub-undo'){ c.cur = i; c.settled[i] = ''; }
    else if(act === 'gate-ok'){ c.gate.ok = true; c.gate.at = Date.now(); c.gate.okText = b.dataset.t; }
    else if(act === 'gate-undo'){ c.gate.ok = false; }
    else if(act === 'brief-toggle'){ c.showFull = !c.showFull; }
    exRsRefresh(k);
  });
  document.addEventListener('input', e => {
    const t = e.target; if(!t.dataset || !t.dataset.cxG || typeof EX === 'undefined' || !EX.cur || !on(EX.cur)) return;
    const g = cx(EX.cur).gate; g[t.dataset.cxG] = t.type === 'checkbox' ? t.checked : t.value;
    // the gate's button wakes up as soon as what it needs is filled in (without redrawing the field being typed in)
    const sec = t.closest('.cx-gate'), btn = sec && sec.querySelector('[data-cx-act="gate-ok"]'), v = on(EX.cur);
    if(btn && v.lv === 'complex') btn.disabled = !((g.decision || '').trim() && (g.revisit || '').trim());
    if(btn && v.lv === 'unknown') btn.disabled = !((g.question || '').trim() && (g.good || '').trim() && g.c1 && g.c2);
  });

  window.CxV2 = { on: k => !!on(k), onOpen, panels, briefHtml, gateHtml, missing, ctx };
})();
