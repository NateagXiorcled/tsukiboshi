// Outils communs aux scripts de contenu
(() => {
  if (window.__VH) return;

  const h = location.hostname;
  let platform = null;
  if (h.endsWith('netflix.com')) platform = 'netflix';
  else if (h.endsWith('crunchyroll.com')) platform = 'crunchyroll';
  else if (h.includes('animationdigitalnetwork')) platform = 'adn';
  else if (h.endsWith('disneyplus.com')) platform = 'disney';
  else if (h.endsWith('primevideo.com') || h.includes('amazon.')) platform = 'prime';

  const MONTHS = {
    janvier: 1, janv: 1, jan: 1, january: 1,
    fevrier: 2, fevr: 2, fev: 2, feb: 2, february: 2,
    mars: 3, mar: 3, march: 3,
    avril: 4, avr: 4, apr: 4, april: 4,
    mai: 5, may: 5,
    juin: 6, jun: 6, june: 6,
    juillet: 7, juil: 7, jul: 7, july: 7,
    aout: 8, aug: 8, august: 8,
    septembre: 9, sept: 9, sep: 9, september: 9,
    octobre: 10, oct: 10, october: 10,
    novembre: 11, nov: 11, november: 11,
    decembre: 12, dec: 12, december: 12,
  };

  const noAccent = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  function mk(y, m, d) {
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
    const dt = new Date(y, m - 1, d, 12, 0, 0);
    return { ts: dt.getTime(), hasTime: false, prec: 1 };
  }

  // Retourne { ts, hasTime } ou null
  function parseDate(text, preferDMY) {
    if (!text) return null;
    let s = noAccent(String(text).toLowerCase()).replace(/\s+/g, ' ').trim();
    if (s.length > 80) return null;
    if (preferDMY === undefined) preferDMY = !/^en(-us)?$/i.test(document.documentElement.lang || 'fr');

    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const shift = (days, prec = 1) => ({ ts: today.getTime() - days * 86400000, hasTime: false, prec: Math.max(1, prec) });

    if (/\b(aujourd'?hui|today)\b/.test(s)) return shift(0);
    if (/\b(hier|yesterday)\b/.test(s)) return shift(1);
    let m = s.match(/il y a (\d+|un|une) (minute|heure|jour|semaine|mois|an)/) || s.match(/(\d+|a|an|one) (minute|hour|day|week|month|year)s? ago/);
    if (m) {
      const n = /^\d+$/.test(m[1]) ? +m[1] : 1;
      const unit = { minute: 0, heure: 0, hour: 0, jour: 1, day: 1, semaine: 7, week: 7, mois: 30, month: 30, an: 365, year: 365 }[m[2]];
      return shift(n * unit, unit);
    }

    m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
    if (m) return mk(+m[1], +m[2], +m[3]);

    m = s.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/);
    if (m) {
      let a = +m[1], b = +m[2];
      let dmy = preferDMY;
      if (a > 12) dmy = true;
      else if (b > 12) dmy = false;
      return dmy ? mk(+m[3], b, a) : mk(+m[3], a, b);
    }

    m = s.match(/\b(\d{1,2})(?:er)?\s+([a-z]+)\.?,?\s+(\d{4})\b/);
    if (m && MONTHS[m[2]]) return mk(+m[3], MONTHS[m[2]], +m[1]);

    m = s.match(/\b([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
    if (m && MONTHS[m[1]]) return mk(+m[3], MONTHS[m[1]], +m[2]);

    return null;
  }

  function cleanTitle(t) {
    return String(t || '')
      .replace(/\s*[|\-–—:]\s*(regarder sur |watch on )?(netflix|crunchyroll|adn|animation digital network|disney\+|prime video|amazon\.?\w*)\s*$/i, '')
      .replace(/^(regarder|watch)\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // envoi au service de l'extension ; si l'extension a été mise à jour ou rechargée, l'ancien script
  // de l'onglet ne peut plus lui parler : on se tait au lieu de remplir la liste des erreurs de Chrome
  const alive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch { return false; } };
  const send = (msg) => {
    if (!alive()) return Promise.resolve(undefined);
    try {
      return chrome.runtime.sendMessage(msg).catch(() => undefined);
    } catch {
      return Promise.resolve(undefined);
    }
  };

  window.__VH = { platform, parseDate, cleanTitle, sleep, send, alive };
})();
