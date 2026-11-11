// tsukiboshi — page « Bilan » : ton année (ou tout ton historique) en chiffres
const PLATFORMS = { netflix: 'Netflix', crunchyroll: 'Crunchyroll', adn: 'ADN', disney: 'Disney+', prime: 'Prime Video' };
const COLORS = { netflix: '#e50914', crunchyroll: '#f47521', adn: '#0099e5', disney: '#3a67ff', prime: '#00a8e1' };
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const keyOf = (e) => `${e.platform}|${norm(e.title)}`;
const fmtN = (n) => Math.round(n).toLocaleString('fr-FR');
const fmtH = (sec) => (sec >= 36000 ? `${fmtN(sec / 3600)} h` : sec >= 3600 ? `${(Math.round(sec / 360) / 10).toLocaleString('fr-FR')} h` : `${Math.round(sec / 60)} min`);
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayLabel = (d) => d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

let data = { entries: [], shows: {}, meta: {}, art: {}, genres: {}, tournaments: [] };
let period = null; // année (nombre) ou 'all'
const DAY_CAP = 14 * 3600;
let capped = 0;

// Durée d'un visionnage : temps réellement regardé si connu, sinon durée de l'épisode, sinon estimation
const isMovie = (e) => !e.episode && e.platform !== 'adn';
function duration(e) {
  if (e.seconds >= 60) return { s: Math.min(e.seconds, 4 * 3600), est: false };
  if (e.length >= 60) return { s: Math.min(e.length, 4 * 3600), est: false };
  const anime = e.platform === 'crunchyroll' || e.platform === 'adn';
  return { s: (isMovie(e) ? 105 : anime ? 23 : 42) * 60, est: true };
}
// Soirée : un épisode lancé à 1 h du matin compte pour la veille au soir
function evening(e) {
  const d = new Date(e.date);
  if (e.hasTime && d.getHours() < 5) d.setDate(d.getDate() - 1);
  d.setHours(12, 0, 0, 0);
  return d;
}

async function load() {
  const r = await chrome.storage.local.get(['entries', 'shows', 'meta', 'art', 'genres', 'tournaments']);
  data = { entries: Object.values(r.entries || {}).filter((e) => e.date), shows: r.shows || {}, meta: r.meta || {}, art: r.art || {}, genres: r.genres || {}, tournaments: r.tournaments || [] };
  const years = [...new Set(data.entries.map((e) => new Date(e.date).getFullYear()))].sort((a, b) => b - a);
  if (period == null) period = years.includes(new Date().getFullYear()) ? new Date().getFullYear() : years[0] ?? 'all';
  $('period').innerHTML = years.map((y) => `<button role="tab" data-p="${y}" class="${period === y ? 'on' : ''}" aria-selected="${period === y}">${y}</button>`).join('')
    + (years.length > 1 ? `<button role="tab" data-p="all" class="${period === 'all' ? 'on' : ''}" aria-selected="${period === 'all'}">Depuis le début</button>` : '');
  render();
}
$('period').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  period = b.dataset.p === 'all' ? 'all' : +b.dataset.p;
  for (const x of $('period').children) { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); }
  render();
};

function render() {
  const list = data.entries.filter((e) => e.source !== 'marked').filter((e) => period === 'all' || evening(e).getFullYear() === period).map((e) => ({ ...e, dur: duration(e), ev: evening(e) }));
  // une journée ne peut pas dépasser 14 h : au-delà (épisodes passés en accéléré, marqués vus…), on ramène au plafond
  const perDay = new Map();
  for (const e of list) perDay.set(dayKey(e.ev), (perDay.get(dayKey(e.ev)) || 0) + e.dur.s);
  capped = 0;
  for (const e of list) {
    const tot = perDay.get(dayKey(e.ev));
    if (tot > DAY_CAP) { e.dur = { s: (e.dur.s * DAY_CAP) / tot, est: true }; e.capped = true; }
  }
  capped = [...perDay.values()].filter((t) => t > DAY_CAP).length;
  const has = list.length > 0;
  $('empty').hidden = has;
  for (const el of document.querySelectorAll('main > :not(.period):not(.empty)')) el.hidden = !has;
  if (!has) return;
  kpis(list);
  calendar(list);
  months(list);
  platforms(list);
  top(list);
  tourney();
  genres(list);
  habits(list);
  records(list);
}

