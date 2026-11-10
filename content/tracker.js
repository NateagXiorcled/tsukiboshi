// Suivi en direct : détecte la lecture d'une vidéo et prévient le service worker.
// Tourne dans toutes les frames (le lecteur Crunchyroll est dans une iframe).
(() => {
  const VH = window.__VH;
  if (!VH || !VH.platform || window.__VH_TRACK) return;
  window.__VH_TRACK = true;

  // Crunchyroll : épisodes marqués « vus » sur le site (repérés par cr-hook.js) → ajoutés à l'historique
  if (VH.platform === 'crunchyroll' && window === top) {
    window.addEventListener('message', (e) => {
      if (e.source !== window || !e.data || e.data.__tsuki !== 'cr-marked' || !Array.isArray(e.data.items)) return;
      const now = Date.now();
      const entries = e.data.items.filter((x) => x && x.series && x.id).map((x, i) => {
        const length = x.duration ? x.duration / 1000 : null;
        const label = (x.season ? `S${x.season} ` : '') + (x.ep != null && x.ep !== '' ? `E${x.ep} - ` : '') + String(x.title || '').trim();
        return {
          platform: 'crunchyroll', title: String(x.series).trim(), episode: label, date: now - i, hasTime: true,
          seconds: length, length, progress: 1, url: `https://www.crunchyroll.com/fr/watch/${x.id}/${x.slug || ''}`,
          seriesId: x.seriesId || '', seasonId: x.seasonId || '', seasonNum: typeof x.season === 'number' ? x.season : null, epNum: typeof x.ep === 'number' ? x.ep : null,
          source: 'marked',
        };
      });
      if (entries.length) VH.send({ type: 'addEntries', entries });
    });
  }

  const INTERVAL = 5; // secondes
  const lastTime = new WeakMap();

  function findVideos() {
    const out = [...document.querySelectorAll('video')];
    if (out.length) return out;
    // Certains lecteurs (Disney+) placent la vidéo dans un shadow DOM
    const walk = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) {
          out.push(...el.shadowRoot.querySelectorAll('video'));
          walk(el.shadowRoot);
        }
      }
    };
    walk(document);
    return out;
  }

  setInterval(() => {
    let playing = false, length = null;
    for (const v of findVideos()) {
      const prev = lastTime.get(v);
      const t = v.currentTime;
      lastTime.set(v, t);
      if (!v.paused && !v.ended && v.readyState >= 2 && prev !== undefined && t > prev + 1) {
        playing = true;
        if (isFinite(v.duration) && v.duration > 60) length = v.duration;
      }
    }
    if (playing) {
      try {
        VH.send({ type: 'heartbeat', platform: VH.platform, delta: INTERVAL, length }).catch(() => {});
      } catch {} // extension rechargée : contexte invalide
    }
  }, INTERVAL * 1000);

  // ---------- Métadonnées (frame principale uniquement) ----------
  if (window !== top) return;

  const txt = (sel) => {
    for (const s of sel.split(',')) {
      const e = document.querySelector(s.trim());
      const t = e && e.textContent.replace(/\s+/g, ' ').trim();
      if (t) return t;
    }
    return '';
  };
  const ogTitle = () => document.querySelector('meta[property="og:title"]')?.content || '';

  function readMeta() {
    switch (VH.platform) {
      case 'netflix': {
        const el = document.querySelector('[data-uia="video-title"]');
        if (!el) return null;
        const h = el.querySelector('h4');
        const spans = [...el.querySelectorAll('span')].map((s) => s.textContent.trim()).filter(Boolean);
        if (h) return { title: h.textContent.trim(), episode: spans.join(' - ') };
        return { title: el.textContent.trim() };
      }
      case 'crunchyroll': {
        // Titre affiché sous le lecteur (mis à jour quand l'épisode suivant s'enchaîne, contrairement à og:title)
        const h1 = document.querySelector('h1');
        const ep = h1 ? h1.textContent.replace(/\s+/g, ' ').trim() : '';
        let series = txt('a.show-title-link h4, a.show-title-link, [data-t="show-title-link"]');
        if (!series && h1) {
          for (let el = h1.parentElement; el && el !== document.body && !series; el = el.parentElement) {
            const a = el.querySelector('a[href*="/series/"]');
            if (a) series = a.textContent.replace(/\s+/g, ' ').trim();
          }
        }
        if (series && ep) return { title: series, episode: ep };
        return null;
      }
      case 'adn': {
        const t = VH.cleanTitle(ogTitle() || document.title);
        return t ? { title: t } : null;
      }
      case 'disney': {
        const t = txt('[data-testid="title-field"], .title-field');
        const sub = txt('[data-testid="subtitle-field"], .subtitle-field');
        if (t) return { title: t, episode: sub };
        return null;
      }
      case 'prime': {
        const t = txt('.atvwebplayersdk-title-text');
        const sub = txt('.atvwebplayersdk-subtitle-text');
        return t ? { title: t, episode: sub } : null;
      }
    }
    return null;
  }

  // Les titres n'apparaissent parfois qu'au survol : on les mémorise par page
  const cache = {};
  setInterval(() => {
    const m = readMeta();
    if (m && m.title) cache[location.pathname] = m;
  }, 2000);

  // ---------- Crunchyroll : infos exactes de l'épisode en cours via l'API du site ----------
  let crAuth = '';
  if (VH.platform === 'crunchyroll') {
    window.addEventListener('message', (e) => {
      if (e.source === window && e.data && (e.data.__tsuki === 'cr-auth' || e.data.__tsuki === 'cr-capture') && e.data.auth) crAuth = e.data.auth;
    });
    window.postMessage({ __tsuki: 'cr-replay' }, location.origin);
  }
  const crCache = {};
  // Appel à l'API Crunchyroll via cr-hook.js (contexte de la page : jeton du site, renouvelé si expiré)
  let crSeq = 0;
  function crApi(path, timeout = 15000) {
    return new Promise((resolve) => {
      const id = 'tk' + Date.now().toString(36) + (crSeq++);
      const done = (res) => { window.removeEventListener('message', onMsg); clearTimeout(t); resolve(res); };
      const onMsg = (e) => { if (e.source === window && e.data && e.data.__tsuki === 'cr-api-res' && e.data.id === id) done(e.data); };
      const t = setTimeout(() => done({ status: 0 }), timeout);
      window.addEventListener('message', onMsg);
      window.postMessage({ __tsuki: 'cr-api', id, path }, location.origin);
    });
  }
  async function crMeta() {
    const id = (location.pathname.match(/\/watch\/([A-Z0-9]+)/i) || [])[1];
    if (!id) return null;
    if (crCache[id]) return crCache[id];
    try {
      const lang = document.documentElement.lang || navigator.language || 'en-US';
      const locale = /-/.test(lang) ? lang : ({ fr: 'fr-FR', en: 'en-US', de: 'de-DE', es: 'es-ES', it: 'it-IT', pt: 'pt-BR' }[lang] || 'en-US');
      let res = null;
      for (let i = 0; i < 3 && !(res && res.data); i++) {
        if (i) await VH.sleep(1500 * i);
        res = await crApi(`/content/v2/cms/objects/${id}?locale=${locale}`);
        if (res.status === 404) break;
      }
      if (!res || !res.data) return null;
      const j = res.data;
      const p = (j.data && j.data[0]) || null;
      if (!p) return null;
      const m = p.episode_metadata || p.movie_metadata || {};
      const series = (m.series_title || m.movie_listing_title || '').trim();
      const num = m.episode ?? m.episode_number;
      const season = m.season_number;
      const label = (season ? `S${season} ` : '') + (num !== undefined && num !== null && num !== '' ? `E${num} - ` : '') + (p.title || '').trim();
      const flat = (x) => (Array.isArray(x) ? x.flatMap(flat) : x ? [x] : []);
      const imgs = flat(p.images && p.images.thumbnail).filter((x) => x && x.source).sort((a, b) => Math.abs(a.width - 480) - Math.abs(b.width - 480));
      return (crCache[id] = {
        title: series || (p.title || '').trim(),
        episode: series ? label : '',
        image: imgs[0] ? imgs[0].source : '',
        seriesId: m.series_id || '',
        seasonId: m.season_id || '',
        seasonNum: typeof season === 'number' ? season : null,
        epNum: typeof m.episode_number === 'number' ? m.episode_number : null,
        length: m.duration_ms ? m.duration_ms / 1000 : null,
      });
    } catch {
      return null;
    }
  }

  // Préchargement dès l'ouverture de l'épisode (y compris passage automatique à l'épisode suivant)
  if (VH.platform === 'crunchyroll' && window.top === window) {
    const tried = {};
    setInterval(() => {
      const id = (location.pathname.match(/\/watch\/([A-Z0-9]+)/i) || [])[1];
      if (!id || crCache[id] || Date.now() - (tried[id] || 0) < 20000) return;
      tried[id] = Date.now();
      crMeta();
    }, 3000);
  }

  // Test complet demandé par la page de diagnostic (mêmes appels que l'extension, via cr-hook.js)
  async function crTest() {
    const out = { page: location.pathname, jetonVu: !!crAuth, etapes: [] };
    const step = async (name, path) => {
      const t = Date.now();
      const r = await crApi(path);
      out.etapes.push({ etape: name, code: r.status, ok: !!r.data, ms: Date.now() - t });
      return r.data || null;
    };
    const lang = document.documentElement.lang || navigator.language || 'en-US';
    const locale = /-/.test(lang) ? lang : ({ fr: 'fr-FR', en: 'en-US', de: 'de-DE', es: 'es-ES', it: 'it-IT', pt: 'pt-BR' }[lang] || 'en-US');
    let seriesId = '';
    const id = (location.pathname.match(/\/watch\/([A-Z0-9]+)/i) || [])[1];
    if (id) {
      const o = await step('épisode en cours (cms/objects)', `/content/v2/cms/objects/${id}?locale=${locale}`);
      const p = o && o.data && o.data[0];
      const m = p && (p.episode_metadata || {});
      if (m && m.series_id) {
        seriesId = m.series_id;
        out.exemple = `${m.series_title} — S${m.season_number} E${m.episode_number}`;
      }
    } else {
      const b = await step('catalogue (discover/browse)', `/content/v2/discover/browse?n=1&locale=${locale}`);
      const it = b && b.data && b.data[0];
      if (it) { seriesId = it.id; out.exemple = it.title; }
    }
    if (seriesId) {
      await step('série (cms/series)', `/content/v2/cms/series/${seriesId}?locale=${locale}`);
      const z = await step('saisons', `/content/v2/cms/series/${seriesId}/seasons?locale=${locale}`);
      out.saisons = z && z.data ? z.data.length : null;
    }
    out.jetonApres = !!crAuth;
    return out;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'crTest' && VH.platform === 'crunchyroll' && window === top) {
      crTest().then(sendResponse, (e) => sendResponse({ erreur: e.message }));
      return true;
    }
    if (msg.type !== 'getMeta') return;
    if (VH.platform === 'crunchyroll') {
      crMeta().then((api) => sendResponse(api || cache[location.pathname] || readMeta() || { title: VH.cleanTitle(document.title) }));
      return true; // réponse asynchrone
    }
    let m = cache[location.pathname] || readMeta();
    if (!m && VH.platform !== 'prime') {
      const t = VH.cleanTitle(document.title);
      m = { title: t && !/^(netflix|disney\+)$/i.test(t) ? t : `${VH.platform} ${location.pathname}` };
    }
    if (m) {
      const og = document.querySelector('meta[property="og:image"]')?.content || '';
      if (/^https?:/.test(og)) m = { ...m, image: og };
    }
    sendResponse(m);
  });
})();
