// components/place-images.js — a real image of one specific, named thing: a place (attraction, market, park, district…),
// a dish, or a named work or product (a video game, film, book…)
// for a slide, or the subject of a Chat question ("what does Mount Fuji look like?", "what is ramen?").
//
// APPROVED EXCEPTION (same as the Map output): this loads remote images, which the prototype rules otherwise forbid.
// Only real photos found by a lookup are used — never an image the AI makes up — and every photo is credited with a
// link to where it came from. When nothing is found, nothing is shown.
//
// Order:
//   1. Tavily image search — only when Tavily is the web search chosen in AI settings (it returns image results).
//   2. Wikipedia's lead image for the best-matching article (public API, no key; credit links to the article).
//      Any licence is accepted (pilicense=any), so named works — a game's cover, a film poster — are found too, not
//      only free photos. Those are often used by Wikipedia under fair use: fine for this prototype with the credit, but
//      a production build needs a licensed image source.
//      Thai / Japanese names are looked up on that language's Wikipedia first, then English.
//
//   const img = await PlaceImages.find('Tsukiji Outer Market, Tokyo');  // → { url, credit, href, title } or null
(function(){
  'use strict';
  const cache = new Map();
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch(e){ return ''; } };
  const langsOf = q => /[฀-๿]/.test(q) ? ['th', 'en'] : /[぀-ヿ一-鿿]/.test(q) ? ['ja', 'en'] : ['en'];

  async function viaTavily(q){
    const s = window.AI && AI.settings;
    if(!s || s.searchProvider !== 'tavily' || !s.tavilyKey) return null;
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${s.tavilyKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `${q} photo`, search_depth: 'basic', max_results: 3, include_images: true, include_answer: false })
    });
    if(!r.ok) return null;
    const data = await r.json(), img = (data.images || []).map(x => typeof x === 'string' ? x : x && x.url).find(u => /^https:\/\//.test(u || ''));
    return img ? { url: img, credit: `${host(img)} · via Tavily search`, href: img, title: q } : null;
  }

  async function viaWikipedia(q){
    for(const lang of langsOf(q)){
      const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=3&prop=pageimages|info&piprop=thumbnail&pithumbsize=960&pilicense=any&inprop=url`;
      const r = await fetch(url); if(!r.ok) continue;
      const pages = Object.values(((await r.json()).query || {}).pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
      const p = pages.find(x => x.thumbnail && x.thumbnail.source); // the best-ranked article that has a photo
      if(p) return { url: p.thumbnail.source, credit: `Wikipedia · ${p.title}`, href: p.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title)}`, title: p.title };
    }
    return null;
  }

  // Wikimedia Commons photos (public API, no key) — individual hotels, venues and buildings that have no Wikipedia
  // article often have photos here. Returns the top few image files ({ url, credit, href, title }) for the caller to
  // check against what it is looking for (a search here matches loosely).
  const commonsCache = new Map();
  function commons(q){
    q = String(q || '').trim(); if(!q) return Promise.resolve([]);
    if(commonsCache.has(q)) return commonsCache.get(q);
    const job = (async () => {
      const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(q)}&gsrlimit=6&prop=imageinfo&iiprop=url|mime&iiurlwidth=800`;
      const r = await fetch(url); if(!r.ok) return [];
      return Object.values(((await r.json()).query || {}).pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0))
        .map(p => ({ p, ii: (p.imageinfo || [])[0] })).filter(x => x.ii && /^image\/(jpeg|png|webp)$/.test(x.ii.mime || ''))
        .map(({ p, ii }) => { const name = p.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''); return { url: ii.thumburl || ii.url, credit: `Wikimedia Commons · ${name}`, href: ii.descriptionurl || ii.url, title: name }; });
    })().catch(e => { console.warn('[PlaceImages] commons', e); return []; });
    commonsCache.set(q, job); return job;
  }
  async function find(q){
    q = String(q || '').trim(); if(!q) return null;
    if(cache.has(q)) return cache.get(q);
    const job = (async () => {
      for(const fn of [viaTavily, viaWikipedia]){
        try { const hit = await fn(q); if(hit) return hit; } catch(e){ console.warn('[PlaceImages]', fn.name, e); }
      }
      return null;
    })();
    cache.set(q, job);
    return job;
  }

  window.PlaceImages = { find, commons };
})();