// ---------- Chiffres clés ----------
function kpis(list) {
  const secs = list.reduce((t, e) => t + e.dur.s, 0);
  const est = list.filter((e) => e.dur.est).length;
  const eps = list.filter((e) => !isMovie(e)).length;
  const films = list.filter(isMovie).length;
  const series = new Set(list.filter((e) => !isMovie(e)).map(keyOf)).size;
  const days = new Set(list.map((e) => dayKey(e.ev))).size;
  const tiles = [
    [`${est / list.length > 0.2 ? '≈ ' : ''}${fmtH(secs)}`, 'regardées', `soit ${fmtN(secs / 86400)} jour${secs >= 2 * 86400 ? 's' : ''} entiers`],
    [fmtN(eps), `épisode${eps > 1 ? 's' : ''}`],
    [fmtN(series), `série${series > 1 ? 's' : ''}`],
    [fmtN(films), `film${films > 1 ? 's' : ''}`],
    [fmtN(days), `soirée${days > 1 ? 's' : ''} devant l'écran`],
  ];
  $('kpis').innerHTML = tiles.map(([v, l, t]) => `<div class="kpi"${t ? ` data-tip="${esc(t)}"` : ''}><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');
  $('note').textContent = est
    ? `≈ : la durée de ${fmtN(est)} visionnage${est > 1 ? 's' : ''} sur ${fmtN(list.length)} est estimée (la plateforme ne la donne pas) : 23 min par épisode d'animé, 42 min par épisode de série, 1 h 45 par film.`
    : '';
  if (capped) $('note').textContent += ` ${capped} journée${capped > 1 ? 's' : ''} de plus de 14 h (épisodes passés en accéléré ou marqués vus) ${capped > 1 ? 'sont ramenées' : 'est ramenée'} à 14 h.`;
}

// ---------- Calendrier (une case par soirée) ----------
function calendar(list) {
  const per = new Map();
  for (const e of list) {
    const k = dayKey(e.ev);
    const x = per.get(k) || { s: 0, n: 0, titles: new Map() };
    x.s += e.dur.s; x.n++;
    x.titles.set(e.title, (x.titles.get(e.title) || 0) + 1);
    per.set(k, x);
  }
  let start, end;
  if (period === 'all') { end = new Date(); start = new Date(end); start.setFullYear(end.getFullYear() - 1); start.setDate(start.getDate() + 1); }
  else { start = new Date(period, 0, 1); end = new Date(period, 11, 31); }
  start.setHours(12, 0, 0, 0); end.setHours(12, 0, 0, 0);
  $('calSub').textContent = period === 'all' ? '12 derniers mois' : `Année ${period}`;
  // paliers : 30 min, 1 h, 2 h, 3 h, 4 h+
  const level = (s) => (!s ? 0 : s < 1800 ? 1 : s < 3600 ? 2 : s < 7200 ? 3 : s < 10800 ? 4 : 5);
  const cells = [];
  const first = new Date(start);
  first.setDate(first.getDate() - ((first.getDay() + 6) % 7)); // lundi
  let col = 0, lastMonth = -1;
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const lastDay = new Date(end); lastDay.setDate(lastDay.getDate() + (6 - ((lastDay.getDay() + 6) % 7))); // dimanche de la dernière semaine
  for (let d = new Date(first); d <= lastDay; d.setDate(d.getDate() + 1)) {
    const wd = (d.getDay() + 6) % 7;
    if (wd === 0) {
      col++;
      // nom du mois au-dessus de la 1re semaine qui le contient
      const probe = new Date(d); probe.setDate(probe.getDate() + 6);
      const m = probe.getMonth();
      if (m !== lastMonth && probe >= start && probe <= lastDay && (period === 'all' || probe.getFullYear() === period)) {
        cells.push(`<span class="m" style="grid-column:${col}">${MONTHS[m]}</span>`);
        lastMonth = m;
      }
    }
    const inRange = d >= start && d <= end && d <= today;
    const x = per.get(dayKey(d));
    const tip = inRange ? `<b>${esc(dayLabel(d))}</b><br>${x ? `${fmtH(x.s)} · ${x.n} visionnage${x.n > 1 ? 's' : ''}<br>${esc([...x.titles].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t).join(', '))}` : 'rien regardé'}` : '';
    cells.push(`<i class="${inRange ? 'l' + level(x ? x.s : 0) : 'out'}" style="grid-column:${col};grid-row:${wd + 2}"${tip ? ` data-tip="${esc(tip)}"` : ''}></i>`);
  }
  $('cal').innerHTML = cells.join('');
}

