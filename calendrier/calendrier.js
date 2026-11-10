// tsukiboshi — Calendrier des sorties : VO, VOSTFR et VF des épisodes des séries en cours
import { langFilter, weekOf } from '../lib/calendar.js';


const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
const DAY = 864e5;
const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const LABEL = { vo: 'VO', vostfr: 'VOSTFR', vf: 'VF' };
// (barre d'onglets déjà dans la page)

let data = { items: [], art: {}, meta: {}, shows: {}, lang: 'both', entries: {} };
let week = weekOf(Date.now());

async function load() {
  const r = await chrome.storage.local.get(['calendar', 'art', 'meta', 'shows', 'settings', 'entries']);
  data = { items: (r.calendar && r.calendar.items) || [], art: r.art || {}, meta: r.meta || {}, shows: r.shows || {}, lang: (r.settings && r.settings.lang) || 'both', entries: r.entries || {} };
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
function item(it) {
  const link = linkOf(it);
  const tag = link ? 'a' : 'div';
  const ep = `${it.season ? `S${it.season} ` : ''}E${it.ep}`;
  return `<${tag} class="rel-item ${it.seen ? 'seen' : ''}" ${link ? `href="${esc(link)}" target="_blank" rel="noopener"` : ''}>
    <div class="p">${thumb(it)}</div>
    <div><div class="t">${esc(it.title)}</div>
      <div class="m"><span class="k ${it.kind}">${LABEL[it.kind]}</span><span class="${it.estimated ? 'est' : ''}">${it.estimated ? '≈ ' : ''}${ep}${it.estimated ? '' : ' · ' + hm(it.at)}</span>${it.seen ? '<span class="ok">✓</span>' : ''}</div></div>
  </${tag}>`;
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
    return `<div class="day ${cls}"><h3>${name}<span>${day.getDate()}</span></h3>${its.length ? its.map(item).join('') : '<p class="none">—</p>'}</div>`;
  }).join('');
  // séries Crunchyroll suivies mais dates VOSTFR / VF pas encore lues : on propose la synchro
  const crSeries = new Set(data.items.filter((it) => it.platform === 'crunchyroll').map((it) => it.key));
  const crWithDates = new Set(data.items.filter((it) => it.platform === 'crunchyroll' && it.kind !== 'vo').map((it) => it.key));
  $('crHint').hidden = !crSeries.size || crWithDates.size >= crSeries.size;
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
