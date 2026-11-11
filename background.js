import { buildXlsx } from './xlsx.js';
import { seriesProgress } from './lib/progress.js';
import { bestArtwork, searchArtwork, sourceStats, testSources, genresFor } from './lib/artwork.js';
import { findAnimeIds, fetchMedia, searchAnime, trendingAnime, fetchAiring, seasonAnime, seasonOf, shiftSeason, platformOfLink, AniLimit } from './lib/anilist.js';
import { buildCalendar } from './lib/calendar.js';
import { seasonGroups } from './lib/progress.js';
import { computeSuites } from './lib/suites.js';
import { netflixId, netflixSearch } from './lib/nflink.js';

// Erreurs de l'extension, consultables dans la page de diagnostic (sans passer par chrome://extensions)
async function logError(where, err) {
  try {
    const { errors = [] } = await chrome.storage.local.get('errors');
    errors.push({ t: new Date().toISOString().slice(0, 19), where, msg: String((err && (err.stack || err.message)) || err).slice(0, 600) });
    await chrome.storage.local.set({ errors: errors.slice(-50) });
  } catch {}
}
self.addEventListener('error', (e) => logError('arrière-plan', e.error || e.message));
self.addEventListener('unhandledrejection', (e) => logError('arrière-plan (promesse)', e.reason));
const saveSourceStats = () => chrome.storage.session.set({ sourceStats: JSON.parse(JSON.stringify(sourceStats)) }).catch(() => {});

export const PLATFORMS = {
  netflix: 'Netflix',
  crunchyroll: 'Crunchyroll',
  adn: 'ADN',
  disney: 'Disney+',
  prime: 'Prime Video',
};

// Pages "historique" (import complet + synchro en arrière-plan)
const IMPORT_URLS = {
  netflix: 'https://www.netflix.com/viewingactivity',
  crunchyroll: 'https://www.crunchyroll.com/history',
  adn: 'https://animationdigitalnetwork.com/account/history',
  prime: 'https://www.primevideo.com/settings/watch-history',
};

// URL d'une page de lecture (pour ne pas compter les bandes-annonces en autoplay)
const WATCH_URL = {
  netflix: /\/watch\//,
  crunchyroll: /\/watch\//,
  adn: /\/video\//,
  disney: /\/(video|play)\//,
  prime: /./, // lecteur en surimpression : vérifié via le titre du lecteur
};

const MIN_SECONDS = 60; // lecture minimum pour compter un visionnage
const SYNC_EVERY_H = 6; // synchro discrète des historiques
const FILE_NAME = 'Tsukiboshi/Tsukiboshi - historique.xlsx';
const DAY = 86400000;

// ---------- verrou pour éviter les écritures concurrentes ----------
let lock = Promise.resolve();
function withLock(fn) {
  const p = lock.then(fn);
  lock = p.catch(() => {});
  return p;
}

// ---------- stockage ----------
const getLocal = async (k, def) => (await chrome.storage.local.get(k))[k] ?? def;
// historique gardé en mémoire : toutes les écritures passent par ce service, le cache suit chaque changement
let entriesCache = null;
const getEntries = async () => entriesCache || (entriesCache = await getLocal('entries', {}));
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.entries) entriesCache = c.entries.newValue || {}; });
async function getSettings() {
  return { autoExport: true, autoSync: false, notify: true, lang: 'both', layout: 'vertical', ...(await getLocal('settings', {})) };
}

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const seriesKey = (e) => `${e.platform}|${norm(e.title)}`;

// "One Piece - Épisode 1000" → série "One Piece", épisode "Épisode 1000"
function splitSeries(title) {
  const m =
    title.match(/^(.+?)\s*[-–|:]\s*((?:saison|season|s\d+|[ée]pisode|episode|ep\.?\s*\d|e\d+|oav|ova|special)\b.*)$/i) ||
    title.match(/^(.+?)\s+((?:[ée]pisode|episode|ep\.?)\s*\d+.*)$/i);
  return m ? [m[1].trim(), m[2].trim()] : [title, ''];
}

