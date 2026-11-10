// erreurs de la page → page de diagnostic
window.addEventListener('error', (e) => chrome.runtime.sendMessage({ type: 'logError', where: 'Ma liste', msg: (e.error && e.error.stack) || e.message }).catch(() => {}));
window.addEventListener('unhandledrejection', (e) => chrome.runtime.sendMessage({ type: 'logError', where: 'Ma liste', msg: String((e.reason && e.reason.stack) || e.reason) }).catch(() => {}));
import { seriesProgress } from '../lib/progress.js';
import { frenchGenres } from '../lib/artwork.js';
import { platformOfLink } from '../lib/anilist.js';
import { installNetflixLinks } from '../lib/nflink.js';
import { initLayout, isHorizontal } from '../lib/layout.js';
// tsukiboshi — page « Ma liste »
const PLATFORMS = { netflix: 'Netflix', crunchyroll: 'Crunchyroll', adn: 'ADN', disney: 'Disney+', prime: 'Prime Video' };
const COLORS = { netflix: '#e50914', crunchyroll: '#f47521', adn: '#0099e5', disney: '#3a67ff', prime: '#00a8e1' };
const STATUS = {
  progress: { label: 'En cours', color: 'var(--s-progress)' },
  done: { label: 'Vu', color: 'var(--s-done)' },
  list: { label: 'Ajouté à la liste', color: 'var(--s-list)' },
  dropped: { label: 'Abandonné', color: 'var(--s-dropped)' },
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// lien sûr : uniquement http(s)
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
const keyOf = (platform, title) => `${platform}|${norm(title)}`;
const fmtN = (n) => n.toLocaleString('fr-FR');

let data = { entries: {}, shows: {}, wishlist: {}, meta: {}, art: {}, newEps: {}, genres: {}, suites: [] };
let shows = [];
const view = { status: 'all', platform: 'all', kind: 'all', q: '', sort: 'recent', genre: '', decade: '' };
// type de titre : animé, série ou film (sous-onglets)
const kindOf = (s) => (s.isMovie ? 'movie' : isAnime(s) ? 'anime' : 'series');
const inScope = (s) => (view.platform === 'all' || s.platform === view.platform) && (view.kind === 'all' || kindOf(s) === view.kind);
let openKey = null;

// ---------- Données ----------
async function load() {
  const r = await chrome.storage.local.get(['entries', 'shows', 'wishlist', 'meta', 'art', 'newEps', 'genres', 'suites']);
  data = { entries: r.entries || {}, shows: r.shows || {}, wishlist: r.wishlist || {}, meta: r.meta || {}, art: r.art || {}, newEps: r.newEps || {}, genres: r.genres || {}, suites: (r.suites && r.suites.list) || [] };
  shows = buildShows();
  render();
  if (openKey) openShow(openKey, true);
}

function buildShows() {
  const map = new Map();
  for (const e of Object.values(data.entries)) {
    const k = keyOf(e.platform, e.title);
    if (!map.has(k)) map.set(k, { key: k, title: e.title, platform: e.platform, items: [] });
    map.get(k).items.push(e);
  }
  for (const w of Object.values(data.wishlist)) {
    if (!map.has(w.key)) map.set(w.key, { key: w.key, title: w.title, platform: w.platform, items: [], added: w.added });
    else map.get(w.key).added = w.added;
  }
  return [...map.values()].map((s) => {
    s.items.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
    const dated = s.items.filter((e) => e.date);
    s.last = dated.length ? dated[0].date : null;
    s.first = dated.length ? dated[dated.length - 1].date : null;
    s.lastItem = s.items[0] || null;
    s.episodes = new Set(s.items.map((e) => norm(e.episode))).size;
    s.secs = s.items.reduce((t, e) => t + (e.seconds || 0), 0);
    s.image = (s.items.find((e) => e.image) || {}).image || '';
    // ADN ne donne que la série (jamais l'épisode) : ce n'est pas un film
    s.isMovie = s.platform !== 'adn' && s.items.length > 0 && s.items.every((e) => !e.episode);
    s.meta = data.meta[s.key] || null;
    s.art = data.art[s.key] || null;
    s.custom = (data.shows[s.key] && data.shows[s.key].poster) || '';
    // image : choisie à la main > affiche Crunchyroll > affiche trouvée (AniList / TVmaze / iTunes)
    s.poster = s.custom || (s.meta && s.meta.poster) || (s.art && s.art.poster) || '';
    s.wide = (s.meta && s.meta.wide) || (s.art && s.art.wide) || '';
    s.prog = s.meta && !s.isMovie ? seriesProgress(s.items, s.meta) : null;
    s.auto = !s.items.length ? 'list' : s.isMovie || (s.prog && s.prog.complete) ? 'done' : 'progress';
    s.status = (data.shows[s.key] && data.shows[s.key].status) || s.auto;
    s.genres = (data.genres[s.key] && data.genres[s.key].genres) || [];
    s.year = (data.genres[s.key] && data.genres[s.key].year) || null;
    s.rating = (data.shows[s.key] && data.shows[s.key].rating) || 0;
    s.fav = !!(data.shows[s.key] && data.shows[s.key].fav);
    s.review = (data.shows[s.key] && data.shows[s.key].review) || '';
    return s;
  });
}

async function setStatus(key, status) {
  const s = shows.find((x) => x.key === key);
  const next = { ...data.shows };
  const cur = { ...(next[key] || {}) };
  if (!status || (s && status === s.auto)) delete cur.status;
  else cur.status = status;
  if (Object.keys(cur).some((k) => k !== 'updated')) next[key] = { ...cur, updated: Date.now() };
  else delete next[key];
  await chrome.storage.local.set({ shows: next });
}

// note (1 à 5), favori, avis : enregistrés avec les autres choix manuels
async function patchShow(key, patch) {
  const next = { ...data.shows };
  const cur = { ...(next[key] || {}), ...patch };
  for (const k of Object.keys(patch)) if (cur[k] == null || cur[k] === '' || cur[k] === 0 || cur[k] === false) delete cur[k];
  delete cur.updated;
  if (Object.keys(cur).length) next[key] = { ...cur, updated: Date.now() };
  else delete next[key];
  data.shows = next;
  await chrome.storage.local.set({ shows: next });
}
const STAR = '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 17l-5.3 2.8 1.1-5.9L3.4 9.8l6-.8z"/></svg>';
const HEART = '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-9.2-8.6C1.3 8.4 3 5 6.3 5c2 0 3.3 1.1 4 2.3h3.4C14.4 6.1 15.7 5 17.7 5 21 5 22.7 8.4 21.2 11.4 19 15.6 12 20 12 20z"/></svg>';

// ---------- Affichage ----------
function when(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if (diff <= 0) return "aujourd'hui";
  if (diff === 1) return 'hier';
  if (diff < 7) return `il y a ${diff} jours`;
  if (diff < 60) { const w = Math.round(diff / 7); return `il y a ${w} semaine${w > 1 ? 's' : ''}`; }
  if (diff < 365) return `il y a ${Math.round(diff / 30)} mois`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
const dateTxt = (e) => {
  if (!e.date) return 'date inconnue';
  const d = new Date(e.date);
  const day = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return e.hasTime ? `${day} · ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : day;
};
const hours = (secs) => (secs >= 3600 ? `${(Math.round(secs / 360) / 10).toLocaleString('fr-FR')} h` : secs ? `${Math.round(secs / 60)} min` : '—');

function hue(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
function placeholder(title) {
  const h = hue(title);
  const ini = title.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  return `<div class="ph" style="background:linear-gradient(135deg,hsl(${h} 45% 34%),hsl(${(h + 40) % 360} 50% 18%))">${esc(ini)}</div>`;
}
function img(src, title) {
  return `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-title="${esc(title)}">`;
}
function visual(s) {
  const src = s.poster || s.image || s.wide;
  return src ? img(src, s.title) : placeholder(s.title);
}
// affichage horizontal : image large, sinon l'affiche sur fond flou
function wideVisual(s) {
  const src = (s.custom ? s.poster : s.wide) || s.poster || s.image;
  return src ? blurBg(src) + img(src, s.title) : placeholder(s.title);
}
const blurBg = (src) => `<div class="blur" style="background-image:url('${esc(safeUrl(src).replace(/['()\\]/g, encodeURIComponent))}')"></div>`;
function heroVisual(s) {
  const src = (s.custom ? '' : s.wide) || s.poster || s.image;
  return src ? blurBg(src) + img(src, s.title) : placeholder(s.title);
}
const epLabel = (n) => (n ? `${n.season != null ? `S${n.season} ` : ''}E${n.ep}` : '');
// Cadrage : si l'image n'a pas le format de sa case (logo, image en largeur…), on l'affiche en entier avec des bandes noires
function fitImage(img) {
  if (!img.naturalWidth || !img.naturalHeight) return;
  const box = img.closest('.thumb, .hero, .art-pick');
  if (!box) return;
  const want = box.classList.contains('hero') || box.classList.contains('wide') ? box.clientWidth / Math.max(1, box.clientHeight) : 2 / 3;
  const ratio = img.naturalWidth / img.naturalHeight;
  const tolerance = box.classList.contains('hero') ? 1.08 : 1.3; // grande image : on ne coupe presque rien
  img.classList.toggle('fit', Math.abs(Math.log(ratio / want)) > Math.log(tolerance));
}
document.addEventListener('load', (e) => { if (e.target.tagName === 'IMG') fitImage(e.target); }, true);
const fitAll = () => document.querySelectorAll('.thumb img, .hero img').forEach((i) => i.complete && fitImage(i));

// image cassée → vignette de remplacement
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName !== 'IMG') return;
  // affiche Allociné en grande taille refusée → taille normale
  const src = img.getAttribute('src') || '';
  if (/acsta\.net\/c_620_840\//.test(src)) { img.src = src.replace('/c_620_840/', '/c_310_420/'); return; }
  if (img.dataset.title) img.outerHTML = placeholder(img.dataset.title);
}, true);

function filtered() {
  const q = norm(view.q);
  let list = shows.filter((s) =>
    (view.status === 'all' || (view.status === 'fav' ? s.fav : s.status === view.status)) &&
    inScope(s) &&
    (!view.genre || s.genres.includes(view.genre)) &&
    (!view.decade || decadeOf(s.year) === view.decade) &&
    (!q || norm(s.title).includes(q)));
  const by = {
    recent: (a, b) => (b.last ?? b.added ?? 0) - (a.last ?? a.added ?? 0),
    alpha: (a, b) => a.title.localeCompare(b.title, 'fr'),
    count: (a, b) => b.episodes - a.episodes,
    time: (a, b) => b.secs - a.secs,
    rating: (a, b) => (b.rating || 0) - (a.rating || 0) || b.fav - a.fav || (b.last ?? 0) - (a.last ?? 0),
  }[view.sort];
  return list.sort(by);
}

const decadeOf = (y) => (!y ? '' : y < 1990 ? 'old' : String(Math.floor(y / 10) * 10));
const DECADE_LABEL = (d) => (d === 'old' ? 'Avant 1990' : `Années ${d}`);
// listes « Genre » et « Époque », avec le nombre de titres (selon la plateforme choisie)
function renderSelects() {
  const base = shows.filter(inScope);
  const gc = new Map(), dc = new Map();
  for (const s of base) {
    for (const g of s.genres) gc.set(g, (gc.get(g) || 0) + 1);
    const d = decadeOf(s.year);
    if (d) dc.set(d, (dc.get(d) || 0) + 1);
  }
  const gs = [...gc].sort((a, b) => b[1] - a[1]);
  $('genre').hidden = !gs.length && !view.genre;
  $('genre').innerHTML = `<option value="">Tous les genres</option>` + gs.map(([g, n]) => `<option value="${esc(g)}"${view.genre === g ? ' selected' : ''}>${esc(g)} (${fmtN(n)})</option>`).join('');
  const ds = [...dc].sort((a, b) => (b[0] === 'old' ? -1 : a[0] === 'old' ? 1 : +b[0] - +a[0]));
  $('decade').hidden = !ds.length && !view.decade;
  $('decade').innerHTML = `<option value="">Toutes les époques</option>` + ds.map(([d, n]) => `<option value="${d}"${view.decade === d ? ' selected' : ''}>${DECADE_LABEL(d)} (${fmtN(n)})</option>`).join('');
}
$('genre').onchange = (e) => { view.genre = e.target.value; render(); };
$('decade').onchange = (e) => { view.decade = e.target.value; render(); };

function renderChips() {
  renderSelects();
  const byPlat = shows.filter((s) => view.platform === 'all' || s.platform === view.platform);
  const kinds = [['all', 'Tout'], ['anime', 'Animés'], ['series', 'Séries'], ['movie', 'Films']].map(([id, label]) => [id, label, id === 'all' ? byPlat.length : byPlat.filter((s) => kindOf(s) === id).length]);
  $('kindTabs').innerHTML = kinds.filter(([id, , n]) => id === 'all' || n || view.kind === id).map(([id, label, n]) =>
    `<button class="kind ${view.kind === id ? 'on' : ''}" data-kind="${id}" role="tab" aria-selected="${view.kind === id}">${label}<span class="n">${fmtN(n)}</span></button>`).join('');
  const base = shows.filter(inScope);
  const n = (st) => base.filter((s) => s.status === st).length;
  const items = [['all', 'Tout', base.length], ['progress', 'En cours', n('progress')], ['done', 'Vu', n('done')], ['list', 'Ajouté à la liste', n('list')]];
  const dropped = n('dropped');
  if (dropped || view.status === 'dropped') items.push(['dropped', 'Abandonné', dropped]);
  const favs = base.filter((s) => s.fav).length;
  if (favs || view.status === 'fav') items.push(['fav', 'Favoris', favs]);
  $('statusChips').innerHTML = items.map(([id, label, count]) =>
    `<button class="chip ${view.status === id ? 'on' : ''}" data-status="${id}">${id === 'fav' ? `<span class="heart">${HEART}</span>` : id !== 'all' ? `<span class="dot" style="background:${STATUS[id].color}"></span>` : ''}${label}<span class="n">${fmtN(count)}</span></button>`).join('');

  const present = Object.keys(PLATFORMS).filter((p) => shows.some((s) => s.platform === p));
  $('platformChips').innerHTML = present.length > 1
    ? [`<button class="chip ${view.platform === 'all' ? 'on' : ''}" data-platform="all">Toutes</button>`,
       ...present.map((p) => `<button class="chip ${view.platform === p ? 'on' : ''}" data-platform="${p}"><span class="dot" style="background:${COLORS[p]}"></span>${PLATFORMS[p]}</button>`)].join('')
    : '';
}

function card(s) {
  const st = STATUS[s.status];
  const li = s.lastItem;
  const where = !li ? 'Pas encore commencé' : s.isMovie ? 'Film' : li.episode || '—';
  let bar = '';
  if (s.prog && s.prog.total) {
    bar = `<div class="bar"><i style="width:${Math.round((s.prog.watched / s.prog.total) * 100)}%;background:${st.color}"></i></div>`;
  } else {
    const prog = li && li.length && li.seconds ? Math.min(1, li.seconds / li.length) : li && li.progress != null ? li.progress : null;
    if (s.status === 'progress' && prog != null && prog < 0.97) bar = `<div class="bar"><i style="width:${Math.round(prog * 100)}%"></i></div>`;
  }
  const count = !s.items.length || s.isMovie ? '' : s.prog ? ` · ${s.prog.watched}/${s.prog.total} ép.` : ` · ${s.episodes} ép.`;
  const nextTxt = s.prog ? (s.prog.next ? `Prochain : ${epLabel(s.prog.next)}` : s.prog.upToDate ? 'À jour' : s.prog.complete ? 'Terminé' : '') : '';
  return `<article class="card" tabindex="0" data-key="${esc(s.key)}">
    <div class="thumb${isHorizontal() ? ' wide' : ''}">${isHorizontal() ? wideVisual(s) : visual(s)}<span class="badge" style="--s:${st.color}">${st.label}</span>${s.fav ? `<span class="fav-mark" title="Favori">${HEART}</span>` : ''}${bar}</div>
    <div class="meta">
      <div class="c-platform"><span class="dot" style="background:${COLORS[s.platform]}"></span>${PLATFORMS[s.platform]}${count}</div>
      <div class="c-title">${esc(s.title)}</div>
      ${s.rating ? `<div class="c-stars" aria-label="Ma note : ${s.rating} sur 5">${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= s.rating ? 'on' : ''}">${STAR}</i>`).join('')}</div>` : ''}
      <div class="c-where">${esc(where)}</div>
      <div class="c-when">${[nextTxt, s.last ? when(s.last) : s.added ? `ajouté ${when(s.added)}` : ''].filter(Boolean).join(' · ')}</div>
    </div>
  </article>`;
}

let renderGen = 0;
function render() {
  if (typeof kickArt === 'function' && shows.length) kickArt();
  renderChips();
  renderUpNext();
  renderSuites();
  const list = filtered();
  $('count').textContent = `${fmtN(list.length)} ${list.length > 1 ? 'titres' : 'titre'}`;
  const withPoster = shows.filter((x) => x.poster).length;
  $('srcBtn').hidden = !shows.length;
  $('srcBtn').textContent = `· Affiches : ${fmtN(withPoster)} / ${fmtN(shows.length)} — voir les sources`;
  // rendu par paquets pour rester fluide avec beaucoup de séries
  const grid = $('grid');
  const gen = ++renderGen; // un nouveau rendu annule le remplissage en cours de l'ancien
  grid.innerHTML = list.slice(0, 120).map(card).join('');
  let i = 120;
  const more = () => {
    if (gen !== renderGen || i >= list.length) return;
    grid.insertAdjacentHTML('beforeend', list.slice(i, i + 120).map(card).join(''));
    i += 120;
    requestAnimationFrame(more);
  };
  requestAnimationFrame(more);
  requestAnimationFrame(fitAll);
  $('empty').hidden = list.length > 0;
  $('emptyText').textContent = shows.length
    ? 'Aucun titre ne correspond à ces filtres.'
    : 'Importe ton historique depuis le popup de tsukiboshi pour remplir ta liste.';
}

// ---------- À suivre ----------
const PLAY_ICON = '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>';
const nfId = (s) => { for (const e of s.items) { const m = String(e.url || '').match(/netflix\.com\/(?:[a-z-]+\/)?(?:title|watch)\/(\d+)/i); if (m) return m[1]; } return ''; };
// où reprendre : épisode entamé → son lien exact ; sinon la page de la série (bouton « Reprendre » de la plateforme)
function resumeLink(s, partial) {
  const li = s.lastItem;
  if (partial && li && li.url) return li.url;
  if (s.platform === 'crunchyroll' && s.meta && s.meta.seriesId) return `https://www.crunchyroll.com/series/${s.meta.seriesId}`;
  if (s.platform === 'netflix' && nfId(s)) return `https://www.netflix.com/title/${nfId(s)}`;
  if (li && li.url) return li.url;
  // pas de lien enregistré (import par fichier) : recherche du titre sur la plateforme
  const q = encodeURIComponent(s.title);
  return {
    netflix: `https://www.netflix.com/search?q=${q}`,
    crunchyroll: `https://www.crunchyroll.com/search?q=${q}`,
    prime: `https://www.primevideo.com/search/ref=atv_sr_sug?phrase=${q}`,
    disney: `https://www.disneyplus.com/search?q=${q}`,
  }[s.platform] || '';
}
function upNextList() {
  if (!(view.status === 'all' || view.status === 'progress') || view.q || view.genre || view.decade) return [];
  return shows
    .filter((s) => s.status === 'progress' && s.items.length && !s.isMovie && s.last)
    .filter(inScope)
    .filter((s) => !(s.prog && !s.prog.next && (s.prog.complete || s.prog.upToDate)))
    .filter((s) => data.newEps[s.key] || !((data.shows[s.key] || {}).hideNext >= s.last)) // masqué jusqu'au prochain visionnage ou au prochain épisode
    // nouveaux épisodes en premier, puis le plus récemment regardé
    .sort((a, b) => (data.newEps[b.key] ? data.newEps[b.key].at : 0) - (data.newEps[a.key] ? data.newEps[a.key].at : 0) || b.last - a.last)
    .slice(0, 16);
}
function upCard(s) {
  const li = s.lastItem;
  const frac = li.length && li.seconds ? Math.min(1, li.seconds / li.length) : li.progress != null ? li.progress : null;
  const partial = frac != null && frac > 0.03 && frac < 0.9;
  const nw = data.newEps[s.key];
  const label = nw
    ? `<em>Nouveau</em> · ${epLabel({ season: nw.season, ep: nw.ep })}${nw.count > 1 ? ` (+${nw.count - 1})` : ''}`
    : partial
    ? `<em>Reprendre</em> · ${esc(li.episode || '')}`
    : s.prog && s.prog.next ? `<em>Prochain</em> · ${epLabel(s.prog.next)}` : `<em>Dernier vu</em> · ${esc(li.episode || '')}`;
  const src = s.wide || li.image || s.image || s.poster;
  const link = safeUrl(resumeLink(s, partial && !nw));
  const bar = partial && !nw ? `<div class="bar"><i style="width:${Math.round(frac * 100)}%"></i></div>` : '';
  return `<article class="up" data-key="${esc(s.key)}">
    <div class="thumb wide">${src ? blurBg(src) + img(src, s.title) : placeholder(s.title)}${bar}${nw ? '<span class="badge new">Nouveau</span>' : ''}
      ${link ? `<a class="play" href="${esc(link)}" target="_blank" rel="noopener" aria-label="Regarder ${esc(s.title)} sur ${PLATFORMS[s.platform]}"><span>${PLAY_ICON}</span></a>` : ''}
      <button class="hide-up" data-hide title="Retirer de « À suivre »" aria-label="Retirer de « À suivre »"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="meta" data-open tabindex="0" role="button" aria-label="Fiche de ${esc(s.title)}">
      <div class="c-platform"><span class="dot" style="background:${COLORS[s.platform]}"></span>${PLATFORMS[s.platform]}${s.prog ? ` · ${s.prog.watched}/${s.prog.total} ép.` : ''}</div>
      <div class="c-title">${esc(s.title)}</div>
      <div class="c-next">${label}</div>
      <div class="c-when">${when(s.last)}</div>
    </div>
  </article>`;
}
function renderUpNext() {
  const list = upNextList();
  $('upnext').hidden = !list.length;
  $('rail').innerHTML = list.map(upCard).join('');
}
$('rail').onkeydown = (e) => {
  const m = e.target.closest('[data-open]');
  if (m && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openShow(m.closest('.up').dataset.key); }
};
$('rail').onclick = async (e) => {
  const tile = e.target.closest('.up');
  if (!tile) return;
  if (e.target.closest('[data-hide]')) {
    const s = shows.find((x) => x.key === tile.dataset.key);
    const next = { ...data.shows, [tile.dataset.key]: { ...(data.shows[tile.dataset.key] || {}), hideNext: s ? s.last : Date.now(), updated: Date.now() } };
    tile.remove();
    if (!$('rail').children.length) $('upnext').hidden = true;
    await chrome.storage.local.set({ shows: next });
    return;
  }
  if (e.target.closest('[data-open]')) openShow(tile.dataset.key);
};

// ---------- Suites à voir ----------
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const searchUrl = (platform, q) => ({
  netflix: `https://www.netflix.com/search?q=${encodeURIComponent(q)}`,
  crunchyroll: `https://www.crunchyroll.com/search?q=${encodeURIComponent(q)}`,
  adn: `https://animationdigitalnetwork.com/video?search=${encodeURIComponent(q)}`,
  prime: `https://www.primevideo.com/search/ref=atv_sr_sug?phrase=${encodeURIComponent(q)}`,
  disney: `https://www.disneyplus.com/search?q=${encodeURIComponent(q)}`,
}[platform] || '');
// liens de streaming d'une suite, la plateforme habituelle en premier
function suiteLinks(x) {
  const seen = new Set(), out = [];
  for (const l of x.links || []) {
    const p = platformOfLink(l.site);
    const id = p || l.site;
    if (seen.has(id) || !safeUrl(l.url)) continue;
    seen.add(id);
    out.push({ p, name: PLATFORMS[p] || l.site, url: l.url });
  }
  return out.sort((a, b) => (b.p === x.platform) - (a.p === x.platform));
}
// manga : liens de lecture officiels d'AniList, sinon sa fiche AniList (qui liste où le lire)
const mangaPage = (x) => `https://anilist.co/manga/${x.mangaId}`;
function mangaLinks(x) {
  const out = (x.links || []).filter((l) => safeUrl(l.url)).slice(0, 2).map((l) => ({ p: '', name: l.site, url: l.url }));
  out.push({ p: '', name: 'Où le lire (AniList)', url: mangaPage(x) });
  return out;
}
function suiteLink(x) {
  if (x.manga) return mangaLinks(x)[0].url;
  const l = suiteLinks(x)[0];
  return l ? l.url : searchUrl(x.platform, x.title);
}
function suiteList() {
  if (!(view.status === 'all' || view.status === 'progress') || view.q || view.genre || view.decade || view.kind === 'series') return [];
  return data.suites.filter((x) => view.platform === 'all' || x.platform === view.platform).slice(0, 16);
}
function suiteCard(x) {
  const links = x.manga ? mangaLinks(x) : suiteLinks(x);
  const when = x.manga
    ? [x.status === 'FINISHED' ? 'Terminé' : x.status === 'RELEASING' ? 'En cours de parution' : '', x.volumes ? `${x.volumes} tomes` : x.chapters ? `${x.chapters} chapitres` : ''].filter(Boolean).join(' · ') || 'Le manga continue l\'histoire'
    : x.upcoming
    ? (x.start ? `Sortie prévue : ${x.start[2] && x.start[1] ? MONTHS[x.start[1] - 1] + ' ' : ''}${x.start[0]}` : 'Annoncée, date à venir')
    : [x.year, x.episodes && x.format !== 'MOVIE' ? `${x.episodes} ép.` : ''].filter(Boolean).join(' · ');
  const inList = Object.values(data.wishlist).some((w) => norm(w.title) === norm(x.title));
  const link = !x.upcoming && safeUrl(suiteLink(x));
  return `<article class="up suite" data-id="${x.id}">
    <div class="thumb wide">${x.cover ? blurBg(x.cover) + img(x.cover, x.title) : placeholder(x.title)}
      <span class="badge ${x.upcoming ? 'soon' : x.manga ? 'kind manga' : 'kind'}">${x.upcoming ? 'Annoncé' : esc(x.kind)}</span>
      ${link && !x.manga ? `<a class="play" href="${esc(link)}" target="_blank" rel="noopener" aria-label="Regarder ${esc(x.title)}"${/netflix\.com/.test(link) ? ` data-nf-title="${esc(x.title)}"` : ''}><span>${PLAY_ICON}</span></a>` : ''}
      <button class="hide-up" data-hide-suite title="Ne plus proposer" aria-label="Ne plus proposer cette suite"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="meta">
      <div class="c-platform">${x.manga ? `Après l'animé ${esc(x.after)}` : `Suite de ${esc(x.after)}`}</div>
      <div class="c-title">${esc(x.title)}</div>
      <div class="c-when">${esc(when)}</div>
      ${x.upcoming ? '' : `<div class="links">${links.length ? links.slice(0, 3).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener"${l.p === 'netflix' ? ` data-nf-title="${esc(x.title)}"` : ''}>${l.p ? `<span class="dot" style="background:${COLORS[l.p]}"></span>` : ''}${esc(l.name)}</a>`).join('') : `<span class="none">Pas de lien de streaming connu</span>`}</div>`}
      ${x.manga ? '' : `<button class="add-list" data-add-suite ${inList ? 'disabled' : ''}>${inList ? '✓ Dans ma liste' : '+ Ajouter à ma liste'}</button>`}
    </div>
  </article>`;
}
function renderSuites() {
  const list = suiteList();
  $('suites').hidden = !list.length;
  $('suitesRail').innerHTML = list.map(suiteCard).join('');
}
$('suitesRail').onclick = async (e) => {
  const card = e.target.closest('.suite');
  if (!card) return;
  const x = data.suites.find((s) => String(s.id) === card.dataset.id);
  if (!x) return;
  if (e.target.closest('[data-hide-suite]')) {
    card.remove();
    if (!$('suitesRail').children.length) $('suites').hidden = true;
    await chrome.runtime.sendMessage({ type: 'hideSuite', id: x.id });
  } else if (e.target.closest('[data-add-suite]')) {
    const l = suiteLinks(x)[0];
    await addTitle(x.title, (l && l.p) || x.platform);
  }
};

