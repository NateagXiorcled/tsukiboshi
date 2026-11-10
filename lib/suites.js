// « Suites ratées » : pour chaque animé terminé, la première suite (saison, film, OAV) pas encore vue.
// Calcul pur (aucun accès réseau) : partagé par le service worker et testé seul.
import { seriesProgress } from './progress.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const ALLOWED = new Set(['TV', 'TV_SHORT', 'ONA', 'MOVIE', 'OVA', 'SPECIAL']);
const SEASON = new Set(['TV', 'TV_SHORT', 'ONA']);
const DAY = 864e5;

export const kindLabel = (format) => (SEASON.has(format) ? 'Nouvelle saison' : format === 'MOVIE' ? 'Film' : 'OAV');

const startTs = (n) => (n.start ? Date.UTC(n.start[0], n.start[1] - 1, n.start[2]) : Infinity);

// suite directe la plus ancienne d'une fiche
function firstSequel(m) {
  return (m.relations || []).filter((r) => r.rel === 'SEQUEL' && ALLOWED.has(r.format)).sort((a, b) => startTs(a) - startTs(b))[0] || null;
}

// épisodes distincts vus dans un groupe d'historique
const distinctEps = (items) => new Set(items.filter((e) => e.episode).map((e) => norm(e.episode))).size;

/**
 * groups : [{ key, title, platform, items, last, meta, aniId }]
 * media  : { [aniId]: fiche AniList (lib/anilist.js) }
 * hidden : { [aniId]: true } suites écartées par l'utilisateur
 * → { list: [suggestion], need: [ids à télécharger pour aller plus loin] }
 */
export function computeSuites({ groups, media, hidden = {}, now = Date.now() }) {
  const seenIds = new Set(groups.map((g) => g.aniId).filter(Boolean));
  const out = new Map();
  const need = new Set();
  // animé fini et sans suite animée : le manga d'origine, pour continuer l'histoire (liens de lecture officiels)
  const addManga = (g, ...nodes) => {
    let m = null;
    for (const n of nodes) { const full = n && (media[n.id] || n); if (full && full.manga && full.manga.length) { m = full.manga[0]; break; } }
    if (!m || hidden['m' + m.id] || !m.title) return;
    const id = 'm' + m.id;
    if (out.has(id)) { out.get(id).from.push(g.key); return; }
    out.set(id, {
      id, mangaId: m.id, manga: true, title: m.title, titles: m.titles, kind: 'Manga', format: 'MANGA',
      chapters: m.chapters || null, volumes: m.volumes || null, year: m.year, start: m.start, cover: m.cover, banner: '',
      links: m.links || [], genres: m.genres, status: m.status, upcoming: false,
      after: g.title, platform: g.platform, from: [g.key], last: g.last || 0,
    });
  };
  const doneWith = (n) => n && n.status === 'FINISHED';
  for (const g of groups) {
    const root = g.aniId && media[g.aniId];
    if (!root) continue;
    // chaîne des suites
    const chain = [];
    let cur = root;
    const visited = new Set([root.id]);
    let partial = false; // chaîne pas encore connue en entier
    for (let d = 0; d < 8; d++) {
      const s = firstSequel(cur);
      if (!s || visited.has(s.id)) break;
      visited.add(s.id);
      chain.push(s);
      cur = media[s.id];
      if (!cur) { need.add(s.id); partial = true; break; }
    }
    // saisons Crunchyroll commencées (saison 1 = la fiche de départ)
    const prog = g.meta ? seriesProgress(g.items, g.meta) : null;
    const seasons = prog ? prog.groups : [];
    const started = seasons.filter((x) => x.seen > 0).length;
    const labels = g.items.map((e) => norm(e.episode)).join(' | ');

    if (!chain.length) {
      // pas de suite animée : manga si l'animé est fini (et vu)
      const fin = root.format === 'MOVIE' || (seasons.length ? seasons.every((x) => x.seen >= x.count * 0.8) : !!root.episodes && distinctEps(g.items) >= root.episodes * 0.8);
      if (fin && doneWith(root)) addManga(g, root);
      continue;
    }
    let tv = 0;
    const seen = chain.map((n) => {
      const isTv = SEASON.has(n.format);
      const k = isTv ? tv++ : -1;
      if (seenIds.has(n.id)) return true;
      if (isTv && started >= k + 2) return true; // saison k+2 commencée sur Crunchyroll
      // libellé d'épisode qui reprend le sous-titre de la suite (« … : Revival of the Commandments »)
      return n.titles.some((t) => { const sub = norm(t.split(/:\s+| - /).slice(1).join(' ')); return sub.split(' ').length >= 2 && labels.includes(sub); });
    });
    const last = seen.lastIndexOf(true);
    const cand = chain[last + 1];
    if (!cand && last === chain.length - 1) {
      // toutes les suites vues : manga si la dernière est finie
      const s = seasons[last + 1];
      const fin = s ? s.seen >= s.count * 0.8 : now - (g.last || 0) > 7 * DAY;
      const end = chain[chain.length - 1];
      if (fin && !partial && doneWith(media[end.id] || end)) addManga(g, end, root);
      continue;
    }
    if (!cand || hidden[cand.id] || cand.status === 'CANCELLED') continue;

    // la partie précédente doit être terminée
    let finished;
    if (last === -1) {
      if (root.format === 'MOVIE') finished = true;
      else if (seasons.length) finished = seasons[0] && seasons[0].seen >= seasons[0].count * 0.8;
      else finished = !!root.episodes && distinctEps(g.items) >= root.episodes * 0.8;
    } else {
      const s = seasons[last + 1];
      finished = s ? s.seen >= s.count * 0.8 : now - (g.last || 0) > 7 * DAY;
    }
    if (!finished) continue;

    const upcoming = cand.status === 'NOT_YET_RELEASED';
    const prev = out.get(cand.id);
    if (prev) { prev.from.push(g.key); continue; }
    out.set(cand.id, {
      id: cand.id,
      title: cand.title,
      titles: cand.titles,
      kind: kindLabel(cand.format),
      format: cand.format,
      episodes: cand.episodes,
      year: cand.year,
      start: cand.start,
      cover: cand.cover,
      banner: cand.banner,
      links: cand.links,
      genres: cand.genres,
      status: cand.status,
      upcoming,
      after: g.title,
      platform: g.platform,
      from: [g.key],
      last: g.last || 0,
    });
  }
  // disponibles d'abord (série regardée le plus récemment en tête), puis annoncées (la plus proche d'abord)
  // mangas en dernier
  const list = [...out.values()].sort((a, b) => !!a.manga - !!b.manga || a.upcoming - b.upcoming || (a.upcoming ? startTs(a) - startTs(b) : b.last - a.last));
  return { list, need: [...need] };
}
