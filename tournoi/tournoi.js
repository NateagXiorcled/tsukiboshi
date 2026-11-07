// tsukiboshi — Tournoi : tes titres de la semaine, du mois ou de l'année s'affrontent en duels
import { participants, periodRange, periodId, periodLabel, bracketSize, firstRound, roundName } from '../lib/tournament.js';

const PLATFORMS = { netflix: 'Netflix', crunchyroll: 'Crunchyroll', adn: 'ADN', disney: 'Disney+', prime: 'Prime Video' };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
const fmtH = (s) => (s >= 3600 ? `${(Math.round(s / 360) / 10).toLocaleString('fr-FR')} h` : `${Math.round(s / 60)} min`);
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

let data = { entries: [], art: {}, meta: {}, shows: {}, tournaments: [] };
function posterOf(key) {
  return safeUrl((data.shows[key] && data.shows[key].poster) || (data.meta[key] && data.meta[key].poster) || (data.art[key] && data.art[key].poster) || '');
}
function hue(str) { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function visual(p) {
  const src = posterOf(p.key);
  if (src) return `<img src="${esc(src)}" alt="" referrerpolicy="no-referrer">`;
  const h = hue(p.title);
  return `<div class="ph" style="background:linear-gradient(135deg,hsl(${h} 45% 34%),hsl(${(h + 40) % 360} 50% 18%))">${esc(p.title.slice(0, 2).toUpperCase())}</div>`;
}
const facts = (p) => [p.movie ? 'Film' : `${p.eps} ép.`, fmtH(p.secs), PLATFORMS[p.platform]].filter(Boolean).join(' · ');

async function load() {
  const r = await chrome.storage.local.get(['entries', 'art', 'meta', 'shows', 'tournaments']);
  data = { entries: Object.values(r.entries || {}), art: r.art || {}, meta: r.meta || {}, shows: r.shows || {}, tournaments: r.tournaments || [] };
}

// ---------- accueil ----------
const PERIODS = [['week', 'Cette semaine'], ['month', 'Ce mois-ci'], ['year', 'Cette année']];
function renderHome() {
  $('periods').innerHTML = PERIODS.map(([id, label]) => {
    const list = participants(data.entries, periodRange(id));
    const n = bracketSize(list.length);
    const posters = list.slice(0, 4).map((p) => posterOf(p.key)).filter(Boolean);
    return `<button class="period" data-period="${id}" ${n ? '' : 'disabled'} role="listitem">
      <div class="p-bg">${posters.map((s) => `<img src="${esc(s)}" alt="" referrerpolicy="no-referrer">`).join('')}</div>
      <b>${label}</b>
      <span>${list.length} titre${list.length > 1 ? 's' : ''} regardé${list.length > 1 ? 's' : ''}</span>
      <span class="go">${n ? `Tournoi à ${n} →` : 'Pas assez de titres (4 minimum)'}</span>
    </button>`;
  }).join('');
  const champs = data.tournaments.slice().reverse();
  $('palmares').hidden = !champs.length;
  $('champs').innerHTML = champs.map((t) => `<div class="champ-mini">
      <div class="thumb">${visual(t.champion)}<span class="crown">👑</span></div>
      <div class="c-title">${esc(t.champion.title)}</div>
      <div class="c-when">Champion ${esc(t.label)}</div>
    </div>`).join('');
  show('home');
}
function show(id) { for (const s of ['home', 'duel', 'champion']) $(s).hidden = s !== id; window.scrollTo(0, 0); }

// ---------- tournoi ----------
let T = null; // { period, label, id, rounds: [[ {a, b, w} ]], r, m }
function start(period) {
  const list = participants(data.entries, periodRange(period));
  const pairs = firstRound(list);
  T = { period, label: periodLabel(period), id: periodId(period), rounds: [pairs.map(([a, b]) => ({ a, b, w: null }))], r: 0, m: 0, total: pairs.length * 2 - 1, done: 0 };
  show('duel');
  renderDuel();
}
function renderDuel() {
  const round = T.rounds[T.r];
  const match = round[T.m];
  $('round').textContent = roundName(round.length);
  $('match').textContent = round.length > 1 ? `Duel ${T.m + 1} sur ${round.length} · tournoi ${T.label}` : `Le dernier duel · tournoi ${T.label}`;
  $('bar').style.width = `${(T.done / T.total) * 100}%`;
  $('arena').innerHTML = `
    <button class="fighter" data-side="a">${'<div class="thumb">' + visual(match.a) + '</div>'}<div class="f-title">${esc(match.a.title)}</div><div class="f-facts">${esc(facts(match.a))}</div></button>
    <div class="vs" aria-hidden="true">VS</div>
    <button class="fighter" data-side="b">${'<div class="thumb">' + visual(match.b) + '</div>'}<div class="f-title">${esc(match.b.title)}</div><div class="f-facts">${esc(facts(match.b))}</div></button>`;
  renderBracket($('bracket'));
  $('arena').querySelector('.fighter').focus({ preventScroll: true });
}
let busy = false;
function pick(side) {
  if (busy || !T) return;
  busy = true;
  const match = T.rounds[T.r][T.m];
  match.w = side === 'a' ? match.a : match.b;
  for (const f of $('arena').querySelectorAll('.fighter')) f.classList.add(f.dataset.side === side ? 'win' : 'lose');
  T.done++;
  setTimeout(() => {
    busy = false;
    const round = T.rounds[T.r];
    if (T.m + 1 < round.length) { T.m++; return renderDuel(); }
    if (round.length === 1) return finish();
    const next = [];
    for (let i = 0; i < round.length; i += 2) next.push({ a: round[i].w, b: round[i + 1].w, w: null });
    T.rounds.push(next);
    T.r++;
    T.m = 0;
    renderDuel();
  }, 450);
}
function renderBracket(el) {
  const names = [];
  let n = T.rounds[0].length;
  while (n >= 1) { names.push(roundName(n)); n /= 2; }
  el.innerHTML = names.map((name, r) => {
    const round = T.rounds[r] || [];
    const count = T.rounds[0].length / 2 ** r;
    return `<div class="b-round"><h4>${name}</h4>${[...Array(count)].map((_, i) => {
      const m = round[i];
      const cur = T.r === r && T.m === i && !(T.rounds[T.r][T.m] || {}).w;
      return `<div class="b-match ${cur ? 'now' : ''}">${m ? [m.a, m.b].map((p) => `<div class="${m.w === p ? 'w' : ''}">${esc(p.title)}</div>`).join('') : '<div>…</div><div>…</div>'}</div>`;
    }).join('')}</div>`;
  }).join('');
}
$('arena').addEventListener('click', (e) => { const f = e.target.closest('.fighter'); if (f) pick(f.dataset.side); });
document.addEventListener('keydown', (e) => {
  if ($('duel').hidden) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); pick('a'); }
  if (e.key === 'ArrowRight') { e.preventDefault(); pick('b'); }
});
$('quit').onclick = () => { if (confirm('Quitter le tournoi en cours ?')) { T = null; renderHome(); } };