// ---------- Ce soir ----------
const tonight = { t: 60, mood: '', offset: 0 };
const isAnime = (s) => s.platform === 'crunchyroll' || s.platform === 'adn' || (s.genres || []).includes('Animé');
function tonightCandidates() {
  const now = Date.now(), DAY = 864e5, out = [];
  for (const s of shows) {
    if (s.status === 'dropped' || s.isMovie) continue;
    const epMin = isAnime(s) ? 24 : 45;
    const base = { key: s.key, title: s.title, img: s.wide || (s.lastItem && s.lastItem.image) || s.poster || s.image, genres: s.genres, mins: epMin };
    if (!s.items.length) {
      out.push({ ...base, score: 30, why: `Dans ta liste depuis ${when(s.added || now)}`, link: resumeLink(s, false) || searchUrl(s.platform, s.title) });
      continue;
    }
    const nw = data.newEps[s.key];
    if (s.status !== 'progress' && !nw) continue;
    const li = s.lastItem;
    const frac = li.length && li.seconds ? li.seconds / li.length : li.progress;
    const partial = frac != null && frac > 0.03 && frac < 0.9;
    const days = (now - (s.last || now)) / DAY;
    const left = s.prog ? s.prog.total - s.prog.watched : null;
    if (nw) out.push({ ...base, score: 100, why: `<em>Nouvel épisode</em> · ${epLabel({ season: nw.season, ep: nw.ep })}`, link: resumeLink(s, false), left });
    else if (days > 60) out.push({ ...base, score: 18, dropped: true, why: li.episode ? `Mis de côté ${when(s.last)} à ${esc(li.episode)}. On reprend ?` : `Mis de côté ${when(s.last)}. On reprend ?`, link: resumeLink(s, false), left });
    else if (s.prog && !s.prog.next && (s.prog.upToDate || s.prog.complete)) continue;
    else {
      // on sait exactement quoi lancer → en premier ; sans numéro d'épisode (ADN…) → plus bas
      const why = partial ? `<em>Reprendre</em> ${esc(li.episode || '')}`
        : s.prog && s.prog.next ? `<em>Prochain</em> · ${epLabel(s.prog.next)}`
        : li.episode ? `Après ${esc(li.episode)}` : `Vu pour la dernière fois ${when(s.last)}`;
      const bonus = partial ? 10 : s.prog && s.prog.next ? 6 : li.episode ? 0 : -25;
      out.push({ ...base, score: 75 - days + bonus, why, link: resumeLink(s, partial), left });
    }
  }
  for (const x of data.suites) {
    if (x.upcoming || x.manga) continue; // « Ce soir » : que des choses à regarder
    const movie = x.format === 'MOVIE';
    out.push({ key: 'suite:' + x.id, title: x.title, img: x.cover, genres: frenchGenres(x.genres, 'anime'), mins: movie ? 110 : 24, movie, score: 55, why: `<em>Suite</em> de ${esc(x.after)} · ${esc(x.kind.toLowerCase())}`, link: suiteLink(x), left: movie ? null : x.episodes });
  }
  return out
    .filter((c) => c.link && c.mins <= Math.max(tonight.t, 30) + (tonight.t >= 300 ? 999 : 0))
    .map((c) => {
      let score = c.score;
      if (tonight.mood) score += c.genres && c.genres.includes(tonight.mood) ? 45 : -35;
      if (tonight.t >= 300 && (c.movie || (c.left || 0) >= 3)) score += 15; // de quoi remplir la soirée
      if (tonight.t <= 25 && c.mins <= 25) score += 5;
      return { ...c, score };
    })
    .sort((a, b) => b.score - a.score);
}
function tonightCard(c) {
  const dur = c.movie ? `≈ ${Math.round(c.mins / 6) / 10} h` : `≈ ${c.mins} min par épisode${c.left > 1 ? ` · ${c.left} restants` : ''}`;
  return `<div class="t-card" data-key="${esc(c.key)}">
    <div class="thumb wide">${c.img ? blurBg(c.img) + img(c.img, c.title) : placeholder(c.title)}</div>
    <div class="t-title">${esc(c.title)}</div>
    <div class="t-why">${c.why}</div>
    <div class="t-dur">${esc(dur)}</div>
    <div class="t-actions">
      <a class="btn primary" href="${esc(c.link)}" target="_blank" rel="noopener">${PLAY_ICON} ${c.dropped ? 'Reprendre' : 'Regarder'}</a>
      ${c.dropped ? `<button class="btn secondary" data-drop>Abandonner</button>` : ''}
    </div>
  </div>`;
}
function renderTonight() {
  const all = tonightCandidates();
  if (tonight.offset >= all.length) tonight.offset = 0;
  const pick = all.slice(tonight.offset, tonight.offset + 3);
  $('tonightResults').innerHTML = pick.length ? pick.map(tonightCard).join('') : `<p class="t-empty">Rien qui rentre dans ce créneau. Essaie « Toute la soirée » ou une autre envie.</p>`;
  $('tonightMore').hidden = all.length <= 3;
  requestAnimationFrame(fitAll);
}
function openTonight() {
  // envies : les genres les plus présents dans tes séries en cours
  const count = new Map();
  for (const s of shows) if (s.status === 'progress' || !s.items.length) for (const g of s.genres) count.set(g, (count.get(g) || 0) + 1);
  const moods = [...count].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([g]) => g);
  if (tonight.mood && !moods.includes(tonight.mood)) tonight.mood = '';
  $('tonightMood').innerHTML = [`<button class="chip ${tonight.mood ? '' : 'on'}" data-mood="">Peu importe</button>`, ...moods.map((g) => `<button class="chip ${tonight.mood === g ? 'on' : ''}" data-mood="${esc(g)}">${esc(g)}</button>`)].join('');
  for (const b of $('tonightTime').children) b.classList.toggle('on', +b.dataset.t === tonight.t);
  tonight.offset = 0;
  renderTonight();
  $('tonightModal').hidden = false;
  requestAnimationFrame(() => $('tonightClose').focus());
}
$('tonightBtn').onclick = openTonight;
$('tonightClose').onclick = () => ($('tonightModal').hidden = true);
$('tonightModal').onclick = async (e) => {
  if (e.target === $('tonightModal')) { $('tonightModal').hidden = true; return; }
  const t = e.target.closest('[data-t]');
  if (t) { tonight.t = +t.dataset.t; tonight.offset = 0; for (const b of $('tonightTime').children) b.classList.toggle('on', b === t); renderTonight(); return; }
  const m = e.target.closest('[data-mood]');
  if (m) { tonight.mood = m.dataset.mood; tonight.offset = 0; for (const b of $('tonightMood').children) b.classList.toggle('on', b === m); renderTonight(); return; }
  if (e.target.closest('[data-drop]')) {
    const key = e.target.closest('.t-card').dataset.key;
    await setStatus(key, 'dropped');
    data.shows = (await chrome.storage.local.get('shows')).shows || {};
    shows = buildShows();
    renderTonight();
  }
};
$('tonightMore').onclick = () => { tonight.offset += 3; renderTonight(); };

