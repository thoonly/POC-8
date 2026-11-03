// components/option-images.js — a credited image on each choice in an execution node (a venue, hotel, restaurant,
// product…), so people can see what they are choosing, not only read its name.
//
// Where: the Options list and the Decide cards in Output, the option post-its on the canvas template, and option cards
// on the canvas (not the compare tables — the name is enough there). Only for choices between real, visible things.
// How: the image comes from components/place-images.js — Tavily or Wikipedia, then Wikimedia Commons (approved
// remote-image exception: real images only, credited, nothing shown when none is found). The lookup is the option's name plus the place the request is about
// ("Kimpton Maa-Lai Bangkok"). Generic options ("Hotel meeting room") are not looked up, and an image is only shown when
// the page it came from is about that option (shares a distinctive word with its name).
// It decorates the page after each redraw (MutationObserver), so the screens' own drawing code is unchanged.
(function(){
  'use strict';
  if(!window.PlaceImages) return;
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  // words that say what kind of thing it is, not which one (never enough on their own to look up or to match)
  const GENERIC = new Set('the a an and of at in on for with by to hotel hotels resort inn hostel room rooms meeting meetings space spaces rooftop roof hall halls venue venues studio studios center centre cafe café restaurant restaurants bar bars house park garden office offices coworking co-working club lounge terrace suite suites floor building tower mall market markets event events conference ballroom villa villas apartment apartments option options plan package tour tours trip day night nights spot place area district style smb sme smbs smes enterprise enterprises startup startups agency agencies company companies business businesses firm firms team teams segment segments customer customers client clients user users market markets size sizes small medium large mid mid-size midsize creative tier tiers plan plans pricing price model models strategy strategies approach channel channels option b2b b2c saas freelancer freelancers individual individuals persona personas audience group groups industry industries sector sectors level levels type types category categories'.split(' '));
  const words = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^\p{L}\p{M}\p{N}]+/u).filter(w => w.length > 2 && !GENERIC.has(w));
  const named = label => words(label).length > 0 && /\p{Lu}|\p{N}|[^\x00-\x7F]/u.test(String(label).replace(/^\p{Lu}/u, '')); // has a proper name in it
  // an image is about this option only when every distinctive word of its name is in the image's title
  // ("Kimpton Maa-Lai" ↔ "Kimpton Maa-Lai Bangkok 2025-09"; not "The Commons Thonglor" ↔ "Park Origin Thonglor")
  // the option's NAME only: the AI often adds a note after it ("Kimpton Maa-Lai (Ploenchit)", "… — 5-star, 3 ballrooms",
  // "…, Lang Suan"). Those extra words are never in a photo's title, so matching on them rejected every real photo
  // (user test: "you give me the hotel names but no images — can't find, or a bug?" — it was this).
