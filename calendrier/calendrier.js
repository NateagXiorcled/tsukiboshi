// tsukiboshi — Calendrier des sorties : VO, VOSTFR et VF des épisodes des séries en cours
import { langFilter, weekOf } from '../lib/calendar.js';
import { initLayout } from '../lib/layout.js';


const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
const DAY = 864e5;
const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const LABEL = { vo: 'VO', vostfr: 'VOSTFR', vf: 'VF' };
// (barre d'onglets déjà dans la page)

let data = { items: [], missing: [], art: {}, meta: {}, shows: {}, lang: 'both', entries: {} };
let week = weekOf(Date.now());

async function load() {
  const r = await chrome.storage.local.get(['calendar', 'art', 'meta', 'shows', 'settings', 'entries']);
  data = { items: (r.calendar && r.calendar.items) || [], missing: (r.calendar && r.calendar.missing) || [], art: r.art || {}, meta: r.meta || {}, shows: r.shows || {}, lang: (r.settings && r.settings.lang) || 'both', entries: r.entries || {} };
  render();
}
const posterOf = (k) => safeUrl((data.shows[k] && data.shows[k].poster) || (data.meta[k] && data.meta[k].poster) || (data.art[k] && data.art[k].poster) || '');
function hue(str) { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function thumb(it) {
  const src = posterOf(it.key);
  if (src) return `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  const h = hue(it.title);
  return `<div class="ph" style="background:linear-gradient(135deg,hsl(${h} 45% 34%),hsl(${(h + 40) % 360} 50% 18%))">${esc(it.title.slice(0, 2).toUpperCase())}</div>`;
}
// lien vers la page de la série sur sa plateforme (dernier épisode vu, ou page série Crunchyroll)
function linkOf(it) {
  const m = data.meta[it.key];
  if (it.platform === 'crunchyroll' && m && m.seriesId) return `https://www.crunchyroll.com/series/${m.seriesId}`;
  return '';
}
const hm = (ts) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
// une fiche par épisode et par jour : VO, VOSTFR et VF du même épisode regroupées
function item(group) {
  const it = group[0];
  const link = linkOf(it);
  const tag = link ? 'a' : 'div';
  const ep = `${it.season ? `S${it.season} ` : ''}E${it.ep}`;
  const seen = group.some((x) => x.seen);
  const lines = group.map((x) => `<span class="k ${x.kind}">${LABEL[x.kind]}</span><span class="${x.estimated ? 'est' : ''}">${x.estimated ? '≈ ' : ''}${hm(x.at)}</span>`).join('');
  return `<${tag} class="rel-item ${seen ? 'seen' : ''}" ${link ? `href="${esc(link)}" target="_blank" rel="noopener"` : ''}>
    <div class="p">${thumb(it)}</div>
    <div><div class="t">${esc(it.title)}</div>
      <div class="m"><span class="ep">${ep}</span>${seen ? '<span class="ok">✓</span>' : ''}</div>
      <div class="m kinds">${lines}</div></div>
  </${tag}>`;
}
function groupDay(its) {
  const by = new Map();
  for (const it of its) {
    const k = `${it.key}|${it.ep}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(it);
  }
  const order = { vo: 0, vostfr: 1, vf: 2 };
  return [...by.values()].map((g) => g.sort((a, b) => order[a.kind] - order[b.kind])).sort((a, b) => a[0].at - b[0].at);
}
function render() {
  for (const b of $('langChips').children) b.classList.toggle('on', b.dataset.lang === data.lang);
  const list = data.items.filter(langFilter(data.lang));
  const start = week, end = week + 7 * DAY;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const inWeek = list.filter((it) => it.at >= start && it.at < end);
  const thisWeek = weekOf(Date.now());
  const dStart = new Date(start), dEnd = new Date(end - DAY);
  $('weekTitle').textContent = week === thisWeek ? 'Cette semaine' : week === thisWeek + 7 * DAY ? 'La semaine prochaine' : week === thisWeek - 7 * DAY ? 'La semaine dernière' : 'Semaine';
  $('weekSub').textContent = `Du ${dStart.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} au ${dEnd.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} · ${inWeek.length} sortie${inWeek.length > 1 ? 's' : ''}`;
  $('week').innerHTML = DAYS.map((name, i) => {
    const d0 = start + i * DAY;
    // décalage été/hiver : on recale chaque jour à minuit local
    const day = new Date(d0); day.setHours(0, 0, 0, 0);
    const from = day.getTime(), to = from + DAY;
    const its = inWeek.filter((it) => it.at >= from && it.at < to);
    const cls = from === today.getTime() ? 'today' : to <= today.getTime() ? 'past' : '';
    return `<div class="day ${cls}"><h3>${name}<span>${day.getDate()}</span></h3>${its.length ? groupDay(its).map(item).join('') : '<p class="none">—</p>'}</div>`;
  }).join('');
  // séries Crunchyroll suivies mais dates VOSTFR / VF pas encore lues : on propose la synchro
  const crSeries = new Set(data.items.filter((it) => it.platform === 'crunchyroll').map((it) => it.key));
  const crWithDates = new Set(data.items.filter((it) => it.platform === 'crunchyroll' && it.kind !== 'vo').map((it) => it.key));
  $('crHint').hidden = !crSeries.size || crWithDates.size >= crSeries.size;
  renderMissing();
  $('empty').hidden = data.items.length > 0;
  $('week').hidden = !data.items.length;
}
$('prev').onclick = () => { week -= 7 * DAY; week = weekOf(week + DAY / 2); render(); };
$('next').onclick = () => { week += 7 * DAY; week = weekOf(week + DAY / 2); render(); };
$('today').onclick = () => { week = weekOf(Date.now()); render(); };
$('langChips').onclick = async (e) => {
  const b = e.target.closest('[data-lang]');
  if (!b) return;
  data.lang = b.dataset.lang;
  render();
  await chrome.runtime.sendMessage({ type: 'setSettings', settings: { lang: data.lang } });
};
$('syncNow').onclick = async (e) => {
  const b = e.currentTarget;
  b.disabled = true;
  b.textContent = 'Synchro en cours… (1 à 2 min)';
  await chrome.runtime.sendMessage({ type: 'syncNow' }).catch(() => {});
  b.textContent = 'Synchro lancée ✓';
};
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && (c.calendar || c.art || c.settings)) load(); });
chrome.runtime.sendMessage({ type: 'calendarKick' }).catch(() => {});
load();

initLayout();

// ---------- séries suivies sans dates : les relier à la bonne fiche AniList ----------
const PLAT = { netflix: 'Netflix', crunchyroll: 'Crunchyroll', adn: 'ADN', disney: 'Disney+', prime: 'Prime Video' };
function renderMissing() {
  const list = data.missing || [];
  $('missing').hidden = !list.length;
  $('missingCount').textContent = list.length;
  $('missingList').innerHTML = list.map((m) => `<button class="miss" data-key="${esc(m.key)}" data-title="${esc(m.title)}"><span class="p">${thumb(m)}</span><span><b>${esc(m.title)}</b><small>${esc(PLAT[m.platform] || m.platform)} · Trouver ses dates</small></span></button>`).join('');
}
let linking = null;
async function findFor(q) {
  $('linkResults').innerHTML = '<p class="none">Recherche…</p>';
  const r = await chrome.runtime.sendMessage({ type: 'searchAnime', q }).catch(() => ({}));
  const list = (r && r.results) || [];
  $('linkResults').innerHTML = list.length ? list.slice(0, 12).map((m) => `<button class="pick" data-id="${m.id}">
      ${safeUrl(m.cover) ? `<img src="${esc(m.cover)}" alt="" referrerpolicy="no-referrer">` : '<span class="ph"></span>'}
      <span><b>${esc(m.title)}</b><small>${esc([m.year, m.format === 'MOVIE' ? 'Film' : m.episodes ? m.episodes + ' ép.' : '', m.status === 'RELEASING' ? 'en cours de diffusion' : ''].filter(Boolean).join(' · '))}</small></span></button>`).join('')
    : `<p class="none">${esc((r && r.error) || 'Aucun résultat. Essaie le titre anglais ou japonais.')}</p>`;
}
$('missingList').onclick = (e) => {
  const b = e.target.closest('.miss');
  if (!b) return;
  linking = { key: b.dataset.key, title: b.dataset.title };
  $('linkTitle').textContent = `Quelle est la série « ${linking.title} » ?`;
  $('linkQ').value = linking.title.replace(/\s*[:(\[].*$/, '');
  $('linkModal').hidden = false;
  $('linkQ').focus();
  findFor($('linkQ').value);
};
$('linkForm').onsubmit = (e) => { e.preventDefault(); findFor($('linkQ').value.trim()); };
$('linkResults').onclick = async (e) => {
  const b = e.target.closest('.pick');
  if (!b || !linking) return;
  b.disabled = true;
  await chrome.runtime.sendMessage({ type: 'linkAnime', key: linking.key, id: +b.dataset.id });
  data.missing = data.missing.filter((m) => m.key !== linking.key);
  $('linkModal').hidden = true;
  renderMissing();
  $('linkDone').hidden = false;
  setTimeout(() => { $('linkDone').hidden = true; }, 6000);
};
$('linkClose').onclick = () => { $('linkModal').hidden = true; };
$('linkModal').onclick = (e) => { if (e.target.id === 'linkModal') $('linkModal').hidden = true; };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('linkModal').hidden = true; });
