// tsukiboshi — « Rechercher un animé » : fiche, où le regarder, déjà vu ou non, ajout à ma liste (données AniList)
import { frenchGenres } from '../lib/artwork.js';
import { platformOfLink } from '../lib/anilist.js';
import { netflixId, installNetflixLinks } from '../lib/nflink.js';
import { initLayout, isHorizontal } from '../lib/layout.js';

const PLATFORMS = { netflix: 'Netflix', crunchyroll: 'Crunchyroll', adn: 'ADN', disney: 'Disney+', prime: 'Prime Video' };
const COLORS = { netflix: '#e50914', crunchyroll: '#f47521', adn: '#0099e5', disney: '#3a67ff', prime: '#00a8e1' };
const FORMAT = { TV: 'Série', TV_SHORT: 'Série courte', MOVIE: 'Film', OVA: 'OAV', ONA: 'ONA', SPECIAL: 'Spécial', MUSIC: 'Clip' };
const STATUS = { RELEASING: 'En cours de diffusion', FINISHED: 'Terminé', NOT_YET_RELEASED: 'À venir', CANCELLED: 'Annulé', HIATUS: 'En pause' };
const REL = { SEQUEL: 'Suite', PREQUEL: 'Avant', SIDE_STORY: 'Histoire parallèle', SPIN_OFF: 'Spin-off', ALTERNATIVE: 'Autre version', PARENT: 'Série principale', SUMMARY: 'Récapitulatif', CHARACTER: 'Mêmes personnages', OTHER: 'Lié' };
const REL_ORDER = ['PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE', 'SUMMARY', 'CHARACTER', 'OTHER'];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
const send = (m) => chrome.runtime.sendMessage(m);

// ---------- ce que l'utilisateur a déjà vu ----------
let mine = { byId: new Map(), byTitle: new Map(), wish: new Set(), platforms: new Set() };
async function loadMine() {
  const r = await chrome.storage.local.get(['entries', 'aniIds', 'wishlist']);
  const groups = new Map();
  for (const e of Object.values(r.entries || {})) {
    const k = `${e.platform}|${norm(e.title)}`;
    const g = groups.get(k) || { key: k, title: e.title, platform: e.platform, eps: new Set(), last: 0, nf: '' };
    if (e.episode) g.eps.add(norm(e.episode));
    if (e.platform === 'netflix' && !g.nf && netflixId(e.url)) g.nf = `https://www.netflix.com/title/${netflixId(e.url)}`; // ton propre lien, sûr
    g.last = Math.max(g.last, e.date || 0);
    groups.set(k, g);
    mine.platforms.add(e.platform);
  }
  mine.byId = new Map();
  mine.byTitle = new Map();
  for (const [k, v] of Object.entries(r.aniIds || {})) if (v && v.id && groups.has(k)) mine.byId.set(v.id, groups.get(k));
  for (const g of groups.values()) mine.byTitle.set(norm(g.title), g);
  mine.wish = new Set(Object.values(r.wishlist || {}).map((w) => norm(w.title)));
}
const seenOf = (m) => mine.byId.get(m.id) || m.titles.map((t) => mine.byTitle.get(norm(t))).find(Boolean) || null;
const inWish = (m) => m.titles.some((t) => mine.wish.has(norm(t)));

