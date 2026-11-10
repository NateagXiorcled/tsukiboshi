// Affiches façon Plex : recherche ciblée par type (film, série, animé, spectacle) dans des sources reconnues
//   TMDB      → films et séries (la base de Plex) — facultatif, avec une clé gratuite
//   Allociné  → films et séries, titres français
//   AniList   → animés (affiche, bannière, nombre d'épisodes) — demandes groupées par paquets
//   iTunes    → films (catalogue Apple TV)
//   TVmaze    → séries télé
// Utilisé par le service worker (recherche automatique + choix manuel dans « Ma liste »).

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// "Haikyu!! Saison 2 (VF)" → "Haikyu!!"
export function cleanQuery(title) {
  let t = String(title || '');
  // « DEATH NOTE -デスノート- » → « DEATH NOTE » : on retire l'écriture japonaise / coréenne / chinoise quand il reste un titre latin
  const latin = t.replace(/[\u3000-\u30ff\u3400-\u9fff\uac00-\ud7af\uff00-\uffef]+/g, ' ').replace(/[-–~\s]+$/, '').replace(/\s[-–~]\s*[-–~]?\s*$/, '');
  if (latin !== t.replace(/[-–~\s]+$/, '') && /[a-z0-9]{2,}/i.test(latin)) t = latin.replace(/\s+[-–~]\s*$/, '').replace(/\s+[-–~]\s+[-–~]\s*/g, ' ');
  return t
    .replace(/\((vf|vostfr|vo|dub|sub|french dub|english dub)\)/gi, '')
    .replace(/\s*[-–:]?\s*(saison|season|partie|part|cour)\s*\d+.*$/i, '')
    .replace(/\s+series$/i, '') // « Rascal Does Not Dream Series » (nom de franchise Crunchyroll)
    .replace(/\s+/g, ' ')
    .trim();
}