// ---------- Restaurer une sauvegarde ----------
function openRestore() {
  $('restoreOut').textContent = '';
  $('restoreOut').className = 'restore-out';
  $('restoreFile').value = '';
  $('restoreModal').hidden = false;
}
$('restoreFile').onchange = async () => {
  const f = $('restoreFile').files[0];
  if (!f) return;
  const out = $('restoreOut');
  out.className = 'restore-out';
  out.textContent = 'Restauration en cours…';
  try {
    const payload = JSON.parse(await f.text());
    const r = await chrome.runtime.sendMessage({ type: 'restore', payload });
    if (r.error) throw new Error(r.error);
    out.className = 'restore-out ok';
    out.textContent = `Restauré ✓ — ${fmtN(r.lignes)} visionnage${r.lignes > 1 ? 's' : ''} ajouté${r.lignes > 1 ? 's' : ''} (${fmtN(r.total)} au total), ${fmtN(Math.max(0, r.affiches))} affiche${r.affiches > 1 ? 's' : ''} récupérée${r.affiches > 1 ? 's' : ''}.`;
  } catch (err) {
    out.className = 'restore-out err';
    out.textContent = 'Impossible : ' + (err instanceof SyntaxError ? "ce fichier n'est pas une sauvegarde Tsukiboshi" : err.message);
  }
};
$('restoreClose').onclick = () => ($('restoreModal').hidden = true);
$('restoreModal').onclick = (e) => { if (e.target === $('restoreModal')) $('restoreModal').hidden = true; };

