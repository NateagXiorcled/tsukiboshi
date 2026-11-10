// AniList : identification des animés et de leurs suites (saisons, films, OAV), avec les liens de streaming.
// Utilisé par le service worker (suites ratées, recherche). Demandes groupées et espacées (limite AniList ≈ 30/min).
import { similarity, cleanQuery } from './artwork.js';

const URL_API = 'https://graphql.anilist.co';
const TIMEOUT = 20000;
let next = 0;
let blockedUntil = 0;

export class AniLimit extends Error {}

// deux files : le travail de fond (suites) espacé largement, les recherches tapées servies tout de suite
let nextFast = 0;
async function gql(query, variables = {}, fast = false) {
  if (Date.now() < blockedUntil) throw new AniLimit('AniList en pause');
  let wait;
  if (fast) { wait = nextFast - Date.now(); nextFast = Math.max(Date.now(), nextFast) + 700; }
  else { wait = next - Date.now(); next = Math.max(Date.now(), next) + 2300; }
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  let r;
  try {
    r = await fetch(URL_API, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query, variables }) });
  } catch {
    throw new AniLimit(ctl.signal.aborted ? 'AniList : délai dépassé' : 'AniList : réseau');
  } finally {
    clearTimeout(timer);
  }
  if (r.status === 429) {
    blockedUntil = Date.now() + (+(r.headers.get('Retry-After') || 60)) * 1000;
    throw new AniLimit('AniList saturé');
  }
  if (r.status >= 500) throw new AniLimit('AniList ' + r.status);
  const j = await r.json().catch(() => ({}));
  return j.data || {};
}

// Champs d'une fiche (suites comprises)
const NODE = `id type format status episodes duration seasonYear startDate { year month day } title { romaji english native } synonyms
  coverImage { extraLarge large } bannerImage genres averageScore description(asHtml: false) studios(isMain: true) { nodes { name } }
  externalLinks { site url type language }`;
const FULL = `${NODE} nextAiringEpisode { episode airingAt }
  relations { edges { relationType node { ${NODE} } } }`;

// Titre utilisateur → identifiant AniList (meilleure correspondance, ou null)
export async function findAnimeIds(titles) {
  const out = {};
  for (let i = 0; i < titles.length; i += 8) {
    const part = titles.slice(i, i + 8);
    const vars = {}, defs = [], q = [];
    part.forEach((t, j) => {
      vars['q' + j] = cleanQuery(t) || t;
      defs.push(`$q${j}: String`);
      q.push(`r${j}: Page(perPage: 6) { media(search: $q${j}, type: ANIME, sort: SEARCH_MATCH) { id format episodes title { romaji english native } synonyms } }`);
    });
    const d = await gql(`query (${defs.join(', ')}) { ${q.join(' ')} }`, vars);
    part.forEach((t, j) => {
      const list = (d['r' + j] && d['r' + j].media) || [];
      let top = null;
      for (const m of list) {
        const names = [m.title.english, m.title.romaji, m.title.native, ...(m.synonyms || [])].filter(Boolean);
        const s = Math.max(0, ...names.map((n) => similarity(n, vars['q' + j])));
        if (!top || s > top.s) top = { id: m.id, s };
      }
      out[t] = top && top.s >= 0.8 ? top.id : null;
    });
  }
  return out;
}

// Fiches complètes (avec suites) pour une liste d'identifiants
export async function fetchMedia(ids, fast = false) {
  const out = {};
  for (let i = 0; i < ids.length; i += 10) {
    const part = ids.slice(i, i + 10);
    const d = await gql(`{ ${part.map((id, j) => `m${j}: Media(id: ${+id}) { ${FULL} }`).join(' ')} }`, {}, fast);
    part.forEach((id, j) => { if (d['m' + j]) out[id] = slim(d['m' + j]); });
  }
  return out;
}

// Recherche libre (page « Rechercher un animé »)
export async function searchAnime(text, page = 1) {
  const d = await gql(`query ($q: String, $p: Int) { Page(page: $p, perPage: 24) { media(search: $q, type: ANIME, sort: [SEARCH_MATCH, POPULARITY_DESC], isAdult: false) { ${FULL} } } }`, { q: text, p: page }, true);
  return ((d.Page && d.Page.media) || []).map(slim);
}

// Dates de diffusion (VO) d'une liste d'animés entre deux dates : { [mediaId]: [{ ep, at }] }
export async function fetchAiring(ids, from, to) {
  const out = {};
  for (let page = 1; page <= 8 && ids.length; page++) {
    const d = await gql(`query ($ids: [Int], $a: Int, $b: Int, $p: Int) { Page(page: $p, perPage: 50) { pageInfo { hasNextPage }
      airingSchedules(mediaId_in: $ids, airingAt_greater: $a, airingAt_lesser: $b, sort: TIME) { episode airingAt mediaId } } }`,
    { ids: ids.map(Number), a: Math.floor(from / 1000), b: Math.floor(to / 1000), p: page });
    const P = d.Page || {};
    for (const x of P.airingSchedules || []) (out[x.mediaId] = out[x.mediaId] || []).push({ ep: x.episode, at: x.airingAt * 1000 });
    if (!(P.pageInfo && P.pageInfo.hasNextPage)) break;
  }
  return out;
}

// Animés du moment (en cours de diffusion, les plus suivis)
export async function trendingAnime() {
  const d = await gql(`{ Page(perPage: 24) { media(type: ANIME, sort: TRENDING_DESC, isAdult: false, status_in: [RELEASING, FINISHED]) { ${FULL} } } }`, {}, true);
  return ((d.Page && d.Page.media) || []).map(slim);
}

// on ne garde que l'utile (stockage léger)
function node(m) {
  const t = m.title || {};
  return {
    id: m.id, type: m.type, format: m.format, status: m.status, episodes: m.episodes, duration: m.duration,
    year: (m.startDate && m.startDate.year) || m.seasonYear || null,
    start: m.startDate && m.startDate.year ? [m.startDate.year, m.startDate.month || 1, m.startDate.day || 1] : null,
    title: t.english || t.romaji, titles: [t.english, t.romaji, t.native, ...(m.synonyms || [])].filter(Boolean),
    cover: (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || '', banner: m.bannerImage || '',
    genres: m.genres || [], score: m.averageScore || null,
    description: String(m.description || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 900),
    studio: (m.studios && m.studios.nodes && m.studios.nodes[0] && m.studios.nodes[0].name) || '',
    links: (m.externalLinks || []).filter((l) => l.type === 'STREAMING' && /^https:\/\//.test(l.url || '')).map((l) => ({ site: l.site, url: l.url, lang: l.language || '' })),
  };
}
function slim(m) {
  return {
    ...node(m),
    nextAiring: m.nextAiringEpisode ? { ep: m.nextAiringEpisode.episode, at: m.nextAiringEpisode.airingAt * 1000 } : null,
    relations: ((m.relations && m.relations.edges) || []).filter((e) => e.node && e.node.type === 'ANIME').map((e) => ({ rel: e.relationType, ...node(e.node), description: '' })),
    fetched: Date.now(),
  };
}

// Plateforme de l'extension correspondant à un lien de streaming AniList
export function platformOfLink(site) {
  const s = String(site || '').toLowerCase();
  if (/crunchyroll/.test(s)) return 'crunchyroll';
  if (/netflix/.test(s)) return 'netflix';
  if (/adn|animation digital/.test(s)) return 'adn';
  if (/prime|amazon/.test(s)) return 'prime';
  if (/disney/.test(s)) return 'disney';
  return '';
}
