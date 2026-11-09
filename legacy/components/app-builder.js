// components/app-builder.js — the Workstream result as a WORKING HTML app: a simulator, calculator, cost model, dashboard,
// configurator or game prototype ("Create a simulation engine to evaluate the 30-year TCO…", "build a turn-based game").
//
//   · One more format in the Workstream result's outputs: "Interactive app". Built automatically when the request asks
//     for an app; otherwise offered under "Convert to".
//   · Built from what the workstream SETTLED — every node's output and its details (collected values with their source
//     pages, decisions, definitions, design logic). Facts and numbers come only from there: each preset gets an ⓘ box
//     with its source, or "Estimate — no public source" with the reasoning. No invented numbers.
//   · One self-contained file: plain HTML/CSS/JS, charts in SVG/canvas, no CDN, fonts, remote images or network calls,
//     so it opens anywhere, offline. If the request asks for another language (e.g. a Thai toggle), it has one.
//   · Runs live in the result (sandboxed iframe), opens in a new tab, downloads as one .html file, goes full screen.
//   · Changes: ask in Chat — the AI edits the app (targeted find/replace edits, a full rewrite only when needed),
//     keeping everything else. Every version is kept and can be restored.
// All LLM calls go through components/ai.js (streamed, so the loading state shows the app being written).
(function(){
  'use strict';
  if(typeof WO === 'undefined' || typeof woBuild !== 'function') return;
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const APP_RE = /\b(simulat\w*|calculator|dashboard|configurator|interactive|html|web ?app|app|prototype|game|games|engine|cost model|what-if)\b/i;
  const FMT = { kind: 'app', label: 'Interactive app', shape: 'A working HTML app built from the workstream — runs here, opens in a new tab, downloads as one file.' };
  window.appWanted = function(){ const it = (window.IP && IP.intent) || {}; return APP_RE.test([window.__topic, it.name, it.purpose, ...(it.outputs || []).map(o => o.text)].filter(Boolean).join(' ')); };

  // ---------- what the workstream settled: the app's only source of facts ----------
  function nodeDetail(k){
    const st = EX.steps[k], w = st && st.w; if(!w || !w.mode) return null;
    const src = x => x && x.web && x.web.url ? { source: x.web.title || '', url: x.web.url } : (x && x.srcText ? { source: x.srcText } : { source: 'none (estimate)' });
    try {
      if(w.mode === 'gather'){ const g = rsGat(w); return { collected: rsKeptG(w).map(x => Object.assign({ item: x.label, detail: x.detail, fields: x.fields }, src(x))) }; }
      if(w.mode === 'define'){ const d = rsDef(w); return { definitions: rsKeptItems(w).map(x => ({ item: x.label, detail: x.detail, fields: Object.fromEntries(d.fields.map(f => [f.label, (x.fields || {})[f.key] || ''])) })) }; }
      if(w.mode === 'decide') return { decision: rsPickedOpts(w).map(o => o.label), reason: w.reason || '', criteria: rsKeptCrit(w).map(c => c.label), options: rsKeptOpt(w).map(o => Object.assign({ option: o.label, fit: rsFit(w, o.id) + '%', facts: (o.facets || []).map(f => `${f.label}: ${f.detail}`) }, src(o))) };
      if(w.mode === 'find') return { findings: w.questions.filter(q => q.kept).map(q => ({ question: q.q, answers: q.findings.filter(f => f.kept).map(f => Object.assign({ answer: f.label, detail: f.detail }, src(f))), note: q.note })) };
      if(w.mode === 'design' && w.design) return { design: w.design.parts.map(p => ({ part: p.label, logic: (p.logic && p.logic.md) || '' })) };
    } catch(e){ /* a node in an unexpected state: its hand-off text is still used */ }
    return null;
  }
// The look the user settled in Design nodes (round 41: art style, colour palette, line and lighting, mood…): the
// artwork and the styles follow it exactly.
function artDirection(){
  const out = [];
  exAllKeys().forEach(k => { const w = EX.steps[k] && EX.steps[k].w; if(!w || w.mode !== 'design' || !w.design) return;
    w.design.parts.forEach(p => (p.aspects || []).forEach(a => { const c = p.choices && p.choices[a.id], o = c && c.options.find(x => x.id === c.pick);
      if(o) out.push({ aspect: a.label, choice: o.label, detail: o.detail || '', colors: o.colors || [], from: `${exStep(k).title} · ${p.label}` }); })); });
  return out;
}
function spec(){
    const it = IP.intent || {};
    const nodes = exAllKeys().filter(k => EX.steps[k] && EX.steps[k].done).map(k => Object.assign({ node: exStep(k).title, purpose: exStep(k).nodeInfo.purpose, output: EX.steps[k].output }, nodeDetail(k) || {}));
    // generated before every node was done: unfinished nodes count with the output the AI wrote for them, flagged as estimates
    if(EX.resultSim) exAllKeys().filter(k => !(EX.steps[k] && EX.steps[k].done) && EX.resultSim.outputs[k]).forEach(k => nodes.push({ node: exStep(k).title, purpose: exStep(k).nodeInfo.purpose, output: EX.resultSim.outputs[k], source: 'written by the AI from its own knowledge, not researched — an estimate' }));
    return { request: window.__topic || '', workstream: it.name || '', purpose: it.purpose || '', audience: it.audience || '', inScope: (it.scopeIn || []).map(x => x.text).filter(Boolean), outOfScope: (it.scopeOut || []).filter(Boolean),
      deliverables: (it.outputs || []).filter(o => o.text).map(o => ({ deliverable: o.text, doneWhen: o.criteria || [] })), knownFacts: typeof ledgerFacts === 'function' ? ledgerFacts() : [], artDirection: artDirection(), nodes, resultDocument: typeof woResultText === 'function' ? woResultText().slice(0, 6000) : '' };
  }
  const RULES = `RULES — the file must:
- Be ONE complete file: "<!doctype html>" … "</html>", all CSS in <style>, all JS in <script>. NO external resources at all: no CDN, no web fonts, no remote images, no fetch/XHR/WebSocket, no imports. Charts and diagrams drawn with inline SVG or <canvas>.
- WORK: every control does something, every calculation runs in the browser, results update live, it is useful the moment it opens (sensible defaults), no "TODO" or placeholder.
- Use ONLY the facts and numbers in the SPEC. Every preset, parameter and default gets an info button (ⓘ) whose box says where the value comes from: the source name with a link when the SPEC gives one; otherwise "Estimate — no public source" plus the reasoning from the SPEC. Never present an estimate as a sourced fact. When the app needs a value the SPEC lacks, use a clearly labelled assumption the user can change, and say so in its info box.
- Languages: when the request asks for another language (e.g. a button to read it in Thai), add a language switch and give EVERY visible string (labels, info boxes, results, chart labels) in each language.
- Be easy to use on a laptop and at phone width; keyboard accessible with visible focus; readable contrast; follows prefers-color-scheme (light and dark).
- A game: playable from start to finish — start screen, the turn loop, feedback each turn, win/lose, restart — with the rules exactly as the SPEC defines them.
- Look and motion (a game, or anything with characters or scenes): follow the ART DIRECTION; every picture is inline SVG drawn in that style — never emoji, clip art or placeholder shapes; purposeful motion — idle animation on characters, feedback on every action (press, hit, damage, win), smooth transitions between screens; nothing moves without a reason; honour prefers-reduced-motion.
- A simulator or cost model: inputs grouped and explained; the formulas visible or explained ("How this is calculated"); scenarios side by side when the SPEC compares options; results as numbers AND a chart; export of results (copy as CSV or print) is welcome.`;
  function buildPrompt(sp){
    return `You are building the FINAL deliverable of a CollabiQ workstream: a working, self-contained HTML app.
WHAT TO BUILD: ${sp.deliverables.map(d => d.deliverable).join(' + ') || sp.purpose}
REQUEST (in the user's words): "${sp.request || sp.purpose}"
SPEC — everything the workstream settled, the ONLY source of facts, numbers, rules and content:
${JSON.stringify(sp).slice(0, 60000)}

${RULES}

Output ONLY the HTML file, starting with <!doctype html>. No explanation, no Markdown fences.`;
  }

  // ---------- AI: the same route every other AI call in the prototype uses ----------
  // User test: the app's replies kept coming back empty while every other call worked. The app was the only feature that
  // called OpenRouter directly (streamed, with its own length cap); everything else goes through callClaudeRaw →
  // anthropicMessages, which picks the connection this page actually has (Claude in the published viewer, OpenRouter
  // locally). The app now uses that route too. An empty reply is tried once more before it counts.
  async function ask(prompt, onText, onStage, maxTokens){
    ask.lastWhy = [];
    for(let i = 0; i < 2; i++){
      if(i && onStage) onStage('The reply came back empty — asking once more…');
      const data = await callClaudeRaw(prompt, { maxTokens: maxTokens || 32000 });
      const t = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      if(String(t || '').trim()){ if(onText) onText(t); return t; }
      ask.lastWhy.push(Object.assign({ finish: data.stop_reason || '' }, (window.AI && AI.lastReply) || {}));
    }
    return '';
  }
  // The HTML file inside a reply, wherever it is: a reply may open with a sentence, wrap the file in ``` fences, or add
  // notes after </html>. A bare fragment (<style>…<div>…) is wrapped into a file. Not HTML at all → ''.
  const isHtml = s => /<!doctype html|<html[\s>]/i.test(s);
  function clean(t){
    let s = String(t || '');
    const fenced = [...s.matchAll(/```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)(?:\r?\n```|$)/g)].map(m => m[1]).find(x => /<(?:!doctype|html|head|body|style|script|div|main|canvas|svg)\b/i.test(x));
    if(fenced && !isHtml(s.replace(fenced, ''))) s = fenced; // the file is inside a fence
    const i = s.search(/<!doctype html|<html[\s>]/i);
    if(i >= 0){ s = s.slice(i); const end = s.search(/<\/html>/i); return end >= 0 ? s.slice(0, end + 7) : s.replace(/\s*```\s*$/, ''); }
    const j = s.search(/<(?:head|body|style|script|main|div|canvas|svg)\b/i);
    if(j >= 0) return `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>\n${s.slice(j).replace(/\s*```\s*$/, '')}\n</body></html>`;
    return '';
  }
  // Why a reply had no file, in words: what the model said, or what the empty replies looked like.
  function said(t){
    const x = String(t || '').trim().replace(/\s+/g, ' ');
    if(x) return `the model replied “${x.slice(0, 160)}${x.length > 160 ? '…' : ''}”`;
    const all = ask.lastWhy || [], r = all[all.length - 1] || {}, n = all.length;
    const why = r.error ? `OpenRouter said: ${r.error}`
      : r.finish === 'length' && r.reasoningChars ? `it used its whole output limit thinking (${Math.max(1, Math.round(r.reasoningChars / 1000))} k characters of reasoning, no text). Pick a model without extended reasoning, or with a larger output limit, in AI settings`
      : r.finish === 'length' ? 'it hit its output limit before writing anything. Pick a model with a larger output limit in AI settings'
      : r.finish === 'content_filter' ? 'the provider’s content filter stopped the reply'
      : r.finish ? `it stopped (“${r.finish}”) without any text`
      : 'the connection ended with no text and no reason given. Try “Make it again”';
    return `the model (${r.model || 'unknown model'}) sent back ${n > 1 ? `${n} empty replies` : 'an empty reply'} — ${why}`;
  }
  async function writeHtml(prompt, o){
    const stage = t => { o.stage = t; progress(o, o.chars || 0); };
    let raw = await ask(prompt, t => progress(o, t.length), stage), html = clean(raw);
    if(!String(raw || '').trim()) throw new Error(`no HTML file came back: ${said(raw)}`); // empty even after the fallbacks: asking again won't help
    if(!html){ // text but no file in it (a plan, a question, a refusal): ask once more, for the file only
      stage('The reply had no HTML file — asking again for the file only…');
      raw = await ask(`${prompt}\n\nIMPORTANT: your previous reply did not contain the HTML file. Do not explain, plan or ask anything. Reply with the complete file only, from <!doctype html> to </html>.`, t => progress(o, t.length), stage);
      html = clean(raw);
      if(!html) throw new Error(`no HTML file came back: ${said(raw)}`);
    }
    for(let n = 0; n < 3 && !/<\/html>\s*$/i.test(html.trim()); n++){ // cut off: carry on exactly where it stopped
      stage('The reply was long — continuing where it stopped…');
      const more = await ask(`You were writing a self-contained HTML file and your reply was cut off. Continue it EXACTLY where it stopped — output only the remaining characters, nothing before them, no repetition, no explanation, no fences. The file so far ends with:\n"""\n${html.slice(-3000)}\n"""`, t => progress(o, html.length + t.length), stage);
      html += String(more || '').replace(/^\s*```(?:html)?\s*/i, '').replace(/\s*```\s*$/i, '');
    }
    return html.trim();
  }
  function checks(html){
    const out = [];
    if(!/<\/html>\s*$/i.test(html)) out.push({ kind: 'err', text: 'The file looks unfinished (no closing </html>). Ask in Chat to finish it, or make it again.' });
    if(/<script[^>]+src\s*=\s*["']?https?:|<link[^>]+href\s*=\s*["']?https?:[^>]*stylesheet|@import\s+url\(\s*["']?https?:/i.test(html)) out.push({ kind: 'warn', text: 'It loads a file from the internet — it may not work offline.' });
    if(/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket/i.test(html)) out.push({ kind: 'warn', text: 'It tries to reach the network — that is blocked here, and the app should not need it.' });
    return out;
  }
  // the loading state shows the app being written (no re-render of the whole result on every token)
  function progress(o, chars){
    o.chars = chars; const el = document.getElementById('app-prog-' + o.id); if(!el) return;
    el.querySelector('.app-prog-n').textContent = chars ? `${Math.round(chars / 1000)} k characters written` : '';
    el.querySelector('.app-prog-stage').textContent = o.stage || '';
  }

  // ---------- the app, written in parts (user test: one 32k-token reply kept coming back empty) ----------
  // A plan first, then the CSS, the markup and the script as separate, smaller replies that each fit easily; the
  // prototype joins them into one self-contained file. The plan fixes what the parts must agree on (ids, classes,
  // inputs with their sources, formulas, UI text), so each writer only needs the plan, not the whole workstream.
  function fenceless(t){
    const s = String(t || '').trim(), blocks = [...s.matchAll(/```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)(?:\r?\n```|$)/g)].map(m => m[1]);
    return (blocks.length ? blocks.sort((a, b) => b.length - a.length)[0] : s).trim();
  }
  const partCss = t => fenceless(t).replace(/<\/?style[^>]*>/gi, '').trim();
  function partBody(t){
    let s = fenceless(t); const m = /<body[^>]*>([\s\S]*?)(?:<\/body>|$)/i.exec(s); if(m) s = m[1];
    return s.replace(/<!doctype[^>]*>|<\/?html[^>]*>|<head[\s\S]*?<\/head>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').trim();
  }
  const partJs = t => fenceless(t).replace(/<\/?script[^>]*>/gi, '').trim();
  const intro = sp => `You are building the FINAL deliverable of a CollabiQ workstream: a working, self-contained HTML app.
WHAT TO BUILD: ${sp.deliverables.map(d => d.deliverable).join(' + ') || sp.purpose}
REQUEST (in the user's words): "${sp.request || sp.purpose}"`;
  async function part(o, label, prompt, maxTokens, base){
    o.stage = label; progress(o, base);
    const t0 = Date.now(), tick = setInterval(() => { const el = document.getElementById('app-prog-' + o.id); if(el) el.querySelector('.app-prog-n').textContent = `${Math.round((Date.now() - t0) / 1000)} s`; }, 1000);
    let t; try { t = await ask(prompt, x => progress(o, base + x.length), s => { o.stage = s; progress(o, base); }, maxTokens); } finally { clearInterval(tick); }
    if(!String(t || '').trim()) throw new Error(`no ${label.replace(/…$/, '').replace(/^Writing the /, '').toLowerCase()} came back: ${said(t)}`);
    return t;
  }
  async function writeInParts(sp, o){
const spec = n => JSON.stringify(sp).slice(0, n);
const ad = (sp.artDirection || []).length ? `ART DIRECTION — settled by the user; follow it exactly:\n${sp.artDirection.map(a => `- ${a.aspect}: ${a.choice}${a.detail ? ` — ${a.detail}` : ''}${a.colors.length ? ` (colours: ${a.colors.join(' ')})` : ''}`).join('\n')}`
  : 'ART DIRECTION — none settled in the workstream. If the app shows pictures, choose ONE consistent style and palette that fits the request, and state it in the plan.';
    // 1. the plan everything else follows
    const plan = fenceless(await part(o, 'Planning the app…', `${intro(sp)}
SPEC — everything the workstream settled, the ONLY source of facts, numbers, rules and content:
${spec(60000)}

${RULES}

Three separate writers will build this app from YOUR PLAN alone: one writes the CSS, one the HTML markup, one the JavaScript. Write that BUILD PLAN now — no code. It must fix everything they have to agree on:
1. Layout: the screens / sections and what each shows.
2. Every input: element id, label, unit, default value, min / max, and its source — the source name and link from the SPEC, or "Estimate — no public source" with the reasoning.
3. Every result and chart: element id, what it shows, and the exact formula.
4. Every element id and CSS class name the markup will use.
5. JavaScript: the state, the function names, and what each button does.
6. Every visible text (labels, info boxes, headings, messages) — in each language when the request asks for a language switch.
7. Artwork: every picture the app shows — characters or creatures, items, backgrounds, icons, effects — each one an SVG symbol: its id (starting with "art-"), what it shows (pose, distinctive features, colours from the art direction) and its viewBox. All in the art direction, each told apart by silhouette and colour. An app that needs no pictures (a calculator, a cost model) lists none.
8. Motion: what moves and when — idle animation, hover and press feedback, attacks and hits, damage numbers, screen transitions, a win — as CSS animation class names or requestAnimationFrame functions. Nothing moves without a reason.
${ad}
Plain text, compact, no code blocks. End the plan with ONE line: ART_IDS: art-…, art-… (or ART_IDS: none).`, 10000, 0));
    const ids = [...new Set(((/ART_IDS:\s*([^\n]+)/i.exec(plan) || [])[1] || '').split(/[,\s]+/).map(x => x.trim()).filter(x => /^art-[\w-]+$/i.test(x)))].slice(0, 40);
    // 2. the parts, each from the plan
    const css = partCss(await part(o, 'Writing the styles…', `${intro(sp)}
BUILD PLAN:
${plan}

${ad}

Write ONLY the CSS for this app — the content of one <style> element. Use exactly the ids and class names in the plan. Follow prefers-color-scheme (light and dark), work at phone width, show a visible focus, keep text readable. Look: use the art direction's palette for the app's own colours too. Motion: write the @keyframes and animation classes the plan names (idle, hit, shake, pop, fade, slide…); put every animation inside @media (prefers-reduced-motion: no-preference). Pictures are shown as <svg class="art"><use href="#art-…"/></svg> — size them with CSS. No HTML, no JavaScript, no explanation.`, 9000, plan.length));
  // 2b. the artwork: one inline SVG sprite sheet, a symbol per picture, drawn in the art direction. If it can't be
  // drawn the app is still built (without pictures) and says so.
  let art = '', found = [];
  if(ids.length){
    try {
      const clean = t => { let x = fenceless(t); const a = x.search(/<svg[\s>]/i), b = x.lastIndexOf('</svg>'); if(a < 0) return ''; x = x.slice(a, b > a ? b + 6 : undefined);
        return x.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '').replace(/<image\b[^>]*>/gi, ''); };
      let raw = await part(o, 'Drawing the artwork…', `${intro(sp)}
${ad}
BUILD PLAN (its "Artwork" section says what each picture shows):
${plan}

Draw the artwork. Write ONLY one inline SVG sprite sheet: <svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true"> with one <symbol id="…" viewBox="…"> for EACH of these ids: ${ids.join(', ')}.
- Follow the art direction exactly: the style, the palette (its colours and tints or shades of them), the line weight and lighting, the mood.
- Every symbol is a finished illustration, not a placeholder: layered shapes, shading and highlights from the chosen lighting, outlines as decided, a clear face or features for characters.
- Each character is recognisable at 64 px by its silhouette and colours; all of them share one consistent style.
- Self-contained: no text, no <image>, no external references, no scripts. Gradients or filters go inside the symbol, with ids that start with the symbol's id.
End with the comment <!-- END OF ART -->`, 20000, plan.length + css.length);
      for(let n = 0; n < 2 && !/END OF ART/.test(raw); n++){
        raw += await part(o, 'The artwork was long — continuing where it stopped…', `You were drawing an inline SVG sprite sheet and your reply was cut off. Continue it EXACTLY where it stopped — only the remaining SVG, no repetition, no explanation, no fences. Close every open tag, end with </svg> and then <!-- END OF ART -->.
The SVG so far ends with:
"""
${raw.slice(-3000)}
"""`, 12000, plan.length + css.length + raw.length);
      }
      art = clean(raw); found = ids.filter(id => new RegExp(`<symbol[^>]*\\bid=["']${id}["']`, 'i').test(art));
      if(!found.length){ art = ''; o.artWarn = 'The artwork came back without any usable pictures — the app was built without them. Ask in Chat to “draw the artwork again”.'; }
      else if(found.length < ids.length) o.artWarn = `${ids.length - found.length} of ${ids.length} pictures weren’t drawn (${ids.filter(x => !found.includes(x)).join(', ')}) — ask in Chat to draw them.`;
    } catch(err){ art = ''; found = []; o.artWarn = `The artwork couldn’t be drawn (${(err && err.message) || 'the AI request failed'}) — the app was built without pictures. Ask in Chat to “draw the artwork again”.`; }
  }
  const artNote = found.length ? `ARTWORK (already drawn — an SVG sprite sheet in the page) with these ids: ${found.join(', ')}. Show a picture as <svg class="art" role="img" aria-label="…"><use href="#art-…"/></svg>.` : 'There is no artwork: do not reference any art- ids.';
    const body = partBody(await part(o, 'Writing the layout…', `${intro(sp)}
BUILD PLAN:
${plan}
SPEC (for exact wording and values): ${spec(20000)}
${artNote}

Write ONLY the HTML that goes inside <body> — markup only: no <script>, no <style>, no <html>, <head> or <body> tags. Use exactly the ids and class names in the plan. Every input shows its default value and has an info button (ⓘ) whose box says where the value comes from, as the plan gives it. Charts are an empty <canvas> or <svg> with the planned id (the script draws them). No explanation.`, 12000, plan.length + css.length + art.length));
    if(!/<[a-z]/i.test(body)) throw new Error('the layout that came back had no HTML in it');
    let js = partJs(await part(o, 'Writing the logic…', `${intro(sp)}
BUILD PLAN:
${plan}
SPEC (for exact values and formulas): ${spec(30000)}
THE MARKUP (already written — use only ids and classes that exist in it):
${body.slice(0, 40000)}
${artNote} From code, build a picture the same way (createElementNS for svg and use).
MOTION: make the motion the plan describes happen — add and remove its animation classes on events (restart one by removing it, forcing a reflow, adding it again), animate numbers and bars with requestAnimationFrame, transition between screens. When matchMedia('(prefers-reduced-motion: reduce)').matches, skip the motion and just show the end state.

Write ONLY the JavaScript — the content of one <script> at the end of <body> — that makes this markup work: every control does something, every calculation runs live, charts are drawn with <canvas> or SVG, the language switch works if the plan has one, results can be exported if the plan says so. No libraries, no fetch, no imports. No HTML, no explanation. End with the line: // END OF APP`, 24000, plan.length + css.length + body.length));
    for(let n = 0; n < 3 && !/\/\/\s*END OF APP\s*$/.test(js); n++){ // cut off: carry on exactly where it stopped
      const more = await part(o, 'The logic was long — continuing where it stopped…', `You were writing the JavaScript of an app and your reply was cut off. Continue it EXACTLY where it stopped — only the remaining code, no repetition, no explanation, no fences. End with the line: // END OF APP
The code so far ends with:
"""
${js.slice(-3000)}
"""`, 12000, plan.length + css.length + body.length + js.length);
      js += '\n' + partJs(more);
    }
    o.stage = 'Putting the app together…'; progress(o, plan.length + css.length + body.length + js.length);
    const title = String(o.title || 'App').replace(/[<>&]/g, '');
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${css}
</style>
</head>
<body>
${art}
${body}
<script>
${js.replace(/<\/script/gi, '<\\/script')}
</script>
</body>
</html>`;
  }
  async function build(o){
    o.busy = true; o.err = ''; o.chars = 0; o.stage = 'Reading what the workstream settled…'; delete WO.hosts[o.id]; exRenderResult();
    try {
      const sp = spec();
      if(!sp.nodes.length) throw new Error('no node has been completed yet — the app is built from their outputs');
      const html = await writeInParts(sp, o); // in parts: a plan, then styles, layout and logic
      addVersion(o, html, 'Built from the workstream');
      if(o.artWarn){ o.data.checks.push({ kind: 'warn', text: o.artWarn }); delete o.artWarn; } // built without (some of) its pictures: said, not hidden
      o.sig = woSig(); o.at = Date.now();
    } catch(err){
      console.error('[Interactive app] build failed', err); o.err = (err && err.message) || 'The AI request failed.';
      if(err && err.code === 'NO_KEY' && window.AI && AI.openSettings) AI.openSettings();
    }
    o.busy = false; exRenderResult();
  }
  function addVersion(o, html, note){
    o.versions = o.versions || []; o.versions.push({ html, note, at: Date.now() }); o.vi = o.versions.length - 1;
    o.data = { html, checks: checks(html) }; delete WO.hosts[o.id];
  }
  const cur = o => o.versions && o.versions[o.vi != null ? o.vi : o.versions.length - 1];

  // ---------- change it via Chat: targeted edits, a full rewrite only when they don't apply ----------
  async function edit(o, instruction){
    const v = cur(o); if(!v) return { ok: false, reply: 'There is no app yet to change.' };
    o.busy = true; o.err = ''; o.chars = 0; o.stage = 'Changing the app…'; exRenderResult();
    let reply = '';
    try {
      const sp = spec(), base = v.html;
      const t = await ask(`Change this self-contained HTML app as the user asks. Keep everything they did not ask to change. Facts and numbers still come only from the SPEC.
USER: "${instruction}"
SPEC: ${JSON.stringify(sp).slice(0, 30000)}
${RULES}
CURRENT FILE:
"""
${base}
"""
Answer in EXACTLY this format: first a line "SUMMARY: <one sentence on what you changed>", then one or more edit blocks:
<<<<<<< FIND
(exact existing text, copied character for character, long enough to be unique)
=======
(the replacement)
>>>>>>> REPLACE
If the change touches most of the file, instead answer "SUMMARY: …" followed by "FULL:" and the complete new file.`, n => progress(o, n));
      reply = ((/SUMMARY:\s*(.+)/.exec(t) || [])[1] || 'Updated the app.').trim();
      let html = null;
      const full = t.split(/^\s*FULL:\s*$/m)[1] || (/FULL:\s*(<!doctype[\s\S]*)/i.exec(t) || [])[1];
      if(full) html = clean(full);
      else {
        const blocks = [...t.matchAll(/<{7} FIND\r?\n([\s\S]*?)\r?\n={7}\r?\n([\s\S]*?)\r?\n>{7} REPLACE/g)];
        if(blocks.length){ html = base; for(const [, a, b] of blocks){ if(html.indexOf(a) < 0){ html = null; break; } html = html.replace(a, () => b); } }
      }
      if(!html){ // the edits didn't fit the file: write the whole file again with the change
        o.stage = 'Rewriting the whole file with your change…'; progress(o, 0);
        html = await writeHtml(`${buildPrompt(sp)}\n\nThe current version is below. Apply this change and keep everything else: "${instruction}"\n"""\n${base}\n"""`, o);
      }
      if(!html) throw new Error('no HTML file came back');
      addVersion(o, html, instruction); o.at = Date.now();
    } catch(err){ console.error('[Interactive app] edit failed', err); o.err = `Couldn’t change the app — ${(err && err.message) || 'the AI request failed'}.`; reply = ''; }
    o.busy = false; exRenderResult();
    return { ok: !o.err, reply };
  }

  // ---------- the app in the Workstream result ----------
  const slug = s => String(s || 'app').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'app';
  function render(box, wo){
    if(wo.busy){
      box.innerHTML = `<div class="app-build" id="app-prog-${wo.id}" role="status" aria-live="polite"><span class="graph-loading-spinner" aria-hidden="true"></span>
        <p class="app-build-t">${wo.versions && wo.versions.length ? 'Updating the app' : 'Building the app'}</p><p class="app-prog-stage">${E(wo.stage || '')}</p><p class="app-prog-n">${wo.chars ? `${Math.round(wo.chars / 1000)} k characters written` : ''}</p>
        <p class="app-build-note">Written in parts — a plan, the styles, the artwork (when it has pictures), the layout and the logic — and joined into one self-contained HTML file. A large app can take a few minutes.</p></div>`;
      return;
    }
    if(wo.err && !cur(wo)){ box.innerHTML = `<div class="banner ex-banner" role="alert">Couldn’t build the app — ${E(wo.err)} <button type="button" class="ip-mini" data-wo="update" data-id="${wo.id}">Try again</button></div>`; return; }
    const v = cur(wo), ck = (wo.data && wo.data.checks) || [], n = wo.versions.length;
    const bar = `<div class="app-bar"><span class="app-bar-t">${FMT_ICO}<b>${E(wo.title)}</b>${n > 1 ? `<label class="app-ver">Version <select data-app-ver="${wo.id}" aria-label="Version">${wo.versions.map((x, i) => `<option value="${i}"${i === wo.vi ? ' selected' : ''}>${i + 1} · ${E(new Date(x.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))} — ${E(String(x.note).slice(0, 40))}</option>`).join('')}</select></label>` : ''}</span><span class="app-bar-sp"></span>
      <button type="button" class="ip-mini" data-app="tab" data-id="${wo.id}">Open in new tab</button><button type="button" class="ip-mini" data-app="download" data-id="${wo.id}">Download .html</button><button type="button" class="ip-mini" data-app="full" data-id="${wo.id}">Full screen</button><button type="button" class="ip-mini" data-wo="update" data-id="${wo.id}">Make it again</button></div>`;
    box.innerHTML = `${wo.err ? `<div class="banner ex-banner" role="alert">${E(wo.err)}</div>` : ''}${bar}
      ${ck.length ? `<ul class="app-checks">${ck.map(c => `<li class="app-check app-check--${c.kind}">${E(c.text)}</li>`).join('')}</ul>` : ''}
      <div class="app-frame-slot"></div>
      <p class="app-hint">Want a change? Ask in Chat — e.g. “add a sensitivity chart for labour cost”. Every version is kept.</p>`;
    // the running app is kept between re-renders (its state isn't lost) — rebuilt only for another version
    let h = WO.hosts[wo.id];
    if(!h || h.dataset.vi !== String(wo.vi)){
      h = document.createElement('div'); h.className = 'app-frame-wrap'; h.dataset.vi = String(wo.vi);
      const f = document.createElement('iframe'); f.className = 'app-frame'; f.title = wo.title;
      f.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals allow-forms allow-downloads');
      f.srcdoc = v.html;
      h.innerHTML = `<div class="app-full-bar"><span class="app-bar-t">${FMT_ICO}<b>${E(wo.title)}</b></span><span class="app-bar-sp"></span><button type="button" class="ip-mini" data-app="download" data-id="${wo.id}">Download .html</button><button type="button" class="btn ip-btn-sm" data-app="exit-full" data-id="${wo.id}">Exit full screen</button></div>`;
      h.appendChild(f); WO.hosts[wo.id] = h;
    }
    box.querySelector('.app-frame-slot').appendChild(h);
  }
  const FMT_ICO = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3 7 13"/></svg>';
  document.addEventListener('change', e => { const s = e.target.closest && e.target.closest('[data-app-ver]'); if(!s) return; const o = WO.outputs.find(x => x.id === s.dataset.appVer); if(!o) return; o.vi = +s.value; const v = cur(o); o.data = { html: v.html, checks: checks(v.html) }; exRenderResult(); });
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-app]'); if(!b) return;
    const o = WO.outputs.find(x => x.id === b.dataset.id), v = o && cur(o); if(!v) return;
    if(b.dataset.app === 'tab'){ const url = URL.createObjectURL(new Blob([v.html], { type: 'text/html' })); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 120000); }
    else if(b.dataset.app === 'download'){ const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([v.html], { type: 'text/html' })); a.download = slug(o.title) + '.html'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
  else if(b.dataset.app === 'full') fullScreen(o.id, true);
  else if(b.dataset.app === 'exit-full') fullScreen(o.id, false);
});
// Full screen: the app's own frame fills the window (moving it would restart the app), with a bar to leave; the browser's
// real full screen too where it is allowed. Esc, or leaving the browser's full screen, closes it.
function fullScreen(id, on){
  const h = WO.hosts[id]; if(!h) return;
  h.classList.toggle('app-frame-wrap--full', on); document.documentElement.classList.toggle('app-full-on', on);
  if(on){
    const x = h.querySelector('[data-app="exit-full"]'); if(x) x.focus();
    if(h.requestFullscreen && !document.fullscreenElement) h.requestFullscreen().catch(() => {}); // not allowed here: the window-filling view stays
  } else {
    if(document.fullscreenElement === h && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    const b = document.querySelector(`[data-app="full"][data-id="${id}"]`); if(b) b.focus();
  }
}
const fullId = () => Object.keys(WO.hosts || {}).find(id => WO.hosts[id].classList.contains('app-frame-wrap--full'));
document.addEventListener('keydown', e => { if(e.key === 'Escape' && fullId()) fullScreen(fullId(), false); });
document.addEventListener('fullscreenchange', () => { const id = fullId(); if(id && document.fullscreenElement !== WO.hosts[id]) fullScreen(id, false); });

  // ---------- wrap the shared Workstream result functions ----------
  const W = (name, fn) => { const orig = window[name]; if(typeof orig !== 'function') return; window[name] = function(){ return fn.call(this, orig, arguments); }; };
  // the app is offered first when the request asks for one
  W('woSuggestFormats', async (o, a) => { await o.apply(null, a); if(appWanted() && WO.formats && !WO.formats.some(f => f.kind === 'app')){ WO.formats.unshift(Object.assign({}, FMT)); exRenderResult(); } });
  W('woBuild', (o, a) => a[0] && a[0].fmt && a[0].fmt.kind === 'app' ? build(a[0]) : o.apply(null, a));
  W('woRenderOutput', (o, a) => { const [box, item] = a, wo = WO.outputs.find(x => x.id === item.id); return wo && wo.fmt.kind === 'app' ? render(box, wo) : o.apply(null, a); });
  W('outputIcon', (o, a) => a[0] && a[0].kind === 'app' ? FMT_ICO : o.apply(null, a));
  // when the request asks for an app, it is built as soon as the result is ready (once), and opened
  W('exRenderResultInner', (o, a) => { const r = o.apply(null, a);
    if(appWanted() && EX.result && (typeof exResultLive === 'function' ? exResultLive() : exAllDone()) && !EX.resultBusy && !WO.appAuto && !WO.outputs.some(x => x.fmt.kind === 'app')){ WO.appAuto = true; setTimeout(() => woConvert(Object.assign({}, FMT)), 0); }
    return r; });
  // Chat in the Workstream result: while the app is open, a request changes the app
  W('exResultChatTurn', async (o, a) => {
    const [text, status] = a, wo = WO.view === 'detail' && WO.outputs.find(x => x.id === WO.cur && x.fmt.kind === 'app');
    if(!wo || !cur(wo) || wo.busy || /^\s*(what|why|how|which|where|who|explain|is |are |does |do |can you explain)/i.test(text) && !/\b(add|change|make|remove|fix|translate|show|use|switch|put|set|replace)\b/i.test(text)) return o.apply(null, a);
    if(status && status.remove) status.remove();
const h = exHist('result'); h.push({ role: 'user', text });
// say in Chat straight away that the change is being made, and where it is (user test: "tell me in the chat that we
// are working on it") — the status line follows the build's own stages until the new version is ready
const ask = String(text).trim().replace(/\s+/g, ' ');
ipAddMsg('result', 'assistant', chatMd(`On it — I’m changing the app: “${ask.length > 140 ? ask.slice(0, 140) + '…' : ask}”. This takes a minute or two; the app in Output updates when the new version is ready.`), 'command');
const st = ipAddStatus('result', 'Changing the app…'), say = () => { const sp = st && st.querySelector('span:last-child'); if(sp && wo.stage) sp.textContent = wo.stage; };
const tick = setInterval(say, 500);
let res; try { res = await edit(wo, text); } finally { clearInterval(tick); if(st && st.remove) st.remove(); }
    const reply = res.ok ? `${res.reply} (version ${wo.versions.length})` : 'I couldn’t change the app — see the message in Output, and try again.';
    h.push({ role: 'assistant', text: reply });
    ipAddMsg('result', 'assistant', chatMd(reply) + (res.ok ? '<div class="msg-cta-row"><button type="button" class="msg-cta" data-ex-goto="sec:result">See the app →</button></div>' : ''), res.ok ? 'command' : 'question');
  });
  window.AppBuilder = { spec, buildPrompt, checks, build, edit };
})();
// a new workstream starts without an app (it is built again for the new request when it asks for one)
(function(){ if(typeof exReset !== 'function') return; const orig = exReset; window.exReset = function(){ const r = orig.apply(this, arguments); if(typeof WO !== 'undefined') WO.appAuto = false; return r; }; })();
