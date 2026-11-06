// Tsukiboshi — s'exécute DANS la page Netflix (monde "MAIN").
// 1) repère les réponses "viewingactivity" chargées par le site (pour refaire la même demande page par page)
// 2) récupère le fichier CSV fabriqué par « Tout télécharger » (sans le télécharger quand l'extension le demande)
// Ne modifie rien et n'envoie rien ailleurs que vers l'extension.
(() => {
  if (window.__tsukiNfHook) return;
  window.__tsukiNfHook = true;

  const MATCH = /viewingactivity/i;
  const caps = [];
  let csvText = null;
  let arm = false; // l'extension a demandé le CSV : on bloque le téléchargement réel
  const blocked = new Set();
  const post = (m) => window.postMessage({ __tsuki: 'nf', ...m }, location.origin);
  const looksCsv = (t) => /^﻿?"?(title|titre)"?\s*[,;]/i.test(t || '');
  const gotCsv = (t) => {
    if (!looksCsv(t)) return;
    csvText = t;
    post({ kind: 'csv', text: t });
  };
  const gotJson = (url, data) => {
    const c = { url: new URL(url, location.href).href, data };
    caps.push(c);
    if (caps.length > 10) caps.shift();
    post({ kind: 'capture', ...c });
  };

  const origFetch = window.fetch;
  window.fetch = async function (input) {
    const res = await origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      const ct = res.headers.get('content-type') || '';
      if (res.ok && /csv/i.test(ct)) res.clone().text().then(gotCsv).catch(() => {});
      else if (res.ok && MATCH.test(url)) res.clone().json().then((d) => gotJson(url, d)).catch(() => {});
    } catch {}
    return res;
  };

  const P = XMLHttpRequest.prototype;
  const open = P.open, send = P.send;
  P.open = function (method, url) {
    this.__tsukiUrl = String(url);
    return open.apply(this, arguments);
  };
  P.send = function () {
    this.addEventListener('load', () => {
      try {
        if (this.status < 200 || this.status >= 300) return;
        const ct = this.getResponseHeader('content-type') || '';
        const text = this.responseType === '' || this.responseType === 'text' ? this.responseText : null;
        if (/csv/i.test(ct) && text) return gotCsv(text);
        if (this.__tsukiUrl && MATCH.test(this.__tsukiUrl)) {
          const d = this.responseType === 'json' ? this.response : JSON.parse(text);
          gotJson(this.__tsukiUrl, d);
        }
      } catch {}
    });
    return send.apply(this, arguments);
  };

  // Fichier fabriqué dans la page (Blob → lien de téléchargement)
  const origCreate = URL.createObjectURL;
  URL.createObjectURL = function (obj) {
    const u = origCreate.apply(this, arguments);
    try {
      if (obj instanceof Blob && (/csv|text/i.test(obj.type) || arm)) {
        if (arm) blocked.add(u);
        obj.text().then(gotCsv).catch(() => {});
      }
    } catch {}
    return u;
  };
  const isBlocked = (a) => a && a.href && blocked.has(a.href);
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (isBlocked(this)) return; // l'extension garde le fichier pour elle
    return origClick.apply(this, arguments);
  };
  const origDispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (ev) {
    if (ev && ev.type === 'click' && this instanceof HTMLAnchorElement && isBlocked(this)) return true;
    return origDispatch.apply(this, arguments);
  };

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__tsuki !== 'nf-cmd') return;
    if (e.data.cmd === 'replay') {
      caps.forEach((c) => post({ kind: 'capture', ...c }));
      if (csvText) post({ kind: 'csv', text: csvText });
    }
    if (e.data.cmd === 'arm') arm = true;
    if (e.data.cmd === 'disarm') arm = false;
  });
})();