function sanitize(e) {
  const date = typeof e.date === 'number' && isFinite(e.date) ? e.date : null;
  let title = String(e.title || '').replace(/\s+/g, ' ').trim().slice(0, 300) || '(sans titre)';
  let episode = String(e.episode || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!episode) [title, episode] = splitSeries(title);
  episode = episode
    .replace(/["“”«»]/g, '')
    .replace(/^(?:saison|season|staffel|temporada)\s*(\d+)\s*[:\-–]\s*/i, 'S$1 - ')
    .trim();
  const num = (x) => (typeof x === 'number' && isFinite(x) && x > 0 ? Math.round(x) : null);
  return {
    platform: e.platform,
    profile: String(e.profile || '').trim(),
    title,
    episode,
    date,
    hasTime: !!e.hasTime && date !== null,
    prec: Math.max(1, Number(e.prec) || 1), // précision de la date en jours ("il y a 3 semaines" → 7)
    seconds: num(e.seconds),
    length: num(e.length),
    progress: typeof e.progress === 'number' && e.progress >= 0 ? Math.min(1, e.progress) : null,
    url: /^https?:\/\//i.test(e.url || '') ? String(e.url).slice(0, 600) : '', // jamais javascript:, data:…
    image: /^https?:\/\//.test(e.image || '') ? String(e.image).slice(0, 600) : '',
    seriesId: String(e.seriesId || '').slice(0, 40),
    seasonId: String(e.seasonId || '').slice(0, 40),
    seasonNum: typeof e.seasonNum === 'number' ? e.seasonNum : null,
    epNum: typeof e.epNum === 'number' ? e.epNum : null,
    source: e.source === 'live' || e.source === 'marked' ? e.source : 'import',
  };
}

// Deux libellés d'épisode désignent-ils le même épisode ? ("E1 Chapitre un" ≈ "Saison 1: Chapitre un")
function sameEpisode(a, b) {
  const A = norm(a), B = norm(b);
  if (A === B) return true;
  if (!A || !B) return false;
  // numéros d'épisode / de saison explicites : doivent être identiques
  const epNum = (s) => (s.match(/\b(?:e|ep|episode|chapitre|chapter)\s?(\d+)\b/) || [])[1];
  const seNum = (s) => (s.match(/\b(?:s|saison|season)\s?(\d+)\b/) || [])[1];
  const ea = epNum(A), eb = epNum(B), sa = seNum(A), sb = seNum(B);
  if (ea && eb && +ea !== +eb) return false;
  if (sa && sb && +sa !== +sb) return false;
  const nums = (s) => new Set(s.match(/\d+/g) || []);
  const na = nums(A), nb = nums(B);
  const [small, big] = na.size <= nb.size ? [na, nb] : [nb, na];
  for (const n of small) if (!big.has(n)) return false;
  const words = (s) => new Set(s.split(' ').filter((w) => !/\d/.test(w) && !/^(saison|season|episode|ep|e|s|chapitre|chapter)$/.test(w)));
  const wa = words(A), wb = words(B);
  if (!wa.size || !wb.size) return small.size > 0 && na.size === nb.size;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / Math.min(wa.size, wb.size) >= 0.5;
}

function sameView(a, b) {
  if (a.profile && b.profile && a.profile !== b.profile) return false;
  // deux lignes d'historique : libellés identiques obligatoires (le rapprochement approximatif
  // ne sert qu'entre un visionnage suivi en direct et la même ligne retrouvée dans l'historique)
  if (a.source === 'import' && b.source === 'import') {
    if (norm(a.episode) !== norm(b.episode)) return false;
  } else if (!sameEpisode(a.episode, b.episode)) return false;
  if (a.date == null || b.date == null) return true;
  // deux lignes d'historique avec une date précise : même jour obligatoire
  if (a.source === 'import' && b.source === 'import' && a.prec <= 1 && b.prec <= 1) {
    const da = new Date(a.date), db = new Date(b.date);
    return da.toDateString() === db.toDateString() && (!a.hasTime || !b.hasTime || Math.abs(a.date - b.date) < 60000);
  }
  return Math.abs(a.date - b.date) <= Math.max(a.prec, b.prec) * DAY + DAY / 2;
}

// Ajoute ou fusionne une entrée ; retourne [clé, ajoutée?]
function upsert(entries, index, raw) {
  const e = sanitize(raw);
  const sk = seriesKey(e);
  for (const k of index.get(sk) || []) {
    const x = entries[k];
    if (!sameView(x, e)) continue;
    // fusion : on garde l'info la plus précise
    if (x.date == null || (e.date != null && ((e.hasTime && !x.hasTime) || e.prec < x.prec))) {
      x.date = e.date; x.hasTime = e.hasTime; x.prec = e.prec;
    }
    if (e.episode.length > x.episode.length && e.source === 'import') x.episode = e.episode;
    x.seconds = Math.max(x.seconds || 0, e.seconds || 0) || null;
    x.length = x.length || e.length;
    if (e.image) x.image = e.image;
    for (const f of ['seriesId', 'seasonId', 'seasonNum', 'epNum']) if (e[f] != null && e[f] !== '') x[f] = e[f];
    if (e.progress != null) x.progress = Math.max(x.progress || 0, e.progress);
    x.profile = x.profile || e.profile;
    if (!x.url || (e.source === 'import' && e.url)) x.url = e.url || x.url;
    return [k, false];
  }
  const k = `${sk}|${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  entries[k] = e;
  if (!index.has(sk)) index.set(sk, []);
  index.get(sk).push(k);
  return [k, true];
}

function buildIndex(entries) {
  const index = new Map();
  for (const [k, e] of Object.entries(entries)) {
    const sk = seriesKey(e);
    if (!index.has(sk)) index.set(sk, []);
    index.get(sk).push(k);
  }
  return index;
}

function addEntries(list) {
  return withLock(async () => {
    const entries = await getEntries();
    const index = buildIndex(entries);
    let added = 0;
    // épisodes marqués « vus » (sur le site ou dans l'app) : ignorés s'ils sont déjà dans l'historique
    let known = null;
    const epKey = (e) => `${seriesKey(e)}|${norm(String(e.episode || '').replace(/\s+-\s+.*$/, ''))}`;
    for (const raw of list) {
      if (!PLATFORMS[raw.platform]) continue;
      if (raw.source === 'marked') {
        if (!known) known = new Set(Object.values(entries).filter((e) => e.episode).map(epKey));
        if (!raw.episode || known.has(epKey(raw))) continue;
        known.add(epKey(raw));
      }
      if (upsert(entries, index, raw)[1]) added++;
    }
    await chrome.storage.local.set({ entries });
    if (list.length) scheduleExport();
    return { added, total: Object.keys(entries).length };
  });
}

// si le navigateur a coupé l'extension pendant un export discret, la bulle des téléchargements pouvait rester masquée
try { chrome.downloads.setUiOptions({ enabled: true }).catch(() => {}); } catch {}

// ---------- Excel ----------
let exportTimer = null;
async function scheduleExport() {
  if (!(await getSettings()).autoExport) return;
  clearTimeout(exportTimer);
  exportTimer = setTimeout(() => exportExcel().catch(console.error), 4000);
}

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const minutes = (s) => (s ? Math.round(s / 6) / 10 : null);
const dateCell = (e) => (e.date ? { date: e.date, hasTime: false } : null);
const timeCell = (e) => (e.date && e.hasTime ? { time: e.date } : null);
const pctCell = (e) =>
  e.seconds && e.length ? { pct: Math.min(1, e.seconds / e.length) } : e.progress != null ? { pct: e.progress } : null;
const byDateDesc = (a, b) => (b.date ?? -Infinity) - (a.date ?? -Infinity);

export const STATUS_LABEL = { progress: 'En cours', done: 'Vu', list: 'Ajouté à la liste', dropped: 'Abandonné' };
// Statut d'une série : choix manuel dans « Ma liste », sinon film = Vu, série = En cours
export function showStatus(key, items, shows, meta) {
  const s = shows && shows[key] && shows[key].status;
  if (s) return s;
  if (items.every((e) => !e.episode)) return 'done';
  const p = meta && meta[key] ? seriesProgress(items, meta[key]) : null;
  return p && p.complete ? 'done' : 'progress';
}

export function buildSheets(entries, shows = {}, meta = {}, genres = {}) {
  const list = Object.values(entries).sort(byDateDesc);
  const sheets = [];

  // --- Regroupement par série / anime ---
  const groups = new Map();
  for (const e of list) {
    const k = seriesKey(e);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const gl = [...groups.values()].map((items) => {
    const dated = items.filter((e) => e.date);
    return {
      items: items.slice().sort((a, b) => (a.date ?? Infinity) - (b.date ?? Infinity)),
      head: items[0],
      episodes: new Set(items.map((e) => norm(e.episode))).size,
      first: dated.length ? Math.min(...dated.map((e) => e.date)) : null,
      last: dated.length ? Math.max(...dated.map((e) => e.date)) : null,
      secs: items.reduce((s, e) => s + (e.seconds || 0), 0),
    };
  });
  gl.sort((a, b) => (b.last ?? -Infinity) - (a.last ?? -Infinity));

  const grouped = [];
  for (const g of gl) {
    grouped.push({
      kind: 'g',
      cells: [g.head.title, PLATFORMS[g.head.platform], g.head.profile, g.episodes, g.last ? { date: g.last } : null, null, minutes(g.secs), null, null],
    });
    for (const e of g.items) {
      grouped.push({
        outline: 1,
        cells: ['      ' + (e.episode || '(film / sans épisode)'), null, null, null, dateCell(e), timeCell(e), minutes(e.seconds), pctCell(e), e.url],
      });
    }
  }
  sheets.push({
    name: 'Par série',
    noFilter: true,
    columns: [
      { header: 'Série / Épisode', width: 55 },
      { header: 'Plateforme', width: 13 },
      { header: 'Profil', width: 12 },
      { header: 'Épisodes vus', width: 12 },
      { header: 'Date', width: 12 },
      { header: 'Heure', width: 8 },
      { header: 'Temps regardé (min)', width: 12 },
      { header: 'Progression', width: 11 },
      { header: 'Lien', width: 45 },
    ],
    rows: grouped,
  });

  sheets.push({
    name: 'Séries',
    columns: [
      { header: 'Série / Film', width: 45 },
      { header: 'Plateforme', width: 13 },
      { header: 'Statut', width: 16 },
      { header: 'Progression', width: 13 },
      { header: 'Épisodes vus', width: 12 },
      { header: 'Visionnages', width: 12 },
      { header: 'Premier visionnage', width: 18 },
      { header: 'Dernier visionnage', width: 18 },
      { header: 'Temps total (h)', width: 13 },
      { header: 'Genres', width: 28 },
      { header: 'Sortie', width: 8 },
      { header: 'Ma note', width: 9 },
      { header: 'Favori', width: 8 },
      { header: 'Mon avis', width: 50 },
    ],
    rows: gl.map((g) => [
      g.head.title,
      PLATFORMS[g.head.platform],
      STATUS_LABEL[showStatus(seriesKey(g.head), g.items, shows, meta)],
      (() => { const p = meta[seriesKey(g.head)] && seriesProgress(g.items, meta[seriesKey(g.head)]); return p ? `${p.watched} / ${p.total}` : null; })(),
      g.episodes,
      g.items.length,
      g.first ? { date: g.first } : null,
      g.last ? { date: g.last } : null,
      g.secs ? Math.round(g.secs / 360) / 10 : null,
      ((genres[seriesKey(g.head)] || {}).genres || []).join(', ') || null,
      (genres[seriesKey(g.head)] || {}).year || null,
      ...(() => { const x = shows[seriesKey(g.head)] || {}; return [x.rating ? '★'.repeat(x.rating) + '☆'.repeat(5 - x.rating) : null, x.fav ? '♥' : null, x.review || null]; })(),
    ]),
  });

  // --- Liste chronologique complète ---
  const columns = [
    { header: 'Date', width: 12 },
    { header: 'Heure', width: 8 },
    { header: 'Plateforme', width: 13 },
    { header: 'Profil', width: 12 },
    { header: 'Série / Titre', width: 40 },
    { header: 'Épisode', width: 45 },
    { header: 'Temps regardé (min)', width: 12 },
    { header: 'Durée (min)', width: 10 },
    { header: 'Progression', width: 11 },
    { header: 'Source', width: 12 },
    { header: 'Lien', width: 45 },
  ];
  const row = (e) => [
    dateCell(e), timeCell(e), PLATFORMS[e.platform], e.profile, e.title, e.episode,
    minutes(e.seconds), minutes(e.length), pctCell(e),
    e.source === 'live' ? 'Suivi auto' : e.source === 'marked' ? 'Marqué vu' : 'Historique', e.url,
  ];
  sheets.push({ name: 'Tout', columns, rows: list.map(row) });

  const summary = [];
  for (const p of Object.keys(PLATFORMS)) {
    const sub = list.filter((e) => e.platform === p);
    if (!sub.length) continue;
    sheets.push({ name: PLATFORMS[p], columns, rows: sub.map(row) });
    const dated = sub.filter((e) => e.date);
    summary.push([
      PLATFORMS[p],
      sub.length,
      new Set(sub.map(seriesKey)).size,
      dated.length ? { date: Math.min(...dated.map((e) => e.date)) } : null,
      dated.length ? { date: Math.max(...dated.map((e) => e.date)) } : null,
      Math.round(sub.reduce((s, e) => s + (e.seconds || 0), 0) / 360) / 10 || null,
    ]);
  }
  sheets.push({
    name: 'Résumé',
    columns: [
      { header: 'Plateforme', width: 15 },
      { header: 'Visionnages', width: 12 },
      { header: 'Séries / films', width: 14 },
      { header: 'Premier', width: 12 },
      { header: 'Dernier', width: 12 },
      { header: 'Temps total (h)', width: 14 },
    ],
    rows: summary,
  });
  return sheets;
}

// Téléchargement discret : pas de bulle de téléchargement, et retiré de la liste des téléchargements
async function exportExcel() {
  const entries = await getEntries();
  const bytes = await buildXlsx(buildSheets(entries, await getLocal('shows', {}), await getLocal('meta', {}), await getLocal('genres', {})));
  const url = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + toBase64(bytes);

  let hidden = false;
  try {
    await chrome.downloads.setUiOptions({ enabled: false });
    hidden = true;
  } catch {}
  const restore = () => hidden && chrome.downloads.setUiOptions({ enabled: true }).catch(() => {});

  const id = await chrome.downloads.download({ url, filename: FILE_NAME, conflictAction: 'overwrite', saveAs: false });
  const done = (d) => {
    if (d.id !== id || !d.state || d.state.current === 'in_progress') return;
    chrome.downloads.onChanged.removeListener(done);
    if (d.state.current === 'complete') chrome.downloads.erase({ id }).catch(() => {});
    restore();
  };
  chrome.downloads.onChanged.addListener(done);
  setTimeout(restore, 15000);
  await chrome.storage.local.set({ lastExport: Date.now() });
  setTimeout(() => autoBackup().catch((e) => logError('sauvegarde automatique', e)), 20000);
}

// ---------- Sauvegarde / restauration (changement de PC, réinstallation de Chrome…) ----------
const BACKUP_KEYS = ['entries', 'shows', 'wishlist', 'meta', 'art', 'genres', 'settings', 'sync', 'profiles', 'suitesHidden', 'tournaments', 'aniIds'];
const BACKUP_AUTO = 'Tsukiboshi/Tsukiboshi - sauvegarde automatique.json';

async function backupBytes() {
  const data = await chrome.storage.local.get(BACKUP_KEYS);
  const payload = { app: 'tsukiboshi', format: 1, version: chrome.runtime.getManifest().version, date: new Date().toISOString(), data };
  return new TextEncoder().encode(JSON.stringify(payload));
}

// manuel : fichier daté, visible dans les téléchargements ; auto : un seul fichier réécrit en silence
async function backup(auto) {
  const url = 'data:application/json;base64,' + toBase64(await backupBytes());
  const filename = auto ? BACKUP_AUTO : `Tsukiboshi/Tsukiboshi - sauvegarde ${new Date().toISOString().slice(0, 10)}.json`;
  let hidden = false;
  if (auto) {
    try { await chrome.downloads.setUiOptions({ enabled: false }); hidden = true; } catch {}
  }
  const restoreUi = () => hidden && chrome.downloads.setUiOptions({ enabled: true }).catch(() => {});
  const id = await chrome.downloads.download({ url, filename, conflictAction: auto ? 'overwrite' : 'uniquify', saveAs: false });
  if (auto) {
    const done = (d) => {
      if (d.id !== id || !d.state || d.state.current === 'in_progress') return;
      chrome.downloads.onChanged.removeListener(done);
      if (d.state.current === 'complete') chrome.downloads.erase({ id }).catch(() => {});
      restoreUi();
    };
    chrome.downloads.onChanged.addListener(done);
    setTimeout(restoreUi, 15000);
  }
  await chrome.storage.local.set({ lastBackup: Date.now() });
  return filename;
}

// sauvegarde automatique au plus une fois par jour, après une mise à jour de l'Excel
async function autoBackup() {
  if (Date.now() - (await getLocal('lastBackup', 0)) < 20 * 3600000) return;
  if (!Object.keys(await getEntries()).length) return;
  await backup(true);
}

// fusion : rien de ce qui est déjà dans l'extension n'est perdu
async function restoreBackup(payload) {
  if (!payload || payload.app !== 'tsukiboshi' || !payload.data) throw new Error("ce fichier n'est pas une sauvegarde Tsukiboshi");
  const d = payload.data;
  const before = Object.keys(await getEntries()).length;
  await addEntries(Object.values(d.entries || {}));
  const after = Object.keys(await getEntries()).length;
  const out = { lignes: after - before, total: after };
  await withLock(async () => {
    const cur = await chrome.storage.local.get(['shows', 'wishlist', 'meta', 'art', 'genres', 'settings', 'sync', 'profiles', 'suitesHidden', 'tournaments', 'aniIds']);
    const merge = (a = {}, b = {}, keep) => {
      const o = { ...a };
      for (const [k, v] of Object.entries(b)) if (!(k in o) || keep(o[k], v)) o[k] = v;
      return o;
    };
    const shows = merge(cur.shows, d.shows, (x, y) => (y.updated || 0) > (x.updated || 0)); // choix manuels les plus récents
    const art = merge(cur.art, d.art, (x, y) => !x.poster && !!y.poster);
    const genres = merge(cur.genres, d.genres, (x, y) => !(x.genres || []).length && !!(y.genres || []).length);
    const meta = merge(cur.meta, d.meta, (x, y) => (y.fetched || 0) > (x.fetched || 0));
    const wishlist = merge(cur.wishlist, d.wishlist, () => false);
    const settings = { ...(d.settings || {}), ...(cur.settings || {}) };
    if (!settings.tmdbKey && d.settings && d.settings.tmdbKey) settings.tmdbKey = d.settings.tmdbKey;
    const sync = merge(cur.sync, d.sync, () => false);
    const profiles = merge(cur.profiles, d.profiles, () => false);
    out.choix = Object.keys(shows).length - Object.keys(cur.shows || {}).length;
    out.affiches = Object.values(art).filter((a) => a.poster).length - Object.values(cur.art || {}).filter((a) => a.poster).length;
    const suitesHidden = { ...(d.suitesHidden || {}), ...(cur.suitesHidden || {}) };
    // palmarès des tournois (un par période, le plus récent gagne) et séries reliées à la main dans le calendrier
    const tBy = new Map();
    for (const t of [...(d.tournaments || []), ...(cur.tournaments || [])]) if (t && t.id && (!tBy.has(t.id) || (t.at || 0) > (tBy.get(t.id).at || 0))) tBy.set(t.id, t);
    const tournaments = [...tBy.values()].sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-200);
    const aniIds = merge(cur.aniIds, d.aniIds, (x, y) => !x.manual && (!!y.manual || (!x.id && !!y.id)));
    await chrome.storage.local.set({ shows, art, genres, meta, wishlist, settings, sync, profiles, suitesHidden, tournaments, aniIds });
  });
  scheduleExport();
  return out;
}

// ---------- suivi en direct ----------
function cleanUrl(u) {
  try {
    const x = new URL(u);
    return x.origin + x.pathname;
  } catch {
    return u || '';
  }
}

function onHeartbeat(msg, sender) {
  const tab = sender.tab;
  if (!tab || !tab.url || !PLATFORMS[msg.platform]) return;
  return withLock(async () => {
    if (!WATCH_URL[msg.platform].test(new URL(tab.url).pathname)) return;
    const { pending = {} } = await chrome.storage.session.get('pending');
    if (pending[tab.id]) return; // onglet de synchro

    const url = cleanUrl(tab.url);
    const { play = {} } = await chrome.storage.session.get('play');
    let s = play[tab.id];
    const entries = await getEntries();
    if (!s || s.url !== url) {
      if (s?.key) { await flushSeconds(entries, s); scheduleExport(); } // épisode précédent terminé → met à jour l'Excel
      s = { url, seconds: 0, key: null };
    }
    // jamais plus que le temps réellement écoulé (deux lecteurs dans la même page ne comptent pas double)
    const beat = Date.now();
    s.seconds += Math.max(0, Math.min(msg.delta || 0, 15, s.at ? (beat - s.at) / 1000 + 0.5 : 15));
    s.at = beat;
    play[tab.id] = s;

    if (!s.key && s.seconds >= MIN_SECONDS) {
      let meta = null;
      try {
        meta = await chrome.tabs.sendMessage(tab.id, { type: 'getMeta' }, { frameId: 0 });
      } catch {}
      if (msg.platform === 'prime' && !meta?.title) {
        await chrome.storage.session.set({ play });
        return; // pas de lecteur Prime → bande-annonce
      }
      const profiles = await getLocal('profiles', {});
      const [key] = upsert(entries, buildIndex(entries), {
        platform: msg.platform,
        profile: profiles[msg.platform] || '',
        title: meta?.title || tab.title,
        episode: meta?.episode || '',
        image: meta?.image || '',
        seriesId: meta?.seriesId, seasonId: meta?.seasonId, seasonNum: meta?.seasonNum, epNum: meta?.epNum,
        date: Date.now(),
        hasTime: true,
        seconds: s.seconds,
        length: msg.length || meta?.length,
        url,
        source: 'live',
      });
      s.key = key;
      s.saved = s.seconds;
      await chrome.storage.local.set({ entries });
      scheduleExport();
    } else if (s.key && entries[s.key]) {
      if (msg.length) s.length = Math.round(msg.length);
      // temps regardé : enregistré toutes les 30 s (pas à chaque battement, la base peut peser plusieurs Mo)
      if (s.seconds - (s.saved || 0) >= 30) await flushSeconds(entries, s);
    }
    await chrome.storage.session.set({ play });
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.shows) scheduleExport();
});

// écrit le temps regardé de l'épisode en cours
async function flushSeconds(entries, s) {
  const e = s && s.key && entries[s.key];
  if (!e) return;
  const sec = Math.max(e.seconds || 0, s.seconds);
  if (sec === e.seconds && (!s.length || s.length === e.length)) return;
  e.seconds = sec;
  if (s.length) e.length = s.length;
  s.saved = s.seconds;
  await chrome.storage.local.set({ entries });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  withLock(async () => {
    const { play = {} } = await chrome.storage.session.get('play');
    if (play[tabId]?.key) { await flushSeconds(await getEntries(), play[tabId]); scheduleExport(); }
    delete play[tabId];
    await chrome.storage.session.set({ play });
  });
  // fenêtre de synchro fermée à la main : on passe tout de suite à la plateforme suivante
  syncWaiters[tabId]?.({ ok: false, reason: 'closed' });
});

// ---------- affiches automatiques (AniList / TVmaze / iTunes) ----------
let artRunning = false;
let artPriority = []; // clés visibles dans « Ma liste » : cherchées en premier
const platformName = (key) => PLATFORMS[String(key).split('|')[0]] || 'Officielle';
const NO_ART = /^(titre retiré|épisode retiré|\(sans titre\)|épisodes regardés|saison \d+|season \d+)/i;

async function artTodo() {
  const [entries, art, shows, wishlist, meta] = await Promise.all([
    getEntries(), getLocal('art', {}), getLocal('shows', {}), getLocal('wishlist', {}), getLocal('meta', {}),
  ]);
  const map = new Map();
  for (const e of Object.values(entries)) {
    const k = seriesKey(e);
    if (!map.has(k)) map.set(k, { key: k, title: e.title, platform: e.platform, last: 0, movie: true, url: '' });
    const g = map.get(k);
    g.last = Math.max(g.last, e.date || 0);
    if (e.episode) g.movie = false;
    // lien du titre ; un lien de lecture (/watch/<épisode>) mène aussi à la page de la série
    const nf = !g.url && e.platform === 'netflix' && (String(e.url || '').match(/netflix\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:title|watch)\/(\d+)/i) || [])[1];
    if (nf) g.url = `https://www.netflix.com/title/${nf}`;
  }
  for (const w of Object.values(wishlist)) {
    if (!map.has(w.key)) map.set(w.key, { key: w.key, title: w.title, platform: w.platform, last: w.added || 0, movie: false, url: '' });
  }
  const now = Date.now();
  const prio = new Map(artPriority.map((k, i) => [k, i]));
  return [...map.values()]
    .filter((g) => !NO_ART.test(g.title))
    .filter((g) => !(shows[g.key] && shows[g.key].poster) && !(meta[g.key] && meta[g.key].poster))
    .filter((g) => {
      const a = art[g.key];
      if (!a) return true;
      if (a.poster) {
        if (a.retryAt && now < a.retryAt) return false;
        // titre Netflix avec une affiche venue d'ailleurs : on essaie une fois l'image officielle Netflix
        if (g.platform === 'netflix' && g.url && !a.official && !a.nfTried) return true;
        return !!a.recheck;
      }
      if (a.retryAt) return now >= a.retryAt; // source saturée la dernière fois : on retente bientôt (jamais avant)
      if (g.platform === 'netflix' && g.url && !a.withUrl) return true; // lien Netflix récupéré depuis : image officielle possible
      return now - (a.fetched || 0) > 3 * DAY;
    })
    .sort((a, b) => (prio.has(a.key) ? prio.get(a.key) : 1e9) - (prio.has(b.key) ? prio.get(b.key) : 1e9) || b.last - a.last);
}

// Recherche en continu (8 titres en parallèle) jusqu'à épuisement ou 4 min 30.
// Une source saturée est mise en pause 10 min (les autres continuent) ; les titres concernés sont retentés 15 min plus tard.
async function artTick() {
  if (artRunning) return;
  artRunning = true;
  const start = Date.now();
  const status = async (all) => {
    const now = Date.now();
    const art = await getLocal('art', {});
    const waiting = Object.values(art).filter((a) => !a.poster && a.retryAt && a.retryAt > now).length;
    await chrome.storage.session.set({ artStatus: { remaining: all.length + waiting, running: all.length + waiting > 0, paused: !all.length && waiting > 0, at: now } });
  };
  try {
    const done = new Set(); // garde-fou : un titre n'est jamais cherché deux fois dans la même passe
    while (Date.now() - start < 270000) {
      const all = (await artTodo()).filter((g) => !done.has(g.key));
      await status(all);
      const todo = all.slice(0, 8);
      todo.forEach((g) => done.add(g.key));
      if (!todo.length) break;
      const tmdbKey = (await getSettings()).tmdbKey || '';
      const found = {};
      await Promise.all(todo.map(async (g) => {
        const now = Date.now();
        try {
          const b = await bestArtwork(g.title, { platform: g.platform, movie: g.movie, tmdbKey, url: g.url });
          found[g.key] = b && b.poster
            ? { poster: b.poster, wide: b.wide || '', source: b.source, match: b.title, kind: b.kind || '', official: !!b.official, episodes: b.episodes || null, status: b.status || null, id: b.id, fetched: now }
            : b && b.pending
              ? { poster: '', fetched: now, retryAt: now + 15 * 60000, withUrl: !!g.url }
              : { poster: '', fetched: now, withUrl: !!g.url };
          if (g.platform === 'netflix' && g.url && !(b && b.pending)) found[g.key].nfTried = true;
        } catch (e) {
          found[g.key] = { poster: '', fetched: now, retryAt: now + 15 * 60000, withUrl: !!g.url, error: String(e.message || e) };
        }
      }));
      await withLock(async () => {
        const cur = await getLocal('art', {});
        // image Netflix identique pour plusieurs titres : générique, traitée comme « pas d'image officielle »
        const shared = sharedNetflixArt(cur, Object.entries(found).filter(([, v]) => v.official && v.poster));
        for (const [k, v0] of Object.entries(found)) {
          const v = v0.official && shared.has(artImgId(v0.poster)) ? { poster: '', fetched: Date.now(), withUrl: true, nfTried: true } : v0;
          // revérification interrompue (source saturée) : on garde l'affiche actuelle et on retente plus tard
          if (!v.poster && v.retryAt && cur[k] && cur[k].poster && cur[k].recheck) cur[k] = { ...cur[k], retryAt: v.retryAt };
          // pas d'image officielle Netflix (ou rien trouvé cette fois) : on garde l'affiche déjà trouvée
          else if (!v.poster && cur[k] && cur[k].poster) cur[k] = { ...cur[k], nfTried: cur[k].nfTried || !!v.nfTried, retryAt: v.retryAt };
          else cur[k] = v;
        }
        dropSharedNetflixArt(cur, shared);
        await chrome.storage.local.set({ art: cur });
      });
      saveSourceStats();
    }
  } finally {
    artRunning = false;
    await status(await artTodo());
  }
}

// ---------- Genres et année de sortie (après les affiches, en tâche de fond) ----------
let genreRunning = false;
async function genreTodo() {
  const [entries, genres, wishlist] = await Promise.all([getEntries(), getLocal('genres', {}), getLocal('wishlist', {})]);
  const map = new Map();
  for (const e of Object.values(entries)) {
    const k = seriesKey(e);
    if (!map.has(k)) map.set(k, { key: k, title: e.title, platform: e.platform, movie: true, url: '', last: 0 });
    const g = map.get(k);
    g.last = Math.max(g.last, e.date || 0);
    if (e.episode) g.movie = false;
    const nf = !g.url && e.platform === 'netflix' && (String(e.url || '').match(/netflix\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:title|watch)\/(\d+)/i) || [])[1];
    if (nf) g.url = `https://www.netflix.com/title/${nf}`;
  }
  for (const w of Object.values(wishlist)) if (!map.has(w.key)) map.set(w.key, { key: w.key, title: w.title, platform: w.platform, movie: false, url: '', last: w.added || 0 });
  const now = Date.now();
  return [...map.values()]
    .filter((g) => !NO_ART.test(g.title))
    .filter((g) => {
      const x = genres[g.key];
      if (!x) return true;
      if (x.retryAt) return now >= x.retryAt;
      return !x.genres.length && now - (x.fetched || 0) > 7 * DAY;
    })
    .sort((a, b) => b.last - a.last);
}
async function genreTick() {
  if (genreRunning || artRunning) return;
  genreRunning = true;
  const start = Date.now();
  try {
    const done = new Set();
    while (Date.now() - start < 240000) {
      const todo = (await genreTodo()).filter((g) => !done.has(g.key)).slice(0, 8);
      todo.forEach((g) => done.add(g.key));
      if (!todo.length) break;
      const found = {};
      await Promise.all(todo.map(async (g) => {
        const now = Date.now();
        try {
          const r = await genresFor(g.title, { platform: g.platform, movie: g.movie && g.platform !== 'adn', url: g.url });
          found[g.key] = r && r.pending ? { genres: [], year: null, fetched: now, retryAt: now + 20 * 60000 }
            : { genres: (r && r.genres) || [], year: (r && r.year) || null, src: (r && r.src) || '', fetched: now };
        } catch (e) {
          found[g.key] = { genres: [], year: null, fetched: now, retryAt: now + 20 * 60000 };
        }
      }));
      await withLock(async () => {
        const cur = await getLocal('genres', {});
        await chrome.storage.local.set({ genres: { ...cur, ...found } });
      });
    }
  } finally {
    genreRunning = false;
  }
}

