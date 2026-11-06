// Progression d'une série à partir des épisodes vus et des infos de la plateforme (saisons, nombre d'épisodes).
// Partagé par le service worker (Excel) et la page « Ma liste ».

const EXTRA = /\b(film|movie|oav|ova|oad|sp[ée]cial|specials|r[ée]cap|recap|compilation)\b/i;

// Saisons regroupées par numéro (les versions doublées d'une même saison comptent une seule fois)
export function seasonGroups(meta) {
  const groups = new Map();
  for (const s of (meta && meta.seasons) || []) {
    if (!s.count) continue;
    const g = s.seq ?? s.number ?? s.id;
    const cur = groups.get(g);
    if (!cur) groups.set(g, { group: g, number: s.number, title: s.title, count: s.count, extra: EXTRA.test(s.title), ids: [s.id, ...(s.versions || [])] });
    else {
      cur.count = Math.max(cur.count, s.count);
      cur.ids.push(s.id, ...(s.versions || []));
    }
  }
  return [...groups.values()].sort((a, b) => (+a.group || 0) - (+b.group || 0));
}

const epNumOf = (e) => {
  if (typeof e.epNum === 'number') return e.epNum;
  const m = String(e.episode || '').match(/\bE(\d+)\b/i);
  return m ? +m[1] : null;
};
const seasonNumOf = (e) => {
  if (typeof e.seasonNum === 'number') return e.seasonNum;
  const m = String(e.episode || '').match(/^S(\d+)\b/i);
  return m ? +m[1] : null;
};

// → null si pas d'infos, sinon { watched, total, complete, upToDate, groups:[{title,count,seen}], next }
export function seriesProgress(items, meta) {
  const groups = seasonGroups(meta);
  if (!groups.length) return null;
  const byId = new Map(), byNum = new Map();
  for (const g of groups) {
    g.ids.forEach((id) => id && byId.set(id, g));
    if (g.number != null && !byNum.has(g.number)) byNum.set(g.number, g);
  }
  const seen = new Map(groups.map((g) => [g, new Set()]));
  let lastG = null, lastN = null, lastDate = -Infinity;
  for (const e of items) {
    const g = (e.seasonId && byId.get(e.seasonId)) || byNum.get(seasonNumOf(e)) || (groups.length === 1 ? groups[0] : null);
    const n = epNumOf(e);
    if (!g || n == null) continue;
    seen.get(g).add(n);
    if ((e.date ?? 0) > lastDate) { lastDate = e.date ?? 0; lastG = g; lastN = n; }
  }
  const main = groups.filter((g) => !g.extra);
  const counted = main.length ? main : groups;
  let watched = 0, total = 0;
  for (const g of counted) {
    // numérotation absolue (ex. One Piece E577 dans une saison de 30) : on compte les épisodes vus, plafonnés
    watched += Math.min(seen.get(g).size, g.count);
    total += g.count;
  }
  // prochain épisode : après le dernier vu
  let next = null;
  if (lastG) {
    // saison regardée en dernier → on repart du plus grand numéro vu (revoir un vieil épisode ne fait pas reculer)
    lastN = Math.max(...seen.get(lastG));
    const i = counted.indexOf(lastG);
    const absolute = lastN > lastG.count; // numérotation continue (ex. One Piece E577)
    if (lastN < lastG.count || (absolute && seen.get(lastG).size < lastG.count)) next = { season: lastG.number, ep: lastN + 1 };
    else if (i >= 0 && counted[i + 1]) next = { season: counted[i + 1].number, ep: 1 };
  }
  const complete = total > 0 && watched >= total;
  return {
    watched,
    total,
    complete: complete && !(meta && meta.simulcast),
    upToDate: complete && !!(meta && meta.simulcast),
    groups: counted.map((g) => ({ title: g.title, number: g.number, count: g.count, seen: Math.min(seen.get(g).size, g.count) })),
    next: complete ? null : next,
  };
}