// ---------- affichage ----------
function hue(str) { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function placeholder(title) {
  const h = hue(title);
  return `<div class="ph" style="background:linear-gradient(135deg,hsl(${h} 45% 34%),hsl(${(h + 40) % 360} 50% 18%))">${esc(title.slice(0, 2).toUpperCase())}</div>`;
}
const img = (src, title) => (safeUrl(src) ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : placeholder(title));
const blurBg = (src) => (safeUrl(src) ? `<div class="blur" style="background-image:url('${esc(src.replace(/['()\\]/g, encodeURIComponent))}')"></div>` : '');
const facts = (m) => [FORMAT[m.format] || m.format, m.year, m.format !== 'MOVIE' && m.episodes ? `${m.episodes} ép.` : ''].filter(Boolean).join(' · ');

let results = [];
function card(m) {
  const seen = seenOf(m);
  const badge = seen ? '<span class="badge mine">Déjà vu</span>' : inWish(m) ? '<span class="badge wish">Dans ma liste</span>' : '';
  return `<article class="card" tabindex="0" data-id="${m.id}">
    <div class="thumb${isHorizontal() ? ' wide' : ''}">${isHorizontal() ? (m.banner ? img(m.banner, m.title) : blurBg(m.cover) + img(m.cover, m.title).replace('<img ', '<img class="fit" ')) : img(m.cover, m.title)}${badge}</div>
    <div class="meta">
      <div class="c-platform">${esc(facts(m))}</div>
      <div class="c-title">${esc(m.title)}</div>
      <div class="c-genres">${esc(frenchGenres(m.genres, 'anime').filter((g) => g !== 'Animé').slice(0, 3).join(' · '))}</div>
    </div>
  </article>`;
}
function showGrid(list, heading, hint) {
  results = list;
  $('heading').textContent = heading;
  $('hint').textContent = hint || '';
  $('grid').innerHTML = list.map(card).join('');
  $('empty').hidden = list.length > 0;
}

// ---------- recherche ----------
let reqId = 0;
async function search(q) {
  const id = ++reqId;
  if (!q) return trending();
  $('grid').innerHTML = '<p class="loading">Recherche…</p>';
  const r = await send({ type: 'searchAnime', q });
  if (id !== reqId) return; // une recherche plus récente a été lancée
  if (r.error) { $('grid').innerHTML = ''; $('empty').hidden = false; $('emptyTitle').textContent = 'Recherche impossible'; $('emptyText').textContent = r.error; return; }
  $('emptyTitle').textContent = 'Aucun résultat';
  $('emptyText').textContent = 'Essaie avec le titre anglais ou japonais.';
  showGrid(r.results, `Résultats pour « ${q} »`, r.results.length ? `${r.results.length} animé${r.results.length > 1 ? "s" : ""} trouvé${r.results.length > 1 ? "s" : ""}` : '');
}
async function trending() {
  const id = ++reqId;
  $('grid').innerHTML = '<p class="loading">Chargement des animés du moment…</p>';
  const r = await send({ type: 'trendingAnime' });
  if (id !== reqId) return;
  if (r.error) { $('grid').innerHTML = `<p class="loading">${esc(r.error)} Tape un titre pour chercher.</p>`; return; }
  showGrid(r.results, 'Animés du moment', 'Les plus suivis en ce moment sur AniList. Tape un titre pour chercher n\'importe quel animé.');
}
let timer = null;
$('q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => search($('q').value.trim()), 450); });
$('form').addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(timer); search($('q').value.trim()); });

