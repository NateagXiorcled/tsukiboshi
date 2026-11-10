// Liens Netflix venant d'AniList : souvent une ancienne adresse (WiMovie), une page d'un autre pays,
// ou un titre plus disponible en France → Netflix ouvre l'accueil au lieu de la série.
// Au clic, on vérifie le lien (service worker, avec ta session) et on bascule sur la recherche Netflix du titre si besoin.
export function netflixId(url) {
  const s = String(url || '');
  return (s.match(/netflix\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:title|watch)\/(\d+)/i) || s.match(/WiMovie\/(?:[^/?#]+\/)?(\d+)/i) || s.match(/[?&](?:movieid|jbv)=(\d+)/i) || [])[1] || '';
}
export const netflixSearch = (title) => `https://www.netflix.com/search?q=${encodeURIComponent(title || '')}`;

// liens marqués data-nf-title="…" : vérifiés au clic
export function installNetflixLinks(root = document) {
  root.addEventListener('click', async (e) => {
    const a = e.target.closest && e.target.closest('a[data-nf-title]');
    if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    let url = a.href;
    try {
      const r = await chrome.runtime.sendMessage({ type: 'netflixResolve', url: a.href, title: a.dataset.nfTitle });
      if (r && r.url) url = r.url;
    } catch {}
    chrome.tabs.create({ url });
  }, true);
}
