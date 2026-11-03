// components/chat-images.js — a photo in Chat when the user asks what something is or what it looks like
// ("What does Mount Fuji look like?", "What is ramen?", "Show me a picture of Kinkaku-ji", "ราเมนคืออะไร").
//
// Works on every Chat in the prototypes (Entry / Output POC chat and the Workstream nodes' chat): it reads the
// question when it is sent from the Chat box, then adds the photo under the AI's answer once that answer appears.
// The photo comes from components/place-images.js (approved remote-image exception — real photos only, credited,
// nothing shown when none is found). A photo is only shown when the article found matches what was asked.
(function(){
  'use strict';
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  // Things that aren't pictures: plans, prices, times, "the difference", pronouns…
  const ABSTRACT = /\b(it|this|that|they|them|these|those|plan|budget|price|prices|cost|costs|time|times|schedule|best|difference|meaning|purpose|step|steps|output|result|reason|way|ways|option|options|idea|ideas|weather|distance|policy|rule|rules)\b/i;

  // The thing the question is about, or '' when it isn't a "what is / what does it look like" question.
  function subjectOf(text){
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    const pats = [
      /what (?:does|do|did) (?:a |an |the )?(.+?) look like/i,
      /(?:show me|send me|can i see|let me see)(?: a| an| some| the)?(?: (?:picture|photo|image|pic)s?(?: of)?)? (?:a |an |the )?(.+)/i,
      /(?:picture|photo|image|pic)s? of (?:a |an |the )?(.+)/i,
      /^(?:what|who) (?:is|are|was|were) (?:a |an |the )?(.+?)[?？.!]*$/i,
      /^(.+?)\s*(?:คืออะไร|คือ อะไร|หน้าตาเป็นยังไง|หน้าตาเป็นอย่างไร|หน้าตาแบบไหน|เป็นยังไง)/,
      /(?:ขอดู)?รูป(?:ภาพ)?(?:ของ)?\s*(.+)/,
      /^(.+?)(?:とは|って何|ってなに)/
    ];
    for(const p of pats){
      const m = t.match(p); if(!m) continue;
      const s = m[1].replace(/[“”"'‘’「」『』]/g, '').replace(/[?？.!。]+$/, '').trim();
      if(!s || s.length > 60 || s.split(/\s+/).length > 6 || ABSTRACT.test(s)) return '';
      return s;
    }
    return '';
  }
  // The article found must be about what was asked (at least one word in common), so a vague question gets no random photo.
  function matches(subject, hit){
    const words = x => String(x || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1);
    const a = new Set(words(subject)), b = words(hit.title);
    if(/[^\x00-\x7F]/.test(subject) && !a.size) return true; // Thai / Japanese: the language's own Wikipedia found it
    return b.some(w => a.has(w)) || [...a].some(w => String(hit.title || '').toLowerCase().includes(w));
  }

  let pending = null;
  function asked(text){
    const subject = subjectOf(text);
    pending = subject && window.PlaceImages ? { subject, at: Date.now(), job: PlaceImages.find(subject) } : null;
  }
  // read the question as it is sent (button or Enter), before the box is cleared
  document.addEventListener('click', e => { if(e.target.closest && e.target.closest('#uib-send')){ const i = document.getElementById('uib-input'); if(i) asked(i.value); } }, true);
  document.addEventListener('keydown', e => { if(e.target && e.target.id === 'uib-input' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) asked(e.target.value); }, true);

  // the first answer that appears after the question gets the photo
  const watch = () => new MutationObserver(muts => {
    if(!pending) return;
    if(Date.now() - pending.at > 120000){ pending = null; return; }
    for(const m of muts) for(const n of m.addedNodes){
      if(!(n instanceof HTMLElement) || !n.matches('.msg.assistant')) continue;
      const p = pending; pending = null; attach(n, p); return;
    }
  }).observe(document.body, { childList: true, subtree: true });
  if(document.body) watch(); else document.addEventListener('DOMContentLoaded', watch); // loaded in <head>

  async function attach(msg, p){
    let hit = null; try { hit = await p.job; } catch(e){}
    if(!hit || !matches(p.subject, hit) || !msg.isConnected || msg.querySelector('.msg-img')) return;
    msg.insertAdjacentHTML('beforeend', `<figure class="msg-img"><img src="${E(hit.url)}" alt="${E(hit.title || p.subject)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"><figcaption>Photo: <a href="${E(hit.href || hit.url)}" target="_blank" rel="noopener">${E(hit.credit || 'source')}</a></figcaption></figure>`);
  }

  window.ChatImages = { subjectOf }; // for testing
})();
