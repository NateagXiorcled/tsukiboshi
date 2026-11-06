// Tsukiboshi — page de diagnostic : tout ce qu'on lisait dans chrome://extensions, plus des tests en direct
const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tag = (etat) => {
  const cls = etat === 'répond' || etat === 'ok' ? 'ok' : etat === 'erreur' ? 'err' : 'warn';
  return `<span class="tag ${cls}">${esc(etat)}</span>`;
};
const last = { sources: null, crunchyroll: null };

function list(el, items, fmt) {
  el.innerHTML = items.length ? items.map((x) => `<li>${esc(fmt(x))}</li>`).join('') : '<li class="none">Rien à signaler.</li>';
}

async function refresh() {
  const [{ errors, id }, diag] = await Promise.all([send({ type: 'getErrors' }), send({ type: 'getDiag' })]);
  $('ver').textContent = `v${chrome.runtime.getManifest().version} · id ${id}`;
  list($('errors'), errors.slice().reverse(), (e) => `${e.t}  [${e.where}]  ${e.msg}`);
  list($('journal'), (diag.journal || []).slice().reverse(), (l) => l);
  $('report').textContent = JSON.stringify({ ...diag, erreurs: errors, testSources: last.sources, testCrunchyroll: last.crunchyroll }, null, 2);
}

$('testArt').onclick = async (ev) => {
  const b = ev.currentTarget;
  b.disabled = true; b.textContent = 'Test en cours…';
  try {
    const { results } = await send({ type: 'testSources' });
    last.sources = results;
    const tb = $('artTable').querySelector('tbody');
    tb.innerHTML = results.map((r) => `<tr>
      <td><b>${esc(r.source)}</b></td>
      <td>${tag(r.etat)}</td>
      <td class="detail">${esc(r.detail || (r.resultats ? `${r.resultats} résultat(s) — « ${r.titre} »` : ''))}</td>
      <td>${r.ms != null ? (r.ms / 1000).toFixed(1) + ' s' : ''}</td>
      <td>${r.affiche ? `<img src="${esc(r.affiche)}" alt="">` : ''}</td></tr>`).join('');
    $('artTable').hidden = false;
  } finally {
    b.disabled = false; b.textContent = 'Tester maintenant';
    refresh();
  }
};

$('testCr').onclick = async (ev) => {
  const b = ev.currentTarget;
  b.disabled = true; b.textContent = 'Test en cours…';
  $('crOut').innerHTML = '';
  try {
    const r = await send({ type: 'crTest' });
    last.crunchyroll = r;
    if (r.erreur) {
      $('crOut').innerHTML = `<p>${tag('erreur')} ${esc(r.erreur)}</p>`;
    } else {
      $('crOut').innerHTML = `<p class="muted">Jeton de connexion repéré : ${r.jetonVu ? 'oui' : 'non'} → après test : ${r.jetonApres ? 'oui' : 'non'}${r.exemple ? ` · exemple lu : <b>${esc(r.exemple)}</b>` : ''}${r.saisons != null ? ` · ${r.saisons} saison(s)` : ''}</p>
        <table><thead><tr><th>Étape</th><th>Résultat</th></tr></thead><tbody>${(r.etapes || []).map((s) => `<tr><td>${esc(s.etape)}</td><td>${s.erreur ? tag('erreur') + ' ' + esc(s.erreur) : tag(s.ok ? 'ok' : 'erreur') + (s.code ? ' code ' + s.code : ' pas de réponse') + (s.ms != null ? ' · ' + (s.ms / 1000).toFixed(1) + ' s' : '')}</td></tr>`).join('')}</tbody></table>`;
    }
  } catch (e) {
    $('crOut').innerHTML = `<p>${tag('erreur')} ${esc(e.message)}</p>`;
  } finally {
    b.disabled = false; b.textContent = 'Tester maintenant';
    refresh();
  }
};

$('clearErr').onclick = async () => { await send({ type: 'clearErrors' }); refresh(); };
$('copy').onclick = async (ev) => {
  await navigator.clipboard.writeText($('report').textContent);
  ev.currentTarget.textContent = 'Copié ✓';
  setTimeout(() => ($('copy').textContent = 'Copier'), 2500);
};

refresh();
setInterval(refresh, 5000);