// Ressemblance entre deux titres (0 → 1)
// - mots comparés sans pluriel (« héros fragile » = « héros fragiles ») et chiffres romains convertis (III = 3)
// - un titre entièrement contenu dans l'autre compte comme proche (« Pokémon, la série » ⊂ « Pokémon les Horizons : la série »)
const ROMAN = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9' };
const STOP = new Set(['the', 'le', 'la', 'les', 'l', 'a', 'an', 'un', 'une', 'de', 'du', 'des', 'd', 'of']);
const LINK = new Set(['and', 'et', 'und', 'y', 'the', 'le', 'la', 'les', 'l', 'of', 'de', 'du', 'des', 'd']);
const toks = (s) => {
  const all = s.split(' ').map((w) => ROMAN[w] || (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
  // petits mots de liaison ignorés (« Stretch Armstrong et les Flex Fighters » = « Stretch Armstrong & the Flex Fighters »)
  const core = all.filter((w) => !LINK.has(w));
  return core.length >= 2 ? core : all;
};
export function similarity(a, b) {
  const A = norm(a), B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (A.startsWith(B + ' ') || B.startsWith(A + ' ')) return 0.85;
  const ta = new Set(toks(A)), tb = new Set(toks(B));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const dice = (2 * inter) / (ta.size + tb.size);
  if (inter === ta.size && inter === tb.size) return 0.95;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if (inter === small.size) {
    const extra = [...big].filter((t) => !small.has(t));
    if (small.size >= 2 || extra.every((t) => STOP.has(t))) return Math.max(dice, 0.8);
  }
  return dice;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const limitError = (src) => Object.assign(new Error('limite ' + src), { retry: true, src });

// Santé des sources (pour le diagnostic) et pause de 10 min quand une source sature
export const sourceStats = {};
const cooldown = {};
const stat = (name) => (sourceStats[name] = sourceStats[name] || { ok: 0, vide: 0, erreurs: 0, dernierCode: null, enPauseJusqua: null });
function guard(name, fn) {
  return async (...args) => {
    if (cooldown[name] > Date.now()) throw Object.assign(new Error('pause ' + name), { skip: true });
    try {
      const res = await fn(...args);
      const st = stat(name);
      res && res.length ? st.ok++ : st.vide++;
      return res;
    } catch (e) {
      const st = stat(name);
      st.erreurs++;
      st.dernierCode = e.message;
      if (e.retry) {
        cooldown[name] = Date.now() + 10 * 60000;
        st.enPauseJusqua = new Date(cooldown[name]).toISOString().slice(11, 16);
      }
      throw e;
    }
  };
}

// Espacement minimal entre deux demandes vers un même site
function spacer(ms) {
  let next = 0;
  return async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + ms;
    if (at > now) await sleep(at - now);
  };
}
// délai maximal par demande : un site qui ne répond jamais ne doit pas bloquer toute la recherche
const TIMEOUT = 15000;
async function safeFetch(url, opts = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    // le corps aussi doit arriver à temps
    const text = r.text.bind(r), json = r.json.bind(r);
    r.text = () => text().finally(() => clearTimeout(timer));
    r.json = () => json().finally(() => clearTimeout(timer));
    return r;
  } catch (e) {
    clearTimeout(timer);
    throw limitError(ctl.signal.aborted ? 'délai dépassé' : 'réseau');
  }
}
const tvmazeGap = spacer(550); // 20 demandes / 10 s
const itunesGap = spacer(3100); // ~20 demandes / minute
const allocineGap = spacer(450);
const tmdbGap = spacer(120);

// ---------- AniList : jusqu'à 8 recherches par demande ----------
const MEDIA_FIELDS = `id format episodes status seasonYear genres bannerImage synonyms title { romaji english native } coverImage { extraLarge large }`;
let aniQueue = [];
let aniTimer = null;
let aniNext = 0;
let aniBlockedUntil = 0;

function anilist(query) {
  return new Promise((resolve, reject) => {
    aniQueue.push({ query, resolve, reject });
    if (!aniTimer) aniTimer = setTimeout(flushAniList, Math.max(60, aniNext - Date.now()));
  });
}

async function flushAniList() {
  aniTimer = null;
  const batch = aniQueue.splice(0, 8);
  if (!batch.length) return;
  if (Date.now() < aniBlockedUntil) {
    batch.forEach((b) => b.reject(limitError('AniList')));
  } else {
    aniNext = Date.now() + 2200; // ~27 demandes / minute, soit ~200 titres / minute
    const vars = {}, defs = [], parts = [];
    batch.forEach((b, i) => {
      vars['q' + i] = b.query;
      defs.push(`$q${i}: String`);
      parts.push(`r${i}: Page(perPage: 6) { media(search: $q${i}, type: ANIME, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} } }`);
    });
    try {
      const r = await safeFetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: `query (${defs.join(', ')}) { ${parts.join(' ')} }`, variables: vars }),
      });
      if (r.status === 429) {
        aniBlockedUntil = Date.now() + (+(r.headers.get('Retry-After') || 60)) * 1000;
        batch.forEach((b) => b.reject(limitError('AniList')));
      } else {
        if (!r.ok && r.status >= 500) throw new Error('AniList ' + r.status);
        const j = r.ok ? await r.json() : {};
        batch.forEach((b, i) => {
          const media = (j.data && j.data['r' + i] && j.data['r' + i].media) || [];
          b.resolve(media.map(aniItem).filter((x) => x.poster));
        });
      }
    } catch (e) {
      batch.forEach((b) => b.reject(limitError('AniList (réseau)')));
    }
  }
  if (aniQueue.length && !aniTimer) aniTimer = setTimeout(flushAniList, Math.max(60, aniNext - Date.now()));
}