// ---------- Suites ratées (AniList) ----------
let suitesRunning = false;
async function animeGroups() {
  const [entries, genres, meta] = await Promise.all([getEntries(), getLocal('genres', {}), getLocal('meta', {})]);
  const map = new Map();
  for (const e of Object.values(entries)) {
    const k = seriesKey(e);
    if (!map.has(k)) map.set(k, { key: k, title: e.title, platform: e.platform, items: [], last: 0 });
    const g = map.get(k);
    g.items.push(e);
    g.last = Math.max(g.last, e.date || 0);
  }
  return [...map.values()].filter((g) => !NO_ART.test(g.title)
    && (g.platform === 'crunchyroll' || g.platform === 'adn' || ((genres[g.key] || {}).genres || []).includes('Animé')))
    .map((g) => ({ ...g, meta: meta[g.key] || null }));
}

// recalcul à partir des fiches déjà téléchargées (rapide, sans réseau)
async function recomputeSuites() {
  const [groups, ids, media, hidden] = await Promise.all([animeGroups(), getLocal('aniIds', {}), getLocal('aniMedia', {}), getLocal('suitesHidden', {})]);
  for (const g of groups) g.aniId = (ids[g.key] || {}).id || null;
  const r = computeSuites({ groups, media, hidden });
  await chrome.storage.local.set({ suites: { list: r.list, at: Date.now() } });
  return r;
}

