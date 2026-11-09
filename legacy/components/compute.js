// components/compute.js — the Calculation step of an Execution node: exact numbers from the user's own data.
//
// Why: the expert coverage test (README round 69) found that 40 of 80 real expert tasks need numbers worked out
// from data (variance vs budget, RICE scores, SCADA vs P50, reconciliations, NPV), and the AI was doing the
// arithmetic in text. Here plain JavaScript does it, the formula is shown, and the result goes into the node's AI
// context ("use these numbers, never redo them") and into its result document.
//
//   Attach a CSV (or paste a table) → the AI maps the request onto ONE fixed calculation and its columns →
//   the calculation runs here → table + formula + summary → used by this node's findings and result.
//
// Fixed calculations only (product decision, option B): variance, group, score, formula, npv, range, reconcile, filter (round 71: conditions, date maths, in / not in table 2).
// Before a calculation, an optional per-row AI step (round 70) reads each row and writes one label or score into a
// new column — e.g. the contact reason of each ticket — which the calculations then count or average.
// Round 72: a lookup from table 2, and several calculations in one node, each on the previous result.
// Round 73: if / band / text in the per-row formula, and a running total with a cut line.
// Round 74: up to 5 attached tables (a step names the one it looks in), and sum / avg / count of a column in formulas.
// Round 75: a pivot (rows × columns), and date functions in formulas (month, week, quarter, days, months).
// Round 76: a step can work on table 1 or an earlier step (side-by-side checks), look in an earlier step's result, and
// group gains min / max (dates too) / first / last.
// CSV / pasted tables only — an .xlsx gets "Save it as CSV first" (no spreadsheet library: CLAUDE.md, no dependencies).
// Loaded after exec-kinds.js; wraps exCtx and exRsResultMd the same way (window function wrappers).
(function(){
  'use strict';
  if(typeof exCtx !== 'function' || typeof exRsW !== 'function') return;
  const E = s => ipE(s == null ? '' : String(s));
  const MAX_BYTES = 2 * 1024 * 1024, MAX_ROWS = 20000, SHOW_ROWS = 40;

  // ---------- reading a table ----------
  function parseTable(text){
    text = String(text || '').replace(/^﻿/, '');
    const first = text.split(/\r?\n/).find(l => l.trim()) || '';
    const count = ch => first.split(ch).length - 1;
    const sep = [['\t', count('\t')], [';', count(';')], [',', count(',')]].sort((a, b) => b[1] - a[1])[0];
    const delim = sep[1] ? sep[0] : ',';
    const rows = []; let row = [], cell = '', q = false;
    for(let i = 0; i < text.length; i++){
      const c = text[i];
      if(q){ if(c === '"'){ if(text[i + 1] === '"'){ cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if(c === '"' && cell === '') q = true;
      else if(c === delim){ row.push(cell); cell = ''; }
      else if(c === '\n' || c === '\r'){ if(c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if(cell !== '' || row.length) { row.push(cell); rows.push(row); }
    const clean = rows.filter(r => r.some(x => String(x).trim()));
    if(clean.length < 2) throw new Error('The table needs a header row and at least one row of data.');
    if(clean.length - 1 > MAX_ROWS) throw new Error(`The table has ${(clean.length - 1).toLocaleString('en-US')} rows; the limit here is ${MAX_ROWS.toLocaleString('en-US')}.`);
    const seen = {};
    const header = clean[0].map((h, i) => { let n = String(h).trim() || `Column ${i + 1}`; if(seen[n]) n = `${n} (${++seen[n]})`; else seen[n] = 1; return n; });
    const body = clean.slice(1).map(r => header.map((_, i) => String(r[i] == null ? '' : r[i]).trim()));
    return { header, rows: body };
  }
  // "1,234.50", "฿1,200", "(350)", "12%", "-" → a number, or null
  function num(v){
    if(typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v == null ? '' : v).trim(); if(!s || s === '-' || s === '—') return null;
    let neg = false;
    if(/^\(.*\)$/.test(s)){ neg = true; s = s.slice(1, -1); }
    s = s.replace(/[฿$€£¥\s,%]/g, '').replace(/[A-Za-z]+$/, '');
    if(!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return null;
    const n = parseFloat(s); return isFinite(n) ? (neg ? -n : n) : null;
  }
  const fmt = (v, d) => v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d == null ? 2 : d });
  const pct = v => v == null || !isFinite(v) ? '—' : `${v >= 0 ? '' : '−'}${Math.abs(v).toFixed(1)}%`;
  const signed = v => v == null || !isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v))}`;

  // ---------- a small safe formula language ----------
  // Column names ([Name with spaces] or Name), numbers, "text", + − × ÷ ^, & (joins text), comparisons = <> > < >= <=,
  // and functions min, max, abs, round(x, digits), if(test, then, else), and, or, not,
  // band(x, upTo1, v1, upTo2, v2, …, else) — the value for the first band x is below (round 73: tiers, a merit matrix key),
  // and sum / avg / count of a whole column (round 74: a share of the total, fitting raises to a budget),
  // and dates (round 75): month(d) "2026-09", week(d) "2026-W37" (ISO), quarter(d) "2026-Q3", year(d), days(a, b), months(a, b), today().
  // Only these tokens are read: nothing is evaluated as code.
  const FUNCS = ['min', 'max', 'abs', 'round', 'if', 'and', 'or', 'not', 'band', 'month', 'week', 'quarter', 'year', 'days', 'months', 'today'];
  function compile(expr, header){
    const src = String(expr || ''), toks = []; let i = 0;
    const byName = n => header.find(h => h.toLowerCase() === n.toLowerCase());
    while(i < src.length){
      const c = src[i], two = src.slice(i, i + 2);
      if(/\s/.test(c)){ i++; continue; }
      if(/[\d.]/.test(c)){ const m = /^\d*\.?\d+/.exec(src.slice(i)); if(!m) throw new Error(`“${c}” can't be used in a formula.`); toks.push({ t: 'n', v: parseFloat(m[0]) }); i += m[0].length; continue; }
      if(c === '"' || c === "'" || c === '“'){ const close = c === '“' ? '”' : c, j = src.indexOf(close, i + 1); if(j < 0) throw new Error('A "text" value is not closed.'); toks.push({ t: 's', v: src.slice(i + 1, j) }); i = j + 1; continue; }
      if(c === '['){ const j = src.indexOf(']', i); if(j < 0) throw new Error('A [column name] is not closed.'); const n = src.slice(i + 1, j), col = byName(n.trim()); if(!col) throw new Error(`Unknown column “${n}”. Columns: ${header.join(', ')}.`); toks.push({ t: 'c', v: col }); i = j + 1; continue; }
      const ag = /^(sum|avg|average|count)\s*\(\s*(\[[^\]]+\]|[A-Za-z_฀-๿][\w฀-๿]*)\s*\)/i.exec(src.slice(i));
      if(ag){ const raw = ag[2].replace(/^\[|\]$/g, '').trim(), col = byName(raw); if(!col) throw new Error(`Unknown column “${raw}” in ${ag[1]}(). Columns: ${header.join(', ')}.`);
        toks.push({ t: 'a', v: ag[1].toLowerCase() === 'average' ? 'avg' : ag[1].toLowerCase(), col }); i += ag[0].length; continue; }
      if(/^(sum|avg|average|count)\s*\(/i.test(src.slice(i))) throw new Error('sum( / avg( / count( take one column: sum([Raise]).');
      if(/[A-Za-z_฀-๿]/.test(c)){ const m = /^[A-Za-z_฀-๿][\w฀-๿]*/.exec(src.slice(i)), w = m[0];
        if(FUNCS.includes(w.toLowerCase()) && /^\s*\(/.test(src.slice(i + w.length))) toks.push({ t: 'f', v: w.toLowerCase() });
        else { const col = byName(w); if(!col) throw new Error(`Unknown column “${w}”. Use [Column name] for names with spaces. Columns: ${header.join(', ')}.`); toks.push({ t: 'c', v: col }); }
        i += w.length; continue; }
      if(['>=', '<=', '<>', '!=', '=='].includes(two)){ toks.push({ t: 'o', v: two === '!=' ? '<>' : two === '==' ? '=' : two }); i += 2; continue; }
      if('≥≤≠'.includes(c)){ toks.push({ t: 'o', v: ({ '≥': '>=', '≤': '<=', '≠': '<>' })[c] }); i++; continue; }
      if('+-*/^(),×÷−&=<>'.includes(c)){ toks.push({ t: 'o', v: ({ '×': '*', '÷': '/', '−': '-' })[c] || c }); i++; continue; }
      throw new Error(`“${c}” can't be used in a formula.`);
    }
    // shunting-yard → postfix; each function call remembers how many arguments it got
    const P = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5, 'u-': 6 };
    const out = [], st = [], args = []; let prev = null;
    const isVal = tk => tk && (tk.t === 'n' || tk.t === 's' || tk.t === 'c' || tk.t === 'a' || (tk.t === 'o' && tk.v === ')'));
    toks.forEach(tk => {
      if(args.length && tk.v !== ')') args[args.length - 1].empty = false;
      if(tk.t === 'n' || tk.t === 's' || tk.t === 'c' || tk.t === 'a') out.push(tk);
      else if(tk.t === 'f') st.push({ t: 'f', v: tk.v });
      else if(tk.v === '('){ st.push(tk); args.push({ fn: !!(prev && prev.t === 'f'), n: 1, empty: true }); }
      else if(tk.v === ','){ while(st.length && st[st.length - 1].v !== '(') out.push(st.pop()); if(!args.length || !args[args.length - 1].fn) throw new Error('A comma can only separate a function\'s values.'); args[args.length - 1].n++; }
      else if(tk.v === ')'){
        while(st.length && st[st.length - 1].v !== '(') out.push(st.pop());
        if(!st.length) throw new Error('A bracket is not opened.');
        st.pop(); const a = args.pop();
        if(a.fn){ const f = st.pop(); out.push({ t: 'f', v: f.v, n: a.empty ? 0 : a.n }); }
      }
      else {
        let op = tk.v; if(op === '-' && !isVal(prev)) op = 'u-';
        while(st.length && st[st.length - 1].t === 'o' && st[st.length - 1].v !== '(' && (P[st[st.length - 1].v] > P[op] || (P[st[st.length - 1].v] === P[op] && op !== '^' && op !== 'u-'))) out.push(st.pop());
        st.push({ t: 'o', v: op });
      }
      prev = tk;
    });
    while(st.length){ const x = st.pop(); if(x.v === '(') throw new Error('A bracket is not closed.'); if(x.t === 'f') throw new Error(`${x.v}( needs its values in brackets.`); out.push(x); }
    if(!out.length) throw new Error('The formula is empty.');
    const cols = [...new Set(toks.filter(t => t.t === 'c').map(t => t.v))];
    const N = v => typeof v === 'number' ? (isFinite(v) ? v : null) : v == null || v === '' ? null : num(v);
    const truthy = v => { if(v == null || v === '') return false; const n = N(v); return n == null ? true : n !== 0; };
    const cmp = (op, a, b) => { const x = N(a), y = N(b);
      if(x != null && y != null) return op === '=' ? x === y : op === '<>' ? x !== y : op === '<' ? x < y : op === '>' ? x > y : op === '<=' ? x <= y : x >= y;
      const s = String(a == null ? '' : a).trim().toLowerCase(), t = String(b == null ? '' : b).trim().toLowerCase();
      return op === '=' ? s === t : op === '<>' ? s !== t : op === '<' ? s < t : op === '>' ? s > t : op === '<=' ? s <= t : s >= t; };
    const call = (f, a) => {
      if(f === 'if'){ if(a.length < 2) throw new Error('if( needs a test and a value: if(test, then, else).'); return truthy(a[0]) ? a[1] : a.length > 2 ? a[2] : null; }
      if(f === 'and') return a.every(truthy) ? 1 : 0;
      if(f === 'or') return a.some(truthy) ? 1 : 0;
      if(f === 'not') return truthy(a[0]) ? 0 : 1;
      // dates: read like the filter reads them (ISO, day-first unless the second number is over 12, "1 Sep 2026", Excel serials)
      if(['month', 'week', 'quarter', 'year', 'days', 'months', 'today'].includes(f)){
        const D = v => v instanceof Date ? v : parseDate(v, 'auto'), two = n => String(n).padStart(2, '0');
        if(f === 'today') return today().toISOString().slice(0, 10);
        if(f === 'days' || f === 'months'){ if(a.length < 2) throw new Error(`${f}( needs two dates: ${f}(from, to).`); const x = D(a[0]), y = D(a[1]); if(!x || !y) return null;
          return f === 'days' ? Math.round((y - x) / 86400000) : (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + (y.getUTCMonth() - x.getUTCMonth()) - (y.getUTCDate() < x.getUTCDate() ? 1 : 0); }
        const d = D(a[0]); if(!d) return null;
        const Y = d.getUTCFullYear(), M = d.getUTCMonth() + 1;
        if(f === 'year') return Y;
        if(f === 'month') return `${Y}-${two(M)}`;
        if(f === 'quarter') return `${Y}-Q${Math.ceil(M / 3)}`;
        // ISO week: the week with the year's first Thursday is week 1
        const t = new Date(Date.UTC(Y, d.getUTCMonth(), d.getUTCDate())), dow = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - dow);
        const y1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return `${t.getUTCFullYear()}-W${two(Math.ceil(((t - y1) / 86400000 + 1) / 7))}`;
      }
      if(f === 'band'){ const x = N(a[0]); if(x == null) return null; const rest = a.slice(1);
        for(let j = 0; j + 1 < rest.length; j += 2){ const up = N(rest[j]); if(up == null) throw new Error('band( needs number limits: band(x, upTo1, value1, upTo2, value2, …, else).'); if(x < up) return rest[j + 1]; }
        return rest.length % 2 ? rest[rest.length - 1] : null; }
      const n = a.map(N);
      if(f === 'abs') return n[0] == null ? null : Math.abs(n[0]);
      if(f === 'round'){ if(n[0] == null) return null; const d = Math.max(0, Math.min(6, n[1] || 0)), p = Math.pow(10, d); return Math.round(n[0] * p) / p; }
      if(n.some(x => x == null) || !n.length) return null;
      return f === 'min' ? Math.min(...n) : Math.max(...n);
    };
    const aggs = toks.filter(t => t.t === 'a').map(t => ({ fn: t.v, col: t.col }));
    return { cols, aggs, eval(get, agg){
      const s = [];
      for(const tk of out){
        if(tk.t === 'n' || tk.t === 's') s.push(tk.v);
        else if(tk.t === 'c') s.push(get(tk.v));
        else if(tk.t === 'a'){ if(!agg) throw new Error('sum / avg / count of a column only work in the per-row formula calculation.'); s.push(agg(tk.v, tk.col)); }
        else if(tk.t === 'f'){ if(s.length < tk.n) throw new Error('The formula is not complete.'); s.push(call(tk.v, tk.n ? s.splice(s.length - tk.n, tk.n) : [])); }
        else if(tk.v === 'u-'){ const a = N(s.pop()); s.push(a == null ? null : -a); }
        else {
          if(s.length < 2) throw new Error('The formula is not complete.');
          const b = s.pop(), a = s.pop();
          if(tk.v === '&'){ s.push(String(a == null ? '' : a) + String(b == null ? '' : b)); continue; }
          if(P[tk.v] === 1){ s.push(cmp(tk.v, a, b) ? 1 : 0); continue; }
          const x = N(a), y = N(b); if(x == null || y == null){ s.push(null); continue; }
          s.push(tk.v === '+' ? x + y : tk.v === '-' ? x - y : tk.v === '*' ? x * y : tk.v === '/' ? (y === 0 ? null : x / y) : Math.pow(x, y));
        }
      }
      if(s.length !== 1) throw new Error('The formula is not complete.');
      const v = s[0]; return typeof v === 'number' ? (isFinite(v) ? v : null) : v == null || v === '' ? null : String(v);
    } };
  }

  // Round 74: up to 5 attached tables. Table 1 is what a step works on (or the previous step's result); a step that
  // looks elsewhere names its table by number (2-5), default 2.
  const MAX_TABLES = 5;
  // Round 76: an earlier step's result can be referred to as "step N" (lookups, reconcile, the filter's other-table tests).
  const refN = (list, n) => { const m = /^step\s*(\d+)$/i.exec(String(n == null ? '' : n).trim()); if(m){ const i = list.findIndex(t => t && t.isStep === +m[1]); if(i > 0) return i + 1; }
    return Math.max(2, Math.min(Math.max(2, list.length), parseInt(n, 10) || 2)); };
  const refLabel = (list, n) => { const t = list[refN(list, n) - 1]; return t && t.isStep ? `step ${t.isStep}` : `table ${refN(list, n)}`; };
  const refKey = (list, n) => { const t = list[refN(list, n) - 1]; return t && t.isStep ? `step ${t.isStep}` : refN(list, n); };
  const refT = (list, n) => list[refN(list, n) - 1];
  const isRefOp = op => /another table$/.test(op || '');
  // ---------- the fixed calculations ----------
  const col = (t, name) => { const i = t.header.indexOf(name); if(i < 0) throw new Error(`Pick a column for “${name || '…'}”.`); return i; };
  const OPS = {
    variance: { label: 'Variance vs budget or target', needs: 1,
      params: [['label', 'col', 'Line (what each row is)'], ['actual', 'col', 'Actual'], ['budget', 'col', 'Budget / target'], ['pct', 'num', 'Flag at |%| ≥', 5], ['abs', 'num', 'or |variance| ≥', 0]],
      run(p, [t]){
        const li = col(t, p.label), ai = col(t, p.actual), bi = col(t, p.budget), P = num(p.pct) || 0, A = num(p.abs) || 0;
        const rows = t.rows.map(r => { const a = num(r[ai]), b = num(r[bi]), v = a == null || b == null ? null : a - b, pc = v == null || !b ? null : v / Math.abs(b) * 100;
          return { l: r[li], a, b, v, pc, flag: v != null && ((P && pc != null && Math.abs(pc) >= P) || (A && Math.abs(v) >= A)) }; });
        rows.sort((x, y) => Math.abs(y.v || 0) - Math.abs(x.v || 0));
        const ta = rows.reduce((s, r) => s + (r.a || 0), 0), tb = rows.reduce((s, r) => s + (r.b || 0), 0), tv = ta - tb, flagged = rows.filter(r => r.flag);
        const rule = [P ? `|%| ≥ ${fmt(P)}%` : '', A ? `|variance| ≥ ${fmt(A)}` : ''].filter(Boolean).join(' or ') || 'no threshold';
        return { formula: `Variance = ${p.actual} − ${p.budget} (positive = above budget); % = Variance ÷ |${p.budget}|; flagged when ${rule}.`,
          summary: [`Total ${p.actual} ${fmt(ta)} vs ${p.budget} ${fmt(tb)}: variance ${signed(tv)} (${pct(tb ? tv / Math.abs(tb) * 100 : null)}).`,
            `${flagged.length} of ${rows.length} lines flagged (${rule}).`, ...flagged.slice(0, 3).map(r => `${r.l}: ${signed(r.v)} (${pct(r.pc)})`)],
          // what the reader scans for first (flag, variance, %) comes first: the Output column is narrow
          cols: [p.label, 'Flag', 'Variance', '%', p.actual, p.budget],
          rows: rows.map(r => [r.l, r.flag ? 'Flagged' : '', signed(r.v), pct(r.pc), fmt(r.a), fmt(r.b)]).concat([['Total', '', signed(tv), pct(tb ? tv / Math.abs(tb) * 100 : null), fmt(ta), fmt(tb)]]) };
      } },
    group: { label: 'Group and count / sum / min / max', needs: 1,
      params: [['group', 'col', 'Group by'], ['value', 'col?', 'Value column (blank = count rows)'], ['agg', ['count', 'sum', 'average', 'min', 'max', 'first', 'last'], 'Measure']],
      run(p, [t]){
        const gi = col(t, p.group), vi = p.value ? col(t, p.value) : -1, agg = vi < 0 ? 'count' : (p.agg || 'sum'), m = new Map();
        // round 76: min / max read a date column as dates (the earliest / latest), first / last follow the file's order
        const cells = vi < 0 ? [] : t.rows.map(r => String(r[vi] == null ? '' : r[vi]).trim()).filter(Boolean);
        const asDate = (agg === 'min' || agg === 'max') && cells.length && cells.filter(x => num(x) == null && parseDate(x, 'auto')).length >= cells.length * 0.8;
        t.rows.forEach(r => { const k = r[gi] || '(blank)', g = m.get(k) || { n: 0, s: 0, c: 0, lo: null, hi: null, first: null, last: null }; g.n++;
          if(vi >= 0){ const raw = String(r[vi] == null ? '' : r[vi]).trim(), v = asDate ? (parseDate(raw, 'auto') || null) : num(raw);
            if(raw){ if(g.first == null) g.first = raw; g.last = raw; }
            if(v != null){ const x = asDate ? +v : v; if(!asDate){ g.s += v; g.c++; } if(g.lo == null || x < g.lo) g.lo = x; if(g.hi == null || x > g.hi) g.hi = x; } }
          m.set(k, g); });
        const val = g => agg === 'count' ? g.n : agg === 'average' ? (g.c ? g.s / g.c : null) : agg === 'sum' ? g.s : agg === 'min' ? g.lo : agg === 'max' ? g.hi : agg === 'first' ? g.first : g.last;
        const show = v => v == null ? '—' : asDate ? new Date(v).toISOString().slice(0, 10) : typeof v === 'number' ? fmt(v) : v;
        const shares = agg === 'count' || agg === 'sum';
        let list = [...m.entries()].map(([k, g]) => ({ k, v: val(g), n: g.n }));
        list = typeof list[0]?.v === 'number' && agg !== 'min' && agg !== 'max' ? list.sort((a, b) => (b.v || 0) - (a.v || 0)) : list.sort((a, b) => String(a.k).localeCompare(String(b.k), 'en', { numeric: true }));
        const total = shares ? list.reduce((x, y) => x + (y.v || 0), 0) : 0;
        const what = agg === 'count' ? 'Rows' : `${rsCap(agg)} of ${p.value}`;
        return { formula: agg === 'count' ? `Rows counted per ${p.group}; share = rows ÷ all rows.` : `${rsCap(agg)} of ${p.value} per ${p.group}${agg === 'sum' ? '; share = group ÷ total' : asDate ? ' (read as dates)' : agg === 'first' || agg === 'last' ? ' (in the file\'s order)' : ''}.`,
          summary: [`${list.length} groups of ${p.group} across ${t.rows.length} rows.`, ...list.slice(0, 3).map(x => `${x.k}: ${show(x.v)}${shares && total ? ` (${pct(x.v / total * 100)})` : ''}`)],
          cols: [p.group, what, ...(shares ? ['Share'] : []), ...(agg === 'count' ? [] : ['Rows'])], // a count already is the rows
          rows: list.map(x => [x.k, show(x.v), ...(shares ? [total ? pct(x.v / total * 100) : '—'] : []), ...(agg === 'count' ? [] : [fmt(x.n, 0)])]) };
      } },
    score: { label: 'Weighted score and rank', needs: 1,
      params: [['label', 'col', 'Option / item'], ['criteria', 'criteria', 'Criteria (column · weight · better when)']],
      run(p, [t]){
        const li = col(t, p.label), cr = (p.criteria || []).filter(c => c && c.col);
        if(!cr.length) throw new Error('Add at least one criterion column.');
        const idx = cr.map(c => ({ i: col(t, c.col), w: num(c.weight) == null ? 1 : num(c.weight), low: c.dir === 'lower', name: c.col }));
        const rng = idx.map(c => { const vs = t.rows.map(r => num(r[c.i])).filter(v => v != null); return { min: Math.min(...vs), max: Math.max(...vs) }; });
        const sw = idx.reduce((s, c) => s + c.w, 0) || 1;
        const rows = t.rows.map(r => { let s = 0; idx.forEach((c, j) => { const v = num(r[c.i]), R = rng[j]; let n = v == null ? 0 : R.max === R.min ? 1 : (v - R.min) / (R.max - R.min); if(c.low) n = 1 - n; s += c.w * n; }); return { l: r[li], s: s / sw * 100, raw: idx.map(c => r[c.i]) }; }).sort((a, b) => b.s - a.s);
        return { formula: `Score = Σ(weight × value scaled 0–1 across the rows) ÷ Σ weights × 100. Weights: ${idx.map(c => `${c.name} ${fmt(c.w)}${c.low ? ' (lower is better)' : ''}`).join(', ')}.`,
          summary: [`Ranked ${rows.length} rows (${p.label}) on ${idx.length} criteria.`, ...rows.slice(0, 3).map((r, i) => `${i + 1}. ${r.l}: ${fmt(r.s, 1)}`)],
          cols: ['Rank', p.label, 'Score (0–100)', ...idx.map(c => c.name)], rows: rows.map((r, i) => [String(i + 1), r.l, fmt(r.s, 1), ...r.raw]) };
      } },
    formula: { label: 'Formula per row (e.g. RICE, margin, capacity factor)', needs: 1,
      params: [['label', 'col', 'Row label'], ['expr', 'text', 'Formula (columns, + − × ÷ ^, & for text, if(test, a, b), band(x, upTo1, v1, …, else), and / or, min / max / abs / round, sum / avg / count of a column, month / week / quarter / year, days(a, b), months(a, b), today())'], ['name', 'text', 'Result name'], ['sort', ['highest first', 'lowest first', 'as in the file'], 'Order']],
      run(p, [t]){
        const li = col(t, p.label), f = compile(p.expr, t.header), name = String(p.name || '').trim() || 'Result';
        const agg = (fn, c) => { const j = t.header.indexOf(c), cells = t.rows.map(r => String(r[j] == null ? '' : r[j]).trim()), vals = cells.map(num).filter(v => v != null);
          return fn === 'count' ? cells.filter(Boolean).length : fn === 'sum' ? vals.reduce((x, y) => x + y, 0) : vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null; };
        const aggVals = f.aggs.map(a => `${a.fn}(${a.col}) = ${fmt(agg(a.fn, a.col))}`);
        let rows = t.rows.map(r => ({ l: r[li], v: f.eval(c => r[t.header.indexOf(c)], agg), raw: t.header.map((h, j) => j === li ? null : r[j]).filter(x => x !== null) }));
        const missing = rows.filter(r => r.v == null).length, nv = v => typeof v === 'number' ? v : null; // text results sort last
        if(p.sort === 'highest first') rows.sort((a, b) => (nv(b.v) == null ? -Infinity : b.v) - (nv(a.v) == null ? -Infinity : a.v));
        if(p.sort === 'lowest first') rows.sort((a, b) => (nv(a.v) == null ? Infinity : a.v) - (nv(b.v) == null ? Infinity : b.v));
        const show = v => typeof v === 'number' ? fmt(v) : v == null ? '—' : v;
        return { formula: `${name} = ${p.expr}${aggVals.length ? ` (over all ${t.rows.length} rows: ${[...new Set(aggVals)].join(', ')})` : ''}`, summary: [`${name} worked out for ${rows.length - missing} of ${rows.length} rows${missing ? ` (${missing} came out blank: a missing or non-number value, or no band matched)` : ''}.`, ...rows.filter(r => r.v != null).slice(0, 3).map(r => `${r.l}: ${show(r.v)}`)],
          cols: [p.label, name, ...t.header.filter((h, j) => j !== li)], rows: rows.map(r => [r.l, show(r.v), ...r.raw]) }; // every input column carries on
      } },
    // Round 73: what fits in a budget or capacity (backlog by RICE, summing effort), or which reasons make up 80%.
    running: { label: 'Running total and cut line', needs: 1,
      params: [['label', 'col', 'Row label'], ['value', 'col', 'Value to add up'], ['sortBy', 'col?', 'Order rows by (blank = the value itself)'], ['order', ['highest first', 'lowest first', 'as in the file'], 'Order'],
        ['limit', 'num', 'Cut line: keep adding while the total stays within (blank = none)', ''], ['share', 'num', 'or: the rows that make up this % of the total (blank = none)', '']],
      run(p, [t]){
        const li = col(t, p.label), vi = col(t, p.value), si = p.sortBy ? col(t, p.sortBy) : vi, lim = num(p.limit), share = num(p.share);
        let rows = t.rows.map(r => ({ r, l: r[li], v: num(r[vi]), s: num(r[si]) }));
        if(p.order !== 'as in the file'){ const d = p.order === 'lowest first' ? 1 : -1; rows.sort((a, b) => (a.s == null) - (b.s == null) || d * ((a.s || 0) - (b.s || 0))); }
        const total = rows.reduce((x, y) => x + (y.v || 0), 0);
        let run = 0, open = true; const cut = lim != null && lim !== '' ? 'limit' : share != null && share !== '' ? 'share' : '';
        rows.forEach(x => { const before = run; run += x.v || 0; x.run = run; x.pc = total ? run / total * 100 : null;
          if(cut === 'limit'){ x.in = open && run <= lim; if(!x.in) open = false; }
          if(cut === 'share'){ x.in = open && (total ? before / total * 100 : 0) < share; if(!x.in) open = false; } });
        const inside = rows.filter(x => x.in), first = rows.find(x => cut && !x.in);
        const rest = t.header.map((h, j) => j).filter(j => j !== li && j !== vi);
        return { formula: `Rows ordered by ${p.sortBy || p.value} (${p.order}); running total of ${p.value}${cut === 'limit' ? `; within the line while the running total ≤ ${fmt(lim)}` : cut === 'share' ? `; within the line until the rows before reach ${fmt(share)}% of the total` : ''}.`,
          summary: [`Total ${p.value}: ${fmt(total)} across ${rows.length} rows.`,
            ...(cut === 'limit' ? [`${inside.length} row${inside.length === 1 ? '' : 's'} fit within ${fmt(lim)} (running total ${fmt(inside.length ? inside[inside.length - 1].run : 0)})${first ? `; the line falls before ${first.l}` : '; every row fits'}.`] : []),
            ...(cut === 'share' ? [`${inside.length} of ${rows.length} rows make up ${pct(inside.length ? inside[inside.length - 1].pc : 0)} of the total (target ${fmt(share)}%).`] : [])],
          // what the reader scans for first (is it in?) comes first: the Output column is narrow
          cols: ['#', p.label, ...(cut ? ['Within the line'] : []), p.value, 'Running total', 'Cumulative %', ...rest.map(j => t.header[j])],
          rows: rows.map((x, i) => [String(i + 1), x.l, ...(cut ? [x.in ? 'Yes' : 'No'] : []), fmt(x.v), fmt(x.run), pct(x.pc), ...rest.map(j => x.r[j])]) };
      } },
    // Round 75: rows × columns. A cohort retention matrix (signup month × months since, distinct users, % of the first
    // column), each user's roles side by side (user × role, count) so a formula can catch conflicting pairs.
    pivot: { label: 'Pivot: rows × columns (count, sum, average)', needs: 1,
      params: [['rows', 'col', 'Rows: one per value of'], ['cols', 'col', 'Columns: one per value of'], ['agg', ['count rows', 'count distinct', 'sum', 'average'], 'In each cell'],
        ['value', 'col?', 'Of this column (for count distinct / sum / average)'], ['show', ['the values', '% of the row total', '% of the first column'], 'Show']],
      run(p, [t]){
        const ri = col(t, p.rows), ci = col(t, p.cols), agg = p.agg || 'count rows', vi = p.value ? col(t, p.value) : -1;
        if(agg !== 'count rows' && vi < 0) throw new Error(`Pick the column to ${agg === 'count distinct' ? 'count distinct values of' : agg === 'sum' ? 'add up' : 'average'}.`);
        const nat = (x, y) => String(x).localeCompare(String(y), 'en', { numeric: true });
        const colVals = [...new Set(t.rows.map(r => r[ci] || '(blank)'))].sort(nat);
        if(colVals.length > 30) throw new Error(`“${p.cols}” has ${colVals.length} different values; a pivot shows up to 30 columns. Bucket it first, e.g. a formula step with month([${p.cols}]) or band().`);
        const cells = new Map(), rowKeys = [];
        t.rows.forEach(r => { const rk = r[ri] || '(blank)', ck = r[ci] || '(blank)', key = rk + '\u0000' + ck;
          if(!cells.has(rk + '\u0000')){ cells.set(rk + '\u0000', 1); rowKeys.push(rk); }
          const g = cells.get(key) || { n: 0, s: 0, c: 0, d: new Set() }; g.n++; if(vi >= 0){ const raw = r[vi], v = num(raw); if(v != null){ g.s += v; g.c++; } if(String(raw || '').trim()) g.d.add(String(raw).trim().toLowerCase()); } cells.set(key, g); });
        rowKeys.sort(nat);
        const val = g => !g ? 0 : agg === 'count rows' ? g.n : agg === 'count distinct' ? g.d.size : agg === 'sum' ? g.s : g.c ? g.s / g.c : null;
        const grid = rowKeys.map(rk => colVals.map(ck => val(cells.get(rk + '\u0000' + ck))));
        // a row's total: for distinct counts, distinct across the whole row (a user in two columns counts once)
        const rowTotal = (rk, i) => agg === 'count distinct' ? new Set(colVals.flatMap(ck => { const g = cells.get(rk + '\u0000' + ck); return g ? [...g.d] : []; })).size : agg === 'average' ? null : grid[i].reduce((x, y) => x + (y || 0), 0);
        const totals = rowKeys.map(rowTotal);
        const show = (v, i) => { if(v == null) return '—';
          if(p.show === '% of the row total') return totals[i] ? pct(v / totals[i] * 100) : '—';
          if(p.show === '% of the first column') return grid[i][0] ? pct(v / grid[i][0] * 100) : '—';
          return fmt(v); };
        const what = agg === 'count rows' ? 'rows' : agg === 'count distinct' ? `distinct ${p.value}` : `${agg} of ${p.value}`;
        return { formula: `One row per ${p.rows}, one column per ${p.cols}; each cell = ${what}${p.show && p.show !== 'the values' ? `, shown as ${p.show}` : ''}.`,
          summary: [`${rowKeys.length} × ${colVals.length} table of ${what} (${p.rows} × ${p.cols}).`,
            ...(agg === 'count distinct' ? ['Total = distinct across the row (one value in two columns counts once).'] : [])],
          cols: [p.rows, ...colVals, ...(agg === 'average' ? [] : ['Total'])],
          rows: rowKeys.map((rk, i) => [rk, ...grid[i].map(v => show(v, i)), ...(agg === 'average' ? [] : [fmt(totals[i])])]) };
      } },
    npv: { label: 'NPV, IRR and payback', needs: 0,
      params: [['rate', 'num', 'Discount rate %', 10], ['flows', 'col?', 'Cash-flow column (or type them below)'], ['flowsText', 'text', 'Cash flows, in order (e.g. -500, 120, 150)'], ['first', ['year 0 (today)', 'year 1'], 'First cash flow falls in'], ['timing', ['end of year', 'mid-year'], 'Timing']],
      run(p, tables){
        const t = tables[0];
        const flows = p.flows && t ? t.rows.map(r => num(r[col(t, p.flows)])).filter(v => v != null) : String(p.flowsText || '').split(/[,;\s]+/).map(num).filter(v => v != null);
        if(flows.length < 2) throw new Error('Give at least two cash flows.');
        const r = (num(p.rate) || 0) / 100, t0 = p.first === 'year 1' ? 1 : 0, mid = p.timing === 'mid-year' ? 0.5 : 0;
        const time = i => Math.max(0, i + t0 - mid), npvAt = rate => flows.reduce((s, cf, i) => s + cf / Math.pow(1 + rate, time(i)), 0);
        let irr = null; const lo0 = npvAt(-0.99), hi0 = npvAt(10);
        if(flows.some(v => v < 0) && flows.some(v => v > 0) && Math.sign(lo0) !== Math.sign(hi0)){ let lo = -0.99, hi = 10; for(let k = 0; k < 200; k++){ const m = (lo + hi) / 2; if(Math.sign(npvAt(m)) === Math.sign(lo0)) lo = m; else hi = m; } irr = (lo + hi) / 2 * 100; }
        // payback: the year the running total turns non-negative, interpolated inside that year
        let cum = 0, payback = null; flows.forEach((cf, i) => { const before = cum; cum += cf; if(payback == null && i > 0 && before < 0 && cum >= 0) payback = time(i - 1) + (cf ? -before / cf : 0) * (time(i) - time(i - 1)); });
        const NPV = npvAt(r);
        return { formula: `NPV = Σ CFₜ ÷ (1 + ${fmt(r * 100)}%)ᵗ, t = ${t0 ? '1' : '0'}, ${t0 ? '2' : '1'}, …${mid ? ' less half a year (mid-year)' : ''}; IRR = the rate where NPV = 0.`,
          summary: [`NPV at ${fmt(r * 100)}%: ${fmt(NPV)}.`, irr == null ? 'IRR: none (the cash flows never change sign, or no rate makes NPV zero).' : `IRR: ${irr.toFixed(2)}%.`, payback == null ? 'Payback: not reached.' : `Payback: about ${fmt(payback, 1)} years (undiscounted).`],
          cols: ['t', 'Cash flow', 'Discount factor', 'Present value'], rows: flows.map((cf, i) => [fmt(time(i), 1), fmt(cf), (1 / Math.pow(1 + r, time(i))).toFixed(4), fmt(cf / Math.pow(1 + r, time(i)))]).concat([['Total', fmt(flows.reduce((s, v) => s + v, 0)), '', fmt(NPV)]]) };
      } },
    range: { label: 'Totals with a low / expected / high range', needs: 1,
      params: [['label', 'col', 'Line item'], ['low', 'col?', 'Low'], ['mid', 'col', 'Expected'], ['high', 'col?', 'High'], ['spread', 'num', 'or ± % around Expected', 15]],
      run(p, [t]){
        const li = col(t, p.label), mi = col(t, p.mid), lo = p.low ? col(t, p.low) : -1, hi = p.high ? col(t, p.high) : -1, sp = (num(p.spread) || 0) / 100;
        const rows = t.rows.map(r => { const m = num(r[mi]); return { l: r[li], m, lo: lo >= 0 ? num(r[lo]) : m == null ? null : m * (1 - sp), hi: hi >= 0 ? num(r[hi]) : m == null ? null : m * (1 + sp) }; });
        const T = k => rows.reduce((s, r) => s + (r[k] || 0), 0);
        return { formula: lo >= 0 && hi >= 0 ? `Totals of ${p.low}, ${p.mid} and ${p.high} across the lines.` : `Low / high = ${p.mid} ∓ ${fmt(sp * 100)}% where no column is given; totals across the lines.`,
          summary: [`Total: low ${fmt(T('lo'))} · expected ${fmt(T('m'))} · high ${fmt(T('hi'))}.`, `${rows.length} lines; the 3 largest: ${rows.slice().sort((a, b) => (b.m || 0) - (a.m || 0)).slice(0, 3).map(r => `${r.l} ${fmt(r.m)}`).join(', ')}.`],
          cols: [p.label, 'Low', 'Expected', 'High'], rows: rows.map(r => [r.l, fmt(r.lo), fmt(r.m), fmt(r.hi)]).concat([['Total', fmt(T('lo')), fmt(T('m')), fmt(T('hi'))]]) };
      } },
    reconcile: { label: 'Reconcile two tables', needs: 2,
      params: [['tableB', 'table', 'Reconcile against'], ['keyA', 'colA', 'Match key in this table'], ['amtA', 'colA', 'Amount in this table'], ['keyB', 'colB', 'Match key in that table'], ['amtB', 'colB', 'Amount in that table'], ['tol', 'num', 'Tolerance (same amount if within)', 0.01]],
      run(p, list){
        const a = list[0], b = refT(list, p.tableB);
        if(!b) throw new Error('Attach a second table to reconcile against.');
        const sum = (t, k, v) => { const m = new Map(); t.rows.forEach(r => { const key = String(r[col(t, k)] || '').trim().toLowerCase(); if(!key) return; const g = m.get(key) || { name: String(r[col(t, k)]).trim(), s: 0, n: 0 }; g.s += num(r[col(t, v)]) || 0; g.n++; m.set(key, g); }); return m; };
        const A = sum(a, p.keyA, p.amtA), B = sum(b, p.keyB, p.amtB), tol = Math.abs(num(p.tol) || 0), rows = [];
        new Set([...A.keys(), ...B.keys()]).forEach(k => { const x = A.get(k), y = B.get(k), d = x && y ? x.s - y.s : null;
          rows.push({ k: (x || y).name, a: x ? x.s : null, b: y ? y.s : null, d, st: !x ? `Only in table ${refN(list, p.tableB)}` : !y ? 'Only in table 1' : Math.abs(d) <= tol ? 'Matched' : 'Amounts differ' }); });
        const order = { 'Amounts differ': 0, 'Only in table 1': 1, [`Only in table ${refN(list, p.tableB)}`]: 2, 'Matched': 3 }; rows.sort((x, y) => order[x.st] - order[y.st] || Math.abs(y.d || 0) - Math.abs(x.d || 0));
        const c = s => rows.filter(r => r.st === s).length, ta = [...A.values()].reduce((s, g) => s + g.s, 0), tb = [...B.values()].reduce((s, g) => s + g.s, 0);
        return { formula: `Rows matched on ${p.keyA} = ${p.keyB} (case and spaces ignored, duplicates added up); matched when |${p.amtA} − ${p.amtB}| ≤ ${fmt(tol)}.`,
          summary: [`${c('Matched')} matched · ${c('Amounts differ')} with different amounts · ${c('Only in table 1')} only in table 1 · ${c(`Only in table ${refN(list, p.tableB)}`)} only in table ${refN(list, p.tableB)}.`, `Totals: table 1 ${fmt(ta)} · table ${refN(list, p.tableB)} ${fmt(tb)} · difference ${signed(ta - tb)}.`],
          cols: ['Key', 'Table 1', `Table ${refN(list, p.tableB)}`, 'Difference', 'Status'], rows: rows.map(r => [r.k, fmt(r.a), fmt(r.b), signed(r.d), r.st]) };
      } },
    // Round 72: bring a value from table 2 into each row — a supplier's quality rejects next to its deliveries,
    // each user's department from the HR list. Several matching rows: the first, their sum, or how many.
    lookup: { label: 'Look up values from another table (join on a key)', needs: 2,
      params: [['tableB', 'table', 'Look up in'], ['keyA', 'col', 'Match key in this table'], ['keyB', 'colB', 'Match key in that table'], ['bring1', 'colB', 'Bring this column'], ['bring2', 'colB?', 'and this one (optional)'], ['bring3', 'colB?', 'and this one (optional)'], ['many', ['first match', 'sum', 'count'], 'When several of its rows match']],
      run(p, list){
        const a = list[0], b = refT(list, p.tableB), tn = refLabel(list, p.tableB);
        if(!b) throw new Error('Attach a second table to look values up in.');
        const ai = col(a, p.keyA), bi = col(b, p.keyB), bring = [p.bring1, p.bring2, p.bring3].filter(Boolean).map(x => ({ name: x, i: col(b, x) }));
        if(!bring.length && p.many !== 'count') throw new Error('Pick at least one column to bring from that table.');
        const m = new Map(); b.rows.forEach(r => { const key = String(r[bi] || '').trim().toLowerCase(); if(key) (m.get(key) || m.set(key, []).get(key)).push(r); });
        const dup = [...m.values()].filter(x => x.length > 1).length;
        const taken = new Set(a.header), uniq = n => { let s = n, j = 2; while(taken.has(s)) s = `${n} ${j++}`; taken.add(s); return s; };
        const newCols = p.many === 'count' ? [uniq(`Matches in ${tn}`)] : bring.map(x => uniq(`${x.name} (${tn})`));
        let found = 0;
        const rows = a.rows.map(r => { const hits = m.get(String(r[ai] || '').trim().toLowerCase()) || []; if(hits.length) found++;
          const add = p.many === 'count' ? [String(hits.length)] : bring.map(x => !hits.length ? '' : p.many === 'sum' ? fmt(hits.reduce((s, h) => s + (num(h[x.i]) || 0), 0)) : String(hits[0][x.i] == null ? '' : hits[0][x.i]));
          return r.concat(add); });
        return { formula: `Each row's ${p.keyA} matched to ${tn}'s ${p.keyB} (case and spaces ignored); ${p.many === 'count' ? 'counted the matching rows' : `brought ${bring.map(x => x.name).join(', ')}${p.many === 'sum' ? ', added up over all matching rows' : ' from the first matching row'}`}.`,
          summary: [`${found.toLocaleString('en-US')} of ${a.rows.length.toLocaleString('en-US')} rows found a match in ${tn}; ${(a.rows.length - found).toLocaleString('en-US')} did not (left blank).`,
            ...(dup ? [`${dup} key${dup === 1 ? ' appears' : 's appear'} more than once in ${tn} — ${p.many === 'first match' ? 'the first row was used' : p.many === 'sum' ? 'their values were added up' : 'counted'}.`] : [])],
          cols: a.header.concat(newCols), rows };
      } },
    // Round 71: rule checks — "accounts dormant over 90 days", "leavers who still have an active account".
    filter: { label: 'Filter rows by conditions (incl. dates, in / not in another table)', needs: 1,
      params: [['conds', 'conds', 'Conditions'], ['match', ['all conditions', 'any condition'], 'Keep rows that meet'], ['asof', 'date', 'Count days up to (as-of date; blank = today)'],
        ['datefmt', ['auto', 'day first (31/12/2026)', 'month first (12/31/2026)'], 'Dates written as'], ['countBy', 'col?', 'Count the matches by (optional)']],
      run(p, list){
        const LEGACY = { 'in table 2': 'in another table', 'not in table 2': 'not in another table' }; // conditions saved before round 74
        const a = list[0], conds = (p.conds || []).filter(x => x && x.col && x.op).map(x => LEGACY[x.op] ? Object.assign({}, x, { op: LEGACY[x.op] }) : x);
        if(!conds.length) throw new Error('Add at least one condition.');
        const asof = p.asof ? parseDate(p.asof, p.datefmt) : today(), DAY = 86400000;
        if(!asof) throw new Error(`“${p.asof}” isn't a date the calculation can read. Use 2026-10-23.`);
        const needB = conds.some(x => isRefOp(x.op));
        if(needB && list.length < 2) throw new Error('A condition looks in another table: attach it (e.g. the leavers list).');
        const keyOf = x => `${refN(list, x.tbl)}:${x.value}`, keys = {};
        conds.forEach(x => { if(isRefOp(x.op)){ const b = refT(list, x.tbl), bi = col(b, x.value); keys[keyOf(x)] = new Set(b.rows.map(r => String(r[bi] || '').trim().toLowerCase()).filter(Boolean)); } });
        const dateCols = [...new Set(conds.filter(x => /days|date/.test(x.op)).map(x => x.col))];
        const bad = {};
        const test = (r, x) => {
          const raw = r[col(a, x.col)], s = String(raw || '').trim(), v = x.value;
          switch(x.op){
            case 'equals': return s.toLowerCase() === String(v).trim().toLowerCase();
            case 'does not equal': return s.toLowerCase() !== String(v).trim().toLowerCase();
            case 'contains': return s.toLowerCase().includes(String(v).trim().toLowerCase());
            case 'does not contain': return !s.toLowerCase().includes(String(v).trim().toLowerCase());
            case 'is blank': return !s;
            case 'is not blank': return !!s;
            case '>': case '≥': case '<': case '≤': { const n = num(s), m = num(v); if(n == null || m == null) return false; return x.op === '>' ? n > m : x.op === '≥' ? n >= m : x.op === '<' ? n < m : n <= m; }
            case 'more than N days ago': case 'within the last N days': {
              const d = parseDate(s, p.datefmt); if(!d){ if(s) bad[x.col] = (bad[x.col] || 0) + 1; return false; } // a blank date never counts as old
              const days = Math.floor((asof - d) / DAY), n = num(v) || 0; return x.op === 'more than N days ago' ? days > n : days >= 0 && days <= n; }
            case 'before date': case 'on or after date': { const d = parseDate(s, p.datefmt), e = parseDate(v, p.datefmt); if(!d){ if(s) bad[x.col] = (bad[x.col] || 0) + 1; return false; } if(!e) throw new Error(`“${v}” isn't a date. Use 2026-10-23.`); return x.op === 'before date' ? d < e : d >= e; }
            case 'in another table': return keys[keyOf(x)].has(s.toLowerCase());
            case 'not in another table': return !keys[keyOf(x)].has(s.toLowerCase());
          }
          return false;
        };
        const any = p.match === 'any condition';
        const hit = a.rows.filter(r => any ? conds.some(x => test(r, x)) : conds.every(x => test(r, x)));
        const daysOf = (r, c) => { const d = parseDate(r[col(a, c)], p.datefmt); return d ? Math.floor((asof - d) / DAY) : null; };
        const say = x => isRefOp(x.op) ? `${x.col} ${x.op === 'in another table' ? 'is' : 'is not'} in ${refLabel(list, x.tbl)}'s ${x.value}` : /N days/.test(x.op) ? `${x.col} ${x.op.replace('N', fmt(num(x.value) || 0, 0))}` : /^is /.test(x.op) ? `${x.col} ${x.op}` : `${x.col} ${x.op} “${x.value}”`;
        const ci = p.countBy ? col(a, p.countBy) : -1, by = new Map(); if(ci >= 0) hit.forEach(r => by.set(r[ci] || '(blank)', (by.get(r[ci] || '(blank)') || 0) + 1));
        const iso = d => d.toISOString().slice(0, 10);
        return { formula: `Keep rows where ${conds.map(say).join(any ? ' OR ' : ' AND ')}${dateCols.length ? `; days counted up to ${iso(asof)}` : ''}${needB ? '; keys compared ignoring case and spaces' : ''}.`,
          summary: [`${hit.length.toLocaleString('en-US')} of ${a.rows.length.toLocaleString('en-US')} rows meet ${any ? 'any condition' : 'every condition'}.`,
            ...[...by.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, n]) => `${k}: ${n}`),
            ...Object.entries(bad).map(([c, n]) => `${n} row${n === 1 ? '' : 's'} with an unreadable date in ${c} — left out; check the date format.`)],
          cols: a.header.concat(dateCols.map(c => `Days since ${c}`)), rows: hit.map(r => r.concat(dateCols.map(c => { const d = daysOf(r, c); return d == null ? '—' : fmt(d, 0); }))) };
      } }
  };
  // ---------- dates ----------
  const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  function today(){ const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); }
  // "2026-09-01", "2026-09-01 10:22", "01/09/2026" (day-first or month-first), "1 Sep 2026", "Sep 1, 2026", an Excel serial (46000) → a UTC day, or null
  function parseDate(v, fmtHint){
    const s = String(v == null ? '' : v).trim(); if(!s) return null;
    const U = (y, m, d) => { const t = new Date(Date.UTC(y, m, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m && t.getUTCDate() === d ? t : null; };
    let m;
    if((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return U(+m[1], +m[2] - 1, +m[3]);
    if((m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/.exec(s))){
      const y = +m[3] < 100 ? 2000 + +m[3] : +m[3], a = +m[1], b = +m[2];
      const monthFirst = /month/.test(fmtHint || '') || (!/day/.test(fmtHint || '') && b > 12 && a <= 12);
      return monthFirst ? U(y, a - 1, b) : U(y, b - 1, a);
    }
    if((m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/.exec(s)) && MON[m[2].toLowerCase()] != null) return U(+m[3], MON[m[2].toLowerCase()], +m[1]);
    if((m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s)) && MON[m[1].toLowerCase()] != null) return U(+m[3], MON[m[1].toLowerCase()], +m[2]);
    if(/^\d{5}(\.\d+)?$/.test(s)){ const n = parseFloat(s); if(n > 20000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000); }
    return null;
  }
  const COND_OPS = ['equals', 'does not equal', 'contains', 'does not contain', 'is blank', 'is not blank', '>', '≥', '<', '≤', 'more than N days ago', 'within the last N days', 'before date', 'on or after date', 'in another table', 'not in another table'];

  // ---------- state ----------
  // Tables live here, not in the node's work (w): undo keeps 40 snapshots of w, and a big CSV in each would be heavy.
  // Each Calculation has its own id, so "Start this node over" (a fresh w) never shows the old tables again.
  const DATA = {};
  let seq = 0;
  const calc = w => w.calc || (w.calc = { tid: `t${Date.now()}-${++seq}`, open: true, files: [], op: '', params: {}, out: null, err: '', busy: '' });
  function tables(k){
    const w = exRsW(k), c = calc(w), d = DATA[k];
    if(!d || d.tid !== c.tid) DATA[k] = { tid: c.tid, list: [] };
    return DATA[k].list;
  }
  // Kinds whose work is mostly numbers: the panel shows open for these; every other node gets a one-line "Add a calculation".
  const NUMERIC = new Set(['K-A4', 'K-A5', 'K-A6', 'K-A7', 'K-A12', 'K-B4', 'K-C5', 'K-C6', 'K-C7', 'K-C12', 'K-E11']); // + Synthesize and Organize: themes and categories counted over rows
  const needs = w => !!(w && w.kind && NUMERIC.has(w.kind.id));

  function addTable(k, name, text){
    const w = exRsW(k), c = calc(w); c.err = '';
    if(/\.xlsx?$/i.test(name)){ c.err = `“${name}” is an Excel file, which can't be read here. In Excel choose File → Save As → CSV, then attach the CSV.`; return false; }
    try {
      const t = parseTable(text); t.name = name;
      const list = tables(k); if(list.length >= MAX_TABLES){ c.err = `${MAX_TABLES} tables at most: remove one first.`; return false; } list.push(t);
      c.files = list.map(x => ({ name: x.name, rows: x.rows.length, cols: x.header.length }));
      return true;
    } catch(e){ c.err = `Couldn't read “${name}”: ${e.message}`; return false; }
  }
  function validCol(t, v){ return t && t.header.includes(v) ? v : ''; }
  function cleanParams(op, p, list){
    const out = {}, D = OPS[op]; if(!D) return out;
    const tB = refT(list, p && p.tableB);
    D.params.forEach(([key, type, , def]) => {
      const v = p && p[key];
      if(type === 'col' || type === 'col?' || type === 'colA') out[key] = validCol(list[0], v);
      else if(type === 'colB' || type === 'colB?') out[key] = validCol(tB, v);
      else if(type === 'table') out[key] = refKey(list, v);
      else if(type === 'num') out[key] = num(v) == null ? (def == null ? '' : def) : num(v);
      else if(type === 'criteria') out[key] = (Array.isArray(v) ? v : []).map(c => ({ col: validCol(list[0], c && c.col), weight: num(c && c.weight) == null ? 1 : num(c.weight), dir: c && c.dir === 'lower' ? 'lower' : 'higher' })).filter(c => c.col).slice(0, 8);
      // conditions: a table-1 column, a known test, a value (for "in another table": a column of that table, "tbl" = its number)
      else if(type === 'conds') out[key] = (Array.isArray(v) ? v : []).map(c => { const legacy = { 'in table 2': 'in another table', 'not in table 2': 'not in another table' }, raw = c && (legacy[c.op] || c.op), op = COND_OPS.includes(raw) ? raw : 'equals', t2 = isRefOp(op), tbl = refKey(list, c && c.tbl), bt = list[refN(list, tbl) - 1];
        return { col: validCol(list[0], c && c.col), op, ...(t2 ? { tbl } : {}), value: t2 ? validCol(bt, c && c.value) || (bt ? bt.header[0] : '') : String(c && c.value != null ? c.value : '') }; }).filter(c => c.col).slice(0, 8);
      else if(Array.isArray(type)) out[key] = type.includes(v) ? v : type[0];
      else out[key] = v == null ? '' : String(v);
    });
    return out;
  }
  // ---------- several calculations in one node (round 72) ----------
  // c.chain holds the finished earlier steps [{op, params, out}]; the current step (c.op / c.params / c.out) works on the
  // last step's result table, and tables 2-5 stay the attached tables (for lookups, filters, reconciling).
  const TOTAL_OPS = ['variance', 'npv', 'range'];
  function asTable(o, name){ return { name, header: o.cols.slice(), rows: (o.totalLast ? o.rows.slice(0, -1) : o.rows).map(r => r.map(x => String(x == null ? '' : x))) }; }
  function chainOf(c){ return c.chain || (c.chain = []); }
  // what a step works on (round 76): 'prev' = the previous step's result (default), 'base' = attached table 1,
  // or 'N' = step N's result — so independent checks on the same data can sit side by side in one node
  const SRC = { previous: 'prev', 'table 1': 'base' };
  const normSrc = v => { const x = String(v == null ? 'prev' : v).trim().toLowerCase(); if(SRC[x]) return SRC[x]; if(x === 'prev' || x === 'base') return x; const m = /(\d+)/.exec(x); return m ? m[1] : 'prev'; };
  function stepTable(done, i){ const s = done[i]; return s && s.out ? Object.assign(asTable(s.out, `the result of step ${i + 1}`), { isStep: i + 1 }) : null; }
  function inputs(k, src){
    const w = exRsW(k), c = calc(w), base = tables(k), done = chainOf(c), from = normSrc(src == null ? c.src : src);
    const first = !done.length || from === 'base' ? base[0] : from === 'prev' ? stepTable(done, done.length - 1) || base[0] : stepTable(done, Math.min(done.length, +from) - 1) || base[0];
    return [first, ...base.slice(1), ...done.map((_, i) => stepTable(done, i))].filter(Boolean);
  }
  // one calculation on given inputs → its result, or throws
  function runStep(c, op, params, list){
    const D = OPS[op]; if(!D) throw new Error('Choose a calculation.');
    if(D.needs > list.length) throw new Error(D.needs === 2 ? (op === 'lookup' ? 'Attach a second table to look values up in.' : 'Attach a second table to reconcile against.') : 'Attach a CSV or paste a table first.');
    const r = D.run(params, list);
    if(TOTAL_OPS.includes(op) && r.rows.length && r.rows[r.rows.length - 1][0] === 'Total') r.totalLast = true; // not carried into the next step
    const ai = c.tagged && Object.values(params).some(v => v === c.tagged.name || (Array.isArray(v) && v.some(x => x && (x.col === c.tagged.name)))) ? Object.assign({}, c.tagged) : null;
    return Object.assign(r, { op, at: Date.now(), from: list.map(t => t.name), ai });
  }
  function run(k){
    const w = exRsW(k), c = calc(w); c.err = ''; c.out = null;
    if(!OPS[c.op]) return;
    try { c.out = runStep(c, c.op, c.params, inputs(k)); }
    catch(e){ c.err = chainOf(c).length ? `Step ${chainOf(c).length + 1}: ${e.message}` : e.message; }
  }
  // the data changed (a correction, a new table, AI tags): every step again, in order
  function rerunChain(k){
    const w = exRsW(k), c = calc(w), ch = chainOf(c), done = [];
    c.err = '';
    for(let i = 0; i < ch.length; i++){
      c.chain = done;
      const list = inputs(k, ch[i].src), s = ch[i];
      s.params = cleanParams(s.op, s.params, list);
      try { s.out = runStep(c, s.op, s.params, list); done.push(s); }
      catch(e){ c.chain = done; c.op = s.op; c.params = s.params; c.src = s.src; c.out = null; c.err = `Step ${i + 1}: ${e.message}`; return; }
    }
    c.chain = done;
    if(OPS[c.op]){ c.params = cleanParams(c.op, c.params, inputs(k)); run(k); }
  }
  // the columns a step asked for that its input doesn't have (cleanParams would quietly blank them)
  function lostCols(op, raw, clean){
    const out = [], D = OPS[op]; if(!D || !raw) return out;
    D.params.forEach(([key, type]) => {
      const v = raw[key], cv = clean[key];
      if(/^col/.test(type) && v && !cv) out.push(v);
      if(type === 'criteria' || type === 'conds') (Array.isArray(v) ? v : []).forEach(x => { if(x && x.col && !(cv || []).some(y => y.col === x.col)) out.push(x.col); });
    });
    return [...new Set(out)];
  }
  // a set of steps from "Set it up from the request": run each on the last one's result; the last stays editable
  function buildChain(k, steps){
    const w = exRsW(k), c = calc(w); c.chain = []; c.out = null; c.err = '';
    const ok = steps.filter(s => s && OPS[s.op]).slice(0, 8);
    for(let i = 0; i < ok.length; i++){
      const src = normSrc(ok[i].on), list = inputs(k, src), params = cleanParams(ok[i].op, ok[i].params, list), lost = lostCols(ok[i].op, ok[i].params, params);
      if(lost.length){ c.op = ok[i].op; c.params = params; c.src = src; c.err = `Step ${i + 1}: ${lost.map(x => `“${x}”`).join(', ')} ${lost.length === 1 ? "isn't" : "aren't"} in ${list[0].name || 'the table'} (columns: ${list[0].header.join(', ')}). Pick the column below.`; return; }
      if(i === ok.length - 1){ c.op = ok[i].op; c.params = params; c.src = src; run(k); return; }
      try { c.chain.push({ op: ok[i].op, params, src, out: runStep(c, ok[i].op, params, list) }); }
      catch(e){ c.op = ok[i].op; c.params = params; c.src = src; c.err = `Step ${i + 1}: ${e.message} Fix it below; the steps after it are not run yet.`; return; }
    }
  }

  // ---------- per-row AI step: tag or score each row, written back as a new column ----------
  // Why: the re-run of the expert test (README round 70) found the calculations had nothing to count when the thing
  // to count had to be READ first — the reason for each of 1,400 tickets, a rubric score for 600 QA reviews, the risk on
  // each deal. Here the AI reads each row and writes ONE label or score into a new column; the calculations above then
  // count, average or rank that column like any other. It is AI judgement, not source data, and is labelled so.
  const TAG_BATCH = 25, TAG_PAR = 3, TAG_MAX = 5000, CELL_CHARS = 400, TAG_SAMPLE = 20, CHECK_ROWS = 8;
  const tagCfg = c => c.tag || (c.tag = { open: false, cols: [], mode: 'tag', labels: '', rubric: '', min: 1, max: 5, name: '', run: null });
  const labelsOf = g => [...new Set(String(g.labels || '').split(/\n|;/).map(s => s.trim()).filter(Boolean))].slice(0, 30);
  const tagName = g => String(g.name || '').trim() || (g.mode === 'score' ? 'Score (AI)' : 'Tag (AI)');
  const calls = n => Math.ceil(n / TAG_BATCH);
  function tagProblem(g, t){
    if(!t) return 'Attach a CSV or paste a table first.';
    if(!g.cols.filter(x => t.header.includes(x)).length) return 'Tick at least one column for the AI to read.';
    if(g.mode === 'tag' && labelsOf(g).length < 2) return 'Give at least two labels, one per line (or let the AI suggest them from a sample).';
    if(g.mode === 'score' && !String(g.rubric || '').trim()) return 'Write the rubric: what a low and a high score mean.';
    if(g.mode === 'score' && !(num(g.min) < num(g.max))) return 'The lowest score must be below the highest.';
    return '';
  }
  // the rows the AI reads, each cut to CELL_CHARS per column
  const rowFor = (t, cols, i) => Object.assign({ i }, ...cols.map(cn => ({ [cn]: String(t.rows[i][t.header.indexOf(cn)] || '').slice(0, CELL_CHARS) })));
  function tagPrompt(k, g, t, cols, batch){
    const s = exStep(k), labels = labelsOf(g), other = labels.some(l => /^other$/i.test(l));
    return `You read rows from a table ONE BY ONE and ${g.mode === 'tag'
      ? `give each row exactly ONE label from this list: ${JSON.stringify(labels)}${other ? '' : ' — or "Other" when none fits'}.`
      : `give each row ONE whole-number score from ${num(g.min)} to ${num(g.max)} using this rubric: ${String(g.rubric).trim()}`}
The work: "${s.title}" — ${s.nodeInfo.purpose}. Original request: "${window.__topic || ''}".
Judge each row only from its own text. When a row says too little to judge, ${g.mode === 'tag' ? 'use "Other"' : 'use null'} rather than guessing.
Rows ("i" is the row number; keep it): ${JSON.stringify(batch.map(i => rowFor(t, cols, i)))}
Write each "why" in the same language as the rows, under 12 words.
Respond ONLY with {"rows": [{"i": 0, "v": ${g.mode === 'tag' ? '"one of the labels"' : 'a number'}, "why": "..."}]} — one entry per row, every "i" above.`;
  }
  function tagValue(g, v){
    if(g.mode === 'tag'){
      const labels = labelsOf(g), hit = labels.find(l => l.toLowerCase() === String(v == null ? '' : v).trim().toLowerCase());
      return hit || (v == null || v === '' ? '' : 'Other');
    }
    const n = num(v), lo = num(g.min), hi = num(g.max);
    return n == null || n < lo || n > hi ? '' : String(Math.round(n));
  }
  async function tagRun(k, how){
    const w = exRsW(k), c = calc(w), g = tagCfg(c), t = tables(k)[0];
    c.err = tagProblem(g, t); if(c.err) return exRsRefresh(k, false);
    const cols = g.cols.filter(x => t.header.includes(x)), name = tagName(g);
    let ci = t.header.indexOf(name);
    if(ci < 0){ t.header.push(name); t.rows.forEach(r => r.push('')); ci = t.header.length - 1; }
    let idx = t.rows.map((_, i) => i);
    if(how === 'sample') idx = idx.slice(0, TAG_SAMPLE);
    if(how === 'blanks') idx = idx.filter(i => !t.rows[i][ci]);
    if(idx.length > TAG_MAX){ c.err = `That is ${idx.length.toLocaleString('en-US')} rows; one run tags up to ${TAG_MAX.toLocaleString('en-US')}. Try a sample first, or split the file.`; return exRsRefresh(k, false); }
    const R = g.run = { how, done: 0, total: idx.length, failed: 0, stop: false, at: Date.now(), name, ci, why: (g.run && g.run.name === name && g.run.why) || {}, fixed: (g.run && g.run.name === name && g.run.fixed) || {} };
    exRsRefresh(k, false); settle(k);
    const queue = []; for(let j = 0; j < idx.length; j += TAG_BATCH) queue.push(idx.slice(j, j + TAG_BATCH));
    const worker = async () => {
      while(queue.length && !R.stop){
        const batch = queue.shift();
        try {
          const res = await callClaude(tagPrompt(k, g, t, cols, batch), { maxTokens: 120 + 45 * batch.length });
          const got = new Map((Array.isArray(res && res.rows) ? res.rows : []).map(r => [parseInt(r && r.i, 10), r]));
          batch.forEach(i => { const r = got.get(i), v = r ? tagValue(g, r.v) : ''; if(R.fixed[i] == null) t.rows[i][ci] = v; R.why[i] = r && r.why ? String(r.why).slice(0, 120) : ''; if(!v) R.failed++; });
        } catch(e){ R.failed += batch.length; R.lastErr = (e && e.message) || 'the AI request failed'; }
        R.done += batch.length;
        if(exRsW(k) === w) exRsRefresh(k, false);
      }
    };
    await Promise.all(Array.from({ length: Math.min(TAG_PAR, queue.length) }, worker));
    R.end = Date.now();
    c.files = tables(k).map(x => ({ name: x.name, rows: x.rows.length, cols: x.header.length }));
    c.tagged = { name, mode: g.mode, labels: labelsOf(g), rubric: g.rubric, min: g.min, max: g.max, filled: t.rows.filter(r => r[ci]).length, rows: t.rows.length };
    // a calculation set up to use the new column runs now; one already shown is refreshed with it
    if(how !== 'sample'){ if(c.pendingSteps){ const st = c.pendingSteps; c.pendingSteps = null; buildChain(k, st); } else if(c.out || chainOf(c).length) rerunChain(k); }
    // after run(), which clears errors: blank rows are said, and counted as "(blank)" in a calculation
    if(R.failed) c.err = `${R.failed.toLocaleString('en-US')} row${R.failed === 1 ? '' : 's'} came back blank${R.lastErr ? ` (${R.lastErr})` : ''}. “Fill the blank rows” tries only those again.${R.stop ? ' Stopped early.' : ''}`;
    else if(R.stop) c.err = `Stopped after ${R.done.toLocaleString('en-US')} of ${R.total.toLocaleString('en-US')} rows. “Fill the blank rows” carries on from there.`;
    g.open = how === 'sample' || !!R.failed || !!R.stop; // a finished full run folds the setup away, so the result shows
    exRsRefresh(k, false); settle(k, false);
  }
  // A sample spread across the file, for suggesting labels or a rubric.
  async function tagSuggest(k){
    const w = exRsW(k), c = calc(w), g = tagCfg(c), t = tables(k)[0];
    if(!t){ c.err = 'Attach a CSV or paste a table first.'; return exRsRefresh(k, false); }
    if(!g.cols.length) g.cols = t.header.filter((h, i) => t.rows.slice(0, 30).some(r => String(r[i]).length > 25)).slice(0, 2);
    if(!g.cols.length){ c.err = 'Tick the column(s) with the text the AI should read.'; return exRsRefresh(k, false); }
    g.busy = true; c.err = ''; exRsRefresh(k, false);
    try {
      const step = Math.max(1, Math.floor(t.rows.length / 60)), sample = t.rows.map((_, i) => i).filter(i => i % step === 0).slice(0, 60);
      const s = exStep(k);
      const res = await callClaude(`Rows from a table the user will have the AI ${g.mode === 'tag' ? 'TAG with one label each' : 'SCORE one by one'}.
The work: "${s.title}" — ${s.nodeInfo.purpose}. Original request: "${window.__topic || ''}".
Sample rows: ${JSON.stringify(sample.map(i => rowFor(t, g.cols, i)))}
${g.mode === 'tag' ? 'Propose 4-12 labels that together cover these rows, mutually exclusive, 1-4 words each, in the same language as the rows, plus "Other". Return {"labels": [...], "name": "<the new column, e.g. Contact reason (AI)>"}.'
  : 'Propose a short rubric for a 1-5 score fitting the request: one line per score saying what earns it. Return {"rubric": "1 = …\\n2 = …\\n3 = …\\n4 = …\\n5 = …", "min": 1, "max": 5, "name": "<the new column, e.g. QA score (AI)>"}.'}
${typeof ipLang === 'function' ? ipLang() : ''}
Respond ONLY with the JSON.`, { maxTokens: 600 });
      if(g.mode === 'tag' && Array.isArray(res && res.labels)) g.labels = res.labels.map(x => String(x).trim()).filter(Boolean).slice(0, 30).join('\n');
      if(g.mode === 'score' && res && res.rubric){ g.rubric = String(res.rubric).trim(); if(num(res.min) != null) g.min = num(res.min); if(num(res.max) != null) g.max = num(res.max); }
      if(res && res.name && !String(g.name || '').trim()) g.name = String(res.name).trim().slice(0, 40);
    } catch(e){ c.err = `Couldn't suggest ${g.mode === 'tag' ? 'labels' : 'a rubric'}: ${(e && e.message) || 'the AI request failed'}. Write them yourself.`; }
    finally { g.busy = false; exRsRefresh(k, false); settle(k); }
  }
  // Rows to check: taken in turn from every value (and blanks), spread through the file — so each label gets a look,
  // and an even stride can't land on one pattern in the data. In file order, for reading.
  function checkRows(t, R){
    const groups = new Map();
    t.rows.forEach((r, i) => { if(r[R.ci] === '' && R.why[i] == null) return; const v = r[R.ci] || '(blank)'; (groups.get(v) || groups.set(v, []).get(v)).push(i); });
    const lists = [...groups.values()].map(a => { const step = Math.max(1, Math.floor(a.length / CHECK_ROWS)); return a.filter((_, j) => j % step === 0); });
    const out = [];
    for(let j = 0; out.length < CHECK_ROWS && lists.some(a => a.length > j); j++) lists.forEach(a => { if(a[j] != null && out.length < CHECK_ROWS) out.push(a[j]); });
    return out.sort((a, b) => a - b);
  }

  // ---------- the AI maps the request onto one calculation ----------
  async function suggest(k){
    const w = exRsW(k), c = calc(w), s = exStep(k), list = tables(k), kind = window.ExKinds && ExKinds.label(w);
    c.busy = 'map'; c.err = ''; exRsRefresh(k, false);
    try {
      const opsText = Object.entries(OPS).map(([id, d]) => `- "${id}" (${d.label}${d.needs === 2 ? '; needs two tables' : d.needs === 0 ? '; works without a table' : ''}): params ${JSON.stringify(Object.fromEntries(d.params.map(([key, type, lab]) => [key, Array.isArray(type) ? type.join(' | ') : type === 'criteria' ? '[{"col", "weight", "dir": "higher" | "lower"}]' : type === 'conds' ? `[{"col": a table-1 column, "op": one of ${JSON.stringify(COND_OPS)}, "value": the value to compare (a number of days for the "N days" tests, a date YYYY-MM-DD for before / on or after, a column OF THAT TABLE for in / not in another table, "" for is blank), "tbl": the table number 2-5 (only for in / not in another table)}]` : type === 'date' ? 'YYYY-MM-DD or ""' : type === 'table' ? 'the number (2-5) of the attached table to use' : `${type} — ${lab}`])))}`).join('\n');
      const res = await callClaude(`You set up the exact calculation(s) for this work node. The numbers are computed by code, not by you.
Node: "${s.title}" — ${s.nodeInfo.purpose}${kind ? ` (runs as ${kind})` : ''}.
Original request: "${window.__topic || ''}"
${list.length ? list.map((t, i) => `Table ${i + 1} "${t.name}": columns ${JSON.stringify(t.header)}; first rows ${JSON.stringify(t.rows.slice(0, 5))}`).join('\n') : 'No table attached — only "npv" can run; take its cash flows and rate from the request.'}
Calculations you can choose from:
${opsText}
Use exact column names from the tables ("col" / "colA" = table 1, or the previous step's result; "colB" = the table named by "tableB", default 2; "col?" may be ""). For "formula", "expr" uses column names (names with spaces in [brackets]), numbers, "text", + - * / ^, & (joins text), comparisons = <> > < >= <=, and min(), max(), abs(), round(x, digits), if(test, then, else), and(), or(), not(), band(x, upTo1, value1, upTo2, value2, …, else), sum([Col]) / avg([Col]) / count([Col]) over the whole column, and dates: month(d) → "2026-09", week(d) → "2026-W37", quarter(d) → "2026-Q3", year(d), days(from, to), months(from, to), today() — e.g. a cohort: month([Signup date]) and months([Signup date], [Event date]); age of an invoice: days([Invoice date], today()); a share: [Sales] / sum([Sales]) * 100; raises fitted to a budget of 11475: [Raise] * 11475 / sum([Raise]); RICE: [Reach]*[Impact]*[Confidence]/[Effort]; a tier: band([Years], 1, 30, 3, 90, 6, 180, 10, 240, 20, 300, 400); a matrix key for a lookup: [Band] & "-" & [Rating]; a rule: if([Status] = "Active", 1, 0). Take thresholds, rates and weights from the request when it gives them.
A FIRST STEP when needed: if the thing to count, average or rank is not in any column yet and must be READ from each row's text (a contact reason per ticket, a rubric score per QA review, a risk level per deal, a theme per comment), ALSO return "tag": {"cols": [the text columns to read], "mode": "tag" (one label per row) | "score" (one number per row), "labels": [4-12 labels + "Other"] (tag only), "rubric": "what each score means" (score only), "min": 1, "max": 5, "name": "<new column name> (AI)"} — the AI fills that column row by row, and your calculation's params then use that new column name. Leave "tag" out when the columns already hold what is needed.
SEVERAL STEPS when needed: if the work takes more than one calculation in order (e.g. look up each supplier's quality rejects from table 2, then score; filter the active leavers, then count them by role), return "steps": [{"op", "params"}, …] (2-6, in order) instead of "op" / "params". Each step works on the PREVIOUS step's result unless it says "on": "table 1" (the attached data again — for independent checks on the same data in one node) or "on": <an earlier step number>. Tables 2-5 stay the attached tables, and an earlier step's result can be looked in by naming it as the table: "tableB": "step 1" (or a condition's "tbl": "step 1") — e.g. step 1 groups users to their first event date, step 2 goes back to table 1 and looks up each user's first date from "step 1". Name columns as each result names them:
- lookup → this table's columns + "<brought column> (table N)" each, N = the table looked in (or "Matches in table N" for count)
- filter → this table's columns + "Days since <column>" for each date tested
- group → [<group>, "Rows" (count) or "Sum of <value>" / "Average of <value>" / "Min of <value>" / "Max of <value>" / "First of <value>" / "Last of <value>", "Share" (count and sum only), "Rows" (not for count)] — min / max of a date column give the earliest / latest date
- formula → [<label>, <result name>, <every other column of its input>]
- running → ["#", <label>, "Within the line" (only with a cut line), <value>, "Running total", "Cumulative %", <every other column>]
- pivot → [<rows column>, <each distinct value of the columns column, sorted>, "Total" (not for average)] — e.g. a user × role pivot gives one column per role name, so a next formula can test and([AP clerk] > 0, [Approver] > 0)
- variance → [<label>, "Flag", "Variance", "%", <actual>, <budget>]
- score → ["Rank", <label>, "Score (0–100)", <criteria columns>]
- range → [<label>, "Low", "Expected", "High"]
- reconcile → ["Key", "Table 1", "Table N", "Difference", "Status"]
Respond ONLY with {"op": "...", "params": {...}} or {"steps": [{"op", "params", "on" (optional)}, ...]}, plus "tag": {...} only when needed, and "why": "one short sentence".`, { maxTokens: 1400 });
      const steps = Array.isArray(res && res.steps) && res.steps.some(x => x && OPS[x.op]) ? res.steps.filter(x => x && OPS[x.op]) : [{ op: res && OPS[res.op] ? res.op : (list.length ? 'group' : 'npv'), params: (res && res.params) || {} }];
      const op = steps[0].op;
      c.op = op; c.why = String((res && res.why) || '').trim(); c.chain = [];
      const tg = res && res.tag && typeof res.tag === 'object' && list[0] ? res.tag : null;
      if(tg){
        // tag first: the steps run once the new column is filled (tagRun picks up pendingSteps)
        const g = tagCfg(c);
        Object.assign(g, { open: true, mode: tg.mode === 'score' ? 'score' : 'tag', cols: (Array.isArray(tg.cols) ? tg.cols : []).filter(x => list[0].header.includes(x)).slice(0, 4),
          labels: (Array.isArray(tg.labels) ? tg.labels : []).map(x => String(x).trim()).filter(Boolean).slice(0, 30).join('\n'), rubric: String(tg.rubric || '').trim(),
          min: num(tg.min) == null ? 1 : num(tg.min), max: num(tg.max) == null ? 5 : num(tg.max), name: String(tg.name || '').trim().slice(0, 40) });
        c.pendingSteps = steps; c.params = cleanParams(op, steps[0].params, list); c.out = null;
      } else buildChain(k, steps);
    } catch(e){ c.err = `Couldn't set up the calculation: ${(e && e.message) || 'the AI request failed'}. Pick one below and set its columns.`; }
    finally { c.busy = ''; const want = !c.out && !c.pendingSteps; c.editOpen = want; exRsRefresh(k, false); settle(k, want); }
  }
  // The page keeps a <details>' open state across redraws, so the panel sets its own folds after one.
  function settle(k, editWant){
    setTimeout(() => {
      const r = document.querySelector('#exec-view [data-xq-root]'), w = exRsW(k); if(!r || !w || !w.calc) return;
      r.querySelectorAll('.xq-paste').forEach(d => { d.open = false; });
      const e = r.querySelector('[data-xq-edit]'), want = editWant == null ? !w.calc.out || !!w.calc.editOpen : editWant; if(e) e.open = want; w.calc.editOpen = want;
      const tg = r.querySelector('[data-xq-tag]'), g = w.calc.tag;
      if(tg && g){ const on = !!(g.open || w.calc.pendingSteps || g.busy || (g.run && !g.run.end)); tg.open = on; g.open = on; }
    }, 0);
  }

  // ---------- the panel ----------
  function control(k, c, [key, type, lab], list){
    const v = c.params[key], id = `xq-${key}`, L = `<label class="ip-label" for="${id}">${E(lab)}</label>`;
    const sel = (opts, cur, blank) => `<select class="ip-field" id="${id}" data-xq-p="${key}">${blank ? `<option value=""${cur ? '' : ' selected'}>—</option>` : ''}${opts.map(o => `<option${o === cur ? ' selected' : ''}>${E(o)}</option>`).join('')}</select>`;
    if(type === 'col' || type === 'col?' || type === 'colA') return list[0] ? L + sel(list[0].header, v, type !== 'col') : '';
    if(type === 'colB' || type === 'colB?'){ const tB = refT(list, c.params.tableB); return tB ? L + sel(tB.header, v, true) : ''; }
    if(type === 'table') return list.length > 1 ? L + `<select class="ip-field" id="${id}" data-xq-p="${key}">${list.slice(1).map((t, i) => `<option value="${t.isStep ? `step ${t.isStep}` : i + 2}"${refN(list, v) === i + 2 ? ' selected' : ''}>${t.isStep ? `Step ${t.isStep}'s result` : `Table ${i + 2} · ${E(t.name)}`}</option>`).join('')}</select>` : '';
    if(Array.isArray(type)) return L + sel(type, v);
    if(type === 'num') return L + `<input class="ip-field xq-num" id="${id}" type="number" step="any" data-xq-p="${key}" value="${E(v)}">`;
    if(type === 'date') return L + `<input class="ip-field xq-num" id="${id}" type="date" data-xq-p="${key}" value="${E(v)}">`;
    if(type === 'conds'){
      const cs = (v || []).concat([{ col: '', op: 'equals', value: '' }]);
      return `<fieldset class="xq-crit"><legend class="ip-label">${E(lab)}</legend>${cs.map((x, i) => { const t2 = isRefOp(x.op), noVal = /^is /.test(x.op), bt = t2 ? refT(list, x.tbl) : null;
        return `<div class="xq-cond-row">
        <select class="ip-field" aria-label="Condition ${i + 1} column" data-xq-f="${i}" data-xq-fk="col"><option value="">${i < cs.length - 1 ? '— remove' : '+ add a condition'}</option>${(list[0] ? list[0].header : []).map(h => `<option${h === x.col ? ' selected' : ''}>${E(h)}</option>`).join('')}</select>
        <select class="ip-field" aria-label="Condition ${i + 1} test" data-xq-f="${i}" data-xq-fk="op">${COND_OPS.map(o => `<option${o === x.op ? ' selected' : ''}>${E(o)}</option>`).join('')}</select>
        ${noVal ? '<span></span>' : t2 ? `<span class="xq-ref">${list.length > 2 ? `<select class="ip-field" aria-label="Condition ${i + 1} table" data-xq-f="${i}" data-xq-fk="tbl">${list.slice(1).map((t, j) => `<option value="${t.isStep ? `step ${t.isStep}` : j + 2}"${refN(list, x.tbl) === j + 2 ? ' selected' : ''}>${t.isStep ? `Step ${t.isStep}` : `Table ${j + 2}`}</option>`).join('')}</select>` : ''}<select class="ip-field" aria-label="Condition ${i + 1} column of that table" data-xq-f="${i}" data-xq-fk="value">${(bt ? bt.header : []).map(h => `<option${h === x.value ? ' selected' : ''}>${E(h)}</option>`).join('') || '<option value="">attach another table</option>'}</select></span>`
          : `<input class="ip-field" type="${/N days/.test(x.op) ? 'number' : /date$/.test(x.op) ? 'date' : 'text'}" aria-label="Condition ${i + 1} value" data-xq-f="${i}" data-xq-fk="value" value="${E(x.value)}">`}</div>`; }).join('')}</fieldset>`;
    }
    if(type === 'criteria'){
      const cr = (v || []).concat([{ col: '', weight: 1, dir: 'higher' }]);
      return `<fieldset class="xq-crit"><legend class="ip-label">${E(lab)}</legend>${cr.map((x, i) => `<div class="xq-crit-row">
        <select class="ip-field" aria-label="Criterion ${i + 1} column" data-xq-c="${i}" data-xq-ck="col"><option value="">${i < cr.length - 1 ? '— remove' : '+ add a criterion'}</option>${(list[0] ? list[0].header : []).map(h => `<option${h === x.col ? ' selected' : ''}>${E(h)}</option>`).join('')}</select>
        <input class="ip-field xq-num" type="number" step="any" aria-label="Criterion ${i + 1} weight" data-xq-c="${i}" data-xq-ck="weight" value="${E(x.weight)}">
        <select class="ip-field" aria-label="Criterion ${i + 1} direction" data-xq-c="${i}" data-xq-ck="dir"><option value="higher"${x.dir !== 'lower' ? ' selected' : ''}>higher is better</option><option value="lower"${x.dir === 'lower' ? ' selected' : ''}>lower is better</option></select></div>`).join('')}</fieldset>`;
    }
    return L + `<input class="ip-field" id="${id}" type="text" data-xq-p="${key}" value="${E(v)}">`;
  }
  function outHtml(o, compact){
    const shown = o.rows.slice(0, compact ? 10 : SHOW_ROWS);
    return `<div class="xq-out" role="region" aria-label="Calculation result">
      <ul class="xq-sum">${o.summary.map(x => `<li>${E(x)}</li>`).join('')}</ul>
      <div class="ex-table-wrap xq-table"><table class="ex-table"><thead><tr>${o.cols.map(h => `<th scope="col">${E(h)}</th>`).join('')}</tr></thead>
        <tbody>${shown.map(r => `<tr>${r.map((x, i) => `<td${i ? ' class="xq-n"' : ''}>${E(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${o.rows.length > shown.length ? `<p class="ex-note">Showing ${shown.length} of ${o.rows.length.toLocaleString('en-US')} rows. The full table goes into the result document.</p>` : ''}
      <p class="ex-note"><b>Formula:</b> ${E(o.formula)}</p>
      ${o.ai ? `<p class="ex-note xq-ai"><b>“${E(o.ai.name)}” was filled by AI, row by row</b> (${o.ai.filled.toLocaleString('en-US')} of ${o.ai.rows.toLocaleString('en-US')} rows${o.ai.fixed ? `; ${o.ai.fixed} corrected by you` : ''}). The arithmetic is exact; the ${o.ai.mode === 'score' ? 'scores' : 'labels'} are judgements — check the sample below.</p>` : ''}
      <p class="ex-note">Computed here from ${E(o.from.join(' and ') || 'the values above')}, not by the AI. This node's findings and result use these exact numbers.</p></div>`;
  }
  function tagHtml(k, c, list, ro){
    const t = list[0]; if(!t) return '';
    const g = tagCfg(c), R = g.run, running = !!(R && !R.end), name = tagName(g), n = t.rows.length, ci = t.header.indexOf(name), verb = g.mode === 'score' ? 'Score' : 'Tag', verbIng = g.mode === 'score' ? 'Scoring' : 'Tagging';
    const open = g.open || running || !!c.pendingSteps || g.busy;
    const labels = labelsOf(g), opts = labels.concat(labels.some(l => /^other$/i.test(l)) ? [] : ['Other']);
    return `<details class="xq-tag" data-xq-tag${open ? ' open' : ''}><summary class="ip-mini">✦ Tag or score each row with AI${c.tagged ? ` · “${E(c.tagged.name)}” filled` : ''}</summary>
      <div class="xq-tag-body">
        ${c.pendingSteps ? `<p class="ip-hint">First the AI reads each row and fills “${E(name)}”. Then ${c.pendingSteps.map(x => `“${E(OPS[x.op].label)}”`).join(' → ')} run${c.pendingSteps.length === 1 ? 's' : ''} on it.</p>`
          : '<p class="ex-note">The AI reads each row and writes one label or score into a new column; the calculations can then count, average or rank it. It is AI judgement, not source data, so check the sample it shows.</p>'}
        ${ro ? '' : `<fieldset class="xq-cols"><legend class="ip-label">Columns the AI reads</legend>${t.header.filter(h => h !== name).map(h => `<label class="xq-colpick"><input type="checkbox" data-xq-tcol="${E(h)}"${g.cols.includes(h) ? ' checked' : ''}${running ? ' disabled' : ''}> ${E(h)}</label>`).join('')}</fieldset>
        <label class="ip-label" for="xq-tmode">What the AI writes for each row</label>
        <select class="ip-field" id="xq-tmode" data-xq-t="mode"${running ? ' disabled' : ''}><option value="tag"${g.mode === 'tag' ? ' selected' : ''}>One label from a list</option><option value="score"${g.mode === 'score' ? ' selected' : ''}>A score on a scale</option></select>
        ${g.mode === 'tag' ? `<label class="ip-label" for="xq-tlabels">Labels, one per line</label><textarea class="ip-field" id="xq-tlabels" rows="5" data-xq-t="labels"${running ? ' disabled' : ''}>${E(g.labels)}</textarea>`
          : `<label class="ip-label" for="xq-trubric">Rubric: what each score means</label><textarea class="ip-field" id="xq-trubric" rows="5" data-xq-t="rubric"${running ? ' disabled' : ''}>${E(g.rubric)}</textarea>
          <div class="xq-range"><label class="ip-label" for="xq-tmin">Lowest</label><input class="ip-field xq-num" id="xq-tmin" type="number" data-xq-t="min" value="${E(g.min)}"><label class="ip-label" for="xq-tmax">Highest</label><input class="ip-field xq-num" id="xq-tmax" type="number" data-xq-t="max" value="${E(g.max)}"></div>`}
        <button type="button" class="ip-mini" data-xq-act="tag-suggest"${running || g.busy ? ' disabled' : ''}>${g.busy ? 'Reading a sample…' : g.mode === 'tag' ? '✦ Suggest labels from a sample' : '✦ Draft a rubric from a sample'}</button>
        <label class="ip-label" for="xq-tname">New column</label><input class="ip-field" id="xq-tname" type="text" data-xq-t="name" value="${E(g.name)}" placeholder="${E(tagName(g))}"${running ? ' disabled' : ''}>
        <div class="ip-row-actions xq-tag-actions">
          ${running ? `<button type="button" class="ip-mini" data-xq-act="tag-stop">Stop</button>`
            : `<button type="button" class="ip-mini" data-xq-act="tag-sample">Try ${Math.min(TAG_SAMPLE, n)} rows first</button>
               <button type="button" class="btn ip-btn-sm" data-xq-act="tag-all">${verb} all ${n.toLocaleString('en-US')} rows</button>
               ${R && R.end && (R.failed || R.stop) ? '<button type="button" class="ip-mini" data-xq-act="tag-blanks">Fill the blank rows</button>' : ''}`}
        </div>
        <p class="ip-hint">${verbIng} all rows makes about ${calls(n).toLocaleString('en-US')} AI call${calls(n) === 1 ? '' : 's'} (${TAG_BATCH} rows each, ${TAG_PAR} at a time); up to ${TAG_MAX.toLocaleString('en-US')} rows per run.</p>`}
        ${running ? `<p class="xo-live" role="status" aria-live="polite"><i></i>${verbIng}… ${R.done.toLocaleString('en-US')} of ${R.total.toLocaleString('en-US')} rows${R.failed ? ` · ${R.failed} blank so far` : ''}</p>` : ''}
      </div></details>`;
  }
  // The AI-filled rows to check and correct: shown under the result, where they are not missed.
  function checkHtml(k, c, list, ro){
    const t = list[0]; if(!t || !c.tag) return '';
    const g = c.tag, R = g.run, name = tagName(g), n = t.rows.length, ci = t.header.indexOf(name);
    const labels = labelsOf(g), opts = labels.concat(labels.some(l => /^other$/i.test(l)) ? [] : ['Other']);
    let check = '';
    if(R && R.end && R.name === name && ci >= 0){
      const rows = checkRows(t, R), first = g.cols.find(x => t.header.includes(x)), fi = t.header.indexOf(first);
      check = `<div class="xq-check"><p class="ip-label">Check the AI's ${g.mode === 'score' ? 'scores' : 'labels'} · ${t.rows.filter(r => r[ci]).length.toLocaleString('en-US')} of ${n.toLocaleString('en-US')} rows filled</p>
        <div class="ex-table-wrap"><table class="ex-table"><thead><tr><th scope="col">Row</th><th scope="col">${E(first)}</th><th scope="col">${E(name)}</th><th scope="col">Why</th></tr></thead><tbody>
        ${rows.map(i => `<tr><td class="xq-n">${i + 1}</td><td>${E(String(t.rows[i][fi] || '').slice(0, 120))}</td><td>${ro ? E(t.rows[i][ci]) : g.mode === 'tag'
          ? `<select class="ip-field" aria-label="${E(name)} for row ${i + 1}" data-xq-fix="${i}"><option value=""${t.rows[i][ci] ? '' : ' selected'}>—</option>${opts.concat(opts.includes(t.rows[i][ci]) || !t.rows[i][ci] ? [] : [t.rows[i][ci]]).map(o => `<option${o === t.rows[i][ci] ? ' selected' : ''}>${E(o)}</option>`).join('')}</select>`
          : `<input class="ip-field xq-num" type="number" step="1" min="${E(g.min)}" max="${E(g.max)}" aria-label="${E(name)} for row ${i + 1}" data-xq-fix="${i}" value="${E(t.rows[i][ci])}">`}${R.fixed[i] != null ? ' <span class="xq-fixed">corrected</span>' : ''}</td><td>${E(R.why[i] || '')}</td></tr>`).join('')}
        </tbody></table></div><p class="ex-note">A correction changes that row in the table, and a calculation shown above is worked out again.</p></div>`;
    }
    return check;
  }
  function panelHtml(k, ro){
    const w = exRsW(k); if(!w || !w.mode || w.mode === 'approve') return '';
    if(!w.calc && !needs(w)) return ro ? '' : `<p class="xq-add"><button type="button" class="xo-link rs-kind-switch" data-xq-act="open">+ Add a calculation from your data</button></p>`;
    const c = calc(w), list = tables(k), D = OPS[c.op], ch = chainOf(c), inp = inputs(k), n = ch.length + 1;
    const status = c.busy ? 'setting up…' : c.out ? `${ch.length ? `${n} steps · ` : ''}${OPS[c.out.op].label.toLowerCase()} · done` : list.length ? `${list.length} table${list.length === 1 ? '' : 's'} attached` : 'exact numbers from your data';
    return `<details class="ip-source xq" data-xq-root${c.open !== false ? ' open' : ''}><summary>Calculation · <span class="xq-status">${E(status)}</span></summary>
      <div class="ip-source-body">
        ${c.err ? `<div class="banner" role="alert">${E(c.err)}</div>` : ''}
        ${list.length ? `<ul class="xq-files">${list.map((t, i) => `<li>Table ${i + 1} · <b>${E(t.name)}</b> · ${t.rows.length.toLocaleString('en-US')} row${t.rows.length === 1 ? '' : 's'} · ${t.header.length} column${t.header.length === 1 ? '' : 's'}${ro ? '' : ` <button type="button" class="ip-mini" data-xq-act="drop" data-i="${i}">Remove</button>`}</li>`).join('')}</ul>`
          : `<p class="ex-note">Attach a CSV or paste a table, and the numbers are worked out exactly here, with the formula shown. An Excel file: save it as CSV first.</p>`}
        ${c.busy ? '<p class="xo-live"><i></i>Reading the columns and choosing the calculation…</p>' : ''}
        ${tagHtml(k, c, list, ro)}
        ${ch.length ? `<ol class="xq-chain" aria-label="Earlier steps">${ch.map((x, i) => `<li><details class="xq-step"><summary><b>Step ${i + 1} · ${E(OPS[x.op].label)}</b>${normSrc(x.src) === 'base' && i ? ' · on table 1' : /^\d+$/.test(normSrc(x.src)) ? ` · on step ${normSrc(x.src)}` : ''} — ${E(x.out ? x.out.summary[0] : 'not run')}</summary>${x.out ? outHtml(x.out, true) : ''}</details></li>`).join('')}</ol>
        <p class="ip-label xq-step-now">Step ${n} · works on ${inp[0] ? `${E(inp[0].name)} (${inp[0].rows.length.toLocaleString('en-US')} rows)` : 'nothing yet'}</p>` : ''}
        ${c.out ? outHtml(c.out) : ''}
        ${!ro && !c.busy && (c.out || ch.length) ? `<div class="ip-row-actions xq-step-actions">${c.out ? '<button type="button" class="ip-mini" data-xq-act="step-add">+ Add a step on this result</button>' : ''}${ch.length ? `<button type="button" class="ip-mini" data-xq-act="step-pop">${c.out || c.op ? 'Remove this step' : `Back to step ${ch.length}`}</button>` : ''}</div>` : ''}
        ${checkHtml(k, c, list, ro)}
        ${ro ? '' : `<details class="xq-edit" data-xq-edit${c.out && !c.editOpen ? '' : ' open'}><summary class="ip-mini">${c.out ? (ch.length ? `Change step ${n} or the data` : 'Change the calculation or the data') : ch.length ? `Set up step ${n}` : 'Set up the calculation'}</summary>
        <div class="xq-in">
          <input type="file" class="hidden" accept=".csv,.tsv,.txt,.xlsx,.xls" data-xq="file" aria-label="Attach a CSV file">
          <button type="button" class="btn ip-btn-sm" data-xq-act="attach"${c.busy || list.length >= MAX_TABLES ? ' disabled' : ''}>${list.length >= MAX_TABLES ? `${MAX_TABLES} tables attached` : list.length ? 'Attach another table' : 'Attach a CSV'}</button>
          <details class="xq-paste"><summary class="ip-mini">Paste a table</summary>
            <label class="ip-label" for="xq-paste-${E(k)}">Rows copied from a spreadsheet, first row = column names</label>
            <textarea class="ip-field" id="xq-paste-${E(k)}" rows="4" data-xq="paste"></textarea>
            <button type="button" class="ip-mini" data-xq-act="paste">Use this table</button></details>
          ${list.length || c.op === 'npv' || !c.op ? `<button type="button" class="ip-mini" data-xq-act="suggest"${c.busy ? ' disabled' : ''}>✦ Set it up from the request</button>` : ''}
        </div>
        ${!c.busy ? `<div class="xq-form">
          ${ch.length ? `<label class="ip-label" for="xq-src">Step ${n} works on</label>
          <select class="ip-field" id="xq-src" data-xq="src"><option value="prev"${normSrc(c.src) === 'prev' ? ' selected' : ''}>The result of step ${ch.length} (the step before)</option><option value="base"${normSrc(c.src) === 'base' ? ' selected' : ''}>Table 1 · ${E(list[0] ? list[0].name : '')} (the attached data)</option>${ch.slice(0, -1).map((_, i) => `<option value="${i + 1}"${normSrc(c.src) === String(i + 1) ? ' selected' : ''}>The result of step ${i + 1}</option>`).join('')}</select>` : ''}
          <label class="ip-label" for="xq-op">${ch.length ? `Step ${n} calculation` : 'Calculation'}</label>
          <select class="ip-field" id="xq-op" data-xq="op"><option value=""${c.op ? '' : ' selected'}>Choose…</option>${Object.entries(OPS).map(([id, d]) => `<option value="${id}"${id === c.op ? ' selected' : ''}>${E(d.label)}</option>`).join('')}</select>
          ${c.why ? `<p class="ip-hint">${E(c.why)}</p>` : ''}
          ${D ? D.params.map(p => control(k, c, p, inp)).join('') + `<div class="ip-row-actions"><button type="button" class="btn ip-btn-sm" data-xq-act="run">Calculate</button></div>` : ''}
        </div>` : ''}</details>`}
      </div></details>`;
  }

  // ---------- events ----------
  const kOf = el => { const r = el && el.closest('[data-xq-root]'); return r && typeof EX !== 'undefined' ? EX.cur : null; };
  document.addEventListener('click', ev => {
    const b = ev.target.closest('[data-xq-act]'); if(!b) return;
    const k = EX.cur; if(!k) return;
    const w = exRsW(k), act = b.dataset.xqAct;
    if(act === 'open'){ calc(w).open = true; return exRsRefresh(k, false); }
    const c = calc(w);
    if(act === 'attach'){ const f = b.closest('[data-xq-root]').querySelector('[data-xq="file"]'); if(f) f.click(); return; }
    if(act === 'paste'){ const ta = b.closest('[data-xq-root]').querySelector('[data-xq="paste"]'); if(!ta || !ta.value.trim()) { c.err = 'Paste a table first: a header row, then the data rows.'; return exRsRefresh(k, false); }
      if(addTable(k, `Pasted table ${tables(k).length + 1}`, ta.value)) return suggest(k); return exRsRefresh(k, false); }
    if(act === 'drop'){ tables(k).splice(+b.dataset.i, 1); c.files = tables(k).map(x => ({ name: x.name, rows: x.rows.length, cols: x.header.length })); rerunChain(k); return exRsRefresh(k, false); }
    if(act === 'suggest') return suggest(k);
    if(act === 'step-add'){ if(!c.out) return; chainOf(c).push({ op: c.op, params: c.params, src: c.src, out: c.out }); c.op = ''; c.params = {}; c.src = 'prev'; c.out = null; c.why = ''; c.err = ''; exRsRefresh(k, false); return settle(k, true); }
    // drop the current step; the previous one becomes the current, editable step again
    if(act === 'step-pop'){ const ch = chainOf(c); if(!ch.length) return; const last = ch.pop(); Object.assign(c, { op: last.op, params: last.params, src: last.src, out: last.out, err: '' }); exRsRefresh(k, false); return settle(k, false); }
    if(act === 'tag-suggest') return tagSuggest(k);
    if(act === 'tag-sample') return tagRun(k, 'sample');
    if(act === 'tag-all') return tagRun(k, 'all');
    if(act === 'tag-blanks') return tagRun(k, 'blanks');
    if(act === 'tag-stop'){ const g = tagCfg(c); if(g.run) g.run.stop = true; return; }
    if(act === 'run'){ run(k); exRsRefresh(k, false); return settle(k, true); }
  });
  document.addEventListener('change', ev => {
    const el = ev.target, k = kOf(el); if(!k) return;
    const w = exRsW(k), c = calc(w);
    if(el.dataset.xq === 'file'){
      const f = el.files && el.files[0]; if(!f) return;
      if(f.size > MAX_BYTES){ c.err = `“${f.name}” is ${(f.size / 1048576).toFixed(1)} MB; the limit here is 2 MB.`; return exRsRefresh(k, false); }
      if(/\.xlsx?$/i.test(f.name)){ addTable(k, f.name, ''); return exRsRefresh(k, false); }
      const r = new FileReader();
      r.onload = () => { if(addTable(k, f.name, String(r.result))) suggest(k); else exRsRefresh(k, false); };
      r.onerror = () => { c.err = `Couldn't read “${f.name}”. Try saving it again as CSV.`; exRsRefresh(k, false); };
      r.readAsText(f); return;
    }
    if(el.dataset.xq === 'src'){ c.src = normSrc(el.value); c.params = cleanParams(c.op, c.params, inputs(k)); c.out = null; return exRsRefresh(k, false); }
    if(el.dataset.xq === 'op'){ c.op = el.value; c.params = cleanParams(c.op, c.params, inputs(k)); c.out = null; c.why = ''; return exRsRefresh(k, false); }
    if(el.dataset.xqP){ c.params[el.dataset.xqP] = el.value; if(el.dataset.xqP === 'tableB'){ c.params = cleanParams(c.op, c.params, inputs(k)); exRsRefresh(k, false); } return; } // another table: its columns
    // the per-row AI step's settings
    if(el.dataset.xqTcol != null){ const g = tagCfg(c), col = el.dataset.xqTcol; g.cols = el.checked ? [...new Set(g.cols.concat(col))] : g.cols.filter(x => x !== col); return; }
    if(el.dataset.xqT){ const g = tagCfg(c), f = el.dataset.xqT; g[f] = f === 'min' || f === 'max' ? num(el.value) : el.value; if(f === 'mode') exRsRefresh(k, false); return; }
    // a correction in the check sample: the table changes, and a calculation shown is worked out again
    if(el.dataset.xqFix != null){
      const g = tagCfg(c), R = g.run, t = tables(k)[0], i = +el.dataset.xqFix; if(!R || !t) return;
      const v = g.mode === 'score' ? tagValue(g, el.value) : el.value;
      t.rows[i][R.ci] = v; R.fixed[i] = v;
      if(c.tagged) c.tagged = Object.assign({}, c.tagged, { fixed: Object.keys(R.fixed).length, filled: t.rows.filter(r => r[R.ci]).length });
      if(c.out || chainOf(c).length) rerunChain(k);
      return exRsRefresh(k, false);
    }
    if(el.dataset.xqF != null){
      const i = +el.dataset.xqF, cs = c.params.conds || (c.params.conds = []), key = el.dataset.xqFk;
      if(!cs[i]) cs[i] = { col: '', op: 'equals', value: '' };
      cs[i][key] = el.value;
      if((key === 'op' && isRefOp(cs[i].op)) || key === 'tbl'){ const b = refT(inputs(k), cs[i].tbl); cs[i].value = b ? b.header[0] : ''; }
      c.params.conds = cs.filter(x => x.col);
      if(key !== 'value') exRsRefresh(k, false); // the value box changes with the test
      return;
    }
    if(el.dataset.xqC != null){
      const i = +el.dataset.xqC, cr = c.params.criteria || (c.params.criteria = []);
      if(!cr[i]) cr[i] = { col: '', weight: 1, dir: 'higher' };
      cr[i][el.dataset.xqCk] = el.value;
      c.params.criteria = cr.filter(x => x.col);
      if(el.dataset.xqCk === 'col') exRsRefresh(k, false);
    }
  });
  document.addEventListener('toggle', ev => {
    const d = ev.target; if(!d || !d.matches || !EX.cur) return;
    const w = exRsW(EX.cur); if(!w || !w.calc) return;
    if(d.matches('details[data-xq-root]')) w.calc.open = d.open;
    if(d.matches('details[data-xq-edit]')) w.calc.editOpen = d.open;
    if(d.matches('details[data-xq-tag]')) tagCfg(w.calc).open = d.open;
  }, true);

  // ---------- into the AI context and the result document ----------
  function asText(o, max){ return [o.cols.join(' | '), ...o.rows.slice(0, max).map(r => r.join(' | ')), o.rows.length > max ? `… ${o.rows.length - max} more rows` : ''].filter(Boolean).join('\n'); }
  function ctx(w){
    const o = w && w.calc && w.calc.out; if(!o) return '';
    const ai = o.ai ? `\nThe column "${o.ai.name}" was NOT in the user's data: the AI filled it by reading each row (${o.ai.mode === 'score' ? `a ${o.ai.min}–${o.ai.max} score` : `one label of: ${o.ai.labels.join(', ')}`}; ${o.ai.filled} of ${o.ai.rows} rows${o.ai.fixed ? `, ${o.ai.fixed} corrected by the user` : ''}). The arithmetic on it is exact; the ${o.ai.mode === 'score' ? 'scores' : 'labels'} are AI judgement — say so wherever you use these numbers.` : '';
    const on = (x, i) => !i ? 'table 1' : normSrc(x.src) === 'base' ? 'table 1' : /^\d+$/.test(normSrc(x.src)) ? `step ${normSrc(x.src)}'s result` : `step ${i}'s result`;
    const ch = chainOf(w.calc).filter(x => x.out), steps = ch.length ? `\nIt is the last of ${ch.length + 1} calculations in one node; each step says what it worked on, and every step's result counts:\n${ch.map((x, i) => `Step ${i + 1} · ${OPS[x.op].label} (on ${on(x, i)}): ${x.out.formula} ${x.out.summary.join(' ')}\n${asText(x.out, 20)}`).join('\n')}\nStep ${ch.length + 1} (the final result below) · ${OPS[o.op].label} (on ${on(w.calc, ch.length)}):` : '';
    return `\nCOMPUTED from the user's own data by code (${OPS[o.op].label}; ${o.from.join(' and ')}). These numbers are EXACT: use them as they are, quote them, never redo the arithmetic or invent other figures. Say which numbers come from this calculation.${ai}${steps}\nFormula: ${o.formula}\n${o.summary.join('\n')}\n${asText(o, 60)}`;
  }
  function resultMd(w){
    const o = w && w.calc && w.calc.out; if(!o) return '';
    const cell = x => String(x).replace(/\|/g, '\\|');
    const ai = o.ai ? ` “${o.ai.name}” was filled by AI, row by row (${o.ai.filled} of ${o.ai.rows} rows${o.ai.fixed ? `; ${o.ai.fixed} corrected` : ''}): the arithmetic is exact, the ${o.ai.mode === 'score' ? 'scores' : 'labels'} are judgements.` : '';
    const tbl = x => { const rows = x.rows.slice(0, 50); return `| ${x.cols.map(cell).join(' | ')} |\n| ${x.cols.map(() => '---').join(' | ')} |\n${rows.map(r => `| ${r.map(cell).join(' | ')} |`).join('\n')}${x.rows.length > 50 ? `\n\n*${x.rows.length - 50} more rows not shown.*` : ''}`; };
    const ch = chainOf(w.calc).filter(x => x.out), steps = ch.length ? `\n\n${ch.map((x, i) => `**Step ${i + 1} · ${OPS[x.op].label}.** ${x.out.summary.join(' ')} *Formula: ${x.out.formula}*\n\n${tbl(x.out)}`).join('\n\n')}\n\n**Step ${ch.length + 1} · ${OPS[o.op].label}** (the result):` : '';
    return `\n\n## Calculation${steps}\n\n${o.summary.map(x => `- ${x}`).join('\n')}\n\n| ${o.cols.map(cell).join(' | ')} |\n| ${o.cols.map(() => '---').join(' | ')} |\n${o.rows.map(r => `| ${r.map(cell).join(' | ')} |`).join('\n')}\n\n*Formula: ${o.formula} Computed from ${o.from.join(' and ') || 'the values given'}.${ai}*`;
  }
  const W = (name, fn) => { const orig = window[name]; if(typeof orig !== 'function') return; window[name] = function(){ return fn.call(this, orig, arguments); }; };
  W('exCtx', (o, a) => { const k = a[0], st = exState(k); return o.apply(null, a) + (st && st.w ? ctx(st.w) : ''); });
  W('exRsResultMd', (o, a) => { const md = o.apply(null, a), st = exState(a[0]); return typeof md === 'string' && st && st.w ? md + resultMd(st.w) : md; });

  window.Compute = { OPS, parseTable, parseDate, num, compile, _inputs: inputs, _buildChain: buildChain, _rerunChain: rerunChain, panelHtml, needs, ctx, resultMd, _addTable: addTable, _run: run, _tables: tables, _tagRun: tagRun, _tagValue: tagValue };
})();