// ---------- Fiche ----------
function openShow(key, refresh) {
  const s = shows.find((x) => x.key === key);
  if (!s) return closeShow();
  openKey = key;
  $('dHero').innerHTML = heroVisual(s);
  $('dPlatform').innerHTML = `<span class="dot" style="background:${COLORS[s.platform]}"></span>${PLATFORMS[s.platform]}`;
  $('dTitle').textContent = s.title;
  $('dGenres').innerHTML = [s.year ? `<span class="g-year">${s.year}</span>` : '', ...s.genres.map((g) => `<button class="g-chip" data-genre="${esc(g)}" title="Voir tous les titres « ${esc(g)} »">${esc(g)}</button>`)].join('');
  const srcNote = s.custom ? 'Image choisie à la main' : s.meta && s.meta.poster ? 'Affiche Crunchyroll' : s.art && s.art.poster ? `Affiche ${s.art.source}${s.art.match && s.art.match !== s.title ? ` (« ${s.art.match} »)` : ''}` : '';
  $('dTitle').insertAdjacentHTML('afterend', '');
  document.querySelector('.art-src')?.remove();
  if (srcNote) $('dTitle').insertAdjacentHTML('afterend', `<p class="art-src">${esc(srcNote)}</p>`);

  $('dStatus').innerHTML = Object.entries(STATUS).map(([id, st]) =>
    `<button role="radio" aria-checked="${s.status === id}" class="${s.status === id ? 'on' : ''}" style="--s:${st.color}" data-set="${id}"><i></i>${st.label}</button>`).join('');
  const manual = data.shows[key] && data.shows[key].status;
  $('dStatus').insertAdjacentHTML('afterend', '');
  const autoNote = document.querySelector('.d-auto');
  if (autoNote) autoNote.remove();
  $('dStatus').insertAdjacentHTML('afterend', manual
    ? `<p class="d-auto">Statut choisi à la main · <button data-reset>revenir au statut automatique</button></p>`
    : `<p class="d-auto">Statut automatique</p>`);

  const rateRow = `
    <div class="rate-row">
      <div class="stars" role="radiogroup" aria-label="Ma note">${[1, 2, 3, 4, 5].map((n) => `<button role="radio" aria-checked="${s.rating === n}" aria-label="${n} étoile${n > 1 ? 's' : ''}" class="${n <= s.rating ? 'on' : ''}" data-rate="${n}">${STAR}</button>`).join('')}</div>
      <span class="rate-txt">${s.rating ? ['', 'Bof', 'Moyen', 'Bien', 'Très bien', 'Chef-d\'œuvre'][s.rating] : 'Pas encore noté'}</span>
      <button class="fav-btn ${s.fav ? 'on' : ''}" data-fav aria-pressed="${s.fav}" title="${s.fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${HEART}<span>${s.fav ? 'Favori' : 'Favori ?'}</span></button>
    </div>`;
  // avis en cours de frappe : on ne remplace que les étoiles, pour ne pas perdre le curseur
  if (refresh && document.activeElement && document.activeElement.id === 'dReview') $('dRate').querySelector('.rate-row').outerHTML = rateRow;
  else $('dRate').innerHTML = rateRow + `<textarea id="dReview" rows="2" maxlength="1000" placeholder="Mon avis (facultatif)…">${esc(s.review)}</textarea>`;
  const li = s.lastItem;
  const p = s.prog;
  const progStats = p ? `
    <div><b>${fmtN(p.watched)} / ${fmtN(p.total)}</b><span>épisodes vus</span></div>
    <div><b>${p.next ? epLabel(p.next) : p.upToDate ? 'À jour' : 'Terminé ✓'}</b><span>${p.next ? 'prochain épisode' : p.upToDate ? 'en attente des prochains épisodes' : 'série terminée'}</span></div>` : '';
  $('dStats').innerHTML = s.items.length ? progStats + `
    <div><b>${s.isMovie ? 'Film' : esc(li.episode || '—')}</b><span>${s.isMovie ? 'vu' : 'dernier épisode vu'}</span></div>
    ${p ? '' : `<div><b>${s.isMovie ? fmtN(s.items.length) + '×' : fmtN(s.episodes)}</b><span>${s.isMovie ? 'visionnages' : 'épisodes vus'}</span></div>`}
    <div><b>${s.first ? new Date(s.first).toLocaleDateString('fr-FR') : '—'}</b><span>premier visionnage</span></div>
    <div><b>${s.last ? new Date(s.last).toLocaleDateString('fr-FR') : '—'}</b><span>dernier visionnage</span></div>
    <div><b>${hours(s.secs)}</b><span>temps regardé</span></div>
    ${p ? '' : `<div><b>${fmtN(s.items.length)}</b><span>lignes d'historique</span></div>`}` : `
    <div><b>${s.added ? new Date(s.added).toLocaleDateString('fr-FR') : '—'}</b><span>ajouté à la liste</span></div>
    <div><b>0</b><span>épisode vu</span></div>`;

  const actions = [];
  if (li && safeUrl(li.url)) actions.push(`<a class="btn primary" href="${esc(safeUrl(li.url))}" target="_blank" rel="noopener">${s.isMovie ? 'Ouvrir le film' : 'Ouvrir le dernier épisode'}</a>`);
  actions.push(`<button class="btn secondary" data-art>Changer l'image</button>`);
  if (s.meta && s.meta.seriesId) actions.push(`<a class="btn secondary" href="https://www.crunchyroll.com/fr/series/${esc(s.meta.seriesId)}" target="_blank" rel="noopener">Voir la série</a>`);
  if (data.wishlist[key]) actions.push(`<button class="btn secondary" data-remove>Retirer de ma liste</button>`);
  const desc = s.meta && s.meta.description;
  $('dDesc').hidden = !desc;
  $('dDesc').textContent = desc || '';
  $('dSeasons').innerHTML = p && p.groups.length > 1 ? `<h3 class="d-section">Saisons</h3><ul class="seasons">${p.groups.map((g) => `
    <li><span class="s-name">${esc(g.title || (g.number != null ? 'Saison ' + g.number : 'Saison'))}</span>
      <span class="s-count">${g.seen} / ${g.count}</span>
      <span class="s-bar"><i style="width:${Math.round((g.seen / g.count) * 100)}%;background:${g.seen >= g.count ? 'var(--s-done)' : 'var(--s-progress)'}"></i></span></li>`).join('')}</ul>` : '';
  $('dActions').innerHTML = actions.join('');

  $('dEpTitle').hidden = !s.items.length;
  $('dEpisodes').innerHTML = s.items.map((e) => {
    const p = e.length && e.seconds ? Math.min(1, e.seconds / e.length) : e.progress;
    const name = esc(e.episode || (s.isMovie ? 'Film' : '—'));
    const extra = [
      p != null ? `<span class="mini"><i style="width:${Math.round(p * 100)}%"></i></span>${Math.round(p * 100)} %` : '',
      e.seconds ? `${Math.round(e.seconds / 60)} min regardées` : '',
      e.source === 'live' ? 'suivi en direct' : '',
    ].filter(Boolean).join(' · ');
    return `<li><span class="ep-name">${safeUrl(e.url) ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${name}</a>` : name}</span>
      <span class="ep-date">${dateTxt(e)}</span>${extra ? `<span class="ep-extra">${extra}</span>` : ''}</li>`;
  }).join('');

  requestAnimationFrame(fitAll);
  if (!refresh) $('drawer').scrollTop = 0;
  $('overlay').hidden = false;
  if (!refresh && !$('drawer').classList.contains('open')) {
    lastFocus = document.activeElement; // pour y revenir à la fermeture
    requestAnimationFrame(() => $('drawerClose').focus({ preventScroll: true }));
  }
  $('drawer').classList.add('open');
  $('drawer').setAttribute('aria-hidden', 'false');
}

let lastFocus = null;
function closeShow() {
  const wasOpen = $('drawer').classList.contains('open');
  const key = openKey;
  openKey = null;
  $('drawer').classList.remove('open');
  $('drawer').setAttribute('aria-hidden', 'true');
  $('overlay').hidden = true;
  if (!wasOpen) return;
  // focus rendu à la vignette d'origine (même si la grille a été redessinée entre-temps)
  const back = (lastFocus && document.contains(lastFocus) && lastFocus) || (key && document.querySelector(`.card[data-key="${CSS.escape(key)}"]`));
  if (back && back.focus) back.focus({ preventScroll: true });
}

// ---------- Sources des affiches ----------
const SOURCES = ['TMDB', 'Allociné', 'IMDb', 'AniList', 'iTunes', 'TVmaze', 'Netflix'];
async function openSources() {
  const [{ sourceStats = {} }, { settings = {} }] = await Promise.all([
    chrome.storage.session.get('sourceStats').catch(() => ({})),
    chrome.storage.local.get('settings'),
  ]);
  const found = shows.filter((x) => x.poster).length;
  const bySrc = {};
  shows.forEach((x) => { if (x.art && x.art.poster) bySrc[x.art.source] = (bySrc[x.art.source] || 0) + 1; });
  $('srcSum').textContent = `${fmtN(found)} titres sur ${fmtN(shows.length)} ont une image.`;
  $('srcList').innerHTML = SOURCES.map((name) => {
    const st = sourceStats[name];
    let cls = 'off', txt = 'pas encore utilisée', why = '';
    if (name === 'TMDB' && !settings.tmdbKey) { txt = 'non configurée (facultatif)'; why = 'Colle une clé gratuite dans les réglages du popup.'; }
    else if (st) {
      const paused = st.enPauseJusqua && st.erreurs > 0;
      if (st.erreurs && !st.ok) { cls = 'bad'; txt = 'bloquée'; why = st.dernierCode || ''; }
      else if (paused) { cls = 'warn'; txt = `en pause jusqu'à ${st.enPauseJusqua}`; why = st.dernierCode || ''; }
      else { cls = 'ok'; txt = 'répond'; }
    }
    const n = st ? `${st.ok} trouvées · ${st.vide} sans résultat${st.erreurs ? ' · ' + st.erreurs + ' erreurs' : ''}` : '';
    return `<li><b>${name}</b><span class="st ${cls}">${esc(txt)}</span><span class="n">${bySrc[name] ? fmtN(bySrc[name]) + ' affiches' : ''}</span>
      ${n || why ? `<span class="why">${esc([n, why].filter(Boolean).join(' — '))}</span>` : ''}</li>`;
  }).join('');
  $('srcModal').hidden = false;
}
$('srcBtn').onclick = openSources;
$('srcClose').onclick = () => ($('srcModal').hidden = true);
$('srcModal').onclick = (e) => { if (e.target === $('srcModal')) $('srcModal').hidden = true; };
$('srcRetry').onclick = async (e) => {
  e.currentTarget.textContent = 'Recherche relancée ✓';
  await chrome.runtime.sendMessage({ type: 'artRetry' });
  setTimeout(() => ($('srcModal').hidden = true), 900);
};