let suitesRetry = null;
async function suitesTick() {
  if (suitesRunning || artRunning || genreRunning) {
    // occupé (affiches ou genres en cours) : on réessaie un peu plus tard plutôt que d'ignorer la demande
    if (!suitesRetry) suitesRetry = setTimeout(() => { suitesRetry = null; suitesTick(); }, 20000);
    return;
  }
  suitesRunning = true;
  const now = Date.now();
  try {
    const [groups, art] = await Promise.all([animeGroups(), getLocal('art', {})]);
    const ids = await getLocal('aniIds', {});
    // 1. identifiant AniList de chaque animé (déjà connu si l'affiche vient d'AniList)
    for (const g of groups) {
      const a = art[g.key];
      if (!ids[g.key] && a && /^anilist:\d+$/.test(a.id || '')) ids[g.key] = { id: +a.id.split(':')[1], fetched: now };
    }
    const fresh = {};
    for (const g of groups) if (ids[g.key] && ids[g.key].fetched === now) fresh[g.key] = ids[g.key];
    const todo = groups.filter((g) => !ids[g.key] || (!ids[g.key].id && !ids[g.key].manual && now - ids[g.key].fetched > 14 * DAY)).slice(0, 48);
    if (todo.length) {
      const found = await findAnimeIds(todo.map((g) => g.title));
      for (const g of todo) fresh[g.key] = ids[g.key] = { id: found[g.title] || null, fetched: now };
    }
    // écriture fusionnée : un lien fait à la main pendant la recherche (calendrier, « Je veux voir ») n'est jamais écrasé
    await withLock(async () => {
      const cur = await getLocal('aniIds', {});
      for (const [k, v] of Object.entries(fresh)) if (!cur[k] || (!cur[k].manual && !cur[k].id)) cur[k] = v;
      Object.assign(ids, cur);
      await chrome.storage.local.set({ aniIds: cur });
    });
    // 2. fiches et suites (rafraîchies chaque semaine), puis on suit la chaîne des suites
    const media = await getLocal('aniMedia', {});
    let want = [...new Set(groups.map((g) => (ids[g.key] || {}).id).filter(Boolean))].filter((id) => !media[id] || !media[id].manga || now - media[id].fetched > 7 * DAY).slice(0, 60); // fiches d'avant la 5.12 : sans le manga
    for (let round = 0; round < 4 && want.length; round++) {
      Object.assign(media, await fetchMedia(want));
      await chrome.storage.local.set({ aniMedia: media });
      const r = await recomputeSuites();
      want = r.need.filter((id) => !media[id]).slice(0, 30);
    }
    await recomputeSuites();
  } catch (e) {
    if (!(e instanceof AniLimit)) logError('suites', e);
  } finally {
    suitesRunning = false;
    if (calendarAgain) { calendarAgain = false; setTimeout(() => calendarTick(), 200); }
  }
}