// ---------- champion ----------
function beaten(champ) {
  const out = [];
  for (const round of T.rounds) for (const m of round) if (m.w === champ) out.push(m.a === champ ? m.b : m.a);
  return out;
}
async function finish() {
  const champ = T.rounds[T.rounds.length - 1][0].w;
  const path = beaten(champ);
  T.champ = champ;
  $('champCard').innerHTML = `
    <div style="position:relative"><span class="crown-on" aria-hidden="true">👑</span><div class="thumb">${visual(champ)}</div></div>
    <div>
      <div class="kicker">Champion ${esc(T.label)}</div>
      <h1>${esc(champ.title)}</h1>
      <p class="path">A battu ${path.map((p) => `<b>${esc(p.title)}</b>`).join(', ').replace(/, ([^,]*)$/, ' et $1')}.</p>
      <p class="stats">${esc(facts(champ))}</p>
    </div>`;
  renderBracket($('finalBracket'));
  const rated = data.shows[champ.key] && data.shows[champ.key].rating;
  $('rate5').hidden = rated === 5;
  // palmarès : un champion par période (le dernier tournoi remplace le précédent)
  const now = new Date();
  const entry = { id: `${T.period}:${T.id}`, period: T.period, label: T.period === 'week' ? `de la semaine du ${weekStart(now)}` : T.label, champion: { key: champ.key, title: champ.title, platform: champ.platform }, finalist: (T.rounds[T.rounds.length - 1][0].a === champ ? T.rounds[T.rounds.length - 1][0].b : T.rounds[T.rounds.length - 1][0].a).title, size: T.rounds[0].length * 2, at: Date.now() };
  data.tournaments = data.tournaments.filter((t) => t.id !== entry.id).concat(entry).slice(-60);
  await chrome.storage.local.set({ tournaments: data.tournaments });
  show('champion');
  confetti();
}
function weekStart(now) {
  const d = new Date(periodRange('week', now).from);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['#ffc94d', '#6c4dff', '#a68bff', '#f47521', '#2fbf71', '#ff5c8a'];
  box.innerHTML = [...Array(90)].map((_, i) => `<i style="left:${Math.random() * 100}%;background:${colors[i % colors.length]};animation-delay:${Math.random() * 0.8}s;animation-duration:${2 + Math.random() * 1.6}s"></i>`).join('');
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 4500);
}
$('again').onclick = () => { T = null; load().then(renderHome); };
$('rate5').onclick = async () => {
  const { shows = {} } = await chrome.storage.local.get('shows');
  shows[T.champ.key] = { ...(shows[T.champ.key] || {}), rating: 5, updated: Date.now() };
  await chrome.storage.local.set({ shows });
  data.shows = shows;
  $('rate5').textContent = '★★★★★ Noté';
  $('rate5').disabled = true;
};

