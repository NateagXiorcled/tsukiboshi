// Calendrier des sorties : dates VO (Japon / diffusion d'origine), VOSTFR et VF de chaque épisode.
// Calcul pur, partagé par le service worker et testé seul.
//   VO     : AniList (animés) ou TVmaze (séries)
//   VOSTFR : catalogue Crunchyroll (version originale) ; à venir : VO + décalage habituel de la série
//   VF     : catalogue Crunchyroll (version doublée fr-FR) ; à venir : estimation d'après le décalage des VF déjà sorties

const DAY = 864e5;
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const epOfLabel = (e) => {
  if (typeof e.epNum === 'number') return e.epNum;
  const m = String(e.episode || '').match(/\bE(\d+)\b/i);
  return m ? +m[1] : null;
};
const seasonOfLabel = (e) => {
  if (typeof e.seasonNum === 'number') return e.seasonNum;
  const m = String(e.episode || '').match(/^S(\d+)\b/i);
  return m ? +m[1] : null;
};

/**
 * group  : { key, title, platform, items, season? }   (season : numéro de la saison suivie, si connu)
 * vo     : [{ ep, at }]                 dates de diffusion d'origine
 * cr     : { season, vostfr: [{ ep, at }], vf: [{ ep, at }] } | null
 * → [{ key, title, platform, ep, season, kind: 'vo'|'vostfr'|'vf', at, estimated, seen }]
 */
export function buildCalendar(group, { vo = [], cr = null, now = Date.now(), horizon = 120 * DAY } = {}) {
  const out = [];
  const season = (cr && cr.season) ?? group.season ?? null;
  // épisodes déjà vus (de cette saison si on la connaît)
  const seen = new Set(group.items.filter((e) => season == null || seasonOfLabel(e) == null || seasonOfLabel(e) === season).map(epOfLabel).filter((n) => n != null));
  const push = (kind, ep, at, estimated = false) => {
    if (!at || !Number.isFinite(at) || at > now + horizon || at < now - 60 * DAY) return;
    out.push({ key: group.key, title: group.title, platform: group.platform, ep, season, kind, at, estimated, seen: seen.has(ep) });
  };
  const voBy = new Map(vo.map((x) => [x.ep, x.at]));
  for (const x of vo) push('vo', x.ep, x.at);
  if (cr) {
    const vost = new Map((cr.vostfr || []).map((x) => [x.ep, x.at]));
    const vf = new Map((cr.vf || []).map((x) => [x.ep, x.at]));
    for (const [ep, at] of vost) push('vostfr', ep, at);
    for (const [ep, at] of vf) push('vf', ep, at);
    // décalage habituel VO → VOSTFR (souvent ~1 h), pour annoncer les prochains épisodes
    const offVost = median([...vost].filter(([ep]) => voBy.has(ep)).map(([ep, at]) => at - voBy.get(ep)).filter((d) => d > -DAY && d < 14 * DAY));
    if (offVost != null) for (const x of vo) if (!vost.has(x.ep)) push('vostfr', x.ep, x.at + offVost, true);
    // décalage habituel VOSTFR → VF (souvent plusieurs semaines) : estimation des prochaines VF
    const vostOrVo = (ep) => vost.get(ep) ?? (voBy.has(ep) && offVost != null ? voBy.get(ep) + offVost : null);
    const offVf = median([...vf].map(([ep, at]) => { const b = vostOrVo(ep); return b == null ? null : at - b; }).filter((d) => d != null && d >= 0 && d < 120 * DAY));
    if (offVf != null && vf.size) {
      const lastVf = Math.max(...vf.keys());
      for (const x of vo) if (x.ep > lastVf && !vf.has(x.ep)) { const b = vostOrVo(x.ep); if (b != null) push('vf', x.ep, b + offVf, true); }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// filtre selon la langue choisie : 'vostfr', 'vf' ou 'both' (la VO reste visible dans tous les cas)
export const langFilter = (lang) => (it) => it.kind === 'vo' || lang === 'both' || it.kind === lang;

// semaine (lundi → dimanche) contenant la date
export function weekOf(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}