function aniItem(m) {
  return {
    source: 'AniList',
    title: m.title.english || m.title.romaji,
    names: [m.title.english, m.title.romaji, m.title.native, ...(m.synonyms || [])].filter(Boolean),
    year: m.seasonYear || null,
    poster: (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || '',
    wide: m.bannerImage || '',
    episodes: m.episodes || null,
    status: m.status || null,
    movie: m.format === 'MOVIE',
    genres: m.genres || [],
    id: `anilist:${m.id}`,
  };
}

// ---------- TVmaze / iTunes ----------
async function tvmaze(query) {
  await tvmazeGap();
  const r = await safeFetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`);
  if (r.status === 429 || r.status >= 500) throw limitError('TVmaze ' + r.status);
  if (!r.ok) return [];
  return (await r.json()).map(({ show: s }) => ({
    source: 'TVmaze',
    title: s.name,
    names: [s.name],
    year: s.premiered ? +s.premiered.slice(0, 4) : null,
    poster: (s.image && (s.image.original || s.image.medium)) || '',
    wide: '',
    episodes: null,
    status: s.status || null,
    movie: false,
    genres: s.genres || [],
    id: `tvmaze:${s.id}`,
  })).filter((x) => x.poster);
}

async function itunes(query) {
  await itunesGap();
  // « media=movie » ne renvoie plus rien (nov. 2026) : recherche générale, puis on garde les films
  const r = await safeFetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&country=FR&limit=50`);
  if (r.status === 403 || r.status === 429 || r.status >= 500) throw limitError('iTunes ' + r.status);
  if (!r.ok) return [];
  return ((await r.json()).results || []).filter((m) => m.kind === 'feature-movie').slice(0, 10).map((m) => ({
    source: 'iTunes',
    title: m.trackName,
    names: [m.trackName],
    year: m.releaseDate ? +m.releaseDate.slice(0, 4) : null,
    poster: (m.artworkUrl100 || '').replace(/\/\d+x\d+bb\./, '/600x900bb.'),
    wide: '',
    episodes: null,
    status: null,
    movie: true,
    genres: m.primaryGenreName ? [m.primaryGenreName] : [],
    id: `itunes:${m.trackId}`,
  })).filter((x) => x.poster);
}