// ---------- image à partager (1080 × 1350) ----------
function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.referrerPolicy = 'no-referrer';
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
}
function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/), lines = [];
  let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  return lines;
}
async function shareImage() {
  const W = 1080, H = 1350, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  await document.fonts.ready;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#241a55'); g.addColorStop(0.55, '#121218'); g.addColorStop(1, '#0e0e11');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const champ = T.champ;
  const poster = await loadImage(posterOf(champ.key));
  const logo = await loadImage(chrome.runtime.getURL('icons/logo.svg'));
  const px = 290, py = 250, pw = 500, ph = 750;
  let drew = false;
  if (poster) {
    try {
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 50; ctx.fillStyle = '#000'; ctx.fillRect(px, py, pw, ph); ctx.restore();
      const r = Math.max(pw / poster.width, ph / poster.height), w = poster.width * r, h = poster.height * r;
      ctx.save(); ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.clip(); ctx.drawImage(poster, px + (pw - w) / 2, py + (ph - h) / 2, w, h); ctx.restore();
      c.toDataURL(); // vérifie que l'affiche peut être exportée (certains sites l'interdisent)
      drew = true;
    } catch { drew = false; }
  }
  if (!drew) {
    // affiche non exportable : on repart d'une toile propre, sans l'image
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const h0 = hue(champ.title), gg = ctx.createLinearGradient(px, py, px + pw, py + ph);
    gg.addColorStop(0, `hsl(${h0},45%,34%)`); gg.addColorStop(1, `hsl(${(h0 + 40) % 360},50%,18%)`);
    ctx.fillStyle = gg; ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = '700 120px Outfit, Inter, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(champ.title.slice(0, 2).toUpperCase(), px + pw / 2, py + ph / 2 + 40);
  }
  ctx.textAlign = 'center';
  ctx.font = '110px serif'; ctx.fillText('👑', W / 2, py - 20);
  ctx.fillStyle = '#ffc94d'; ctx.font = '700 38px Inter, sans-serif';
  ctx.fillText(`MON CHAMPION ${T.label.toUpperCase()}`, W / 2, 130);
  ctx.fillStyle = '#f2f2f5'; ctx.font = '700 72px Outfit, Inter, sans-serif';
  const lines = wrap(ctx, champ.title, W - 140).slice(0, 2);
  lines.forEach((l, i) => ctx.fillText(l, W / 2, 1100 + i * 80));
  ctx.fillStyle = '#a7a7b3'; ctx.font = '500 30px Inter, sans-serif';
  const path = beaten(champ).map((p) => p.title);
  const sub = wrap(ctx, `A battu ${path.slice(-3).join(', ')}${path.length > 3 ? '…' : ''}`, W - 160).slice(0, 2);
  sub.forEach((l, i) => ctx.fillText(l, W / 2, 1100 + lines.length * 80 + i * 40));
  if (logo) ctx.drawImage(logo, W / 2 - 150, H - 92, 54, 54);
  ctx.fillStyle = '#f2f2f5'; ctx.font = '700 40px Outfit, Inter, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('tsukiboshi', W / 2 - 84, H - 52);
  const url = c.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `tsukiboshi-champion-${T.id}.png`;
  document.body.appendChild(a); a.click(); a.remove();
  return drew;
}
$('share').onclick = async (e) => {
  const b = e.currentTarget;
  b.disabled = true;
  const withPoster = await shareImage().catch(() => null);
  b.textContent = withPoster === false ? 'Image téléchargée (sans l\'affiche, protégée par son site)' : 'Image téléchargée ✓';
  setTimeout(() => { b.textContent = 'Télécharger l\'image'; b.disabled = false; }, 3500);
};

$('periods').addEventListener('click', (e) => { const p = e.target.closest('[data-period]'); if (p && !p.disabled) start(p.dataset.period); });

await load();
renderHome();
// lancement direct depuis le Bilan (tournoi.html#year)
const h = location.hash.slice(1);
if (['week', 'month', 'year'].includes(h) && bracketSize(participants(data.entries, periodRange(h)).length)) start(h);