// ---------- Calendrier des sorties (VO, VOSTFR, VF) ----------
let calendarRunning = false;
// séries en cours qu'on suit : regardées ces 90 derniers jours (ou en cours de diffusion), pas « Vu » ni « Abandonné »
async function followedGroups() {
  const [entries, shows, meta, genres] = await Promise.all([getEntries(), getLocal('shows', {}), getLocal('meta', {}), getLocal('genres', {})]);
  const map = new Map();
  for (const e of Object.values(entries)) {
    const k = seriesKey(e);
    if (!map.has(k)) map.set(k, { key: k, title: e.title, platform: e.platform, items: [], last: 0 });
    const g = map.get(k);
    g.items.push(e);
    g.last = Math.max(g.last, e.date || 0);
  }
  const now = Date.now();
  // « Je veux voir » : animés pas encore commencés, suivis dans le calendrier
  const wishlist = await getLocal('wishlist', {});
  const wants = Object.values(wishlist).filter((w) => w.want && w.aniId && !map.has(w.key))
    .map((w) => ({ key: w.key, title: w.title, platform: w.platform, items: [], last: 0, want: true, aniId: w.aniId, added: w.added || 0, meta: null, anime: true }));
  return [...map.values()].filter((g) => {
    const st = shows[g.key] && shows[g.key].status;
    if (st === 'done' || st === 'dropped' || NO_ART.test(g.title)) return false;
    if (g.items.every((e) => !e.episode) && g.platform !== 'adn') return false; // film
    return now - g.last < 90 * DAY || (meta[g.key] && meta[g.key].simulcast);
  }).map((g) => ({ ...g, meta: meta[g.key] || null, anime: g.platform === 'crunchyroll' || g.platform === 'adn' || ((genres[g.key] || {}).genres || []).includes('Animé') })).concat(wants);
}
// saison Crunchyroll la plus récente (hors films / OAV) d'une fiche
function latestCrSeason(meta) {
  const groups = seasonGroups(meta).filter((g) => !g.extra);
  const g = groups[groups.length - 1];
  if (!g) return null;
  const s = (meta.seasons || []).find((x) => x.id === g.ids[0]) || {};
  return { id: s.id, number: g.number, audio: s.audio || '', vers: s.vers || [], count: s.count || null };
}
// dernière saison (en cours ou annoncée) dans la chaîne des suites AniList
function currentAniId(id, media) {
  let cur = media[id], best = id;
  for (let d = 0; cur && d < 8; d++) {
    const s = (cur.relations || []).filter((r) => r.rel === 'SEQUEL' && ['TV', 'TV_SHORT', 'ONA'].includes(r.format)).sort((a, b) => (a.year || 0) - (b.year || 0))[0];
    if (!s || s.status === 'NOT_YET_RELEASED' && !s.start) break;
    best = s.id;
    cur = media[s.id];
  }
  return best;
}
// → { id, eps } ; { id: null, eps: [] } si la série est inconnue de TVmaze ; null si TVmaze n'a pas répondu (à retenter)
async function tvmazeEpisodes(title) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(title)}&embed=episodes`, { signal: ctl.signal });
    if (r.status === 404) return { id: null, eps: [] };
    if (!r.ok) return null;
    const j = await r.json();
    return { id: j.id, eps: ((j._embedded && j._embedded.episodes) || []).filter((e) => e.airstamp).map((e) => ({ s: e.season, ep: e.number, at: Date.parse(e.airstamp) })) };
  } catch { return null; } finally { clearTimeout(t); }
}

// Animés pas reconnus par leur titre (titre français de Crunchyroll / ADN…) : retrouvés par le lien de la plateforme.
// Les fiches AniList des animés de la saison donnent l'adresse Crunchyroll (numéro de série) et ADN (titre dans l'adresse).
function linkIndex(lists) {
  const byCr = new Map(), bySlug = new Map();
  for (const m of lists.flat()) {
    for (const l of m.links || []) {
      const p = platformOfLink(l.site);
      const u = String(l.url || '');
      if (p === 'crunchyroll') {
        const id = (u.match(/\/series\/([A-Z0-9]{6,})/i) || [])[1];
        if (id && !byCr.has(id.toUpperCase())) byCr.set(id.toUpperCase(), m.id);
        const slug = (u.match(/\/series\/[A-Z0-9]+\/([^/?#]+)/i) || u.match(/crunchyroll\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?([^/?#]+)\/?$/i) || [])[1];
        if (slug && !bySlug.has('crunchyroll|' + norm(slug))) bySlug.set('crunchyroll|' + norm(slug), m.id);
      } else if (p === 'adn') {
        const slug = (u.match(/\/video\/(?:\d+-)?([^/?#]+)/i) || [])[1];
        if (slug && !bySlug.has('adn|' + norm(slug))) bySlug.set('adn|' + norm(slug), m.id);
      }
    }
  }
  return { byCr, bySlug };
}
async function seasonLists(now) {
  const cache = await getLocal('seasonCache', {});
  const cur = seasonOf(now), prev = shiftSeason(cur, -1);
  const out = [];
  let changed = false;
  for (const x of [cur, prev]) {
    const id = `${x.year}-${x.season}`;
    if (!cache[id] || now - cache[id].at > 24 * 3600e3) {
      try {
        const list = (await seasonAnime(x.season, x.year, 3, false)).map(({ description, relations, manga, ...m }) => m);
        cache[id] = { at: now, list };
        changed = true;
      } catch { /* AniList indisponible : on fait avec ce qu'on a */ }
    }
    if (cache[id]) out.push(cache[id].list);
  }
  if (changed) {
    const keep = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, 4);
    await chrome.storage.local.set({ seasonCache: Object.fromEntries(keep) });
  }
  return out;
}

let calendarAgain = false; // une demande est arrivée pendant un calcul : on recommence juste après
async function calendarTick() {
  if (calendarRunning || suitesRunning) { calendarAgain = true; return; }
  calendarRunning = true;
  calendarAgain = false;
  const now = Date.now();
  try {
    const groups = await followedGroups();
    const [ids, media, crEps, tvShows, settings] = await Promise.all([getLocal('aniIds', {}), getLocal('aniMedia', {}), getLocal('crEpisodes', {}), getLocal('tvShows', {}), getSettings()]);
    // 0. animés pas reconnus par leur titre : retrouvés par le lien Crunchyroll / ADN des animés de la saison
    const unknown = groups.filter((g) => g.anime && !g.want && !(ids[g.key] && (ids[g.key].id || ids[g.key].manual)));
    if (unknown.length) {
      const { byCr, bySlug } = linkIndex(await seasonLists(now));
      const found = {};
      for (const g of unknown) {
        const sid = String((g.meta && g.meta.seriesId) || (g.items.find((e) => e.seriesId) || {}).seriesId || '').toUpperCase();
        const id = (g.platform === 'crunchyroll' && sid && byCr.get(sid)) || bySlug.get(`${g.platform}|${norm(g.title)}`);
        if (id) found[g.key] = { id, fetched: now, via: 'lien' };
      }
      if (Object.keys(found).length) {
        await withLock(async () => {
          const cur = await getLocal('aniIds', {});
          for (const [k, v] of Object.entries(found)) if (!cur[k] || (!cur[k].id && !cur[k].manual)) cur[k] = v;
          Object.assign(ids, cur);
          await chrome.storage.local.set({ aniIds: cur });
        });
      }
    }
    // 1. VO des animés : AniList, saison en cours
    const aniOf = new Map();
    for (const g of groups) {
      if (g.want) continue;
      if (ids[g.key] && ids[g.key].manual) aniOf.set(g.key, ids[g.key].id); // lié à la main depuis le calendrier
      else if (ids[g.key] && ids[g.key].via === 'lien') aniOf.set(g.key, ids[g.key].id); // fiche de la saison en cours
      else if (g.anime && ids[g.key] && ids[g.key].id) aniOf.set(g.key, currentAniId(ids[g.key].id, media));
    }
    // « Je veux voir » : la fiche choisie, sauf si la série est déjà suivie (pas de doublon dans le calendrier)
    const covered = new Map([...aniOf].map(([k, id]) => [id, k]));
    const started = [];
    for (const g of groups) {
      if (!g.want) continue;
      const k = covered.get(g.aniId);
      const base = k && groups.find((x) => x.key === k);
      if (base) { if (base.items.some((e) => (e.date || 0) > (g.added || 0))) started.push(g.key); continue; }
      aniOf.set(g.key, g.aniId);
    }
    if (started.length) {
      // commencé depuis : le titre « Je veux voir » a fait son travail, il sort de la liste
      await withLock(async () => {
        const w = await getLocal('wishlist', {});
        for (const k of started) delete w[k];
        await chrome.storage.local.set({ wishlist: w });
      });
    }
    const wantIds = [...new Set(aniOf.values())];
    let airing = await getLocal('aniAiring', {});
    const have = new Set(airing._ids || []);
    if (wantIds.length && (now - (airing._at || 0) > 6 * 3600e3 || wantIds.some((id) => !have.has(id)))) {
      try { airing = { ...(await fetchAiring(wantIds, now - 30 * DAY, now + 120 * DAY)), _at: now, _ids: wantIds }; await chrome.storage.local.set({ aniAiring: airing }); } catch (e) { if (!(e instanceof AniLimit)) logError('calendrier', e); }
    }
    // 2. VO des séries (Netflix, Prime…) : TVmaze, rafraîchi chaque semaine
    let n = 0;
    for (const g of groups) {
      if (g.anime || n >= 15) continue;
      const cur = tvShows[g.key];
      if (cur && now - cur.fetched < 7 * DAY) continue;
      const got = await tvmazeEpisodes(g.title);
      n++;
      if (!got) continue; // TVmaze n'a pas répondu : nouvel essai au prochain passage (pas dans une semaine)
      tvShows[g.key] = { ...got, fetched: now };
    }
    if (n) await chrome.storage.local.set({ tvShows });
    // 3. assemblage
    const items = [];
    const missing = [];
    const wantsDone = new Set(started);
    for (const g of groups) {
      if (g.want && (wantsDone.has(g.key) || !aniOf.has(g.key))) continue;
      let vo = [];
      if (aniOf.has(g.key)) vo = airing[aniOf.get(g.key)] || [];
      else if (!g.anime && tvShows[g.key] && tvShows[g.key].eps.length) {
        const eps = tvShows[g.key].eps;
        const last = Math.max(...eps.filter((e) => e.at <= now).map((e) => e.s), ...eps.map((e) => (e.at > now ? e.s : 0)));
        vo = eps.filter((e) => e.s === last).map((e) => ({ ep: e.ep, at: e.at }));
        g.season = last;
      }
      const cr = crEps[g.key] || null;
      const ls = g.meta && g.platform === 'crunchyroll' ? latestCrSeason(g.meta) : null;
      const its = vo.length || cr ? buildCalendar({ ...g, count: (ls && ls.count) || null }, { vo, cr, now }) : [];
      // « sans dates » : seulement les animés que personne n'a su reconnaître (une série reconnue mais terminée n'a rien à annoncer)
      if (!its.length && g.anime && !g.want && !aniOf.has(g.key) && ids[g.key]) missing.push({ key: g.key, title: g.title, platform: g.platform });
      items.push(...its);
    }
    const prev = await getLocal('calendar', {});
    await chrome.storage.local.set({ calendar: { items, missing: missing.filter((m) => !NO_ART.test(m.title)).slice(0, 60), at: now } });
    // 4. alerte : un épisode est sorti en VF (réelle, pas estimée) depuis la dernière vérification
    if (settings.lang !== 'vostfr' && settings.notify) {
      const since = prev.at || now;
      for (const it of items) {
        if (it.kind !== 'vf' || it.estimated || it.seen || it.at > now || it.at <= since) continue;
        chrome.notifications.create(`vf|${it.key}|${it.ep}`, { type: 'basic', iconUrl: 'icons/icon128.png', title: `${it.title} — épisode ${it.ep} en VF`, message: 'Disponible en version française', priority: 0 }).catch?.(() => {});
      }
    }
  } catch (e) {
    logError('calendrier', e);
  } finally {
    calendarRunning = false;
    if (calendarAgain) { calendarAgain = false; setTimeout(() => calendarTick(), 200); }
  }
}

// ---------- synchro discrète des historiques ----------
const syncWaiters = {};
let syncing = false;
let syncCurrent = null; // plateforme en cours de synchro (affichée dans le popup)

async function setPending(tabId, value) {
  const { pending = {} } = await chrome.storage.session.get('pending');
  if (value) pending[tabId] = value;
  else delete pending[tabId];
  await chrome.storage.session.set({ pending });
}

async function syncOne(platform) {
  // fenêtre réduite, jamais au premier plan ; certains navigateurs (Opera…) refusent de la créer réduite :
  // on la crée sans le focus puis on la réduit aussitôt
  let win;
  try {
    win = await chrome.windows.create({ url: IMPORT_URLS[platform], state: 'minimized', focused: false });
  } catch {
    win = await chrome.windows.create({ url: IMPORT_URLS[platform], focused: false, width: 400, height: 300, left: 0, top: 0 });
  }
  // vérifié juste après, puis une seconde fois quand la page commence à charger (certains navigateurs la ré-affichent)
  const keepMinimized = async () => {
    const w = await chrome.windows.get(win.id).catch(() => null);
    if (w && w.state !== 'minimized') await chrome.windows.update(win.id, { state: 'minimized', focused: false }).catch(() => {});
  };
  await keepMinimized();
  setTimeout(keepMinimized, 1000);
  const tabId = win.tabs[0].id;
  await chrome.tabs.update(tabId, { muted: true }).catch(() => {});
  await setPending(tabId, { platform, silent: true });
  // → { ok: true } si l'historique a été relu ; sinon la raison (pas connecté, délai dépassé, fenêtre fermée)
  const result = await new Promise((resolve) => {
    let t = 0;
    const tick = setInterval(() => {
      chrome.runtime.getPlatformInfo(); // garde le service worker éveillé
      if ((t += 10) >= 180) { clearInterval(tick); resolve({ ok: false, reason: 'timeout' }); } // 3 min au plus par plateforme
    }, 10000);
    syncWaiters[tabId] = (r) => { clearInterval(tick); resolve(r || { ok: true }); };
  });
  delete syncWaiters[tabId];
  await setPending(tabId, null);
  await chrome.windows.remove(win.id).catch(() => {});
  return result;
}

// ---------- Nouveaux épisodes (Crunchyroll) ----------
// Séries suivies : en simulcast, regardées ces 4 derniers mois, pas marquées « Vu » à la main.
const FOLLOW_DAYS = 120;
const NEW_EPS_EVERY_H = 3;
function crGroups(entries) {
  const map = new Map();
  for (const e of Object.values(entries)) {
    if (e.platform !== 'crunchyroll') continue;
    const k = seriesKey(e);
    if (!map.has(k)) map.set(k, { key: k, title: e.title, items: [], last: 0 });
    const g = map.get(k);
    g.items.push(e);
    g.last = Math.max(g.last, e.date || 0);
  }
  return map;
}
function isFollowed(g, m, shows) {
  return !!(g && m && m.simulcast && Date.now() - g.last < FOLLOW_DAYS * DAY && !(shows[g.key] && (shows[g.key].status === 'done' || shows[g.key].status === 'dropped')));
}
async function followedCount() {
  const [entries, meta, shows] = await Promise.all([getEntries(), getLocal('meta', {}), getLocal('shows', {})]);
  let n = 0;
  for (const g of crGroups(entries).values()) if (isFollowed(g, meta[g.key], shows)) n++;
  return n;
}

// appelé quand les fiches Crunchyroll sont mises à jour : un épisode de plus qu'avant, et tu étais à jour → alerte
async function detectNewEpisodes(oldMeta, newItems) {
  const [entries, shows, newEps] = await Promise.all([getEntries(), getLocal('shows', {}), getLocal('newEps', {})]);
  const groups = crGroups(entries);
  const fresh = [];
  for (const [k, m] of Object.entries(newItems)) {
    const g = groups.get(k), old = oldMeta[k];
    if (!old || !isFollowed(g, m, shows)) continue;
    const before = seriesProgress(g.items, old), after = seriesProgress(g.items, m);
    if (!before || !after || after.total <= before.total || !after.next) continue;
    if (before.watched < before.total - 1) continue; // tu avais du retard : pas d'alerte
    const n = after.total - after.watched;
    newEps[k] = { key: k, title: g.title, seriesId: m.seriesId || '', season: after.next.season ?? null, ep: after.next.ep, count: n, at: Date.now(), seen: false };
    fresh.push(newEps[k]);
  }
  if (!fresh.length) return;
  await chrome.storage.local.set({ newEps });
  await updateBadge();
  const st = await getSettings();
  if (!st.notify || st.lang === 'vf') return; // en VF : l'alerte vient du calendrier, quand la VF sort
  for (const x of fresh) {
    const ep = `${x.season != null ? `S${x.season} ` : ''}E${x.ep}`;
    chrome.notifications.create('new|' + x.key, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `${x.title} — ${ep}`,
      message: x.count > 1 ? `${x.count} nouveaux épisodes à regarder sur Crunchyroll` : 'Nouvel épisode disponible sur Crunchyroll',
      priority: 0,
    }).catch?.(() => {});
  }
}

// après chaque visionnage : une série rattrapée sort des nouveautés
async function refreshNewEps() {
  const newEps = await getLocal('newEps', {});
  if (!Object.keys(newEps).length) return updateBadge();
  const [entries, meta] = await Promise.all([getEntries(), getLocal('meta', {})]);
  const groups = crGroups(entries);
  let changed = false;
  for (const [k, x] of Object.entries(newEps)) {
    const g = groups.get(k), p = g && seriesProgress(g.items, meta[k]);
    if (!p || !p.next || Date.now() - x.at > 60 * DAY) { delete newEps[k]; changed = true; continue; }
    const n = p.total - p.watched;
    if (n !== x.count || p.next.ep !== x.ep || p.next.season !== x.season) { Object.assign(newEps[k], { count: n, ep: p.next.ep, season: p.next.season ?? null }); changed = true; }
  }
  if (changed) await chrome.storage.local.set({ newEps });
  await updateBadge();
}

async function updateBadge() {
  const n = Object.keys(await getLocal('newEps', {})).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#f47521' }).catch(() => {});
  await chrome.action.setBadgeText({ text: n ? String(n) : '' }).catch(() => {});
}

chrome.notifications.onClicked.addListener(async (id) => {
  if (!id.startsWith('new|')) return;
  const x = (await getLocal('newEps', {}))[id.slice(4)];
  const url = x && x.seriesId ? `https://www.crunchyroll.com/series/${x.seriesId}` : chrome.runtime.getURL('list/list.html');
  chrome.tabs.create({ url });
  chrome.notifications.clear(id);
});