// A name with only ONE distinctive word ("Rembrandt Hotels (สุขุมวิท)" → "rembrandt") also needs a second clue in the
// photo title — the kind of place ("hotel"), the area in brackets ("สุขุมวิท"), or the place the request is about —
// else any page that shares the word counts (user test: it showed "7 rue Rembrandt, Paris" for a Bangkok hotel).
const raw = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').split(/[^\p{L}\p{M}\p{N}]+/u).filter(w => w.length > 2).map(w => w.replace(/s$/, ''));
const strict = (name, full, hit) => {
  if(!matches(name, hit)) return false;
  const d = words(name); if(d.length >= 2) return true;
  const dd = new Set(d.map(w => w.replace(/s$/, ''))), t = raw(hit.title).join(' ');
  const clues = [...new Set(raw(`${full} ${typeof placeHint === 'function' ? placeHint() : ''}`))].filter(w => !dd.has(w) && !['the', 'and', 'for', 'with'].includes(w));
  return clues.some(w => t.includes(w));
};
  const nameOf = label => { const s = String(label || '').split(/\s[—–-]\s|\s*[(\[,:|·•]/)[0].trim(); return words(s).length ? s : String(label || '').trim(); };
  const matches = (label, hit) => { const t = new Set(words(hit.title)), flat = words(hit.title).join(' '); return words(label).every(w => t.has(w) || flat.includes(w)); };

  // the place the request is about ("… in Bangkok", "… in Chiang Mai"), to make the lookup specific
  function placeHint(){
    const t = [window.__topic, window.IP && IP.intent && IP.intent.purpose].filter(Boolean).join(' ');
    const m = t.match(/\b(?:in|at|near|around)\s+(\p{Lu}[\p{L}'’-]+(?:\s\p{Lu}[\p{L}'’-]+)?)/u);
    return m ? m[1] : '';
  }
  const NONLATIN = /[฀-๿຀-໿က-႟ក-៿぀-ヿ㐀-鿿가-힯Ѐ-ӿ֐-ۿ]/;
  const enCache = new Map(); let enQueue = [], enTimer = 0;
  function enName(name){
    if(!NONLATIN.test(name) || typeof callClaude !== 'function') return Promise.resolve('');
    if(enCache.has(name)) return enCache.get(name);
    const p = new Promise(res => { enQueue.push({ name, res }); });
    enCache.set(name, p);
    clearTimeout(enTimer); enTimer = setTimeout(async () => { // one AI call for all the names waiting
      const batch = enQueue; enQueue = [];
      let names = {};
      try { const r = await callClaude(`Give the official English name each of these places or businesses is listed under (on its own website, booking sites or Wikipedia): brand + area, no description. If you don't know one, transliterate it into English letters.
Names: ${JSON.stringify(batch.map(x => x.name))}
Respond ONLY with {"names": {"<name exactly as given>": "<English name>"}}.`, { maxTokens: 400 }); names = (r && r.names) || {}; } catch(e){}
      batch.forEach(x => { const v = typeof names[x.name] === 'string' ? names[x.name].trim() : ''; enCache.set(x.name, Promise.resolve(v)); x.res(v); });
    }, 60);
    return p;
  }
  // what to search for and what a photo's title must name: the English name when there is one, else the name as written
  async function target(label){
    const name = nameOf(label), en = await enName(name);
    const use = en && words(en).length ? en : name, hint = placeHint();
    return { name: use, q: hint && !use.toLowerCase().includes(hint.toLowerCase()) ? `${use} ${hint}` : use, orig: name };
  }
  const cache = new Map(); // label → hit | null | Promise
  function lookup(label){
    if(cache.has(label)) return cache.get(label);
    if(!named(nameOf(label))){ cache.set(label, null); return null; }
    // Tavily / Wikipedia first, then Wikimedia Commons (photos of individual hotels and venues); only a matching image counts
    const job = (async () => {
      const { name, q, orig } = await target(label);
      const hit = await PlaceImages.find(q); if(hit && strict(name, label, hit)) return hit;
      let files = PlaceImages.commons ? await PlaceImages.commons(q) : [], f = files.find(x => strict(name, label, x));
      if(!f && q !== name){ files = await PlaceImages.commons(name); f = files.find(x => strict(name, label, x)); } // the city added to the search can hide a photo whose title doesn't name it
      if(!f && orig !== name){ const h2 = await PlaceImages.find(orig); if(h2 && strict(orig, label, h2)) return h2; } // the name as written (its own-language Wikipedia)
      return f || null;
    })().then(ok => { cache.set(label, ok); schedule(); return ok; }).catch(() => { cache.set(label, null); schedule(); return null; }); // found or not: redraw, so the result is said either way
    cache.set(label, job); return job;
  }

  // Only a choice between real, visible things (a venue, hotel, restaurant, product…) gets photos — not a choice of a
  // segment, strategy, plan or approach (e.g. "Pick the company size segment": "SMB creative agency" has no photo).
  const ABSTRACT_NODE = /\b(segment|segments|strategy|strategies|pricing|price|approach|model|tier|plan|plans|channel|policy|method|framework|size|audience|persona|priority|priorities|metric|kpi|goal|target market|positioning|message|messaging|tone|scope)\b/i;
  // A choice between places (venue, hotel, restaurant, destination…) gets photos; a choice between products, tools or
  // companies ("Salesforce Sales Cloud", "HubSpot Sales Hub") gets a small logo in front of each name instead.
  // the same in Thai (no word boundaries in Thai script, so plain substrings)
  const PLACE_TH = /(โรงแรม|ที่พัก|รีสอร์ท|ร้านอาหาร|ห้องประชุม|สถานที่จัด|คาเฟ่|ร้านกาแฟ|สถานที่ท่องเที่ยว)/;
  const PLACE_NODE = /\b(venue|venues|hotel|hotels|restaurant|restaurants|cafe|caf\u00e9|bar|place|places|destination|destinations|city|cities|location|locations|attraction|attractions|market|neighbou?rhood|resort|hostel|museum|park|beach|island|trip|tour|stay|accommodation|room|space for|offsite)\b/i;
// Are these options real, named things with a photo or an official logo — or ideas, settings, approaches? Asked once
// per node (user test: options like "Shape + limit only" got a Disney logo — the node title said nothing abstract, so it
// was treated as a product choice). Until the answer is in, nothing is shown.
// The things this node chooses between: a decision's options, or a collecting node's items (user test: hotels collected
// in a "Pick" step — Output rows and the canvas Ideas — got no photo and no "No photo found": only decisions were covered).
function itemsOf(w){
  if(w && w.mode === 'gather' && w.gather && Array.isArray(w.gather.items)) return w.gather.items;
  return w && Array.isArray(w.options) ? w.options : [];
}
function looks(k, w, st){
  const list = itemsOf(w);
  const sig = k + '|' + list.slice(0, 3).map(o => o.label).join('|');
  if(w.optLook && w.optLook.sig === sig) return w.optLook.kind;
  if(w.optLook && w.optLook.sig === sig + '…') return null; // asking
  if(w.optLook && w.optLook.sig === sig + '!' && Date.now() - w.optLook.at < 20000) return null; // the check failed: try again shortly
  if(typeof callClaude !== 'function') return null;
  w.optLook = { sig: sig + '…', kind: null };
  callClaude(`An execution node: "${st.title}" — ${(st.nodeInfo || {}).purpose || ''}
Its options: ${JSON.stringify(list.slice(0, 8).map(o => o.label))}
Are these options specific, real-world, NAMED things that have a photo or an official logo — a hotel, venue, restaurant, city (photo); a product, app, company, airline, brand (logo)? Or are they ideas, approaches, settings, rules, configurations, categories or descriptions (none)?
Respond ONLY with {"show": "photo" | "logo" | "none"}.`, { maxTokens: 60 })
    .then(r => { const v = r && r.show; w.optLook = { sig, kind: v === 'photo' || v === 'logo' ? v : 'none' }; if(w.optLook.kind !== 'none') schedule(); })
    .catch(() => { w.optLook = { sig: sig + '!', kind: null, at: Date.now() }; setTimeout(schedule, 21000); }); // the check failed: no pictures for now, asked again in a moment
  return null;
}
// the current node's options (id → label), in the order the compare tables use (kept ones), and what to show for them
  function options(){
    try {
      if(typeof EX === 'undefined' || !EX.cur || typeof exRsW !== 'function') return null;
      const st = typeof exStep === 'function' ? exStep(EX.cur) : null, about = st ? `${st.title || ''} ${(st.nodeInfo || {}).purpose || ''}` : '';
      void ABSTRACT_NODE; // no keyword filter any more (user test: a hotel node whose purpose said "plan" or "price" lost its photos) — looks() decides
      const w = exRsW(EX.cur), list = itemsOf(w), gather = w && w.mode === 'gather'; if(!list.length) return null;
      // the node's template already says how its choices look (components/node-template.js): photos or logos, or neither
      if(w.tpl && w.tpl.show && w.tpl.show !== 'photo' && w.tpl.show !== 'logo') return null;
      let kind = w.tpl && (w.tpl.show === 'photo' || w.tpl.show === 'logo') ? w.tpl.show : looks(EX.cur, w, st);
      // a node about choosing a hotel, venue, restaurant, place… gets photos without waiting for that check, and even when
      // it fails or says otherwise (user test: the Pick step of a hotel node showed neither photos nor "No photo found" —
      // when the check is slow or fails, nothing at all was shown)
      if(kind !== 'photo' && kind !== 'logo' && (PLACE_NODE.test(about) || PLACE_TH.test(about) || list.some(o => /\b(hotel|resort|hostel)\b/i.test(o.label || '') || PLACE_TH.test(o.label || '')))) kind = 'photo';
      if(kind !== 'photo' && kind !== 'logo') return null; // not real, named things (or not known yet): no pictures
      if(gather && kind === 'logo') return null; // collected items: photos only
      return gather ? { kind, all: list, kept: list.filter(o => o.kept), k: 'g', act: 'keep-g' }
        : { kind, all: w.options, kept: typeof rsKeptOpt === 'function' ? rsKeptOpt(w) : w.options.filter(o => o.kept), k: 'o', act: 'keep-o' };
    } catch(e){ return null; }
  }
  // ---------- a small photo carousel per option (user test: a hotel needs its building AND its ballroom, rooms…) ----------
  // Several real, credited photos of THIS option: the main lookup, Wikimedia Commons files whose title names it, and a
  // search per thing worth seeing for that kind of place (a hotel: ballroom, meeting room, guest room). Every photo must
  // name the option in its title (same rule as the single photo). One frame at a time — little space, arrows + dots.
  function aspectsFor(){
    try { const st = exStep(EX.cur), t = `${st.title} ${(st.nodeInfo || {}).purpose || ''}`;
      if(/\b(hotel|hotels|stay|accommodation|resort|hostel)\b/i.test(t)) return /\b(offsite|meeting|meetings|conference|event|workshop|seminar)\b/i.test(t) ? ['ballroom', 'meeting room', 'guest room'] : ['guest room', 'restaurant', 'lobby']; // a stay: the room, the dining, the place
      if(/\b(restaurant|restaurants|cafe|café|bar|dinner|lunch)\b/i.test(t)) return ['interior', 'food'];
      if(/\b(venue|venues|space|offsite|ballroom|hall|conference)\b/i.test(t)) return ['hall', 'interior'];
      return ['interior']; } catch(e){ return []; }
  }
  const capOf = (title, aspects) => { const t = String(title || '').toLowerCase(), a = aspects.find(x => t.includes(x.split(' ')[0])); return a ? a.charAt(0).toUpperCase() + a.slice(1) : ''; };
  const galCache = new Map(); // label → [hits] | Promise
  function gallery(label){
    if(galCache.has(label)) return galCache.get(label);
    if(!named(nameOf(label))){ galCache.set(label, []); return []; }
    const aspects = aspectsFor();
    const job = (async () => {
      const { name, q } = await target(label);
      const out = [], seen = new Set(), add = (h, cap) => { if(h && h.url && !seen.has(h.url) && out.length < 6){ seen.add(h.url); out.push(Object.assign({ cap: cap || capOf(h.title, aspects) }, h)); } };
      const main = await lookup(label); add(main, '');
      const files = PlaceImages.commons ? await PlaceImages.commons(q) : []; files.filter(f => strict(name, label, f)).forEach(f => add(f));
      for(const a of aspects){ if(out.length >= 5) break;
        const fa = PlaceImages.commons ? await PlaceImages.commons(`${name} ${a}`) : []; fa.filter(f => strict(name, label, f)).forEach(f => add(f, a.charAt(0).toUpperCase() + a.slice(1)));
        const h = await PlaceImages.find(`${q} ${a}`); if(h && strict(name, label, h)) add(h, a.charAt(0).toUpperCase() + a.slice(1)); }
      return out;
    })().then(list => { galCache.set(label, list); if(list.length > 1) schedule(); return list; }).catch(() => { galCache.set(label, []); return []; });
    galCache.set(label, job); return job;
  }
  function carHtml(list, label, inButton){
    const credit = (h, i) => `<span class="opt-car-n">${i + 1}/${list.length}</span>${h.cap ? `<b class="opt-car-cap">${E(h.cap)}</b>` : ''}${inButton ? `<span>Photo: ${E(h.credit || 'source')}</span>` : `Photo: <a href="${E(h.href || h.url)}" target="_blank" rel="noopener">${E(h.credit || 'source')}</a>`}`;
    return `<div class="opt-car-track" tabindex="${inButton ? -1 : 0}" aria-label="Photos of ${E(label)}">${list.map((h, i) => `<img src="${E(h.url)}" alt="${E(label)}${h.cap ? ' — ' + E(h.cap) : ''}" loading="lazy" referrerpolicy="no-referrer" data-i="${i}">`).join('')}</div>
      ${inButton ? '' : `<button type="button" class="opt-car-btn opt-car-prev" data-car="-1" aria-label="Previous photo of ${E(label)}">‹</button><button type="button" class="opt-car-btn opt-car-next" data-car="1" aria-label="Next photo of ${E(label)}">›</button>`}
      <span class="opt-car-dots" aria-hidden="true">${list.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</span>
      <figcaption>${credit(list[0], 0)}</figcaption>`;
  }
  function carSync(fig){ // which photo is showing → dots + caption
    const tr = fig.querySelector('.opt-car-track'); if(!tr || !fig._list) return;
    const i = Math.max(0, Math.min(fig._list.length - 1, Math.round(tr.scrollLeft / Math.max(1, tr.clientWidth)))); if(fig._i === i) return; fig._i = i;
    fig.querySelectorAll('.opt-car-dots i').forEach((d, n) => d.classList.toggle('on', n === i));
    const h = fig._list[i], cap = fig.querySelector('figcaption'), inBtn = !!fig.closest('button');
    if(cap) cap.innerHTML = `<span class="opt-car-n">${i + 1}/${fig._list.length}</span>${h.cap ? `<b class="opt-car-cap">${E(h.cap)}</b>` : ''}${inBtn ? `<span>Photo: ${E(h.credit || 'source')}</span>` : `Photo: <a href="${E(h.href || h.url)}" target="_blank" rel="noopener">${E(h.credit || 'source')}</a>`}`;
  }
  // arrows (the canvas must not treat the click as selecting the post-it), swipe/scroll, and — inside a card that is
  // itself a button — the photos turn by themselves while the pointer is over it
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('.opt-car-btn'); if(!b) return; e.preventDefault(); e.stopPropagation();
    const tr = b.closest('.opt-car').querySelector('.opt-car-track'); tr.scrollBy({ left: tr.clientWidth * (+b.dataset.car), behavior: 'smooth' }); }, true);
  document.addEventListener('pointerdown', e => { if(e.target.closest && e.target.closest('.opt-car-btn')) e.stopPropagation(); }, true);
  document.addEventListener('scroll', e => { const t = e.target; if(t && t.classList && t.classList.contains('opt-car-track')) carSync(t.closest('.opt-car')); }, true);
  document.addEventListener('pointerover', e => { const fig = e.target.closest && e.target.closest('button .opt-car'); if(!fig || fig._auto) return;
    fig._auto = setInterval(() => { const tr = fig.querySelector('.opt-car-track'); if(!tr || !fig.isConnected || !fig.matches(':hover')){ clearInterval(fig._auto); fig._auto = null; return; } const n = tr.scrollLeft + tr.clientWidth >= tr.scrollWidth - 2 ? 0 : tr.scrollLeft + tr.clientWidth; tr.scrollTo({ left: n, behavior: 'smooth' }); }, 1600); });
  // inside a button a link isn't allowed: the credit is plain text there (the full link is on the image's title)
  function figHtml(hit, label, inButton){
    const credit = inButton ? `<span>Photo: ${E(hit.credit || 'source')}</span>` : `Photo: <a href="${E(hit.href || hit.url)}" target="_blank" rel="noopener">${E(hit.credit || 'source')}</a>`;
    return `<img src="${E(hit.url)}" alt="${E(label)}" loading="lazy" referrerpolicy="no-referrer" title="${E(hit.credit || '')}"><figcaption>${credit}</figcaption>`;
  }
  function put(host, label, where, cls, inButton){
    if(!host || !label) return;
    const cur = host.querySelector(':scope > .opt-img');
    // several photos when the gallery has them (a carousel), else the single photo while it is still looking
    const g = gallery(label), one = lookup(label), list = Array.isArray(g) && g.length ? g : one && typeof one.then !== 'function' ? [one] : [];
    if(!list.length){ if(cur) cur.remove();
      // Always say where the photo stands, on every place an option shows (user test: "if you cannot find it, you need to
      // tell the user"): "Looking for a photo…" while searching, then "No photo found" — with why and what helps where
      // there's room (a list row), a short line on cards and post-its.
      const looking = (one && typeof one.then === 'function') || (g && typeof g.then === 'function');
      const tavily = !!(window.AI && AI.settings && AI.settings.searchProvider === 'tavily' && AI.settings.tavilyKey);
      const name = nameOf(label), link = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(name + (placeHint() ? ' ' + placeHint() : ''))}`;
      const html = looking ? 'Looking for a photo…'
        : cls === 'opt-img--row' && !inButton ? `No photo found — ${tavily ? 'not in the web image search, Wikipedia or Wikimedia Commons' : 'Wikipedia and Wikimedia Commons have none, and web image search is off (turn on Tavily in AI settings to search photos on the web)'}. <a href="${link}" target="_blank" rel="noopener">Search photos ↗</a>`
        : 'No photo found';
      const sig = (looking ? 'wait|' : 'none|') + label;
      let p = host.querySelector(':scope > .opt-nophoto');
      if(p && p.dataset.sig === sig) return;
      if(!p){ p = document.createElement(inButton ? 'span' : 'p'); p.setAttribute('contenteditable', 'false'); if(where === 'start') host.insertBefore(p, host.firstChild); else if(where && where.nodeType) host.insertBefore(p, where); else host.appendChild(p); }
      p.className = 'opt-nophoto' + (looking ? ' opt-nophoto--wait' : '') + (cls === 'opt-img--row' && !inButton ? '' : ' opt-nophoto--short');
      p.dataset.sig = sig; p.innerHTML = html;
      return; }
    host.querySelectorAll(':scope > .opt-nophoto').forEach(x => x.remove());
    const sig = `${label}|${list.length}`;
    if(cur && cur.dataset.sig === sig) return;
    if(cur) cur.remove();
    const fig = document.createElement('figure'); fig.className = `opt-img ${cls}${list.length > 1 ? ' opt-car' : ''}`; fig.dataset.label = label; fig.dataset.sig = sig; fig.setAttribute('contenteditable', 'false');
    if(list.length > 1){ fig._list = list; fig._i = 0; fig.innerHTML = carHtml(list, label, inButton);
      fig.querySelectorAll('img').forEach(im => im.addEventListener('error', () => { const i = +im.dataset.i; list.splice(i, 1); galCache.set(label, list); im.remove(); fig.dataset.sig = ''; schedule(); })); }
    else { fig.innerHTML = figHtml(list[0], label, inButton); fig.querySelector('img').addEventListener('error', () => { cache.set(label, null); galCache.set(label, []); fig.remove(); }); }
    if(where === 'start') host.insertBefore(fig, host.firstChild); else if(where && where.nodeType) host.insertBefore(fig, where); else host.appendChild(fig);
  }

  function decorate(){
    if(window.ExKinds && ExKinds.noPhotos()) return; // item types that are never photographed (people) or draw their own visual
    const o = options(); if(!o || !o.all.length) return;
    if(o.kind === 'logo') return decorateLogos(o);
    const byId = id => o.all.find(x => x.id === id);
    docPhotos(o);
    // Output: Options list rows
    document.querySelectorAll(`.rs-item .rs-keep[data-rq-act="${o.act}"]`).forEach(b => { const x = byId(b.dataset.id), body = b.parentNode.querySelector('.rs-item-body'); if(x) put(body, x.label, 'start', 'opt-img--row'); });
    // v4 canvas Output: the compact list of what's on the table
    document.querySelectorAll(`#exec-view [data-xo^="${o.k}:"] .xo-main`).forEach(m => { const x = byId(m.closest('[data-xo]').dataset.xo.slice(o.k.length + 1)); if(x) put(m, x.label, 'start', 'opt-img--pi'); });
    // Output and canvas: Decide cards (buttons)
    document.querySelectorAll('.rs-card[data-rq-act="choose"], .xc-picks .rs-card').forEach(b => { const x = byId(b.dataset.id) || o.all.find(y => y.label === ((b.querySelector('.rs-card-title') || {}).textContent || '').trim()); if(x) put(b, x.label, 'start', 'opt-img--card', true); });
    // Output and canvas: compare tables — one column per kept option
    // (compare tables: no photos — the option's name is enough there)
    // canvas template: option post-its
    document.querySelectorAll(`#xc-world [data-pi^="${o.k}:"]`).forEach(pi => { const x = byId(pi.dataset.pi.slice(o.k.length + 1)), top = pi.querySelector('.xc-pi-top'); if(x) put(pi, x.label, top ? top.nextSibling : 'start', 'opt-img--pi'); });
    // canvas: option ideas (the same post-it they become)
    document.querySelectorAll(`#xc-world [data-idea^="${o.k}:"] .xc-idea-b`).forEach(b => { const x = byId(b.closest('[data-idea]').dataset.idea.slice(o.k.length + 1)); if(x) put(b, x.label, b.querySelector('.xc-idea-t') ? b.querySelector('.xc-idea-t').nextSibling : 'start', 'opt-img--pi'); });
    // canvas: cards made from an option (dragged out of the graph or Text view)
    document.querySelectorAll('#xc-world [data-card] .xc-w-b').forEach(b => { const t = ((b.querySelector('.xc-card-t') || {}).textContent || '').replace(/^★\s*/, '').trim(), x = o.all.find(y => y.label === t); if(x) put(b, x.label, 'start', 'opt-img--pi'); });
  }
  // ---------- the node's result document (Result step) ----------
  // User test: "Pick a hotel" ended in a document with only the hotel's name. The same photo as in the steps now sits
  // under each picked option's heading (a decision), or in a row over the table of what was collected (a Pick step).
  // It is part of the document on screen, so Export as PDF prints it too.
  function docPhoto(box, label, name){
    if(name && !box.querySelector(':scope > .rs-doc-photo-n')){ const n = document.createElement('p'); n.className = 'rs-doc-photo-n'; n.textContent = nameOf(label); box.appendChild(n); }
    put(box, label, null, 'opt-img--doc');
  }
  function docPhotos(o){
    const doc = document.querySelector('#exec-view .rs-doc .rs-nodedoc'); if(!doc) return;
    if(o.k === 'o'){
      doc.querySelectorAll('h2, h3, h4').forEach(h => { // the renderer writes "## " as h3
        const t = h.textContent.trim(), x = o.all.find(y => y.label === t || nameOf(y.label) === nameOf(t)); if(!x) return;
        let box = h.nextElementSibling;
        if(!box || !box.matches('.rs-doc-photo')){ box = document.createElement('div'); box.className = 'rs-doc-photo'; box.setAttribute('contenteditable', 'false'); h.after(box); }
        docPhoto(box, x.label, false);
      });
      return;
    }
    const items = o.kept.slice(0, 6), tb = doc.querySelector('table'), at = tb || doc.querySelector('ul'); if(!items.length || !at) return;
    let row = at.previousElementSibling;
    if(!row || !row.matches('.rs-doc-photos')){ row = document.createElement('div'); row.className = 'rs-doc-photos'; row.setAttribute('contenteditable', 'false'); at.before(row); }
    items.forEach(x => {
      let box = [...row.children].find(c => c.dataset.label === x.label);
      if(!box){ box = document.createElement('div'); box.className = 'rs-doc-photo'; box.dataset.label = x.label; row.appendChild(box); }
      docPhoto(box, x.label, true);
    });
  }
  // ---------- logos (products, tools, companies) ----------
  // The product's own website: Wikipedia's article for it → Wikidata "official website"; else a guess (<first word>.com).
  // The logo is that site's icon (favicon service). Shown only when the article is about it and a real icon comes back.
  const logoCache = new Map(); // label → { src, domain } | null | Promise
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch(e){ return ''; } };
  // The brand is the option's leading name: "ANA nonstop to Haneda" → "ANA", "Japan Airlines nonstop" → "Japan Airlines",
  // "Salesforce Sales Cloud" → all of it (it stops at the first ordinary lower-case word).
  function brandOf(label){
    const toks = String(label || '').replace(/[,(–—:].*$/, '').trim().split(/\s+/), out = [];
    for(const t of toks){ if(/^[\p{Lu}\p{N}]/u.test(t) || /[\p{Lu}]/u.test(t.slice(1))) out.push(t); else break; }
    return out.join(' ');
  }
  const isAcronym = b => /^[\p{Lu}\p{N}&]{2,5}$/u.test(b);
  // what the choice is about, to point the search at the right thing ("ANA" + airline → All Nippon Airways)
  function kindHint(){
    try { const st = exStep(EX.cur), t = `${st.title} ${(st.nodeInfo || {}).purpose || ''}`;
      return /\b(flight|flights|airline|airlines|fly|carrier)\b/i.test(t) ? 'airline' : /\b(crm|software|tool|tools|app|apps|platform|saas|product|vendor)\b/i.test(t) ? 'software' : /\b(bank|card|insurer|insurance)\b/i.test(t) ? 'company' : ''; } catch(e){ return ''; }
  }
  const NOT_A_SITE = /(^|\.)(wikipedia|wikimedia|wikidata|wiki|fandom|google|facebook|linkedin|twitter|x)\.[a-z.]+$/i; // never a logo source
  async function officialSite(brand){
    const hint = kindHint(), q = hint ? `${brand} ${hint}` : brand;
    const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=4&prop=pageprops&ppprop=wikibase_item`);
    if(!r.ok) return [];
    const bw = words(brand), pages = Object.values(((await r.json()).query || {}).pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
    const initials = t => String(t).split(/\s+/).filter(Boolean).map(x => x[0]).join('').toUpperCase();
    // the article must be about the brand: its title carries the brand's words, or (a code like "ANA") its initials match,
    // or — a code with a hint — it's the top result for "<code> <kind>"
    // the title must be (nearly) the brand itself — a one-word brand allows no other word, a longer one at most one (user
    // test: "Shape" matched the film "The Shape of Water" and showed its distributor's logo)
    const tw = x => words(x.title), extra = x => tw(x).filter(w => !bw.includes(w)).length;
    const strongOf = x => (bw.length && bw.every(w => tw(x).includes(w)) && extra(x) <= (bw.length > 1 ? 1 : 0)) || (isAcronym(brand) && initials(x.title) === brand.toUpperCase());
    // a code with a hint: the top result counts if its title says what kind it is ("JL airline" → Japan Airlines)
    const weakOf = (x, i) => isAcronym(brand) && hint && i === 0 && new RegExp(hint === 'airline' ? '\\bair(line|lines|ways)?\\b' : hint, 'i').test(x.title);
    const ok = x => x.pageprops && x.pageprops.wikibase_item && !/^(list of|lists of|outline of|history of)\b/i.test(x.title);
    const exact = x => words(x.title).join(' ') === bw.join(' ') || x.title.toLowerCase() === brand.toLowerCase(); // the article named after the brand first
    // candidates in order — named exactly after the brand (not for a code: "Ana", "JL" are name / disambiguation pages),
    // then carrying the brand, then a code's top result — and the first one that lists a website wins
    const cands = [...new Set([].concat(isAcronym(brand) ? [] : pages.filter(x => ok(x) && exact(x)), pages.filter(x => ok(x) && strongOf(x) && !(isAcronym(brand) && exact(x))), pages.filter((x, i) => ok(x) && weakOf(x, i))))].slice(0, 3);
    for(const p of cands){
      const qid = p.pageprops.wikibase_item, d = await (await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&format=json&origin=*`)).json();
      // every official website listed (the first one may have no icon — e.g. a regional site)
      const c = (((d.entities || {})[qid] || {}).claims || {}).P856 || [];
      const sites = [...new Set(c.map(x => x && x.mainsnak && x.mainsnak.datavalue && x.mainsnak.datavalue.value).filter(Boolean).map(host).filter(h => h && !NOT_A_SITE.test(h)))].slice(0, 4);
      if(sites.length) return sites;
    }
    return [];
  }
  // the brand's site: the whole brand, else its first word when that's a real name ("Salesforce" of "Salesforce Sales Cloud")
  async function siteFor(brand){
    let ds = []; try { ds = await officialSite(brand); } catch(e){}
    const first = brand.split(/\s+/)[0];
    if(!ds.length && brand.includes(' ') && first.length >= 5 && /[\p{Lu}]/u.test(first)) { try { ds = await officialSite(first); } catch(e){} }
    for(const d of ds){ let src = await iconFor(d); if(src) return { domain: d, src }; const bare = d.split('.').slice(-3).join('.').replace(/^(www|global|en)\./, ''); if(bare !== d && (src = await iconFor(bare))) return { domain: bare, src }; }
    return null;
  }
  const iconOk = src => new Promise(res => { const im = new Image(); im.referrerPolicy = 'no-referrer'; im.onload = () => res(im.naturalWidth > 16); im.onerror = () => res(false); im.src = src; setTimeout(() => res(false), 6000); }); // the service's "no icon" globe is 16 px
  const iconSrc = d => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64`;
  // only Google's icon service: its "no icon" answer is recognisable (16 px); others answer with a look-alike placeholder
  async function iconFor(d){ return await iconOk(iconSrc(d)) ? iconSrc(d) : ''; }
  function logo(label){
    if(logoCache.has(label)) return logoCache.get(label);
    const brand = brandOf(label);
    if(!brand){ logoCache.set(label, null); return null; }
    const job = (async () => {
      const site = await siteFor(brand); // only from an article that is about the brand (see officialSite), with a real icon
      return site || null; // no guessed "<word>.com" (user test: "Shape" → shape.com showed an unrelated brand's logo)
    })().then(ok => { logoCache.set(label, ok); if(ok) schedule(); return ok; }).catch(() => { logoCache.set(label, null); return null; });
    logoCache.set(label, job); return job;
  }
  function putLogo(host, label, before){
    if(!host || !label) return;
    const cur = host.querySelector(':scope > .opt-logo'); if(cur && cur.dataset.label === label) return;
    const hit = logo(label); if(cur) cur.remove();
    if(!hit || typeof hit.then === 'function') return;
    const im = document.createElement('img'); im.className = 'opt-logo'; im.dataset.label = label; im.src = hit.src; im.alt = ''; im.width = 18; im.height = 18;
    im.referrerPolicy = 'no-referrer'; im.title = `Logo: ${hit.domain}`; im.setAttribute('contenteditable', 'false');
    host.insertBefore(im, before === undefined ? host.firstChild : before);
  }
  function decorateLogos(o){
    const byId = id => o.all.find(x => x.id === id), byName = t => o.all.find(y => y.label === String(t || '').replace(/^★\s*/, '').trim());
    const own = el => [...el.childNodes].filter(n => !(n.nodeType === 1 && n.classList.contains('opt-logo'))).map(n => n.textContent).join('').trim();
    document.querySelectorAll('.rs-item .rs-keep[data-rq-act="keep-o"]').forEach(b => { const x = byId(b.dataset.id), t = b.parentNode.querySelector('.rs-item-title'); if(x && t) putLogo(t, x.label); });
    document.querySelectorAll('.rs-card .rs-card-title').forEach(t => { const x = byName(own(t)); if(x) putLogo(t, x.label); });
    document.querySelectorAll('table.rs-matrix thead th, table.xc-matrix thead th, table.rs-final-table td:first-child b').forEach(t => { const x = byName(own(t)); if(x) putLogo(t, x.label); });
    document.querySelectorAll('#xc-world [data-pi^="o:"] .xc-pi-top').forEach(top => { const x = byId(top.closest('[data-pi]').dataset.pi.slice(2)), grip = top.querySelector('.xc-grip'); if(x) putLogo(top, x.label, grip ? grip.nextSibling : top.firstChild); });
    document.querySelectorAll('#xc-world [data-card] .xc-card-t').forEach(t => { const x = byName(own(t)); if(x) putLogo(t, x.label); });
    document.querySelectorAll('#xc-world [data-idea^="o:"] .xc-idea-t').forEach(t => { const x = byId(t.closest('[data-idea]').dataset.idea.slice(2)); if(x) putLogo(t, x.label); });
  }
  let timer = 0;
  const run = () => { obs.disconnect(); try { decorate(); } finally { obs.observe(document.body, { childList: true, subtree: true }); } };
  function schedule(){ clearTimeout(timer); timer = setTimeout(run, 120); } // after a lookup finishes
  // on a redraw, put known photos / logos back straight away (before the page paints), so nothing jumps or flickers
  const obs = new MutationObserver(() => run());
  const start = () => { obs.observe(document.body, { childList: true, subtree: true }); schedule(); };
  if(document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  window.OptionImages = { decorate, lookup, gallery, placeHint, nameOf, logo, brandOf, officialSite, siteFor };
})();
