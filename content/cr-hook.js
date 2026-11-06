// Tsukiboshi — s'exécute DANS la page Crunchyroll (monde "MAIN").
// Repère les réponses de l'historique ("watch-history") chargées par le site lui-même
// et les transmet au script de l'extension. Ne modifie rien et n'envoie rien ailleurs.
(() => {
  if (window.__tsukiHook) return;
  window.__tsukiHook = true;

  const MATCH = /\/watch-history/;
  const buf = [];
  const post = (c) => window.postMessage({ __tsuki: 'cr-capture', ...c }, location.origin);
  const emit = (c) => {
    buf.push(c);
    if (buf.length > 20) buf.shift();
    post(c);
  };
  const authOf = (h) => {
    try {
      if (!h) return '';
      if (h instanceof Headers) return h.get('authorization') || '';
      if (Array.isArray(h)) {
        const f = h.find(([k]) => /^authorization$/i.test(k));
        return f ? f[1] : '';
      }
      for (const k in h) if (/^authorization$/i.test(k)) return h[k];
    } catch {}
    return '';
  };

  // Jeton de connexion : repéré sur n'importe quelle demande à l'API, ou dans la réponse qui le fournit
  const API = /crunchyroll\.com\/(content|cms|accounts|discover|auth|playheads|watch-history)\b|^\/(content|cms|accounts|discover|auth)\b/;
  let lastAuth = '';
  const gotAuth = (a) => {
    if (!a || !/^bearer\s/i.test(a) || a === lastAuth) return; // jamais l'identifiant « Basic » du site
    lastAuth = a;
    window.postMessage({ __tsuki: 'cr-auth', auth: a }, location.origin);
  };
  const tokenFrom = (url, data) => {
    if (/\/auth\/v1\/token/.test(url) && data && data.access_token) gotAuth(`${data.token_type || 'Bearer'} ${data.access_token}`);
  };

  // Demande de jeton du site, mémorisée pour pouvoir la rejouer quand le jeton expire (durée de vie ≈ 5 min)
  let tokenReq = null;
  const plainHeaders = (h) => {
    const o = {};
    try {
      if (!h) return o;
      if (h instanceof Headers) h.forEach((v, k) => (o[k] = v));
      else if (Array.isArray(h)) h.forEach(([k, v]) => (o[k] = v));
      else Object.assign(o, h);
    } catch {}
    return o;
  };
  const rememberToken = (url, method, headers, body) => {
    if (typeof body !== 'string' && !(body instanceof URLSearchParams)) return;
    tokenReq = { url: new URL(url, location.href).href, method: method || 'POST', headers: plainHeaders(headers), body: String(body) };
  };

  const origFetch = window.fetch;

  // Expiration du jeton (champ exp du JWT)
  const expOf = (a) => {
    try {
      const p = JSON.parse(atob(a.split(' ')[1].split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return p.exp ? p.exp * 1000 : 0;
    } catch { return 0; }
  };
  let refreshing = null;
  async function refreshToken() {
    if (!tokenReq) return false;
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const r = await origFetch.call(window, tokenReq.url, { method: tokenReq.method, headers: tokenReq.headers, body: tokenReq.body, credentials: 'include' });
          if (!r.ok) return false;
          tokenFrom(tokenReq.url, await r.json());
          return true;
        } catch { return false; }
      })().finally(() => setTimeout(() => (refreshing = null), 0));
    }
    return refreshing;
  }

  // Appels à l'API Crunchyroll pour l'extension, faits ici (même contexte que le site) :
  // jeton toujours frais, renouvelé si besoin, et nouvel essai si le serveur est momentanément indisponible.
  const API_OK = /^\/content\/v2\/(cms|discover)\//;
  async function apiGet(path) {
    const u = new URL(path, location.origin);
    if (u.origin !== location.origin || !API_OK.test(u.pathname)) return { status: 400 };
    const exp = lastAuth ? expOf(lastAuth) : 0;
    if (!lastAuth || (exp && exp - Date.now() < 30000)) await refreshToken();
    for (let i = 0; i < 4; i++) {
      let r;
      try {
        r = await origFetch.call(window, u.href, { headers: lastAuth ? { Authorization: lastAuth } : {}, credentials: 'include' });
      } catch {
        r = { status: 0 };
      }
      if ((r.status === 401 || r.status === 403) && i === 0) {
        if (await refreshToken()) continue;
        return { status: r.status };
      }
      if (r.status === 0 || r.status === 429 || r.status >= 500) {
        await new Promise((ok) => setTimeout(ok, 800 * (i + 1) + Math.random() * 400));
        continue;
      }
      if (!r.ok) return { status: r.status };
      try { return { status: r.status, data: await r.json() }; } catch { return { status: 502 }; }
    }
    return { status: 503 };
  }

  window.fetch = async function (input, init) {
    try {
      const u0 = typeof input === 'string' ? input : (input && input.url) || String(input);
      if (/\/auth\/v1\/token/.test(u0)) {
        if (init && init.body) rememberToken(u0, init.method, init.headers, init.body);
        else if (input instanceof Request) input.clone().text().then((b) => b && rememberToken(u0, input.method, input.headers, b)).catch(() => {});
      }
    } catch {}
    const res = await origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      const auth0 = authOf(init && init.headers) || (input instanceof Request ? input.headers.get('authorization') || '' : '');
      if (API.test(url)) gotAuth(auth0);
      if (/\/auth\/v1\/token/.test(url) && res.ok) res.clone().json().then((d) => tokenFrom(url, d)).catch(() => {});
      if (MATCH.test(url) && res.ok) {
        const auth = auth0;
        res.clone().json().then((data) => emit({ url: new URL(url, location.href).href, auth, data })).catch(() => {});
      }
    } catch {}
    return res;
  };

  const P = XMLHttpRequest.prototype;
  const open = P.open, setHeader = P.setRequestHeader, send = P.send;
  P.open = function (method, url) {
    this.__tsukiUrl = String(url);
    this.__tsukiMethod = method;
    this.__tsukiHeaders = {};
    return open.apply(this, arguments);
  };
  P.setRequestHeader = function (k, v) {
    if (/^authorization$/i.test(k)) this.__tsukiAuth = v;
    if (this.__tsukiHeaders) this.__tsukiHeaders[k] = v;
    return setHeader.apply(this, arguments);
  };
  P.send = function (body) {
    if (this.__tsukiUrl && /\/auth\/v1\/token/.test(this.__tsukiUrl) && body) rememberToken(this.__tsukiUrl, this.__tsukiMethod, this.__tsukiHeaders, body);
    if (this.__tsukiUrl && API.test(this.__tsukiUrl)) gotAuth(this.__tsukiAuth);
    if (this.__tsukiUrl && /\/auth\/v1\/token/.test(this.__tsukiUrl)) {
      this.addEventListener('load', () => {
        try { tokenFrom(this.__tsukiUrl, this.responseType === 'json' ? this.response : JSON.parse(this.responseText)); } catch {}
      });
    }
    if (this.__tsukiUrl && MATCH.test(this.__tsukiUrl)) {
      this.addEventListener('load', () => {
        try {
          if (this.status < 200 || this.status >= 300) return;
          const data = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
          emit({ url: new URL(this.__tsukiUrl, location.href).href, auth: this.__tsukiAuth || '', data });
        } catch {}
      });
    }
    return send.apply(this, arguments);
  };

  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.__tsuki === 'cr-replay') {
      buf.forEach(post);
      if (lastAuth) window.postMessage({ __tsuki: 'cr-auth', auth: lastAuth }, location.origin);
    }
    if (e.source === window && e.data && e.data.__tsuki === 'cr-api' && e.data.id && typeof e.data.path === 'string') {
      const { id, path } = e.data;
      apiGet(path).then((res) => window.postMessage({ __tsuki: 'cr-api-res', id, ...res }, location.origin));
    }
  });
})();
