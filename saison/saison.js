// tsukiboshi — calendrier saisonnier : tous les animés d'une saison (AniList), avec « Je veux voir »
import { frenchGenres } from '../lib/artwork.js';
import { platformOfLink, seasonOf, shiftSeason } from '../lib/anilist.js';
import { initLayout, isHorizontal } from '../lib/layout.js';

const PLATFORMS = { crunchyroll: 'Crunchyroll', adn: 'ADN', netflix: 'Netflix', prime: 'Prime Video', disney: 'Disney+' };
const COLORS = { netflix: '#e50914', crunchyroll: '#f47521', adn: '#0099e5', disney: '#3a67ff', prime: '#00a8e1' };
const SEASON_FR = { WINTER: 'Hiver', SPRING: 'Printemps', SUMMER: 'Été', FALL: 'Automne' };
const FORMAT = { TV: 'Série', TV_SHORT: 'Série courte', MOVIE: 'Film', OVA: 'OAV', ONA: 'ONA', SPECIAL: 'Spécial', MUSIC: 'Clip' };
const FORMATS = [['all', 'Tout'], ['tv', 'Séries'], ['movie', 'Films'], ['other', 'ONA, OAV, spéciaux']];
const fmtGroup = (f) => (f === 'TV' || f === 'TV_SHORT' ? 'tv' : f === 'MOVIE' ? 'movie' : 'other');

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
const send = (m) => chrome.runtime.sendMessage(m);

const view = { ...seasonOf(), format: 'all', platform: 'all', sort: 'pop' };
const fromHash = location.hash.slice(1).match(/^(\d{4})-(WINTER|SPRING|SUMMER|FALL)$/);
if (fromHash) { view.year = +fromHash[1]; view.season = fromHash[2]; }
let list = [];
let mine = { seen: new Set(), titles: new Set(), want: new Set() };

async function loadMine() {
  const r = await chrome.storage.local.get(['entries', 'aniIds', 'wishlist']);
  const keys = new Set(), titles = new Set();
  for (const e of Object.values(r.entries || {})) { keys.add(`${e.platform}|${norm(e.title)}`); titles.add(norm(e.title)); }
  const seen = new Set();
  for (const [k, v] of Object.entries(r.aniIds || {})) if (v && v.id && keys.has(k)) seen.add(v.id);
  mine = { seen, titles, want: new Set(Object.values(r.wishlist || {}).filter((w) => w.aniId).map((w) => w.aniId)) };
}
const isSeen = (m) => mine.seen.has(m.id) || (m.titles || []).some((t) => mine.titles.has(norm(t)));

const plats = (m) => [...new Set((m.links || []).map((l) => platformOfLink(l.site)).filter(Boolean))];
const startTs = (m) => (m.start ? new Date(m.start[0], m.start[1] - 1, m.start[2]).getTime() : Infinity);
const dayFmt = (ts, o) => new Date(ts).toLocaleDateString('fr-FR', o);
function whenOf(m) {
  if (m.nextAiring) return `Ép. ${m.nextAiring.ep} ${dayFmt(m.nextAiring.at, { weekday: 'short', day: 'numeric', month: 'short' })} à ${new Date(m.nextAiring.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  if (m.start && m.start[2] && m.start.length === 3) {
    const ts = startTs(m);
    return `${ts > Date.now() ? 'Dès le' : 'Depuis le'} ${dayFmt(ts, { day: 'numeric', month: 'long' })}`;
  }
  return m.status === 'FINISHED' ? 'Terminé' : '';
}

function hue(str) { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
const placeholder = (t) => { const h = hue(t); return `<div class="ph" style="background:linear-gradient(135deg,hsl(${h} 45% 34%),hsl(${(h + 40) % 360} 50% 18%))">${esc(t.slice(0, 2).toUpperCase())}</div>`; };
const img = (src, t, cls = '') => (safeUrl(src) ? `<img ${cls ? `class="${cls}" ` : ''}src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : placeholder(t));
const blurBg = (src) => (safeUrl(src) ? `<div class="blur" style="background-image:url('${esc(src.replace(/['()\\]/g, encodeURIComponent))}')"></div>` : '');

function card(m) {
  const seen = isSeen(m), want = mine.want.has(m.id);
  const badge = seen ? '<span class="badge mine">Déjà vu</span>' : want ? '<span class="badge wish">Je veux voir</span>' : m.status === 'RELEASING' ? '<span class="badge airing">En cours</span>' : '';
  const facts = [FORMAT[m.format] || m.format, m.format !== 'MOVIE' && m.episodes ? `${m.episodes} ép.` : '', m.studio].filter(Boolean).join(' · ');
  const p = plats(m);
  const H = isHorizontal();
  return `<article class="card" tabindex="0" data-id="${m.id}">
    <div class="thumb${H ? ' wide' : ''}">${H ? (m.banner ? img(m.banner, m.title) : blurBg(m.cover) + img(m.cover, m.title, 'fit')) : img(m.cover, m.title)}${badge}</div>
    <div class="meta">
      <div class="c-platform">${esc(facts)}</div>
      <div class="c-title">${esc(m.title)}</div>
      <div class="c-when">${esc(whenOf(m))}</div>
      <div class="c-genres">${esc(frenchGenres(m.genres, 'anime').filter((g) => g !== 'Animé').slice(0, 3).join(' · '))}</div>
      ${p.length ? `<div class="c-plats">${p.map((x) => `<span><i class="dot" style="background:${COLORS[x]}"></i>${PLATFORMS[x]}</span>`).join('')}</div>` : ''}
      ${seen ? '' : `<button class="want" data-want="${m.id}" aria-pressed="${want}">${want ? '✓ Je veux voir' : '☆ Je veux voir'}</button>`}
    </div>
  </article>`;
}