// ---------- fiche ----------
let current = null;
function whereToWatch(m) {
  const seen = new Set(), out = [];
  for (const l of m.links || []) {
    const p = platformOfLink(l.site);
    if (!safeUrl(l.url) || seen.has(p || l.site)) continue;
    seen.add(p || l.site);
    out.push({ p, name: PLATFORMS[p] || l.site, url: l.url, mine: mine.platforms.has(p) });
  }
  // Netflix : le lien de ton historique (déjà vu) vaut mieux que celui d'AniList
  const own = seenOf(m);
  if (own && own.nf) {
    const nf = out.find((l) => l.p === 'netflix');
    if (nf) nf.url = own.nf; else out.push({ p: 'netflix', name: 'Netflix', url: own.nf, mine: true });
  }
  // tes plateformes d'abord
  return out.sort((a, b) => b.mine - a.mine);
}
function openDetail(m) {
  current = m;
  const seen = seenOf(m);
  const genres = frenchGenres(m.genres, 'anime').filter((g) => g !== 'Animé');
  const where = whereToWatch(m);
  const rels = (m.relations || []).filter((r) => REL[r.rel]).sort((a, b) => REL_ORDER.indexOf(a.rel) - REL_ORDER.indexOf(b.rel) || (a.year || 0) - (b.year || 0));
  const alt = [...new Set(m.titles.filter((t) => t !== m.title))].slice(0, 2).join(' · ');
  $('dHero').innerHTML = m.banner ? img(m.banner, m.title) : blurBg(m.cover) + img(m.cover, m.title);
  $('dBody').innerHTML = `
    <h1>${esc(m.title)}</h1>
    ${alt ? `<p class="d-alt">${esc(alt)}</p>` : ''}
    <div class="d-facts">
      ${m.year ? `<span>${m.year}</span>` : ''}${m.format ? `<span>${esc(FORMAT[m.format] || m.format)}</span>` : ''}
      ${m.episodes && m.format !== 'MOVIE' ? `<span>${m.episodes} épisodes${m.duration ? ` · ${m.duration} min` : ''}</span>` : m.duration ? `<span>${m.duration} min</span>` : ''}
      ${m.status ? `<span>${esc(STATUS[m.status] || m.status)}</span>` : ''}
      ${m.studio ? `<span>${esc(m.studio)}</span>` : ''}
      ${m.score ? `<span class="score">★ ${(m.score / 10).toLocaleString('fr-FR')}/10</span>` : ''}
    </div>
    ${genres.length ? `<div class="d-genres">${genres.map((g) => `<span class="g-chip">${esc(g)}</span>`).join('')}</div>` : ''}
    ${m.nextAiring ? `<p class="d-alt">Épisode ${m.nextAiring.ep} : ${new Date(m.nextAiring.at).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</p>` : ''}
    ${seen ? `<div class="mine-box">✓ Déjà dans ton historique (${esc(PLATFORMS[seen.platform] || seen.platform)}${seen.eps.size ? `, ${seen.eps.size} épisode${seen.eps.size > 1 ? 's' : ''}` : ''}) · <a href="../list/list.html#${encodeURIComponent(seen.key)}">Voir dans Ma liste</a></div>` : ''}
    <h3 class="d-section">Où le regarder</h3>
    <div class="where">${where.length
      ? where.map((l) => `<a class="${l.mine ? 'mine' : ''}" href="${esc(l.url)}" target="_blank" rel="noopener"${l.p === 'netflix' ? ` data-nf-title="${esc(m.title)}"` : ''}>${l.p ? `<span class="dot" style="background:${COLORS[l.p]}"></span>` : ''}${esc(l.name)}</a>`).join('')
      : '<span class="note">Aucune plateforme connue. Cherche-le directement :</span>' + ['crunchyroll', 'adn', 'netflix'].map((p) => `<a href="${esc(searchOn(p, m.title))}" target="_blank" rel="noopener"><span class="dot" style="background:${COLORS[p]}"></span>${PLATFORMS[p]}</a>`).join('')}</div>
    <div class="d-actions">
      ${seen ? '' : `<button class="btn ${inWish(m) ? 'secondary' : 'primary'}" id="addWish" aria-pressed="${inWish(m)}">${inWish(m) ? '✓ Je veux voir' : '☆ Je veux voir'}</button>`}
      <a class="btn secondary" href="https://anilist.co/anime/${m.id}" target="_blank" rel="noopener">Voir sur AniList</a>
    </div>
    ${(m.manga || []).length ? mangaBox(m.manga[0]) : ''}
    ${m.description ? `<p class="d-desc">${esc(m.description)}</p><p class="d-desc-src">Résumé en anglais, source AniList.</p>` : ''}
    ${rels.length ? `<h3 class="d-section">Saisons, films et histoires liées</h3><div class="rels">${rels.map((r) => `
      <button class="rel" data-rel="${r.id}"><div class="thumb">${img(r.cover, r.title)}</div>
        <div class="r-kind">${esc(REL[r.rel])}</div><div class="r-title">${esc(r.title)}</div><div class="r-meta">${esc(facts(r))}</div></button>`).join('')}</div>` : ''}`;
  $('drawer').scrollTop = 0;
  $('overlay').hidden = false;
  $('drawer').classList.add('open');
  $('drawer').setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => $('drawerClose').focus({ preventScroll: true }));
}
// le manga d'origine : où le lire légalement (liens officiels d'AniList)
function mangaBox(x) {
  const links = (x.links || []).filter((l) => safeUrl(l.url)).slice(0, 3);
  const facts = [x.status === 'FINISHED' ? 'Terminé' : x.status === 'RELEASING' ? 'En cours de parution' : '', x.volumes ? `${x.volumes} tomes` : '', x.chapters ? `${x.chapters} chapitres` : ''].filter(Boolean).join(' · ');
  return `<h3 class="d-section">Le manga</h3>
    <div class="manga-box">${img(x.cover, x.title).replace('<img ', '<img class="m-cover" ')}
      <div><b>${esc(x.title)}</b>${facts ? `<div class="m-facts">${esc(facts)}</div>` : ''}
        <div class="where">${links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.site)}</a>`).join('')}<a href="https://anilist.co/manga/${x.id}" target="_blank" rel="noopener">Où le lire</a></div>
      </div></div>`;
}
const searchOn = (p, q) => ({
  crunchyroll: `https://www.crunchyroll.com/search?q=${encodeURIComponent(q)}`,
  adn: `https://animationdigitalnetwork.com/video?search=${encodeURIComponent(q)}`,
  netflix: `https://www.netflix.com/search?q=${encodeURIComponent(q)}`,
}[p]);
function closeDetail() {
  $('drawer').classList.remove('open');
  $('drawer').setAttribute('aria-hidden', 'true');
  $('overlay').hidden = true;
  const back = current && document.querySelector(`.card[data-id="${current.id}"]`);
  if (back) back.focus({ preventScroll: true });
}
async function openById(id) {
  const local = results.find((m) => m.id === id);
  if (local && local.relations) return openDetail(local);
  $('dBody').innerHTML = '<p class="loading">Chargement…</p>';
  const r = await send({ type: 'animeById', id });
  if (r.media) openDetail(r.media);
  else $('dBody').innerHTML = `<p class="loading">${esc(r.error || 'Fiche introuvable.')}</p>`;
}