// ---------- Heures par mois (par année pour « depuis le début ») ----------
function columns(el, rows, { unit = fmtH, labelEvery = 1 } = {}) {
  const max = Math.max(...rows.map((r) => r.v), 1);
  const maxI = rows.findIndex((r) => r.v === max);
  el.innerHTML = rows.map((r, i) => {
    const h = Math.round((r.v / max) * 100);
    return `<div class="col" data-tip="${esc(`<b>${r.full || r.x}</b><br>${unit(r.v)}${r.extra ? '<br>' + r.extra : ''}`)}">
      ${i === maxI && r.v ? `<span class="v" style="bottom:${h}%">${esc(unit(r.v))}</span>` : ''}
      <div class="b${r.v ? '' : ' zero'}" style="height:${h}%"></div>
      ${i % labelEvery === 0 ? `<span class="x">${esc(r.x)}</span>` : ''}</div>`;
  }).join('');
}
function months(list) {
  let rows;
  if (period === 'all') {
    const by = new Map();
    for (const e of list) { const y = e.ev.getFullYear(); by.set(y, (by.get(y) || 0) + e.dur.s); }
    const ys = [...by.keys()].sort();
    rows = [];
    for (let y = ys[0]; y <= ys[ys.length - 1]; y++) rows.push({ x: String(y), v: by.get(y) || 0 });
    $('barsTitle').textContent = 'Heures par année';
  } else {
    const v = Array(12).fill(0), n = Array(12).fill(0);
    for (const e of list) { v[e.ev.getMonth()] += e.dur.s; n[e.ev.getMonth()]++; }
    rows = v.map((s, i) => ({ x: MONTHS[i], full: `${MONTHS[i]} ${period}`, v: s, extra: `${n[i]} visionnage${n[i] > 1 ? 's' : ''}` }));
    $('barsTitle').textContent = 'Heures par mois';
  }
  columns($('months'), rows);
  $('monthsTable').innerHTML = `<tr><th>${period === 'all' ? 'Année' : 'Mois'}</th><th>Temps</th></tr>` + rows.map((r) => `<tr><td>${esc(r.full || r.x)}</td><td>${r.v ? esc(fmtH(r.v)) : '—'}</td></tr>`).join('');
}

// ---------- Plateformes ----------
function platforms(list) {
  const by = new Map();
  for (const e of list) by.set(e.platform, (by.get(e.platform) || 0) + e.dur.s);
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  const max = Math.max(...by.values());
  $('platforms').innerHTML = [...by].sort((a, b) => b[1] - a[1]).map(([p, s]) => `
    <li data-tip="${esc(`<b>${PLATFORMS[p]}</b><br>${fmtH(s)} · ${Math.round((s / total) * 100)} %`)}">
      <span class="name"><span class="dot" style="background:${COLORS[p]}"></span>${PLATFORMS[p] || p}</span>
      <span class="val">${Math.round((s / total) * 100)} % · ${esc(fmtH(s))}</span>
      <span class="track"><i style="width:${(s / max) * 100}%"></i></span>
    </li>`).join('');
}

// ---------- Tournoi ----------
function tourney() {
  const year = period === 'all' ? new Date().getFullYear() : period;
  const current = year === new Date().getFullYear();
  const champs = data.tournaments.filter((t) => String(t.id || '').split(':')[1]?.startsWith(String(year)));
  const yearChamp = champs.filter((t) => t.period === 'year').pop();
  const last = yearChamp || champs[champs.length - 1];
  $('tourneySub').textContent = last ? `${champs.length} tournoi${champs.length > 1 ? 's' : ''} en ${year}` : `Fais s'affronter tes titres de ${year}`;
  const src = last && posterOf(last.champion.key, []);
  const h = last ? hue(last.champion.title) : 0;
  $('tourneyBody').innerHTML = (last
    ? `<div class="champ">${src ? `<img src="${esc(src)}" alt="" referrerpolicy="no-referrer">` : `<div class="ph" style="background:linear-gradient(135deg,hsl(${h} 45% 34%),hsl(${(h + 40) % 360} 50% 18%))">${esc(last.champion.title.slice(0, 2).toUpperCase())}</div>`}
        <div><b>👑 ${esc(last.champion.title)}</b><span>Champion ${esc(last.label)}${last.finalist ? ` · finale contre ${esc(last.finalist)}` : ''}</span></div></div>`
    : `<p class="none">Pas encore de champion pour ${year}.</p>`)
    + (current ? `<a class="go" href="../tournoi/tournoi.html#year">${yearChamp ? 'Rejouer le tournoi de l\'année' : 'Lancer le tournoi de l\'année'}</a>` : '');
}