// ---------- Changer l'image ----------
async function setCustomPoster(key, url) {
  const next = { ...data.shows };
  const cur = { ...(next[key] || {}) };
  if (url) cur.poster = url; else delete cur.poster;
  if (Object.keys(cur).filter((k) => k !== 'updated').length) next[key] = { ...cur, updated: Date.now() };
  else delete next[key];
  await chrome.storage.local.set({ shows: next });
}

async function runArtSearch() {
  const s = shows.find((x) => x.key === openKey);
  const q = $('artQuery').value.trim();
  if (!s || !q) return;
  $('artHint').textContent = 'Recherche…';
  $('artResults').innerHTML = '';
  let list = [];
  try {
    list = (await chrome.runtime.sendMessage({ type: 'artSearch', query: q, platform: s.platform, movie: s.isMovie })) || [];
  } catch {}
  if (!Array.isArray(list) || !list.length) {
    $('artHint').textContent = 'Aucune image trouvée. Essaie un autre titre (souvent le titre anglais ou japonais), ou colle un lien ci-dessous.';
    return;
  }
  $('artHint').textContent = `${list.length} propositions · clique sur une affiche pour la choisir`;
  $('artResults').innerHTML = list.map((c, i) => `
    <button class="art-pick ${c.poster === s.poster ? 'on' : ''}" data-i="${i}">
      <img src="${esc(c.poster)}" alt="" loading="lazy" referrerpolicy="no-referrer">
      <b>${esc(c.title)}</b><span>${esc(c.source)}${c.year ? ' · ' + c.year : ''}${c.episodes ? ' · ' + c.episodes + ' ép.' : ''}</span>
    </button>`).join('');
  $('artResults').onclick = async (e) => {
    const b = e.target.closest('.art-pick');
    if (!b) return;
    await setCustomPoster(openKey, list[+b.dataset.i].poster);
    $('artModal').hidden = true;
  };
}

