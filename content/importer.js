// Import de l'historique depuis la page "Historique" de chaque plateforme.
// - mode normal : import complet (1re utilisation), avec un petit panneau
// - mode silencieux : synchro en arrière-plan (fenêtre réduite), seulement les visionnages récents
(() => {
  const VH = window.__VH;
  if (!VH || !VH.platform || window !== top || window.__VH_IMP) return;
  window.__VH_IMP = true;

  const CONF = {
    netflix: { page: /\/viewingactivity|\/settings\/viewed/i, run: importNetflix },
    crunchyroll: { page: /\/history/, link: 'a[href*="/watch/"]', series: 'a[href*="/series/"]', run: importCrunchyroll },
    // série ADN : /video/851-akira (numéro devant) — les menus sont /video/genre/…, /video/order/…, /video/type/…
    adn: { page: /histor/i, link: 'a[href*="/video/"]', linkOk: (a) => adnIsShow(a) },
    prime: { page: /watch-history|historique/i, link: 'a[href*="/detail/"]', run: importPrime },
  }[VH.platform];
  if (!CONF) return;

  // Liens de menus (en-tête, navigation, pied de page) : jamais des visionnages
  function inMenu(a) {
    return !!a.closest('header, nav, footer, [role="navigation"], [role="menu"], [role="menubar"], [role="banner"], [role="contentinfo"]');
  }
  function adnIsShow(a) {
    try {
      return /\/video\/\d+-[^/]+/.test(new URL(a.href, location.href).pathname);
    } catch { return false; }
  }
  function adnDepth(a) {
    try {
      const path = new URL(a.href, location.href).pathname;
      const i = path.indexOf('/video/');
      return i < 0 ? 0 : path.slice(i + 7).split('/').filter(Boolean).length;
    } catch { return 0; }
  }
  const linkOk = (a) => !inMenu(a) && (!CONF.linkOk || CONF.linkOk(a));

  const platform = VH.platform;
  const isHistoryPage = () => CONF.page.test(location.pathname + location.search);
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  let silent = false;

  // Journal : console + diagnostic copiable depuis les réglages du popup
  function log(...args) {
    console.info('[Tsukiboshi]', ...args);
    const text = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ').slice(0, 700);
    try { VH.send({ type: 'diag', text: `${platform}: ${text}` }).catch(() => {}); } catch {}
  }
  let profile = '';

  // ---------- Profil (Netflix : l'historique est séparé par profil) ----------
  function detectProfile() {
    if (platform !== 'netflix') return '';
    const html = document.documentElement.innerHTML;
    const m =
      html.match(/"profileName"\s*:\s*"([^"]+)"/) ||
      html.match(/"userInfo"\s*:\s*\{\s*"data"\s*:\s*\{[^}]*?"name"\s*:\s*"([^"]+)"/);
    if (!m) return '';
    return m[1].replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  profile = detectProfile();
  if (profile) VH.send({ type: 'profile', platform, name: profile }).catch(() => {});

  // ---------- Petit panneau flottant (mode normal uniquement) ----------
  let panel, statusEl, btn, boxEl, running = false;
  function ensurePanel() {
    if (panel || silent) return;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    const logo = chrome.runtime.getURL('icons/logo-small.svg');
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .box { width: 320px; box-sizing: border-box; padding: 16px; border-radius: 12px; position: relative;
               background: #0e0e11; color: #f2f2f5; border: 1px solid #26262e; box-shadow: 0 16px 48px rgba(0,0,0,.5);
               font: 400 13px/1.45 Inter, "Segoe UI", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
        .head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
        .head img { width: 22px; height: 22px; }
        .name { font-weight: 700; font-size: 15px; letter-spacing: -0.2px; }
        .x { margin-left: auto; width: 26px; height: 26px; display: grid; place-items: center; border-radius: 6px;
             color: #8b8b98; cursor: pointer; font-size: 14px; }
        .x:hover { background: #1f1f26; color: #f2f2f5; }
        .st { color: #cfcfd8; }
        .bar { height: 3px; margin-top: 12px; border-radius: 3px; background: #26262e; overflow: hidden; display: none; }
        .bar i { display: block; height: 100%; width: 35%; background: #6c4dff; border-radius: 3px; animation: run 1.2s ease-in-out infinite; }
        .box.busy .bar { display: block; }
        @keyframes run { from { transform: translateX(-100%); } to { transform: translateX(290%); } }
        button { margin-top: 14px; width: 100%; height: 36px; border: 0; border-radius: 8px; cursor: pointer;
                 background: #6c4dff; color: #fff; font: 600 13px Inter, "Segoe UI", system-ui, sans-serif; }
        button:hover { background: #7d62ff; }
        .box.busy button, .box.busy .csv { display: none; }
        .csv { display: block; margin-top: 10px; text-align: center; color: #a593ff; font-size: 12px; cursor: pointer; }
        .csv:hover { text-decoration: underline; }
      </style>
      <div class="box">
        <div class="head"><img src="${logo}" alt=""><span class="name">tsukiboshi</span><span class="x" title="Fermer">✕</span></div>
        <div class="st"></div>
        <div class="bar"><i></i></div>
        <button>Importer tout l'historique</button>
        ${platform === 'netflix' ? '<a class="csv">ou importer le fichier CSV « Tout télécharger »</a><input type="file" accept=".csv,text/csv" hidden>' : ''}
      </div>`;
    statusEl = root.querySelector('.st');
    btn = root.querySelector('button');
    btn.onclick = () => runImport(false);
    boxEl = root.querySelector('.box');
    const csvLink = root.querySelector('.csv');
    if (csvLink) {
      const input = root.querySelector('input[type=file]');
      csvLink.onclick = () => input.click();
      input.onchange = async () => {
        const f = input.files[0];
        if (!f) return;
        const list = netflixCsvEntries(await f.text());
        input.value = '';
        if (!list.length) return status("Ce fichier ne ressemble pas à l'export Netflix (colonnes Title et Date).");
        await sendEntries(list, false);
      };
    }
    root.querySelector('.x').onclick = () => { if (!running) { host.remove(); panel = null; } };
    document.documentElement.appendChild(host);
    panel = host;
  }
  const status = (t) => {
    if (/^Terminé|^Erreur|^Aucun/.test(t) && boxEl) boxEl.classList.remove('busy');
    if (silent) return;
    ensurePanel();
    statusEl.textContent = t;
  };

  // ---------- Défilement jusqu'à tout charger ----------
  function clickShowMore() {
    const b = [...document.querySelectorAll('button, a[role="button"], [role="button"]')].find(
      (x) => x.offsetParent && /afficher plus|voir plus|charger plus|show more|load more|plus de r[ée]sultats/i.test(x.textContent)
    );
    if (b) b.click();
    return !!b;
  }

  // Conteneur qui défile (la page ou un bloc interne)
  function scroller() {
    let best = null;
    for (const el of document.querySelectorAll('main, div, section')) {
      if (el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 300) {
        const oy = getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && (!best || el.scrollHeight > best.scrollHeight)) best = el;
      }
    }
    return best;
  }

  // Descend d'un écran (et non directement en bas : certaines listes n'affichent que ce qui est visible)
  function scrollStep() {
    const inner = scroller();
    const step = Math.round(window.innerHeight * 0.8);
    if (inner) {
      inner.scrollTop += Math.round(inner.clientHeight * 0.8);
      return inner.scrollTop + inner.clientHeight >= inner.scrollHeight - 5;
    }
    window.scrollBy(0, step);
    const el = document.scrollingElement || document.documentElement;
    return window.scrollY + window.innerHeight >= el.scrollHeight - 5;
  }

  // collect() lit les éléments visibles et retourne le total déjà trouvé
  async function loadAll(collect) {
    for (let i = 0; i < 30 && !collect(); i++) await VH.sleep(1000);
    window.scrollTo(0, 0);
    const maxRounds = silent ? 6 : 20000; // en synchro, seuls les plus récents suffisent
    let stable = 0, lastC = -1;
    for (let i = 0; i < maxRounds && stable < 6; i++) {
      const atBottom = scrollStep();
      const clicked = atBottom && clickShowMore();
      await VH.sleep(atBottom ? 1500 : 600);
      const c = collect();
      stable = atBottom && c === lastC && !clicked ? stable + 1 : 0;
      lastC = c;
      status(`Lecture de l'historique… ${c} épisodes trouvés`);
    }
  }

  // ---------- Crunchyroll : lecture des données chargées par le site ----------
  // content/cr-hook.js (dans la page) intercepte les réponses "watch-history" et nous les transmet.
  // Vignette Crunchyroll : images.thumbnail = [[{ source, width, height }, …]]
  function crImage(p) {
    try {
      const list = [].concat(...((p.images && (p.images.thumbnail || p.images.poster_wide)) || [])).filter((x) => x && x.source);
      if (!list.length) return '';
      list.sort((a, b) => Math.abs(a.width - 480) - Math.abs(b.width - 480));
      return list[0].source;
    } catch { return ''; }
  }

  function crItem(it) {
    const p = it.panel || it;
    const m = p.episode_metadata || p.movie_metadata || {};
    const epTitle = clean(p.title);
    const series = clean(m.series_title || m.movie_listing_title || p.series_title);
    const num = m.episode ?? m.episode_number;
    const season = m.season_number;
    const label = (season ? `S${season} ` : '') + (num !== undefined && num !== null && num !== '' ? `E${num} - ` : '') + epTitle;
    const d = it.date_played || it.last_watched || it.datetime || it.date;
    const date = d ? new Date(d).getTime() : null;
    const length = m.duration_ms ? m.duration_ms / 1000 : null;
    return {
      _id: `${it.id || p.id}|${d || ''}`,
      platform,
      profile,
      title: series || epTitle || 'Épisode retiré du catalogue',
      episode: series ? label : epTitle ? '' : `ID ${p.id || it.id || '?'}`,
      date: isFinite(date) ? date : null,
      hasTime: !!d,
      seconds: it.playhead || null,
      length,
      progress: it.fully_watched ? 1 : null,
      url: p.id ? `https://www.crunchyroll.com/fr/watch/${p.id}/${p.slug_title || ''}` : '',
      image: crImage(p),
      seriesId: m.series_id || '',
      seasonId: m.season_id || '',
      seasonNum: typeof season === 'number' ? season : null,
      epNum: typeof m.episode_number === 'number' ? m.episode_number : /^\d+$/.test(String(num ?? '')) ? +num : null,
      source: 'import',
    };
  }

  // ---------- Crunchyroll : affiches, saisons et nombre d'épisodes ----------
  // Le jeton du site est repéré en continu par cr-hook.js (réponses "watch-history")
  let crAuth = '';
  if (platform === 'crunchyroll') {
    window.addEventListener('message', (e) => {
      if (e.source === window && e.data && (e.data.__tsuki === 'cr-capture' || e.data.__tsuki === 'cr-auth') && e.data.auth) crAuth = e.data.auth;
    });
  }

  // images = [[{ source, width, height }, …]] ou [{…}] ou "https://…"
  function pickImage(sets, width) {
    try {
      if (typeof sets === 'string') return /^https?:/.test(sets) ? sets : '';
      const flat = (x) => (Array.isArray(x) ? x.flatMap(flat) : x ? [x] : []);
      const list = flat(sets).filter((x) => x && (x.source || x.url));
      if (!list.length) return '';
      list.sort((a, b) => Math.abs((a.width || 0) - width) - Math.abs((b.width || 0) - width));
      return list[0].source || list[0].url;
    } catch { return ''; }
  }
  function imagesOf(d) {
    const im = (d && (d.images || (d.series_metadata && d.series_metadata.images))) || {};
    return {
      poster: pickImage(im.poster_tall || im.posterTall || im.poster || d.poster_tall, 360),
      wide: pickImage(im.poster_wide || im.posterWide || im.keyart || im.background || d.poster_wide, 960),
    };
  }
  let diagSample = 0;

  // Langue de l'utilisateur (ex. fr-FR, en-US, de-DE) : celle de la page, sinon du navigateur
  function crLocale() {
    const l = document.documentElement.lang || navigator.language || 'en-US';
    return /-/.test(l) ? l : ({ fr: 'fr-FR', en: 'en-US', de: 'de-DE', es: 'es-ES', it: 'it-IT', pt: 'pt-BR', ar: 'ar-SA', ru: 'ru-RU' }[l] || 'en-US');
  }

  // Appels faits par cr-hook.js dans le contexte de la page : jeton du site renouvelé automatiquement,
  // nouvel essai si Crunchyroll répond « indisponible » (503)
  let crSeq = 0;
  function crApi(path, timeout = 20000) {
    return new Promise((resolve) => {
      const id = 'ti' + Date.now().toString(36) + (crSeq++);
      const done = (res) => { window.removeEventListener('message', onMsg); clearTimeout(t); resolve(res); };
      const onMsg = (e) => { if (e.source === window && e.data && e.data.__tsuki === 'cr-api-res' && e.data.id === id) done(e.data); };
      const t = setTimeout(() => done({ status: 0 }), timeout);
      window.addEventListener('message', onMsg);
      window.postMessage({ __tsuki: 'cr-api', id, path }, location.origin);
    });
  }
  async function crGet(path) {
    const u = new URL(path, location.origin);
    if (!u.searchParams.has('locale')) u.searchParams.set('locale', crLocale());
    const res = await crApi(u.pathname + u.search);
    if (res.status === 401 || res.status === 403) throw new Error('auth');
    if (res.status === 0 || res.status >= 500) throw new Error('indisponible ' + res.status);
    return res.data || null;
  }

  async function crSeriesMeta(seriesId) {
    const sj = await crGet(`/content/v2/cms/series/${seriesId}`);
    const d = (sj && ((sj.data && sj.data[0]) || sj)) || {};
    const zj = await crGet(`/content/v2/cms/series/${seriesId}/seasons`);
    const seasons = ((zj && (zj.data || zj.items)) || []).map((x) => ({
      id: x.id,
      title: clean(x.title),
      number: x.season_number ?? x.season_sequence_number ?? null,
      seq: x.season_sequence_number ?? x.season_number ?? null,
      count: x.number_of_episodes ?? x.episode_count ?? null,
      versions: (x.versions || []).map((v) => v.guid || v.id).filter(Boolean),
    }));
    if (!d.id && !seasons.length) {
      log('Crunchyroll : fiche série illisible', seriesId, sj && Object.keys(sj), zj && Object.keys(zj));
      throw new Error('fiche vide'); // pas enregistrée : retentée à la prochaine synchro
    }
    let { poster, wide } = imagesOf(d);
    if (diagSample++ < 2) log('fiche série', seriesId, { cles: Object.keys(d), images: d.images ? JSON.stringify(d.images).slice(0, 300) : null, saisons: seasons.length, poster, wide });
    // 2e source : objet générique
    if (!poster) {
      try {
        const oj = await crGet(`/content/v2/cms/objects/${seriesId}`);
        const o = (oj && oj.data && oj.data[0]) || {};
        const im = imagesOf(o);
        poster = im.poster; wide = wide || im.wide;
      } catch {}
    }
    // 3e source : image de partage de la page de la série
    if (!poster && !wide) {
      try {
        const r = await fetch(`https://www.crunchyroll.com/fr/series/${seriesId}`, { credentials: 'include' });
        const html = r.ok ? await r.text() : '';
        const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || html.match(/content=["']([^"']+)["'][^>]+property=["']og:image/i);
        if (m) wide = m[1].replace(/&amp;/g, '&');
      } catch {}
    }
    return {
      seriesId,
      title: clean(d.title),
      poster,
      wide,
      description: clean(d.description).slice(0, 600),
      episodeCount: d.episode_count ?? null,
      seasonCount: d.season_count ?? null,
      simulcast: !!d.is_simulcast,
      seasons,
      fetched: Date.now(),
    };
  }

  async function crFetchMeta() {
    if (!crAuth) {
      window.postMessage({ __tsuki: 'cr-replay' }, location.origin);
      await VH.sleep(800);
    }
    log('infos séries : jeton', crAuth ? 'trouvé' : 'absent (essai sans)');
    const todo = (await VH.send({ type: 'crMetaTodo', max: silent ? 60 : 1000 })) || [];
    if (!todo.length) return;
    const results = {};
    let done = 0, stop = false;
    const worker = async () => {
      while (todo.length && !stop) {
        const t = todo.shift();
        try {
          results[t.key] = await crSeriesMeta(t.seriesId);
        } catch (e) {
          if (e.message === 'auth') stop = true;
          else log('Crunchyroll : fiche', t.seriesId, String(e.message || e));
        }
        done++;
        status(`Récupération des affiches et du nombre d'épisodes… ${done} séries`);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (Object.keys(results).length) await VH.send({ type: 'setMeta', items: results });
    log('Crunchyroll : infos de', Object.keys(results).length, 'séries récupérées', stop ? '(jeton expiré, la suite à la prochaine synchro)' : '');
  }

  async function importCrunchyroll() {
    const caps = [];
    let seenCaps = 0;
    const onMsg = (e) => {
      if (e.source === window && e.data && e.data.__tsuki === 'cr-capture') caps.push(e.data);
    };
    window.addEventListener('message', onMsg);
    window.postMessage({ __tsuki: 'cr-replay' }, location.origin);
    for (let i = 0; i < 20 && !caps.length; i++) {
      if (i === 6) window.scrollBy(0, 400); // provoque le chargement si besoin
      await VH.sleep(1000);
    }
    if (!caps.length) {
      window.removeEventListener('message', onMsg);
      return importGeneric(); // repli : lecture de la page
    }

    const out = new Map();
    const addData = (data) => {
      const items = (data && (data.data || data.items)) || [];
      let fresh = 0;
      for (const it of items) {
        const e = crItem(it);
        if (!out.has(e._id)) { out.set(e._id, e); fresh++; }
      }
      return { n: items.length, fresh };
    };
    const drainCaps = () => {
      let fresh = 0;
      for (; seenCaps < caps.length; seenCaps++) fresh += addData(caps[seenCaps].data).fresh;
      return fresh;
    };
    drainCaps();
    const first = caps[0];
    log('réponse Crunchyroll :', first.url, Object.keys(first.data || {}), first.data && (first.data.meta || first.data.__links__ || first.data.links));

    const progress = () => status(`Lecture de l'historique Crunchyroll… ${out.size.toLocaleString('fr-FR')} épisodes (ça peut prendre plusieurs minutes)`);
    const headers = () => {
      const c = [...caps].reverse().find((x) => x.auth); // jeton le plus récent du site
      const a = (c && c.auth) || crAuth;
      return a ? { Authorization: a } : {};
    };
    async function get(url) {
      let r = await fetch(url, { headers: headers(), credentials: 'include' });
      if (r.status === 401 || r.status === 403) {
        window.scrollBy(0, 1500); // le site renouvelle son jeton
        await VH.sleep(3000);
        r = await fetch(url, { headers: headers(), credentials: 'include' });
      }
      return r.ok ? r.json() : null;
    }
    const nextLink = (d) => {
      if (!d) return null;
      const n = (d.meta && (d.meta.next_page || d.meta.next)) || d.next_page || d.next ||
        (d.links && d.links.next && (d.links.next.href || d.links.next)) ||
        (d.__links__ && d.__links__.next && d.__links__.next.href);
      return typeof n === 'string' && n ? new URL(n, location.origin).href : null;
    };
    // Une stratégie de pagination : on s'arrête quand une page est vide, identique à la précédente
    // (paramètre ignoré par le site) ou n'apporte plus rien 3 fois de suite
    async function paginate(makeUrl) {
      let got = 0, prevSig = '', empty = 0;
      for (let i = 0; i < (silent ? 2 : 5000); i++) {
        const url = makeUrl(i);
        if (!url) break;
        const d = await get(url);
        const items = (d && (d.data || d.items)) || [];
        const sig = items.length ? JSON.stringify([items[0].id, items[items.length - 1].id, items.length]) : '';
        if (!items.length || sig === prevSig) break;
        prevSig = sig;
        last = d;
        const res = addData(d);
        progress();
        got += res.fresh;
        empty = res.fresh ? 0 : empty + 1;
        if (empty >= 3) break;
      }
      return got;
    }
    let last = first.data;

    try {
      // 1) liens "page suivante" fournis par Crunchyroll
      const nl = nextLink(first.data);
      if (nl) await paginate((i) => (i === 0 ? nl : nextLink(last)));

      if (!silent) {
        const base = new URL(first.url);
        const size = +base.searchParams.get('page_size') || +base.searchParams.get('n') || 20;
        // 2) numéro de page
        await paginate((i) => { const u = new URL(base); u.searchParams.set('page', i + 1); return u.href; });
        // 3) décalage (start / offset)
        await paginate((i) => {
          const u = new URL(base);
          u.searchParams.set('start', i * size);
          u.searchParams.set('offset', i * size);
          return u.href;
        });
      }
    } catch (e) {
      log('pagination Crunchyroll interrompue', String(e));
    }

    // 4) en dernier recours : on fait défiler la page jusqu'au bout, le site charge lui-même la suite
    if (!silent) {
      drainCaps();
      let idle = 0;
      while (idle < 10) {
        const el = scroller();
        if (el) el.scrollTop = el.scrollHeight;
        window.scrollTo(0, (document.scrollingElement || document.documentElement).scrollHeight);
        clickShowMore();
        await VH.sleep(1500);
        const fresh = drainCaps();
        idle = fresh ? 0 : idle + 1;
        progress();
      }
    }
    window.removeEventListener('message', onMsg);
    log('Crunchyroll :', out.size, 'épisodes récupérés');
    return [...out.values()];
  }

  // ---------- Netflix ----------
  // "Doctor Who : Saison 9 : "La sorcière et son pantin"" → { title: "Doctor Who", episode: "S9 - La sorcière et son pantin" }
  function netflixTitle(full) {
    const parts = clean(full).split(/\s*:\s+/).map((x) => clean(x.replace(/^["“”«»\s]+|["“”«»\s]+$/g, '')));
    const series = parts[0];
    let rest = parts.slice(1).filter(Boolean);
    if (rest.length > 1 && rest[0].toLowerCase() === (series || '').toLowerCase()) rest = rest.slice(1); // "Lie to Me : Lie to Me : …"
    let episode = '';
    if (rest.length) {
      const m = rest[0].match(/^(?:saison|season|staffel|temporada)\s*(\d+)$/i);
      episode = m ? `S${m[1]}${rest.length > 1 ? ' - ' + rest.slice(1).join(' : ') : ''}` : rest.join(' - ');
    }
    return { title: series || 'Titre retiré de Netflix', episode };
  }

  // Lecteur CSV simple (guillemets, virgules et retours à la ligne dans les champs)
  function parseCsv(text) {
    const rows = [];
    let row = [], field = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') q = false;
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ',' || c === ';') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some((x) => x !== '')) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some((x) => x !== '')) rows.push(row);
    return rows;
  }

  // Netflix écrit « Titre : Sous-titre » pour les films aussi (ex. « Batman v Superman : L'Aube de la justice »).
  // Si un titre n'apparaît qu'avec un seul sous-titre, sans saison ni épisode, c'est un film : on recolle le titre complet.
  const EP_MARK = /\b(s\d+|e\d+|saison|season|staffel|temporada|[ée]pisode|ep\.?\s*\d|chapitre|chapter|partie|part|volume|vol\.|livre|book|collection|mini-série|série limitée|limited series|\d+)\b/i;
  function netflixMovies(list) {
    const groups = new Map();
    for (const e of list) {
      if (!e.episode || /netflix\.com\/title\/\d+/.test(e.url || '')) continue;
      if (!groups.has(e.title)) groups.set(e.title, new Set());
      groups.get(e.title).add(e.episode);
    }
    for (const e of list) {
      const g = groups.get(e.title);
      if (g && g.size === 1 && !EP_MARK.test(e.episode)) {
        e.title = `${e.title} : ${e.episode}`;
        e.episode = '';
      }
    }
    return list;
  }

  // Fichier "Tout télécharger" de Netflix (colonnes Title / Date)
  function netflixCsvEntries(text) {
    const rows = parseCsv(text);
    if (!rows.length) return [];
    const head = rows[0].map((h) => h.toLowerCase().trim());
    const ti = head.findIndex((h) => /^(title|titre)$/.test(h));
    const di = head.findIndex((h) => /^date$/.test(h));
    if (ti < 0 || di < 0) return [];
    // format de date : jour/mois si une date dépasse 12 en première position
    const dmy = rows.slice(1).some((r) => +((r[di] || '').split(/[\/.\-]/)[0]) > 12) ||
      !rows.slice(1).some((r) => +((r[di] || '').split(/[\/.\-]/)[1]) > 12) && !/^en/i.test(document.documentElement.lang || 'fr');
    return netflixMovies(rows.slice(1).map((r) => {
      const d = VH.parseDate(r[di], dmy);
      return { platform, profile, ...netflixTitle(r[ti]), date: d?.ts ?? null, prec: d?.prec, url: '', source: 'import' };
    }));
  }

  async function netflixFromCsvLink() {
    const a = [...document.querySelectorAll('a, button')].find((x) => /tout télécharger|télécharger tout|download all/i.test(x.textContent));
    const href = a && a.getAttribute('href');
    if (!href || /^(#|javascript:)/i.test(href)) return null;
    const r = await fetch(new URL(href, location.href).href, { credentials: 'include' });
    if (!r.ok) return null;
    const list = netflixCsvEntries(await r.text());
    return list.length ? list : null;
  }

  function nfItem(it) {
    const series = clean(it.seriesTitle);
    let date = null, hasTime = false;
    if (it.date) {
      const d = new Date(it.date);
      hasTime = d.getHours() + d.getMinutes() + d.getSeconds() > 0;
      if (!hasTime) d.setHours(12);
      date = d.getTime();
    }
    const t = series
      ? netflixTitle(`${series} : ${clean(it.title).replace(series, '').replace(/^\s*:\s*/, '')}`)
      : netflixTitle(it.title || it.videoTitle || '');
    return {
      platform, profile, ...t, date, hasTime,
      seconds: it.bookmark || null,
      length: it.duration || null,
      url: it.movieID ? `https://www.netflix.com/title/${it.movieID}` : '',
      source: 'import',
    };
  }

  // Refait page par page la demande que Netflix utilise lui-même
  async function netflixApi(baseUrl) {
    const out = [], seen = new Set();
    const maxPages = silent ? 3 : 5000;
    for (let pg = 0; pg < maxPages; pg++) {
      const u = new URL(baseUrl, location.href);
      u.searchParams.set('pg', pg);
      u.searchParams.set('pgSize', 100);
      const r = await fetch(u.href, { credentials: 'include' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const items = j.viewedItems || [];
      let fresh = 0;
      for (const it of items) {
        const k = `${it.movieID}|${it.date}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(nfItem(it));
        fresh++;
      }
      status(`Lecture de l'historique Netflix… ${out.length.toLocaleString('fr-FR')} visionnages`);
      if (!items.length || !fresh || (j.vhSize && out.length >= j.vhSize)) break;
    }
    return out;
  }

  // Le fichier CSV ne contient pas le numéro des titres : on le reprend des lignes de la page (lien /title/123)
  // → sert à l'image officielle Netflix quand aucune affiche n'est trouvée ailleurs
  async function netflixAddLinks(list) {
    try {
      status('Netflix : récupération des liens des titres…');
      await loadAll(() => document.querySelectorAll('li.retableRow').length);
      const key = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
      const links = new Map();
      for (const row of document.querySelectorAll('li.retableRow')) {
        const a = row.querySelector('.title a');
        if (!a || !/\/title\/\d+/.test(a.getAttribute('href') || '')) continue;
        const k = key(netflixTitle(a.textContent || '').title);
        if (k && !links.has(k)) links.set(k, new URL(a.getAttribute('href'), location.origin).href.replace(/\?.*$/, ''));
      }
      let n = 0;
      for (const e of list) if (!e.url && links.has(key(e.title))) { e.url = links.get(key(e.title)); n++; }
      log('Netflix : liens ajoutés à', n, 'lignes sur', list.length, '(', links.size, 'titres )');
    } catch (e) {
      log('Netflix : liens non récupérés', String(e));
    }
    return list;
  }

  // Affiches officielles Netflix pour les titres que les autres sources n'ont pas trouvés.
  // Fait ici, sur netflix.com (connecté) : chaque ligne de l'historique a un lien /title/123,
  // et la page du titre contient son affiche verticale.
  async function netflixOfficialArt() {
    const missing = (await VH.send({ type: 'artMissing', platform: 'netflix' })) || [];
    if (!missing.length) return;
    const want = new Map(missing.map((m) => [m.key, m.title]));
    const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const links = new Map();
    const scan = () => {
      for (const a of document.querySelectorAll('li.retableRow .title a')) {
        const href = a.getAttribute('href') || '';
        if (!/\/title\/\d+/.test(href)) continue;
        // titre de la série (« Lie to Me : Saison 1 : … ») ou titre complet d'un film (« Batman v Superman : L'Aube de la justice »)
        const txt = a.textContent || '';
        for (const k of ['netflix|' + norm(netflixTitle(txt).title), 'netflix|' + norm(txt)]) {
          if (want.has(k) && !links.has(k)) links.set(k, href);
        }
      }
      return links.size;
    };
    // on charge l'historique (« Voir plus ») tant qu'il reste des titres sans lien
    scan();
    for (let i = 0; i < (silent ? 40 : 400) && links.size < want.size; i++) {
      if (!clickShowMore()) break;
      await VH.sleep(1200);
      scan();
      status(`Affiches Netflix : ${links.size} / ${want.size} titres repérés…`);
    }
    const pick = (html, type) => {
      const i = html.indexOf(type);
      if (i < 0) return '';
      const m = html.slice(i, i + 2500).match(/url\\*"\s*:\s*\\*"(https:[^"\\]*(?:\\+u0026[^"\\]*)*)/);
      return m ? m[1].replace(/\\+u0026/g, '&') : '';
    };
    let items = {}, n = 0, found = 0;
    const flush = async () => {
      if (!Object.keys(items).length) return;
      found += Object.keys(items).length;
      await VH.send({ type: 'setArt', items });
      items = {};
    };
    for (const [k, href] of links) {
      try {
        const r = await fetch(new URL(href, location.origin).href, { credentials: 'include' });
        if (r.ok) {
          const html = await r.text();
          const wide = pick(html, 'ECLIPSE_BILLBOARD');
          // sinon l'image de partage de la page (toujours présente, même pour un titre retiré du catalogue en France)
          const og = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || html.match(/content=["']([^"']+)["'][^>]+property=["']og:image/i) || [])[1];
          const poster = pick(html, 'VERTICAL_BILLBOARD') || pick(html, 'BOXART') || wide || (og ? og.replace(/&amp;/g, '&') : '');
          if (poster) items[k] = { poster, wide, url: new URL(href, location.origin).href };
        }
      } catch {}
      status(`Affiches Netflix : ${++n} / ${links.size}…`);
      if (Object.keys(items).length >= 5) await flush(); // enregistrées au fur et à mesure
      await VH.sleep(300);
    }
    await flush();
    const notFound = [...want].filter(([k]) => !links.has(k)).map(([, t]) => t);
    log('Netflix : affiches officielles', found, '/', want.size, 'titres sans affiche', notFound.length ? '— sans lien dans l\'historique : ' + notFound.slice(0, 15).join(', ') : '');
  }

  async function importNetflix() {
    const caps = [];
    let csv = null;
    const onMsg = (e) => {
      if (e.source !== window || !e.data || e.data.__tsuki !== 'nf') return;
      if (e.data.kind === 'capture') caps.push(e.data);
      if (e.data.kind === 'csv') csv = e.data.text;
    };
    const cmd = (c) => window.postMessage({ __tsuki: 'nf-cmd', cmd: c }, location.origin);
    window.addEventListener('message', onMsg);
    try {
      cmd('replay');
      await VH.sleep(500);

      // 1) la demande d'historique de Netflix (repérée sur la page, déclenchée par « Voir plus » si besoin)
      const apiCap = () => caps.find((c) => c.data && Array.isArray(c.data.viewedItems));
      if (!apiCap()) {
        clickShowMore();
        for (let i = 0; i < 8 && !apiCap(); i++) await VH.sleep(1000);
      }
      const urls = [];
      if (apiCap()) urls.push(apiCap().url);
      const m = document.documentElement.innerHTML.match(/BUILD_IDENTIFIER\\?"\s*:\s*\\?"([a-zA-Z0-9]+)/);
      if (m) urls.push(`/api/shakti/${m[1]}/viewingactivity`);
      for (const u of urls) {
        try {
          const out = await netflixApi(u);
          if (out.length) return out;
        } catch (e) {
          log('Netflix : demande d\'historique refusée', u, e.message);
        }
      }
      log('Netflix : aucune demande d\'historique exploitable', caps.map((c) => c.url));

      // 2) fichier « Tout télécharger »
      if (!csv) {
        try {
          const direct = await netflixFromCsvLink();
          if (direct) return await netflixAddLinks(direct);
        } catch {}
        const link = [...document.querySelectorAll('a, button')].find((x) => /tout télécharger|télécharger tout|download all/i.test(x.textContent));
        if (link) {
          cmd('arm');
          link.click();
          for (let i = 0; i < 120 && !csv; i++) {
            status(`Netflix prépare le fichier « Tout télécharger »… (${i} s)`);
            await VH.sleep(1000);
          }
          cmd('disarm');
        }
      }
      if (csv) {
        const list = netflixCsvEntries(csv);
        if (list.length) return await netflixAddLinks(list);
      }
      log('Netflix : fichier CSV non récupéré, lecture de la page');
    } finally {
      window.removeEventListener('message', onMsg);
    }

    // 3) lecture de la page en cliquant sur "Voir plus"
    await loadAll(() => document.querySelectorAll('li.retableRow').length);
    return netflixMovies([...document.querySelectorAll('li.retableRow')].map((row) => {
      const a = row.querySelector('.title a');
      const d = VH.parseDate(row.querySelector('.date')?.textContent);
      return {
        platform, profile,
        ...netflixTitle(a?.textContent || row.querySelector('.title')?.textContent || ''),
        date: d?.ts ?? null, prec: d?.prec,
        url: a?.href || '',
        source: 'import',
      };
    }));
  }

  // ---------- Import générique (Crunchyroll, ADN, Prime Video) ----------
  const hrefOf = (a) => (a.getAttribute('href') || '').split('?')[0];

  // Remonte jusqu'au plus grand bloc ne contenant qu'un seul titre = la "carte"
  function findCard(a) {
    let el = a;
    while (el.parentElement && el.parentElement !== document.body) {
      const p = el.parentElement;
      const hrefs = new Set([...p.querySelectorAll(CONF.link)].filter(linkOk).map(hrefOf));
      if (hrefs.size > 1) break;
      el = p;
    }
    return el;
  }

  const NOISE = /^(lecture|lire|play|regarder|watch|reprendre|resume|plus d'options|more options|supprimer|remove)\b|\b(restante?s?|left|remaining)\b|^\d+\s*(min|m|h)\b/i;

  // Titre d'épisode : on privilégie le texte affiché ("S1 E12 - …"), pas les libellés de boutons
  function bestText(card, series) {
    const texts = [];
    const w = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = clean(n.textContent);
      if (t.length >= 2 && t.length < 200 && t !== series && !VH.parseDate(t) && !NOISE.test(t)) texts.push(t);
    }
    const ep = texts.find((t) => /^(s\d+\s*)?(e|ep\.?|[ée]pisode)\s*\d+/i.test(t));
    if (ep) return ep;
    if (texts.length) return texts.sort((x, y) => y.length - x.length)[0];
    const alts = [];
    for (const a of card.querySelectorAll(CONF.link)) {
      a.querySelectorAll('img[alt]').forEach((i) => alts.push(clean(i.alt)));
      alts.push(clean(a.getAttribute('title')), clean(a.getAttribute('aria-label')));
    }
    return alts.filter((t) => t && t.length < 200 && !NOISE.test(t))[0] || '';
  }

  function dateIn(card) {
    const w = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const d = VH.parseDate(n.textContent);
      if (d) return d;
    }
    return null;
  }

  function dateBefore(card) {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    w.currentNode = card;
    for (let i = 0; i < 400; i++) {
      const n = w.previousNode();
      if (!n) break;
      const d = VH.parseDate(n.textContent);
      if (d) return d;
    }
    return null;
  }

  // Image d'une carte (on ignore les images vides / en chargement)
  function imgOf(el) {
    for (const img of el.querySelectorAll('img')) {
      const src = img.currentSrc || img.src || img.getAttribute('data-src') || '';
      if (/^https?:/.test(src) && !/\.svg(\?|$)/i.test(src)) return src;
    }
    return '';
  }

  // Progression affichée par une barre (style="width: 42%")
  function progressIn(card) {
    const bar = card.querySelector('[role="progressbar"], [class*="progress" i] [style*="width"], [class*="progress" i][style*="width"]');
    if (!bar) return null;
    const v = bar.getAttribute('aria-valuenow');
    if (v != null && !isNaN(v)) return Math.min(1, +v / (+bar.getAttribute('aria-valuemax') || 100));
    const m = (bar.getAttribute('style') || '').match(/width:\s*([\d.]+)%/);
    return m ? Math.min(1, +m[1] / 100) : null;
  }

  const EP_RE = /^(s\d+\s*)?(e|ep\.?|[ée]pisode)\s*\d+/i;
  // Nom de la série quand la carte n'en donne pas explicitement : autre texte de la carte, sinon l'adresse
  function seriesGuess(card, a, ep) {
    const w = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = clean(n.textContent);
      if (t.length >= 2 && t.length < 120 && t !== ep && !EP_RE.test(t) && !VH.parseDate(t) && !NOISE.test(t) && !/^vu\b/i.test(t)) return t;
    }
    try {
      const path = new URL(a.href, location.href).pathname;
      const i = path.indexOf('/video/');
      const slug = i >= 0 ? path.slice(i + 7).split('/')[0] : '';
      const words = slug.replace(/^\d+-/, '').split('-').filter(Boolean);
      if (words.length) return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
    } catch {}
    return '';
  }

  function cardEntry(card, a) {
    let series = CONF.series ? clean(card.querySelector(CONF.series)?.textContent) : '';
    const title = bestText(card, series);
    if (!title) return null;
    if (!series && EP_RE.test(title)) series = seriesGuess(card, a, title);
    const d = dateIn(card) || dateBefore(card);
    return {
      platform,
      profile,
      title: series || title,
      episode: series && series !== title ? title : '',
      date: d?.ts ?? null,
      prec: d?.prec,
      progress: progressIn(card),
      image: imgOf(card),
      url: a.href,
      source: 'import',
    };
  }

  async function importGeneric() {
    const found = new Map();
    const seen = new WeakSet();
    const collect = () => {
      for (const a of document.querySelectorAll(CONF.link)) {
        if (seen.has(a)) continue;
        if (!linkOk(a)) { seen.add(a); continue; }
        const card = findCard(a);
        const e = cardEntry(card, a);
        if (!e) continue;
        seen.add(a);
        const k = `${hrefOf(a)}|${e.date ?? ''}`;
        if (!found.has(k)) found.set(k, e);
      }
      return found.size;
    };
    await loadAll(collect);
    collect();
    return [...found.values()];
  }

  // ---------- Prime Video ----------
  // Une ligne = une saison (ou un film) à une date ; les épisodes sont cachés sous « Épisodes regardés ».
  const PRIME_TOGGLE = /^(épisodes regardés|episodes watched|épisodes vus)$/i;
  const PRIME_REMOVE = /^(supprimer|delete|remove|retirer)\b/i;
  const PRIME_EP = /^(?:épisode|episode|ép\.?|ep\.?)\s*(\d+)\s*[:.\-–]?\s*(.*)$/i;

  // Éléments dont le texte correspond exactement (parcours des textes : rapide même sur une très longue page)
  function deepest(re) {
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (n.textContent.length < 80 && re.test(clean(n.textContent)) && n.parentElement) out.push(n.parentElement);
    }
    return out;
  }

  const expanded = new WeakSet();
  function expandPrime() {
    let n = 0;
    for (const el of deepest(PRIME_TOGGLE)) {
      const target = el.closest('button, [role="button"], a, [aria-expanded]') || el;
      if (expanded.has(target)) continue;
      expanded.add(target);
      if (target.getAttribute('aria-expanded') === 'true') continue; // déjà ouvert
      target.click();
      n++;
    }
    return n;
  }

  function primeRows() {
    const rows = new Set();
    for (const el of deepest(PRIME_REMOVE)) {
      let row = el;
      while (row.parentElement && !row.querySelector(CONF.link)) row = row.parentElement;
      if (row && row !== document.body) rows.add(row);
    }
    // repli : lignes repérées par le lien vers la fiche
    if (!rows.size) for (const a of document.querySelectorAll(CONF.link)) rows.add(findCard(a));
    return [...rows];
  }

  function splitSeason(t) {
    const m = t.match(/^(.*?)\s*[-–:]\s*(?:saison|season|staffel)\s*(\d+)\s*$/i);
    return m ? { series: m[1].trim(), season: +m[2] } : { series: t, season: null };
  }

  function parsePrimeRow(row, final) {
    const a = row.querySelector(CONF.link);
    const texts = [];
    const w = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = clean(n.textContent);
      if (t) texts.push(t);
    }
    const eps = [];
    let title = '';
    for (const t of texts) {
      const m = t.match(PRIME_EP);
      if (m) eps.push({ num: m[1], name: clean(m[2]) });
      else if (!title && t.length > 1 && !/épisodes regardés|episodes watched|épisodes vus/i.test(t) && !PRIME_REMOVE.test(t) && !VH.parseDate(t)) title = t;
    }
    if (!title && a) title = clean(a.getAttribute('aria-label') || a.querySelector('img')?.alt);
    if (!title) return [];
    const hasToggle = texts.some((t) => PRIME_TOGGLE.test(t));
    if (hasToggle && !eps.length && !final) return null; // pas encore déplié : on reviendra
    const d = dateIn(row) || dateBefore(row);
    const { series, season } = splitSeason(title);
    const base = { platform, profile, date: d?.ts ?? null, prec: d?.prec, url: a ? a.href : '', image: imgOf(row), source: 'import' };
    if (!eps.length) return [{ ...base, title: series, episode: season ? `Saison ${season}` : '' }];
    return eps.map((e) => ({
      ...base,
      title: series,
      episode: `${season ? `S${season} ` : ''}E${e.num}${e.name ? ' - ' + e.name : ''}`,
    }));
  }

  async function importPrime() {
    const found = new Map();
    const done = new WeakSet();
    const collect = (final) => {
      expandPrime();
      for (const row of primeRows()) {
        if (done.has(row)) continue;
        const list = parsePrimeRow(row, final);
        if (list === null) continue;
        done.add(row);
        for (const e of list) {
          const k = `${e.title}|${e.episode}|${e.date ?? ''}`;
          if (!found.has(k)) found.set(k, e);
        }
      }
      return found.size;
    };
    await loadAll(() => collect(false));
    expandPrime();
    await VH.sleep(1500);
    collect(true);
    return [...found.values()];
  }

  // ---------- Lancement ----------
  // Envoi par paquets au service worker + message de fin
  async function sendEntries(entries, fromRun) {
    const res = { added: 0, total: 0 };
    if (!fromRun && boxEl) boxEl.classList.add('busy');
    for (let i = 0; i < entries.length; i += 500) {
      const r = await VH.send({ type: 'addEntries', entries: entries.slice(i, i + 500) });
      res.added += r.added;
      res.total = r.total;
      status(`Enregistrement… ${Math.min(i + 500, entries.length).toLocaleString('fr-FR')} / ${entries.length.toLocaleString('fr-FR')}`);
    }
    status(`Terminé ✓ ${entries.length.toLocaleString('fr-FR')} épisodes lus, ${res.added.toLocaleString('fr-FR')} nouveaux (total : ${res.total.toLocaleString('fr-FR')}). Le fichier Excel est à jour.`);
    if (!fromRun) VH.send({ type: 'importDone', platform, count: entries.length, silent: false }).catch(() => {});
    return res;
  }

  async function runImport(isSilent) {
    if (running) return;
    silent = isSilent;
    if (!isHistoryPage()) {
      status("Ouvre d'abord ta page « Historique » sur ce site, puis relance l'import.");
      return;
    }
    running = true;
    if (btn) btn.disabled = true;
    if (boxEl) boxEl.classList.add('busy');
    let count = 0;
    try {
      status("Import en cours… Garde cet onglet ouvert. Si ton historique est très long, ça peut prendre plusieurs minutes.");
      const entries = CONF.run ? await CONF.run() : await importGeneric();
      count = entries.length;
      if (!count) {
        status('Aucun visionnage trouvé sur cette page. Vérifie que tu es connecté et sur la page Historique.');
        return;
      }
      await sendEntries(entries, true);
      if (platform === 'crunchyroll') {
        const final = statusEl ? statusEl.textContent : '';
        try { await crFetchMeta(); } catch (e) { log('infos séries non récupérées', e); }
        if (final) status(final);
      }
      if (platform === 'netflix') {
        const final = statusEl ? statusEl.textContent : '';
        try { await netflixOfficialArt(); } catch (e) { log('affiches Netflix non récupérées', String(e)); }
        if (final) status(final);
      }
    } catch (e) {
      status('Erreur : ' + (e?.message || e));
    } finally {
      running = false;
      if (btn) btn.disabled = false;
      if (boxEl) boxEl.classList.remove('busy');
      VH.send({ type: 'importDone', platform, count, silent }).catch(() => {});
    }
  }

  async function check() {
    let res = {};
    try {
      res = (await VH.send({ type: 'shouldImport', platform })) || {};
    } catch {}
    if (res.pending && res.silent) {
      silent = true;
      if (isHistoryPage()) runImport(true);
      return;
    }
    if (isHistoryPage()) {
      ensurePanel();
      if (res.pending) runImport(false);
      else if (!running) status("Récupère tout l'historique de ce compte depuis sa création. Si tu as regardé des milliers d'épisodes, l'import sera long et le fichier Excel lourd.");
    } else if (res.pending) {
      status("Connecte-toi / choisis ton profil, puis va sur la page « Historique » : l'import démarrera automatiquement.");
    }
  }

  // Sites en SPA : on surveille les changements d'URL
  let lastPath = '';
  setInterval(() => {
    const p = location.pathname + location.search;
    if (p !== lastPath) {
      lastPath = p;
      check();
    }
  }, 1000);
})();