// ---------- Genres ----------
function genres(list) {
  const by = new Map();
  let known = 0, total = 0;
  for (const e of list) {
    total += e.dur.s;
    const g = (data.genres[keyOf(e)] || {}).genres || [];
    if (!g.length) continue;
    known += e.dur.s;
    for (const x of g) by.set(x, (by.get(x) || 0) + e.dur.s);
  }
  $('genresCard').hidden = !by.size;
  if (!by.size) return;
  const rows = [...by].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const max = rows[0][1];
  $('genresSub').textContent = known < total * 0.95 ? `Temps passé par genre · genres connus pour ${Math.round((known / total) * 100)} % de ton temps` : 'Temps passé par genre';
  $('genres').innerHTML = rows.map(([g, s]) => `
    <li data-tip="${esc(`<b>${esc(g)}</b><br>${fmtH(s)} · ${Math.round((s / known) * 100)} % du temps`)}">
      <span class="name">${esc(g)}</span>
      <span class="val">${esc(fmtH(s))}</span>
      <span class="track"><i style="width:${(s / max) * 100}%"></i></span>
    </li>`).join('');
}

// ---------- Top 10 ----------
function posterOf(k, items) {
  return (data.shows[k] && data.shows[k].poster) || (data.meta[k] && data.meta[k].poster) || (data.art[k] && data.art[k].poster) || (items.find((e) => e.image) || {}).image || '';
}
function hue(str) { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function top(list) {
  const by = new Map();
  for (const e of list) {
    if (isMovie(e)) continue;
    const k = keyOf(e);
    const x = by.get(k) || { k, title: e.title, platform: e.platform, s: 0, eps: new Set(), items: [] };
    x.s += e.dur.s; x.eps.add(norm(e.episode)); x.items.push(e);
    by.set(k, x);
  }
  const rows = [...by.values()].sort((a, b) => b.s - a.s).slice(0, 10);
  $('top').innerHTML = rows.map((r, i) => {
    const src = posterOf(r.k, r.items);
    const h = hue(r.title);
    const ini = r.title.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    return `<li><a href="../list/list.html#${encodeURIComponent(r.k)}">
      <div class="poster">${src ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<div class="ph" style="background:linear-gradient(135deg,hsl(${h} 45% 34%),hsl(${(h + 40) % 360} 50% 18%))">${esc(ini)}</div>`}<span class="rank">${i + 1}</span></div>
      <div class="t">${esc(r.title)}</div>
      <div class="s">${esc(fmtH(r.s))} · ${r.eps.size} ép. · ${PLATFORMS[r.platform]}</div></a></li>`;
  }).join('');
  // cadrage : image non verticale → affichée en entier
  for (const img of $('top').querySelectorAll('img')) {
    const fit = () => img.naturalWidth && img.classList.toggle('fit', Math.abs(Math.log((img.naturalWidth / img.naturalHeight) / (2 / 3))) > Math.log(1.3));
    img.complete ? fit() : img.addEventListener('load', fit, { once: true });
    img.addEventListener('error', () => img.remove(), { once: true });
  }
}

// ---------- Habitudes ----------
function habits(list) {
  const wd = Array(7).fill(0);
  for (const e of list) wd[(e.ev.getDay() + 6) % 7] += e.dur.s;
  columns($('weekdays'), wd.map((s, i) => ({ x: DAYS[i].slice(0, 3) + '.', full: DAYS[i], v: s })));
  const timed = list.filter((e) => e.hasTime);
  const hr = Array(24).fill(0);
  for (const e of timed) hr[new Date(e.date).getHours()]++;
  // de 6 h à 5 h du matin : la soirée reste d'un seul tenant
  const order = [...Array(24)].map((_, i) => (i + 6) % 24);
  columns($('hours'), order.map((h) => ({ x: `${h}h`, full: `${h} h – ${h + 1} h`, v: hr[h] })), { unit: (n) => `${fmtN(n)} lancement${n > 1 ? 's' : ''}`, labelEvery: 3 });
  const bestDay = wd.indexOf(Math.max(...wd));
  const bestH = hr.indexOf(Math.max(...hr));
  $('habitsSub').textContent = timed.length
    ? `Ton créneau : le ${DAYS[bestDay].toLowerCase()} vers ${bestH} h`
    : `Ton jour préféré : le ${DAYS[bestDay].toLowerCase()}`;
}

// ---------- Records ----------
function records(list) {
  const out = [];
  // plus longue soirée
  const per = new Map();
  for (const e of list) { const k = dayKey(e.ev); const x = per.get(k) || { s: 0, n: 0, d: e.ev }; x.s += e.dur.s; x.n++; per.set(k, x); }
  const best = [...per.values()].filter((x) => x.s < DAY_CAP - 1).sort((a, b) => b.s - a.s)[0];
  if (best) out.push(['🌙', 'Plus longue soirée', `${fmtH(best.s)} · ${best.n} visionnages · ${best.d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`]);
  // plus longue série de soirées d'affilée
  const days = [...per.keys()].sort();
  let run = 1, bestRun = 1, runEnd = days[0];
  for (let i = 1; i < days.length; i++) {
    const gap = Math.round((new Date(days[i]) - new Date(days[i - 1])) / 864e5);
    run = gap === 1 ? run + 1 : 1;
    if (run > bestRun) { bestRun = run; runEnd = days[i]; }
  }
  if (bestRun > 1) out.push(['🔥', `${bestRun} soirées d'affilée`, `jusqu'au ${new Date(runEnd).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`]);
  // série dévorée le plus vite (au moins 6 épisodes)
  const by = new Map();
  for (const e of list) { if (isMovie(e)) continue; const k = keyOf(e); const x = by.get(k) || { title: e.title, eps: new Set(), first: Infinity, last: 0 }; x.eps.add(norm(e.episode)); x.first = Math.min(x.first, +e.ev); x.last = Math.max(x.last, +e.ev); by.set(k, x); }
  const binge = [...by.values()].filter((x) => x.eps.size >= 6).map((x) => ({ ...x, days: Math.round((x.last - x.first) / 864e5) + 1 })).filter((x) => x.eps.size / x.days <= 16) /* rythme crédible */.sort((a, b) => b.eps.size / b.days - a.eps.size / a.days)[0];
  if (binge) out.push(['⚡', `${binge.title}`, `série dévorée le plus vite : ${binge.eps.size} épisodes en ${binge.days} jour${binge.days > 1 ? 's' : ''}`]);
  // série la plus regardée en épisodes
  const most = [...by.values()].sort((a, b) => b.eps.size - a.eps.size)[0];
  if (most) out.push(['📺', most.title, `le plus d'épisodes : ${fmtN(most.eps.size)}`]);
  // film le plus revu
  const films = new Map();
  for (const e of list) if (isMovie(e)) films.set(keyOf(e), { title: e.title, n: (films.get(keyOf(e))?.n || 0) + 1 });
  const fav = [...films.values()].sort((a, b) => b.n - a.n)[0];
  if (fav && fav.n > 1) out.push(['🎬', fav.title, `film le plus revu : ${fav.n} fois`]);
  // nuit la plus tardive
  const late = list.filter((e) => e.hasTime && new Date(e.date).getHours() < 5).sort((a, b) => (new Date(b.date).getHours() * 60 + new Date(b.date).getMinutes()) - (new Date(a.date).getHours() * 60 + new Date(a.date).getMinutes()))[0];
  if (late) { const d = new Date(late.date); out.push(['🦉', `Couché après ${d.getHours()} h ${pad(d.getMinutes())}`, `${late.title}${late.episode ? ' · ' + late.episode : ''} · ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`]); }
  $('records').innerHTML = out.map(([ic, b, s]) => `<li><span class="ic" aria-hidden="true">${ic}</span><div><b>${esc(b)}</b><span>${esc(s)}</span></div></li>`).join('');
}

// ---------- Infobulle ----------
const tip = $('tip');
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest('[data-tip]');
  if (!t) { tip.hidden = true; return; }
  tip.innerHTML = t.dataset.tip;
  tip.hidden = false;
});
document.addEventListener('mousemove', (e) => {
  if (tip.hidden) return;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + w > innerWidth - 8) x = e.clientX - w - 14;
  if (y + h > innerHeight - 8) y = e.clientY - h - 14;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
});
document.addEventListener('mouseleave', () => (tip.hidden = true));

chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && (c.entries || c.art || c.shows || c.genres || c.tournaments)) load(); });
load();