function openArt() {
  const s = shows.find((x) => x.key === openKey);
  if (!s) return;
  $('artQuery').value = s.title.replace(/\s*[-–:]?\s*(saison|season|partie|part)\s*\d+.*$/i, '');
  $('artUrl').value = '';
  $('artReset').hidden = !s.custom;
  $('artModal').hidden = false;
  runArtSearch();
}

$('artSearchForm').onsubmit = (e) => { e.preventDefault(); runArtSearch(); };
$('artUrlForm').onsubmit = async (e) => {
  e.preventDefault();
  const url = $('artUrl').value.trim();
  if (!/^https?:\/\//.test(url)) return;
  await setCustomPoster(openKey, url);
  $('artModal').hidden = true;
};
$('artReset').onclick = async () => { await setCustomPoster(openKey, ''); $('artModal').hidden = true; };
$('artClose').onclick = () => ($('artModal').hidden = true);
$('artModal').onclick = (e) => { if (e.target === $('artModal')) $('artModal').hidden = true; };

// ---------- Ajouter ----------
function openAdd() {
  $('addPlatform').innerHTML = Object.entries(PLATFORMS).map(([id, n]) => `<option value="${id}">${n}</option>`).join('');
  // plateforme par défaut : celle du filtre, sinon la plus utilisée
  const counts = {};
  shows.forEach((x) => (counts[x.platform] = (counts[x.platform] || 0) + 1));
  $('addPlatform').value = view.platform !== 'all' ? view.platform
    : Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || 'crunchyroll';
  $('addTitle').value = view.q;
  $('addModal').hidden = false;
  $('addTitle').focus();
}
async function addTitle(title, platform) {
  const key = keyOf(platform, title);
  const wishlist = { ...data.wishlist, [key]: { key, title, platform, added: Date.now() } };
  await chrome.storage.local.set({ wishlist });
  return key;
}

// ---------- Événements ----------
$('statusChips').onclick = (e) => {
  const b = e.target.closest('[data-status]');
  if (b) { view.status = b.dataset.status; render(); }
};
$('platformChips').onclick = (e) => {
  const b = e.target.closest('[data-platform]');
  if (b) { view.platform = b.dataset.platform; render(); }
};
$('sort').onchange = (e) => { view.sort = e.target.value; render(); };
$('kindTabs').onclick = (e) => { const b = e.target.closest('[data-kind]'); if (b) { view.kind = b.dataset.kind; view.genre = ''; render(); } };
$('q').oninput = (e) => { view.q = e.target.value; render(); };
$('grid').onclick = (e) => {
  const c = e.target.closest('.card');
  if (c) openShow(c.dataset.key);
};
$('grid').onkeydown = (e) => {
  const c = e.target.closest('.card');
  if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openShow(c.dataset.key); }
};
$('drawer').onclick = async (e) => {
  if (e.target.closest('[data-art]')) return openArt();
  const gch = e.target.closest('[data-genre]');
  if (gch) { view.genre = gch.dataset.genre; view.status = 'all'; closeShow(); render(); return; }
  const rate = e.target.closest('[data-rate]');
  if (rate) { const s = shows.find((x) => x.key === openKey); const n = +rate.dataset.rate; return patchShow(openKey, { rating: s && s.rating === n ? 0 : n }); } // re-cliquer la même étoile efface la note
  if (e.target.closest('[data-fav]')) { const s = shows.find((x) => x.key === openKey); return patchShow(openKey, { fav: !(s && s.fav) }); }
  const set = e.target.closest('[data-set]');
  if (set) return setStatus(openKey, set.dataset.set);
  if (e.target.closest('[data-reset]')) return setStatus(openKey, null);
  if (e.target.closest('[data-remove]')) {
    const wishlist = { ...data.wishlist };
    delete wishlist[openKey];
    const showsMap = { ...data.shows };
    if (!shows.find((s) => s.key === openKey)?.items.length) delete showsMap[openKey];
    await chrome.storage.local.set({ wishlist, shows: showsMap });
  }
};
let reviewTimer = null;
$('drawer').addEventListener('input', (e) => {
  if (e.target.id !== 'dReview') return;
  const key = openKey, val = e.target.value.trim();
  clearTimeout(reviewTimer);
  reviewTimer = setTimeout(() => patchShow(key, { review: val }), 700);
});
$('drawerClose').onclick = closeShow;
$('overlay').onclick = closeShow;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('tonightModal').hidden) $('tonightModal').hidden = true;
    else if (!$('restoreModal').hidden) $('restoreModal').hidden = true;
    else if (!$('srcModal').hidden) $('srcModal').hidden = true;
    else if (!$('artModal').hidden) $('artModal').hidden = true;
    else if (!$('addModal').hidden) $('addModal').hidden = true;
    else closeShow();
  }
  // « / » = rechercher, sauf quand on écrit (avis, lien d'image, ajout…)
  const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
  if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); $('q').focus(); }
});
$('addBtn').onclick = openAdd;
$('addCancel').onclick = () => ($('addModal').hidden = true);
$('addModal').onclick = (e) => { if (e.target === $('addModal')) $('addModal').hidden = true; };
$('addForm').onsubmit = async (e) => {
  e.preventDefault();
  const title = $('addTitle').value.trim();
  if (!title) return;
  const key = await addTitle(title, $('addPlatform').value);
  $('addModal').hidden = true;
  openKey = key;
};