let newEpsTimer = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(changes.entries || changes.shows)) return;
  clearTimeout(newEpsTimer);
  newEpsTimer = setTimeout(() => refreshNewEps().catch((e) => logError('nouveaux épisodes', e)), 1500);
});

async function runSync(force) {
  if (syncing) return;
  const settings = await getSettings();
  if (!settings.autoSync && !force) return;
  syncing = true;
  try {
    const sync = await getLocal('sync', {});
    for (const p of Object.keys(IMPORT_URLS)) {
      if (!sync[p]?.enabled) continue;
      // Crunchyroll plus souvent quand des séries en cours de diffusion sont suivies
      const every = p === 'crunchyroll' && (await followedCount()) ? NEW_EPS_EVERY_H : SYNC_EVERY_H;
      if (!force && Date.now() - Math.max(sync[p].last || 0, sync[p].tried || 0) < (every - 0.25) * 3600000) continue;
      syncCurrent = p;
      const res = await syncOne(p);
      const s2 = await getLocal('sync', {});
      // « synchronisé » seulement si l'historique a vraiment été relu ; sinon on garde la raison pour le popup
      s2[p] = res.ok ? { ...s2[p], last: Date.now(), error: '' } : { ...s2[p], tried: Date.now(), error: res.reason || 'timeout' };
      await chrome.storage.local.set({ sync: s2 });
    }
  } finally {
    syncing = false;
    syncCurrent = null;
  }
}

// ---------- Nouvelle version copiée dans le dossier (« Mettre a jour tsukiboshi.vbs ») : rechargement automatique ----------
// le navigateur lit les fichiers d'une extension non empaquetée directement sur le disque : un manifest.json plus récent
// que la version en cours veut dire que la mise à jour a été copiée → on se recharge pour l'utiliser
async function reloadIfUpdated() {
  try {
    const r = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' });
    const disk = (await r.json()).version;
    if (disk && newer(disk, chrome.runtime.getManifest().version)) {
      chrome.runtime.reload();
      return true;
    }
  } catch {}
  return false;
}

// ---------- Nouvelle version disponible (Releases GitHub, une fois par jour) ----------
const RELEASES = 'https://api.github.com/repos/NateagXiorcled/tsukiboshi/releases/latest';
export function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number), pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
}
async function checkUpdate(force) {
  const cur = await getLocal('update', {});
  if (!force && Date.now() - (cur.checked || 0) < 20 * 3600e3) return cur;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(RELEASES, { headers: { Accept: 'application/vnd.github+json' }, signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error('GitHub ' + r.status);
    const j = await r.json();
    const asset = (j.assets || []).find((a) => /\.zip$/i.test(a.name || ''));
    const info = { checked: Date.now(), latest: String(j.tag_name || '').replace(/^v/, ''), name: j.name || '', url: /^https:\/\/github\.com\//.test(j.html_url || '') ? j.html_url : '', zip: asset && /^https:\/\/github\.com\//.test(asset.browser_download_url || '') ? asset.browser_download_url : '' };
    await chrome.storage.local.set({ update: info });
    return info;
  } catch {
    // échec (hors ligne…) : nouvel essai dans 30 min plutôt que le lendemain
    const info = { ...cur, checked: Date.now() - 20 * 3600e3 + 30 * 60e3 };
    await chrome.storage.local.set({ update: info });
    return info;
  }
}

function setupAlarm() {
  chrome.alarms.create('sync', { delayInMinutes: 2, periodInMinutes: 60 });
  chrome.alarms.create('art', { delayInMinutes: 0.2, periodInMinutes: 1 });
  chrome.alarms.create('update', { delayInMinutes: 1, periodInMinutes: 360 });
}
// ---------- Affiches Netflix identiques sur plusieurs titres (image générique prise par erreur) ----------
const artImgId = (u) => { try { return new URL(u).pathname; } catch { return String(u || ''); } };
function sharedNetflixArt(art, extra = []) {
  const use = new Map();
  const add = (img, k) => { if (!img) return; const id = artImgId(img); if (!use.has(id)) use.set(id, new Set()); use.get(id).add(k); };
  for (const [k, a] of Object.entries(art)) if (a && a.official && k.startsWith('netflix|')) add(a.poster, k);
  for (const [k, v] of extra) if (k.startsWith('netflix|')) add(v.poster, k);
  return new Set([...use].filter(([, keys]) => keys.size >= 3).map(([id]) => id));
}
function dropSharedNetflixArt(art, shared) {
  let n = 0;
  // retirées : les autres sources reprennent la main, l'image Netflix sera recherchée à nouveau
  for (const [k, a] of Object.entries(art)) if (a && a.official && k.startsWith('netflix|') && shared.has(artImgId(a.poster))) { delete art[k]; n++; }
  return n;
}
async function repairNetflixArt() {
  await withLock(async () => {
    const art = await getLocal('art', {});
    const n = dropSharedNetflixArt(art, sharedNetflixArt(art));
    if (n) { await chrome.storage.local.set({ art }); console.log('affiches Netflix génériques retirées :', n); }
  });
}
repairNetflixArt().catch((e) => logError('réparation affiches', e));

chrome.runtime.onInstalled.addListener(() => {
  setupAlarm();
  // 5.13 : la synchro automatique (qui ouvre une fenêtre réduite) ne tourne plus sans l'accord de l'utilisateur
  withLock(async () => {
    if (await getLocal('syncConsent', false)) return;
    const st = await getLocal('settings', {});
    await chrome.storage.local.set({ settings: { ...st, autoSync: false }, syncConsent: true });
  }).catch(() => {});
  withLock(async () => {
    const art = await getLocal('art', {});
    for (const k of Object.keys(art)) if (!art[k].poster || art[k].source === 'Wikipédia' || art[k].via) delete art[k];
    // 5.1.1 : correspondance des titres plus stricte → les affiches trouvées automatiquement sont revérifiées
    // (l'affiche actuelle reste affichée en attendant ; un choix manuel n'est jamais touché)
    if ((await getLocal('artRules', 1)) < 2) {
      for (const k of Object.keys(art)) if (art[k].poster && !art[k].official) art[k].recheck = true;
      await chrome.storage.local.set({ artRules: 2 });
    }
    // (titres non trouvés : nouvelle tentative avec les sources officielles)
    await chrome.storage.local.set({ art });
    // fiches Crunchyroll enregistrées sans saisons (API indisponible à ce moment-là) : redemandées à la prochaine synchro
    const meta = await getLocal('meta', {});
    for (const k of Object.keys(meta)) if (!(meta[k].seasons && meta[k].seasons.length)) meta[k].fetched = 0; // affiche gardée
    await chrome.storage.local.set({ meta });
  }).then(() => artTick());
  migrate();
});

// Nettoyage des données des anciennes versions (lignes mal lues, menus ADN, films Netflix découpés…)
function migrate() {
  return withLock(async () => {
    const entries = await getEntries();
    let n = 0;
    const nfGroups = {};
    for (const [k, e] of Object.entries(entries)) {
      const badCr = e.source === 'import' && /^(lecture|play)\b/i.test(e.episode);
      const badPrime = e.platform === 'prime' && e.source === 'import' &&
        ((!e.episode && /\b(saison|season)\s*\d+\s*$/i.test(e.title)) || /^(épisodes regardés|episodes watched|épisodes vus)$/i.test(e.title));
      let badAdn = false;
      if (e.platform === 'adn' && e.source === 'import' && e.url) {
        try {
          const path = new URL(e.url).pathname;
          // seulement les menus (/video/genre/…, /video/order/…, /video/type/…) : les adresses d'épisodes du nouveau site
          // (/video/<série>/<épisode>, sans numéro devant) sont de vrais visionnages
          badAdn = /\/video\/(genre|genres|order|type|types|calendrier|calendar|catalogue|catalog|nouveau|nouveautes|populaire|simulcast|search|recherche)(\/|$)/.test(path);
        } catch {}
      }
      if (badCr || badPrime || badAdn) { delete entries[k]; n++; continue; }
      if (e.platform === 'netflix' && e.source === 'import' && e.episode && !/netflix\.com\/title\/\d+/.test(e.url || '')) {
        (nfGroups[e.title] = nfGroups[e.title] || new Set()).add(e.episode);
      }
      // re-normalise les libellés (nouvelle mise en forme des titres)
      const fixed = sanitize(e);
      if (fixed.title !== e.title || fixed.episode !== e.episode) { e.title = fixed.title; e.episode = fixed.episode; n++; }
      if (fixed.url !== (e.url || '')) { e.url = fixed.url; n++; }
    }
    const EP_MARK = /\b(s\d+|e\d+|saison|season|staffel|temporada|[ée]pisode|ep\.?\s*\d|chapitre|chapter|partie|part|volume|vol\.|livre|book|collection|mini-série|série limitée|limited series|\d+)\b/i;
    for (const e of Object.values(entries)) {
      const g = e.platform === 'netflix' && e.source === 'import' && e.episode && nfGroups[e.title];
      if (g && g.size === 1 && !EP_MARK.test(e.episode)) {
        e.title = `${e.title} : ${e.episode}`;
        e.episode = '';
        n++;
      }
    }
    if (n) await chrome.storage.local.set({ entries });
    return n;
  });
}
chrome.runtime.onStartup.addListener(setupAlarm);
chrome.runtime.onStartup.addListener(() => updateBadge());
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'sync') runSync(false);
  if (a.name === 'update') checkUpdate(false);
  if (a.name === 'art') reloadIfUpdated();
  if (a.name === 'art') artTick().then(() => genreTick()).then(() => suitesTick()).then(() => calendarTick()).catch((e) => logError('genres', e));
});

