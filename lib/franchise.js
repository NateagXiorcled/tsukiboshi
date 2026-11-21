// Regroupement d'un même animé : ses saisons (« Black Clover » + « Black Clover Season 2 »), et le même titre
// vu sur plusieurs plateformes (Crunchyroll + ADN…). Calcul pur, testé seul.
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// titre sans la mention de saison / partie
export function baseTitle(title) {
  const t = norm(title);
  const b = t
    .replace(/\b(the )?(final|last) season\b.*$/, '')
    .replace(/\b(saison|season|staffel|temporada|cour|part|partie)\s*\d+\b.*$/, '')
    .replace(/\b\d+\s*(st|nd|rd|th|e|eme|ere)\s+(saison|season|cour|part|partie)\b.*$/, '')
    .replace(/\bs\d+$/, '')
    .replace(/\s+(ii|iii|iv|vi)$/, '')
    .trim();
  return b.length >= 2 ? b : t;
}

/**
 * items : [{ key, title, platform }]
 * aniIds : { [key]: { id } } ; aniMedia : { [id]: { relations: [{ rel, id }] } }
 * → tableau de groupes (chaque groupe = tableau d'items)
 */
export function franchiseGroups(items, aniIds = {}, aniMedia = {}) {
  const parent = new Map(items.map((x) => [x.key, x.key]));
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  // 1. même titre une fois la saison retirée (toutes plateformes confondues)
  const byBase = new Map();
  for (const x of items) {
    const b = baseTitle(x.title);
    if (byBase.has(b)) join(byBase.get(b), x.key); else byBase.set(b, x.key);
  }
  // 2. AniList : même fiche, ou fiches reliées comme saisons / suites / histoire principale
  const byId = new Map();
  for (const x of items) {
    const id = aniIds[x.key] && aniIds[x.key].id;
    if (!id) continue;
    if (byId.has(id)) join(byId.get(id), x.key); else byId.set(id, x.key);
  }
  const LINK = new Set(['SEQUEL', 'PREQUEL', 'PARENT', 'SIDE_STORY']);
  for (const [id, k] of byId) {
    for (const r of ((aniMedia[id] || {}).relations || [])) if (LINK.has(r.rel) && byId.has(r.id)) join(k, byId.get(r.id));
  }
  const groups = new Map();
  for (const x of items) {
    const r = find(x.key);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(x);
  }
  return [...groups.values()];
}