// mise à jour en direct (nouvel épisode regardé, synchro, autre onglet…)
let reloadTimer = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  // genres trouvés en tâche de fond : listes mises à jour sans redessiner la grille (sauf filtre actif)
  if (changes.genres && !(changes.entries || changes.shows || changes.wishlist || changes.meta || changes.art || changes.newEps)) {
    data.genres = changes.genres.newValue || {};
    shows = buildShows();
    if (view.genre || view.decade) render(); else renderSelects();
    if (openKey && $('drawer').classList.contains('open')) openShow(openKey, true);
    return;
  }
  if (changes.suites && !(changes.entries || changes.shows || changes.wishlist || changes.meta || changes.art || changes.newEps)) {
    data.suites = (changes.suites.newValue && changes.suites.newValue.list) || [];
    renderSuites();
    return;
  }
  if (!(changes.entries || changes.shows || changes.wishlist || changes.meta || changes.art || changes.newEps)) return;
  // nouvelles affiches seulement : on met à jour les vignettes concernées, sans tout reconstruire
  if (changes.art && !(changes.entries || changes.shows || changes.wishlist || changes.meta || changes.newEps)) {
    data.art = changes.art.newValue || {};
    shows = buildShows();
    for (const card of document.querySelectorAll('.card')) {
      const sh = shows.find((x) => x.key === card.dataset.key);
      const img = card.querySelector('.thumb img');
      const src = sh && (sh.poster || sh.image || sh.wide);
      if (sh && src && (!img || img.getAttribute('src') !== src)) {
        const box = card.querySelector('.thumb');
        (box.querySelector('img, .ph') || box.firstChild).outerHTML = visual(sh);
      }
    }
    requestAnimationFrame(fitAll);
    if (openKey && $('drawer').classList.contains('open')) openShow(openKey, true);
    return;
  }
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(load, 300);
});

