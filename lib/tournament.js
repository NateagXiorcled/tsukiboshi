// Tournoi : participants d'une période, tableau à élimination directe (calcul pur, testé seul)

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const keyOf = (e) => `${e.platform}|${norm(e.title)}`;
const isMovie = (e) => !e.episode && e.platform !== 'adn';

// durée d'un visionnage (même règle que le Bilan)
export function duration(e) {
  if (e.seconds >= 60) return Math.min(e.seconds, 4 * 3600);
  if (e.length >= 60) return Math.min(e.length, 4 * 3600);
  const anime = e.platform === 'crunchyroll' || e.platform === 'adn';
  return (isMovie(e) ? 105 : anime ? 23 : 42) * 60;
}

// bornes d'une période : 'week' (depuis lundi), 'month' (mois en cours), 'year' (année en cours)
export function periodRange(period, now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  else if (period === 'month') d.setDate(1);
  else { d.setMonth(0, 1); }
  return { from: d.getTime(), to: now.getTime() };
}
const pad = (n) => String(n).padStart(2, '0');
export function periodId(period, now = new Date()) {
  if (period === 'year') return String(now.getFullYear());
  if (period === 'month') return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  // semaine ISO
  const t = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return `${y}-S${pad(w)}`;
}
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export function periodLabel(period, now = new Date()) {
  if (period === 'year') return `de l'année ${now.getFullYear()}`;
  if (period === 'month') return `de ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
  return 'de la semaine';
}

// titres regardés pendant la période, classés par temps passé
export function participants(entries, { from, to }) {
  const by = new Map();
  for (const e of entries) {
    if (!e.date || e.date < from || e.date > to) continue;
    const k = keyOf(e);
    const x = by.get(k) || { key: k, title: e.title, platform: e.platform, secs: 0, eps: new Set(), views: 0, movie: true, last: 0 };
    x.secs += duration(e);
    x.views++;
    if (e.episode) { x.eps.add(norm(e.episode)); x.movie = false; }
    x.last = Math.max(x.last, e.date);
    by.set(k, x);
  }
  return [...by.values()].map((x) => ({ ...x, eps: x.eps.size, movie: x.movie && x.platform !== 'adn' })).sort((a, b) => b.secs - a.secs || b.last - a.last);
}

// taille du tableau : 16, 8 ou 4 (0 = pas assez)
export const bracketSize = (n) => (n >= 16 ? 16 : n >= 8 ? 8 : n >= 4 ? 4 : 0);

// ordre classique des têtes de série (1 contre 16, 8 contre 9…) pour que les favoris se croisent le plus tard possible
export function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

// premier tour : paires de participants
export function firstRound(list) {
  const size = bracketSize(list.length);
  const seeded = list.slice(0, size);
  const order = seedOrder(size);
  const pairs = [];
  for (let i = 0; i < size; i += 2) pairs.push([seeded[order[i] - 1], seeded[order[i + 1] - 1]]);
  return pairs;
}

export const roundName = (count) => ({ 1: 'Finale', 2: 'Demi-finales', 4: 'Quarts de finale', 8: 'Huitièmes de finale' }[count] || 'Tour');