$('grid').addEventListener('click', (e) => { const c = e.target.closest('.card'); if (c) openById(+c.dataset.id); });
$('grid').addEventListener('keydown', (e) => { const c = e.target.closest('.card'); if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openById(+c.dataset.id); } });
$('drawer').addEventListener('click', async (e) => {
  const rel = e.target.closest('[data-rel]');
  if (rel) return openById(+rel.dataset.rel);
  const wb = e.target.closest('#addWish');
  if (wb && current) {
    // « Je veux voir » : dans Ma liste et, dès que les dates sont connues, dans le Calendrier
    const on = !inWish(current);
    const where = whereToWatch(current);
    const platform = (where.find((l) => l.p && l.mine) || where.find((l) => l.p) || { p: 'crunchyroll' }).p;
    wb.disabled = true;
    await send({ type: 'wantAnime', media: current, platform, on });
    for (const t of current.titles) on ? mine.wish.add(norm(t)) : mine.wish.delete(norm(t));
    wb.disabled = false;
    wb.textContent = on ? '✓ Je veux voir' : '☆ Je veux voir';
    wb.className = `btn ${on ? 'secondary' : 'primary'}`;
    wb.setAttribute('aria-pressed', String(on));
    const c = document.querySelector(`.card[data-id="${current.id}"]`);
    if (c) c.outerHTML = card(current);
  }
});
$('drawerClose').onclick = closeDetail;
$('overlay').onclick = closeDetail;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDetail();
  const typing = e.target.closest && e.target.closest('input, textarea, select');
  if (e.key === '/' && !typing) { e.preventDefault(); $('q').focus(); }
});

installNetflixLinks();
initLayout(() => { if (results.length) $('grid').innerHTML = results.map(card).join(''); });

// recherche passée dans l'adresse (ex. recherche.html#frieren)
await loadMine();
const h = decodeURIComponent(location.hash.slice(1));
const byId = h.match(/^id:(\d+)$/);
if (byId) { trending(); openById(+byId[1]); }
else if (h) { $('q').value = h; search(h); } else trending();