// Indicateur « Recherche des affiches… »
function showArtStatus(st) {
  const on = st && st.remaining > 0;
  $('artStatus').hidden = !on;
  if (!on) return;
  $('artStatus').classList.toggle('paused', !!st.paused);
  $('artStatusText').textContent = `${st.paused ? 'Affiches : pause (site saturé)' : 'Recherche des affiches'} · ${fmtN(st.remaining)} restante${st.remaining > 1 ? 's' : ''}`;
}
chrome.storage.session.get('artStatus').then((r) => showArtStatus(r.artStatus)).catch(() => {});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.artStatus) showArtStatus(changes.artStatus.newValue);
});

// filtre éventuel passé dans l'adresse (ex. list.html#crunchyroll)
const hash = location.hash.slice(1);
if (PLATFORMS[hash]) view.platform = hash;
if (hash === 'restaurer') { openRestore(); history.replaceState(null, '', location.pathname); }
else if (hash.includes('%7C') || hash.includes('|')) { openKey = decodeURIComponent(hash); history.replaceState(null, '', location.pathname); }
load();
// les 60 premiers titres affichés (selon filtres et tri) sont cherchés en premier
let kickTimer = null;
function kickArt() {
  clearTimeout(kickTimer);
  kickTimer = setTimeout(() => {
    const keys = filtered().filter((s) => !s.poster).slice(0, 60).map((s) => s.key);
    chrome.runtime.sendMessage({ type: 'artKick', keys }).catch(() => {});
  }, 400);
}
kickArt();
installNetflixLinks();
initLayout(() => render());