// ---------- Allociné (onglets « Films » et « Séries » de la recherche) ----------
const decode = (t) => String(t || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;|&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

function attrs(tag) {
  const o = {};
  for (const m of tag.matchAll(/([\w-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) o[m[1].toLowerCase()] = decode(m[3] ?? m[4]);
  return o;
}

async function allocine(query, kind) {
  await allocineGap();
  const path = kind === 'series' ? 'series/' : kind === 'movie' ? 'movie/' : '';
  const r = await safeFetch(`https://www.allocine.fr/rechercher/${path}?q=${encodeURIComponent(query)}`, { credentials: 'omit' });
  if (r.status === 429 || r.status === 403 || r.status >= 500) throw limitError('Allociné ' + r.status);
  if (!r.ok) return [];
  const html = await r.text();
  const out = [], seen = new Set();
  // chaque résultat = une affiche (image acsta.net) dont le texte alternatif est le titre
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    // affiches récentes (/pictures/) et anciennes (/medias/nmedia/) ; pas les logos ni l'image « sans affiche »
    const src = [a['data-src'], a.src].find((u) => u && /acsta\.net\/.*\/(pictures|medias)\//.test(u) && !/\/commons\/|empty_|default/i.test(u));
    // texte alternatif « poster du film Green Lantern » → « Green Lantern »
    const title = (a.alt || a.title || '').replace(/^\s*(poster|affiche)\s+(du film|de la s[ée]rie|du spectacle|du programme)?\s*/i, '').trim();
    if (!src || !title || seen.has(src) || /^(image|photo)s?\b/i.test(title)) continue;
    seen.add(src);
    const around = html.slice(m.index, m.index + 2500);
    const year = (around.match(/\b(19|20)\d{2}\b/) || [])[0];
    out.push({
      source: 'Allociné',
      title,
      names: [title],
      year: year ? +year : null,
      poster: src.replace(/\/c_\d+_\d+\//, '/c_620_840/'),
      wide: '',
      episodes: null,
      status: null,
      movie: kind === 'movie',
      kind,
      id: 'allocine:' + src,
    });
    if (out.length >= 10) break;
  }
  return out;
}

// ---------- TMDB (facultatif : clé gratuite sur themoviedb.org) ----------
async function tmdb(query, kind, key) {
  if (!key) return [];
  await tmdbGap();
  const bearer = /^eyJ/.test(key); // jeton « v4 » ou clé « v3 »
  const type = kind === 'series' ? 'tv' : 'movie';
  const lang = (globalThis.navigator && navigator.language) || 'fr-FR';
  const url = `https://api.themoviedb.org/3/search/${type}?language=${encodeURIComponent(lang)}&include_adult=false&query=${encodeURIComponent(query)}${bearer ? '' : '&api_key=' + encodeURIComponent(key)}`;
  const r = await safeFetch(url, bearer ? { headers: { Authorization: 'Bearer ' + key } } : undefined);
  if (r.status === 429 || r.status >= 500) throw limitError('TMDB ' + r.status);
  if (!r.ok) return [];
  return ((await r.json()).results || []).filter((m) => m.poster_path).slice(0, 10).map((m) => ({
    source: 'TMDB',
    title: m.title || m.name,
    names: [m.title, m.name, m.original_title, m.original_name].filter(Boolean),
    year: +((m.release_date || m.first_air_date || '').slice(0, 4)) || null,
    poster: 'https://image.tmdb.org/t/p/w500' + m.poster_path,
    wide: m.backdrop_path ? 'https://image.tmdb.org/t/p/w1280' + m.backdrop_path : '',
    episodes: null,
    status: null,
    movie: type === 'movie',
    kind,
    id: `tmdb:${type}:${m.id}`,
  }));
}

// ---------- IMDb (suggestions publiques, sans clé) : type exact de chaque titre ----------
const imdbGap = spacer(250);
const IMDB_TYPES = {
  movie: ['movie', 'tvMovie', 'video', 'tvSpecial', 'short'],
  series: ['tvSeries', 'tvMiniSeries'],
  any: ['movie', 'tvMovie', 'video', 'tvSpecial', 'short', 'tvSeries', 'tvMiniSeries'],
};
async function imdb(query, kind) {
  await imdbGap();
  const q = String(query).toLowerCase().trim();
  const r = await safeFetch(`https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(q)}.json?includeVideos=0`);
  if (r.status === 429 || r.status === 403 || r.status >= 500) throw limitError('IMDb ' + r.status);
  if (!r.ok) return [];
  const ok = IMDB_TYPES[kind] || IMDB_TYPES.any;
  return ((await r.json()).d || [])
    .filter((m) => m.i && m.i.imageUrl && ok.includes(m.qid))
    .map((m) => ({
      source: 'IMDb',
      title: m.l,
      names: [m.l],
      year: m.y || null,
      poster: m.i.imageUrl.replace(/\._V1_.*?\.(jpe?g|png)$/i, '._V1_UX600_.$1'),
      wide: '',
      episodes: null,
      status: null,
      movie: kind === 'movie',
      kind,
      id: 'imdb:' + m.id,
    }));
}

// ---------- Image officielle de la plateforme ----------
// Netflix : la page du titre (netflix.com/title/<id>, un lien d'épisode y redirige aussi)
//   connecté → données de la page : affiche verticale (VERTICAL_BILLBOARD) et image large (ECLIPSE_BILLBOARD)
//   sinon    → image de partage (og:image)
function nfArtworkAt(html, type) {
  const i = html.indexOf(type);
  if (i < 0) return '';
  const m = html.slice(i, i + 2500).match(/url\\*"\s*:\s*\\*"(https:[^"\\]*(?:\\+u0026[^"\\]*)*)/);
  return m ? m[1].replace(/\\+u0026/g, '&') : '';
}
// image du titre lui-même : cherchée juste après son numéro (la page décrit aussi des titres mis en avant,
// dont la 1re image venue n'est pas celle du titre demandé)
export function nfArtwork(html, type, id) {
  if (!id) return '';
  const re = new RegExp(`\\\\?["']${id}\\\\?["']`, 'g');
  let m, n = 0;
  while ((m = re.exec(html)) && n++ < 40) {
    const u = nfArtworkAt(html.slice(m.index, m.index + 6000), type);
    if (u) return u;
  }
  return '';
}
const netflixGap = spacer(700); // pages de titres demandées calmement
async function netflixOfficial(url) {
  const id = (String(url || '').match(/netflix\.com\/title\/(\d+)/) || [])[1];
  if (!id) return [];
  await netflixGap();
  const r = await safeFetch(`https://www.netflix.com/title/${id}`, { credentials: 'include' });
  if (r.status === 429 || r.status >= 500) throw limitError('Netflix ' + r.status);
  if (!r.ok) return [];
  const html = await r.text();
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || html.match(/content=["']([^"']+)["'][^>]+property=["']og:image/i);
  const wide = nfArtwork(html, 'ECLIPSE_BILLBOARD', id) || (og ? decode(og[1]) : '');
  const poster = nfArtwork(html, 'VERTICAL_BILLBOARD', id) || nfArtwork(html, 'BOXART', id) || wide;
  if (!poster) return [];
  const t = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i);
  const title = decode(t ? t[1] : '').replace(/\s*[|\-–]\s*(site officiel de )?netflix.*$/i, '').trim();
  // genre et année : données structurées de la page (« genre »: « Animes japonais », « dateCreated »…)
  const ld = (html.match(/"genre"\s*:\s*("([^"]+)"|\[[^\]]*\])/) || [])[1] || '';
  const nfGenres = ld.startsWith('[') ? (ld.match(/"([^"]+)"/g) || []).map((x) => decode(x.slice(1, -1))) : ld ? [decode(ld.slice(1, -1))] : [];
  const nfYear = +((html.match(/"dateCreated"\s*:\s*"(\d{4})/) || html.match(/"releaseYear"\s*:\s*(\d{4})/) || [])[1]) || null;
  return [{ source: 'Netflix', title, names: [title], year: nfYear, genres: nfGenres, poster, wide, episodes: null, status: null, movie: null, id: 'netflix:' + id, official: true }];
}

// ---------- Type du titre ----------
const ANIME_PLATFORMS = new Set(['crunchyroll', 'adn']);
const SHOW_RE = /\b(spectacle|stand[- ]?up|one[- ]man[- ]show|one[- ]woman[- ]show|en concert|live at|seul en scène|humour)\b/i;

export function kindOf({ title, platform, movie }) {
  if (SHOW_RE.test(title || '')) return 'show';
  if (platform === 'adn' && movie) return 'anime-any'; // ADN ne donne que la série, jamais l'épisode
  if (ANIME_PLATFORMS.has(platform)) return movie ? 'anime-movie' : 'anime';
  return movie ? 'movie' : 'series';
}

// Sources à interroger, dans l'ordre, selon le type
const gTmdb = guard('TMDB', tmdb), gAllo = guard('Allociné', allocine), gAni = guard('AniList', anilist);
const gTv = guard('TVmaze', tvmaze), gIt = guard('iTunes', itunes), gNf = guard('Netflix', netflixOfficial);
const gImdb = guard('IMDb', imdb);

function plan(kind, key) {
  const T = (k) => (key ? (q) => gTmdb(q, k, key) : null); // TMDB seulement avec une clé
  const A = (k) => (q) => gAllo(q, k);
  const I = (k) => (q) => gImdb(q, k);
  const ani = (want) => async (q) => (await gAni(q)).filter((x) => want == null || x.movie === want);
  const tvmaze = gTv, itunes = gIt;
  switch (kind) {
    case 'anime': return [ani(false), T('series'), A('series'), I('series'), tvmaze].filter(Boolean);
    case 'anime-movie': return [ani(true), T('movie'), A('movie'), I('movie'), itunes].filter(Boolean);
    case 'anime-any': return [ani(null), A(''), I('any')].filter(Boolean);
    case 'show': return [T('movie'), A('movie'), I('movie'), A(''), itunes].filter(Boolean);
    case 'movie': return [T('movie'), A('movie'), I('movie'), itunes, ani(true), A('')].filter(Boolean);
    default: return [T('series'), A('series'), I('series'), tvmaze, ani(false)].filter(Boolean);
  }
}

// ---------- Recherche ----------
// En dessous, trop de faux amis (« La Chronique des Bridgerton » ≠ « La chronique des Dubois »)
const MIN_SCORE = 0.8;
function best(list, q) {
  let top = null;
  for (const c of list) {
    const score = Math.max(...c.names.map((n) => similarity(n, q)));
    if (!top || score > top.score) top = { ...c, score };
  }
  return top;
}

// Toutes les propositions (pour le choix manuel)
export async function searchArtwork(query, { platform, movie, tmdbKey } = {}) {
  const q = cleanQuery(query) || query;
  const kind = kindOf({ title: query, platform, movie });
  const res = await Promise.allSettled(plan(kind, tmdbKey).map((f) => f(q)));
  const seen = new Set();
  return res
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .filter((c) => !seen.has(c.poster) && seen.add(c.poster))
    .map((c) => ({ ...c, score: Math.max(...c.names.map((n) => similarity(n, q))) }));
}

// Meilleure affiche automatique.
// → { ...affiche } ; null si rien ; { pending: true } si une source était en pause/saturée (à retenter plus tard)
export async function bestArtwork(title, { platform, movie, tmdbKey, url } = {}) {
  const q = cleanQuery(title) || title;
  const kind = kindOf({ title, platform, movie });
  let pending = false;
  // Netflix : l'image officielle de la page du titre passe avant tout le reste
  let nfTried = false;
  if (platform === 'netflix' && url) {
    nfTried = true;
    try {
      const [o] = await gNf(url);
      if (o) return { ...o, kind, score: 1 };
    } catch (e) {
      if (e.retry || e.skip) pending = true;
    }
  }
  for (const f of plan(kind, tmdbKey)) {
    try {
      const b = best(await f(q), q);
      if (b && b.score >= MIN_SCORE) return { ...b, kind };
    } catch (e) {
      // source saturée ou en pause : à retenter ; autre erreur (réponse illisible…) : on passe à la source suivante
      if (e.retry || e.skip) pending = true;
    }
  }
  // film « Titre : Sous-titre » introuvable → c'est peut-être un épisode isolé d'une série (« Code Lyoko : Teddygozilla »)
  const head = (title.match(/^(.+?)\s+[:–-]\s+.+$/) || [])[1];
  if ((kind === 'movie' || kind === 'show') && head && head.length >= 3) {
    for (const f of plan('series', tmdbKey)) {
      try {
        const b = best(await f(head), head);
        if (b && b.score >= MIN_SCORE) return { ...b, kind: 'series' };
      } catch (e) {
        if (e.retry || e.skip) pending = true;
      }
    }
  }
  // image officielle de la plateforme (Netflix : page du titre) quand aucune affiche n'a été trouvée
  if (platform === 'netflix' && url && !nfTried) {
    try {
      const [o] = await gNf(url);
      if (o) return { ...o, kind, score: 1 };
    } catch (e) {
      if (e.retry || e.skip) pending = true;
    }
  }
  return pending ? { pending: true } : null;
}

// ---------- Test en direct de chaque source (page de diagnostic) ----------
// Appelle chaque site sans pause ni cache et rapporte le résultat brut.
export async function testSources(tmdbKey) {
  const cases = [
    ['TMDB', () => tmdb('Green Lantern', 'movie', tmdbKey), !tmdbKey && 'pas de clé'],
    ['Allociné', () => allocine('Green Lantern', 'movie')],
    ['IMDb', () => imdb('Green Lantern', 'movie')],
    ['iTunes', () => itunes('Green Lantern')],
    ['TVmaze', () => tvmaze('Dexter')],
    ['AniList', () => anilist('Frieren')],
    ['Netflix', () => netflixOfficial('https://www.netflix.com/title/70143836')],
  ];
  return Promise.all(cases.map(async ([name, fn, skip]) => {
    if (skip) return { source: name, etat: 'non configurée', detail: skip };
    const t = Date.now();
    try {
      const res = await Promise.race([fn(), sleep(20000).then(() => { throw new Error('délai dépassé (20 s)'); })]);
      const list = Array.isArray(res) ? res : res ? [res] : [];
      const first = list[0] || {};
      return { source: name, etat: list.length ? 'répond' : 'aucun résultat', ms: Date.now() - t, resultats: list.length, titre: first.title || '', affiche: first.poster || first.wide || '' };
    } catch (e) {
      return { source: name, etat: 'erreur', ms: Date.now() - t, detail: e.message };
    }
  }));
}


// ---------- Genres et année de sortie ----------
// Chaque source a ses propres noms de genres : on les ramène à une liste française commune.
const GENRE_RULES = [
  [/\banime|animes japonais|japanimation/, 'Animé'],
  [/action/, 'Action'], [/aventure|adventure/, 'Aventure'], [/com[eé]d|comedy|humou?r|stand.?up/, 'Comédie'],
  [/dram/, 'Drame'], [/fantas/, 'Fantasy'], [/horr|[eé]pouvante/, 'Horreur'], [/myst/, 'Mystère'],
  [/roman/, 'Romance'], [/sci.?fi|science/, 'Science-fiction'], [/slice of life|tranche de vie/, 'Tranche de vie'],
  [/sport/, 'Sport'], [/supernatural|surnaturel/, 'Surnaturel'], [/thrill|suspense/, 'Thriller'],
  [/music|musique|musical/, 'Musique'], [/mecha/, 'Mecha'], [/psycholog/, 'Psychologique'],
  [/crime|polici|criminel|detective|d[eé]tective/, 'Policier'], [/documentai|documentary/, 'Documentaire'],
  [/famil|children|kids|jeunesse|enfant/, 'Famille'], [/histori/, 'Historique'], [/\bwar\b|guerre/, 'Guerre'],
  [/western/, 'Western'], [/mahou|magical girl/, 'Magical girl'], [/ecchi/, 'Ecchi'],
  [/reality|t[eé]l[eé]r[eé]alit/, 'Téléréalité'], [/\bfood\b|cuisine|culinai/, 'Cuisine'], [/animation|dessins? anim/, 'Animation'],
];
export function frenchGenres(list, kind) {
  const out = new Set();
  for (const g of list || []) {
    const n = String(g).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, (c) => c);
    for (const [re, fr] of GENRE_RULES) if (re.test(n)) out.add(fr);
  }
  if (kind && kind.startsWith('anime')) { out.add('Animé'); out.delete('Animation'); }
  if (kind === 'show') out.add('Spectacle');
  return [...out];
}

// genres d'un titre : AniList pour les animés, page Netflix, TVmaze (séries), iTunes (films)
export async function genresFor(title, { platform, movie, url } = {}) {
  const q = cleanQuery(title) || title;
  const kind = kindOf({ title, platform, movie });
  const steps = [];
  if (platform === 'netflix' && url) steps.push(() => gNf(url));
  if (kind.startsWith('anime')) steps.unshift(() => gAni(q));
  else if (kind === 'series') steps.push(() => gTv(q), () => gAni(q));
  else steps.push(() => gIt(q));
  let pending = false;
  for (const f of steps) {
    try {
      const list = (await f()) || [];
      const b = list[0] && list[0].official ? { ...list[0], score: 1 } : best(list, q);
      if (b && b.score >= MIN_SCORE && b.genres && b.genres.length) {
        return { genres: frenchGenres(b.genres, kind), year: b.year || null, src: b.source };
      }
    } catch (e) {
      if (e.retry || e.skip) pending = true;
    }
  }
  if (kind === 'show') return { genres: ['Spectacle', 'Comédie'], year: null, src: 'type' };
  return pending ? { pending: true } : null;
}