function filtered() {
  const out = list.filter((m) => (view.format === 'all' || fmtGroup(m.format) === view.format) && (view.platform === 'all' || plats(m).includes(view.platform)));
  const by = {
    pop: (a, b) => (b.popularity || 0) - (a.popularity || 0),
    start: (a, b) => startTs(a) - startTs(b),
    score: (a, b) => (b.score || 0) - (a.score || 0),
  }[view.sort];
  return out.sort(by);
}

function renderChips() {
  const count = (f) => list.filter((m) => f === 'all' || fmtGroup(m.format) === f).length;
  $('formatChips').innerHTML = FORMATS.filter(([id]) => id === 'all' || count(id)).map(([id, label]) => `<button class="chip ${view.format === id ? 'on' : ''}" data-format="${id}">${label}<span class="n">${count(id)}</span></button>`).join('');
  const present = Object.keys(PLATFORMS).filter((p) => list.some((m) => plats(m).includes(p)));
  $('platChips').innerHTML = present.length ? [`<button class="chip ${view.platform === 'all' ? 'on' : ''}" data-plat="all">Toutes les plateformes</button>`,
    ...present.map((p) => `<button class="chip ${view.platform === p ? 'on' : ''}" data-plat="${p}"><span class="dot" style="background:${COLORS[p]}"></span>${PLATFORMS[p]}</button>`)].join('') : '';
}

function render() {
  renderChips();
  const items = filtered();
  $('grid').innerHTML = items.map(card).join('');
  $('empty').hidden = items.length > 0 || !list.length;
  $('emptyText').textContent = 'Aucun animé avec ces filtres.';
}

let req = 0;
async function load() {
  const id = ++req;
  const cur = seasonOf();
  const isNow = cur.season === view.season && cur.year === view.year;
  $('title').textContent = `${SEASON_FR[view.season]} ${view.year}`;
  $('now').hidden = isNow;
  $('sub').textContent = 'Chargement…';
  $('grid').innerHTML = '<p class="loading">Chargement de la saison…</p>';
  history.replaceState(null, '', `#${view.year}-${view.season}`);
  const r = await send({ type: 'seasonAnime', season: view.season, year: view.year });
  if (id !== req) return;
  if (r.error) {
    list = [];
    $('grid').innerHTML = '';
    $('empty').hidden = false;
    $('emptyTitle').textContent = 'Saison indisponible';
    $('emptyText').textContent = r.error;
    $('sub').textContent = '';
    return;
  }
  list = r.results || [];
  $('emptyTitle').textContent = 'Rien pour cette saison';
  const onMine = list.filter((m) => plats(m).some((p) => ['crunchyroll', 'adn', 'netflix', 'prime', 'disney'].includes(p))).length;
  $('sub').textContent = `${list.length} animé${list.length > 1 ? 's' : ''}${onMine ? ` · ${onMine} disponible${onMine > 1 ? 's' : ''} en France sur Crunchyroll, ADN, Netflix…` : ''}${isNow ? ' · saison en cours' : ''}`;
  render();
}

$('prev').onclick = () => { Object.assign(view, shiftSeason(view, -1)); load(); };
$('next').onclick = () => { Object.assign(view, shiftSeason(view, 1)); load(); };
$('now').onclick = () => { Object.assign(view, seasonOf()); load(); };
$('sort').onchange = (e) => { view.sort = e.target.value; render(); };
$('formatChips').onclick = (e) => { const b = e.target.closest('[data-format]'); if (b) { view.format = b.dataset.format; render(); } };
$('platChips').onclick = (e) => { const b = e.target.closest('[data-plat]'); if (b) { view.platform = b.dataset.plat; render(); } };

$('grid').addEventListener('click', async (e) => {
  const w = e.target.closest('[data-want]');
  if (w) {
    const m = list.find((x) => x.id === +w.dataset.want);
    if (!m) return;
    const on = !mine.want.has(m.id);
    w.disabled = true;
    await send({ type: 'wantAnime', media: m, on });
    if (on) mine.want.add(m.id); else mine.want.delete(m.id);
    const el = w.closest('.card');
    el.outerHTML = card(m);
    const again = document.querySelector(`.card[data-id="${m.id}"] [data-want]`);
    if (again) again.focus({ preventScroll: true });
    return;
  }
  const c = e.target.closest('.card');
  if (c) openDetail(+c.dataset.id);
});
$('grid').addEventListener('keydown', (e) => {
  const c = e.target.closest('.card');
  if (c && e.target === c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(+c.dataset.id); }
});

// ---------- fiche d'un animé : volet par-dessus la saison (on ne quitte pas la page) ----------
let detailId = null;
function openDetail(id) {
  detailId = id;
  $('detailFrame').src = `../recherche/recherche.html#id:${id}&embed`;
  $('detail').hidden = false;
  document.body.style.overflow = 'hidden';
}
async function closeDetail() {
  if ($('detail').hidden) return;
  $('detail').hidden = true;
  $('detailFrame').src = 'about:blank';
  document.body.style.overflow = '';
  // « Je veux voir » a pu changer dans la fiche : la carte est remise à jour, et le focus y revient
  await loadMine();
  const m = list.find((x) => x.id === detailId);
  const el = document.querySelector(`.card[data-id="${detailId}"]`);
  if (m && el) el.outerHTML = card(m);
  const back = document.querySelector(`.card[data-id="${detailId}"]`);
  if (back) back.focus({ preventScroll: true });
}
window.addEventListener('message', (e) => { if (e.origin === location.origin && e.data && e.data.tsuki === 'detail-close') closeDetail(); });
$('detail').addEventListener('click', (e) => { if (e.target.id === 'detail') closeDetail(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });

await loadMine();
initLayout(() => render());
load();