// ---------- messages ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handle = async () => {
    switch (msg.type) {
      case 'heartbeat':
        await onHeartbeat(msg, sender);
        return { ok: true };

      case 'addEntries':
        return addEntries(msg.entries || []);

      // séries Crunchyroll dont il faut (re)demander les infos : jamais demandées, ou anciennes (7 j, 1 j si simulcast)
      case 'crMetaTodo': {
        const entries = await getEntries();
        const meta = await getLocal('meta', {});
        const ids = new Map();
        for (const e of Object.values(entries)) {
          if (e.platform !== 'crunchyroll' || !e.seriesId) continue;
          const k = seriesKey(e);
          if (!ids.has(k)) ids.set(k, { key: k, seriesId: e.seriesId, last: e.date || 0 });
          else ids.get(k).last = Math.max(ids.get(k).last, e.date || 0);
        }
        const now = Date.now();
        const todo = [...ids.values()].filter((t) => {
          const m = meta[t.key];
          if (!m) return true;
          // séries suivies en cours de diffusion : revérifiées à chaque synchro (≈ 3 h)
          if (m.simulcast && now - t.last < FOLLOW_DAYS * DAY) return now - (m.fetched || 0) > (NEW_EPS_EVERY_H - 0.5) * 3600000;
          return now - (m.fetched || 0) > (m.simulcast ? 1 : 7) * DAY;
        });
        todo.sort((a, b) => (meta[a.key] ? 1 : 0) - (meta[b.key] ? 1 : 0) || b.last - a.last);
        return todo.slice(0, msg.max || 1000);
      }

      // titres sans aucune affiche (pour la récupération des images officielles sur le site)
      case 'artMissing': {
        const [entries, art, shows, meta] = await Promise.all([getEntries(), getLocal('art', {}), getLocal('shows', {}), getLocal('meta', {})]);
        const out = new Map();
        for (const e of Object.values(entries)) {
          if (msg.platform && e.platform !== msg.platform) continue;
          const k = seriesKey(e);
          if (out.has(k) || NO_ART.test(e.title || '')) continue;
          if ((shows[k] && shows[k].poster) || (meta[k] && meta[k].poster)) continue;
          if (art[k] && art[k].poster && (art[k].official || e.platform !== 'netflix')) continue; // Netflix : l'officielle remplace les autres
          if (art[k] && art[k].poster && art[k].nfTried) continue; // image officielle déjà cherchée une fois : pas redemandée à chaque synchro
          out.set(k, { key: k, title: e.title });
        }
        return [...out.values()];
      }

      case 'setArt': {
        await withLock(async () => {
          const art = await getLocal('art', {});
          const now = Date.now();
          const items = Object.entries(msg.items || {}).filter(([, v]) => v && v.poster);
          const shared = sharedNetflixArt(art, items);
          for (const [k, v] of items) {
            if (shared.has(artImgId(v.poster))) continue; // même image que d'autres titres : image générique, refusée
            if (art[k] && art[k].poster && art[k].official && !art[k].recheck) continue; // une affiche venue d'ailleurs est remplacée
            art[k] = { poster: v.poster, wide: v.wide || '', source: platformName(k), official: true, fetched: now, url: v.url || '' };
          }
          dropSharedNetflixArt(art, shared);
          // pages de titres lues sans image exploitable : notées pour ne pas être relues à chaque synchro
          for (const k of msg.tried || []) if (art[k] && !art[k].official) art[k].nfTried = true;
          await chrome.storage.local.set({ art });
        });
        scheduleExport();
        return { ok: true };
      }

      case 'setMeta': {
        let oldMeta = {};
        await withLock(async () => {
          const meta = await getLocal('meta', {});
          oldMeta = { ...meta };
          Object.assign(meta, msg.items || {});
          await chrome.storage.local.set({ meta });
        });
        detectNewEpisodes(oldMeta, msg.items || {}).catch((e) => logError('nouveaux épisodes', e));
        scheduleExport();
        return { ok: true };
      }

      case 'artSearch': {
        const list = await searchArtwork(msg.query, { platform: msg.platform, movie: msg.movie, tmdbKey: (await getSettings()).tmdbKey || '' });
        return list.sort((a, b) => b.score - a.score).slice(0, 16);
      }

      // « Relancer » dans Ma liste : on retente tous les titres sans affiche
      case 'artRetry': {
        await withLock(async () => {
          const art = await getLocal('art', {});
          for (const k of Object.keys(art)) if (!art[k].poster) delete art[k];
          await chrome.storage.local.set({ art });
        });
        artTick();
        return { ok: true };
      }

      case 'backup':
        return { file: await backup(false) };

      case 'restore':
        return await restoreBackup(msg.payload);

      case 'reloadIfUpdated':
        return { reloading: await reloadIfUpdated() };

      case 'linkAnime': {
        // série du calendrier sans dates : l'utilisateur choisit la bonne fiche AniList
        if (!msg.key || !msg.id) return { ok: false };
        await withLock(async () => {
          const [ids, airing] = await Promise.all([getLocal('aniIds', {}), getLocal('aniAiring', {})]);
          ids[msg.key] = { id: +msg.id, fetched: Date.now(), manual: true };
          airing._at = 0;
          await chrome.storage.local.set({ aniIds: ids, aniAiring: airing });
        });
        calendarTick().catch(() => {});
        return { ok: true };
      }

      case 'crEpisodesTodo': {
        const [groups, crEps] = await Promise.all([followedGroups(), getLocal('crEpisodes', {})]);
        const now = Date.now();
        return groups.filter((g) => g.platform === 'crunchyroll' && g.meta && g.meta.seasons && g.meta.seasons.length)
          .filter((g) => !crEps[g.key] || now - crEps[g.key].fetched > 3 * 3600e3)
          .map((g) => ({ key: g.key, season: latestCrSeason(g.meta) })).filter((t) => t.season && t.season.id)
          .slice(0, msg.max || 40);
      }

      case 'setCrEpisodes': {
        await withLock(async () => {
          const cur = await getLocal('crEpisodes', {});
          await chrome.storage.local.set({ crEpisodes: { ...cur, ...(msg.items || {}) } });
        });
        calendarTick();
        return { ok: true };
      }

      case 'calendarKick':
        calendarTick();
        return { ok: true };

      case 'suitesKick':
        suitesTick();
        return { ok: true };

      case 'hideSuite': {
        const hidden = await getLocal('suitesHidden', {});
        hidden[msg.id] = Date.now();
        await chrome.storage.local.set({ suitesHidden: hidden });
        await recomputeSuites();
        return { ok: true };
      }

      case 'animeById':
        try {
          const media = await getLocal('aniMedia', {});
          if (media[msg.id] && Date.now() - media[msg.id].fetched < 7 * DAY) return { media: media[msg.id] };
          const got = await fetchMedia([+msg.id], true);
          return { media: got[msg.id] || null };
        } catch (e) {
          return { error: e instanceof AniLimit ? 'AniList est momentanément saturé, réessaie dans une minute.' : 'Fiche introuvable : ' + e.message };
        }

      case 'seasonAnime': {
        // une saison complète, gardée 12 h (la saison en cours bouge peu)
        const id = `${msg.year}-${msg.season}`;
        const cache = await getLocal('seasonCache', {});
        if (cache[id] && Date.now() - cache[id].at < 12 * 3600e3) return { results: cache[id].list };
        try {
          // fiches allégées (le résumé et les suites se lisent dans la fiche complète)
          const list = (await seasonAnime(msg.season, msg.year)).map(({ description, relations, manga, ...m }) => m);
          // on garde les 4 dernières saisons consultées
          const keep = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, 3);
          await chrome.storage.local.set({ seasonCache: { ...Object.fromEntries(keep), [id]: { at: Date.now(), list } } });
          return { results: list };
        } catch (e) {
          if (cache[id]) return { results: cache[id].list, stale: true };
          return { error: e instanceof AniLimit ? 'AniList ne répond pas pour le moment, réessaie dans une minute.' : 'Saison indisponible.' };
        }
      }

      case 'wantAnime': {
        // « Je veux voir » : dans ma liste + dans le calendrier dès que les dates sont connues
        const m = msg.media || {};
        if (!m.id || !m.title) return { ok: false };
        const platform = msg.platform || ((m.links || []).map((l) => platformOfLink(l.site)).find(Boolean)) || 'crunchyroll';
        const key = `${platform}|${norm(m.title)}`;
        const names = new Set([m.title, ...(m.titles || [])].map(norm));
        const wantKey = (w) => w.aniId === m.id || names.has(norm(w.title));
        await withLock(async () => {
          const [wishlist, aniIds, art, airing] = await Promise.all([getLocal('wishlist', {}), getLocal('aniIds', {}), getLocal('art', {}), getLocal('aniAiring', {})]);
          if (msg.on === false) {
            for (const [k, w] of Object.entries(wishlist)) if (wantKey(w)) delete wishlist[k];
          } else {
            wishlist[key] = { key, title: m.title, platform, added: Date.now(), aniId: m.id, want: true, start: m.start || null };
            if (!aniIds[key]) aniIds[key] = { id: m.id, fetched: Date.now() };
            if (m.cover && !(art[key] && art[key].poster)) art[key] = { poster: m.cover, wide: m.banner || '', source: 'AniList', id: 'anilist:' + m.id, fetched: Date.now() };
          }
          airing._at = 0; // dates à relire avec ce titre
          await chrome.storage.local.set({ wishlist, aniIds, art, aniAiring: airing });
        });
        calendarTick().catch(() => {});
        return { ok: true, key };
      }

      case 'trendingAnime': {
        // gardé 6 h en mémoire de session
        const { trending } = await chrome.storage.session.get('trending');
        if (trending && Date.now() - trending.at < 6 * 3600e3) return { results: trending.list };
        try {
          const list = await trendingAnime();
          await chrome.storage.session.set({ trending: { at: Date.now(), list } }).catch(() => {});
          return { results: list };
        } catch (e) {
          return { error: 'Tendances indisponibles pour le moment.' };
        }
      }

      case 'netflixResolve': {
        // lien Netflix d'AniList : on vérifie qu'il mène bien au titre (sinon recherche du titre sur Netflix)
        const id = netflixId(msg.url);
        const search = netflixSearch(msg.title);
        if (!id) return { url: search };
        const page = `https://www.netflix.com/title/${id}`;
        try {
          const ctl = new AbortController();
          const t = setTimeout(() => ctl.abort(), 8000);
          const r = await fetch(page, { credentials: 'include', signal: ctl.signal }).finally(() => clearTimeout(t));
          const ok = r.ok && (r.url.includes(`/title/${id}`) || r.url.includes(`jbv=${id}`));
          return { url: ok ? page : search };
        } catch {
          return { url: page }; // Netflix injoignable : on tente quand même le lien
        }
      }

      case 'searchAnime':
        try {
          return { results: await searchAnime(String(msg.q || '').slice(0, 100), msg.page || 1) };
        } catch (e) {
          return { error: e instanceof AniLimit ? 'AniList est momentanément saturé, réessaie dans une minute.' : 'Recherche impossible : ' + e.message };
        }

      case 'checkUpdate': {
        const info = await checkUpdate(!!msg.force);
        const current = chrome.runtime.getManifest().version;
        return { ...info, current, available: !!(info.latest && newer(info.latest, current)) };
      }

      case 'logError':
        await logError(msg.where || 'page', msg.msg);
        return { ok: true };

      case 'getErrors':
        return { errors: await getLocal('errors', []), id: chrome.runtime.id };

      case 'clearErrors':
        await chrome.storage.local.set({ errors: [], diag: [] });
        return { ok: true };

      case 'testSources':
        return { results: await testSources((await getSettings()).tmdbKey) };

      case 'crTest': {
        // un onglet Crunchyroll ouvert, sinon on en ouvre un en arrière-plan le temps du test
        let [tab] = await chrome.tabs.query({ url: 'https://www.crunchyroll.com/*' });
        let opened = false;
        if (!tab) {
          tab = await chrome.tabs.create({ url: 'https://www.crunchyroll.com/history', active: false });
          opened = true;
          await new Promise((res) => {
            const done = (id, info) => { if (id === tab.id && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(done); res(); } };
            chrome.tabs.onUpdated.addListener(done);
            setTimeout(res, 20000);
          });
          await new Promise((r) => setTimeout(r, 5000)); // laisse le site obtenir son jeton
        }
        let res;
        try {
          res = await chrome.tabs.sendMessage(tab.id, { type: 'crTest' }, { frameId: 0 });
        } catch (e) {
          res = { erreur: 'pas de réponse de l\'onglet Crunchyroll (recharge-le) : ' + e.message };
        }
        if (opened) chrome.tabs.remove(tab.id).catch(() => {});
        return res || { erreur: 'aucune réponse' };
      }

      case 'migrate':
        return { changed: await migrate() };

      case 'artKick':
        if (Array.isArray(msg.keys)) artPriority = msg.keys.slice(0, 200);
        setupAlarm();
        artTick();
        return { ok: true };

      case 'diag': {
        const diag = await getLocal('diag', []);
        diag.push(`${new Date().toISOString().slice(0, 19)} ${msg.text}`);
        await chrome.storage.local.set({ diag: diag.slice(-80) });
        return { ok: true };
      }

      case 'getDiag': {
        const entries = Object.values(await getEntries());
        const meta = await getLocal('meta', {});
        const metaList = Object.entries(meta);
        const cr = entries.filter((e) => e.platform === 'crunchyroll');
        return {
          version: chrome.runtime.getManifest().version,
          date: new Date().toISOString(),
          entrees: entries.length,
          parPlateforme: entries.reduce((a, e) => ((a[e.platform] = (a[e.platform] || 0) + 1), a), {}),
          crunchyroll: {
            avecSeriesId: cr.filter((e) => e.seriesId).length,
            avecImage: cr.filter((e) => e.image).length,
            exempleImage: (cr.find((e) => e.image) || {}).image || null,
          },
          fiches: {
            nombre: metaList.length,
            avecAffiche: metaList.filter(([, m]) => m.poster).length,
            avecImageLarge: metaList.filter(([, m]) => m.wide).length,
            avecSaisons: metaList.filter(([, m]) => m.seasons && m.seasons.length).length,
            exemples: metaList.slice(0, 3).map(([k, m]) => ({ k, poster: m.poster, wide: m.wide, saisons: (m.seasons || []).length, simulcast: m.simulcast })),
          },
          affichesExternes: await getLocal('art', {}).then((a) => {
            const v = Object.values(a);
            return {
              cherchees: v.length,
              trouvees: v.filter((x) => x.poster).length,
              aRetenter: v.filter((x) => !x.poster && x.retryAt).length,
              parSource: v.reduce((o, x) => ((o[x.source || 'aucune'] = (o[x.source || 'aucune'] || 0) + 1), o), {}),
              etatDesSources: sourceStats,
              exemplesSansAffiche: Object.entries(a).filter(([, x]) => !x.poster).slice(0, 8).map(([k, x]) => `${k}${x.error ? ' (' + x.error + ')' : ''}`),
            };
          }),
          // tous les titres de « Ma liste » sans affiche, avec la raison
          sansAffiche: await (async () => {
            const [art, shows] = await Promise.all([getLocal('art', {}), getLocal('shows', {})]);
            const seen = new Map();
            for (const e of entries) {
              const k = seriesKey(e);
              if (!seen.has(k)) seen.set(k, { titre: e.title, plateforme: e.platform, film: true, lien: false });
              const g = seen.get(k);
              if (e.episode) g.film = false;
              if (/netflix\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:title|watch)\/\d+/i.test(e.url || '')) g.lien = true;
            }
            const out = [];
            for (const [k, g] of seen) {
              if ((shows[k] && shows[k].poster) || (meta[k] && meta[k].poster) || (art[k] && art[k].poster)) continue;
              const x = art[k];
              const raison = NO_ART.test(g.titre) ? 'ignoré' : !x ? 'pas encore cherché' : x.retryAt ? 'source saturée, nouvel essai prévu' : x.error ? 'erreur ' + x.error : 'introuvable';
              out.push(`${g.titre} | ${g.plateforme}${g.film ? ' | film' : ''}${g.plateforme === 'netflix' ? (g.lien ? ' | lien Netflix' : ' | sans lien') : ''} | ${raison}`);
            }
            return out;
          })(),
          journal: (await getLocal('diag', [])).slice(-40),
        };
      }

      case 'profile': {
        const profiles = await getLocal('profiles', {});
        profiles[msg.platform] = msg.name;
        await chrome.storage.local.set({ profiles });
        return { ok: true };
      }

      case 'getStats': {
        const entries = await getEntries();
        const counts = {};
        const series = new Set();
        let secs = 0, last = null;
        for (const e of Object.values(entries)) {
          counts[e.platform] = (counts[e.platform] || 0) + 1;
          series.add(seriesKey(e));
          secs += e.seconds || 0;
          if (e.date && (!last || e.date > last.date)) last = e;
        }
        return {
          counts,
          series: series.size,
          hours: Math.round(secs / 3600),
          last: last && { title: last.title, episode: last.episode, date: last.date, hasTime: last.hasTime, platform: last.platform },
          total: Object.keys(entries).length,
          lastExport: await getLocal('lastExport', null),
          lastBackup: await getLocal('lastBackup', null),
          settings: await getSettings(),
          sync: await getLocal('sync', {}),
          syncing,
          syncCurrent,
          platforms: PLATFORMS,
          importable: Object.keys(IMPORT_URLS),
        };
      }

      case 'export':
        await exportExcel();
        return { ok: true };

      case 'syncNow':
        runSync(true);
        return { ok: true };

      case 'setSettings': {
        const s = await getSettings();
        await chrome.storage.local.set({ settings: { ...s, ...msg.settings } });
        if ('tmdbKey' in (msg.settings || {}) && msg.settings.tmdbKey !== s.tmdbKey) {
          await withLock(async () => {
            const art = await getLocal('art', {});
            for (const k of Object.keys(art)) if (!art[k].poster) delete art[k];
            await chrome.storage.local.set({ art });
          });
          artTick();
        }
        return { ok: true };
      }

      case 'clear':
        await withLock(() => chrome.storage.local.set({ entries: {} }));
        return { ok: true };

      case 'startImport': {
        const url = IMPORT_URLS[msg.platform];
        if (!url) return { ok: false };
        const tab = await chrome.tabs.create({ url });
        await setPending(tab.id, { platform: msg.platform, silent: false });
        return { ok: true };
      }

      case 'shouldImport': {
        const { pending = {} } = await chrome.storage.session.get('pending');
        const p = sender.tab && pending[sender.tab.id];
        return p && p.platform === msg.platform ? { pending: true, silent: p.silent } : { pending: false };
      }

      case 'importDone': {
        setTimeout(() => artTick(), 3000);
        if (msg.count > 0) {
          const sync = await getLocal('sync', {});
          sync[msg.platform] = { ...sync[msg.platform], enabled: true, last: Date.now(), error: '' };
          await chrome.storage.local.set({ sync });
        }
        const tabId = sender.tab?.id;
        if (tabId != null) {
          const { pending = {} } = await chrome.storage.session.get('pending');
          if (pending[tabId] && !pending[tabId].silent) await setPending(tabId, null);
          syncWaiters[tabId]?.(msg.reason ? { ok: false, reason: msg.reason } : { ok: true });
        }
        return { ok: true };
      }
    }
  };
  handle().then(sendResponse, (err) => sendResponse({ error: String(err?.message || err) }));
  return true;
});
