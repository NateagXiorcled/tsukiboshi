const send = (msg) => chrome.runtime.sendMessage(msg);
const $ = (id) => document.getElementById(id);

const COLORS = { netflix: '#e50914', crunchyroll: '#f47521', adn: '#0099e5', disney: '#3a67ff', prime: '#00a8e1' };
let platforms = {};
let pendingImport = null;

function show(view) {
  for (const v of ['home', 'confirm', 'settings']) $(v).hidden = v !== view;
}

function when(ts, hasTime) {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  const label = diff === 0 ? "aujourd'hui" : diff === 1 ? 'hier'
    : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: diff > 300 ? 'numeric' : undefined });
  return hasTime ? `${label}, ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : label;
}
const fmtN = (n) => n.toLocaleString('fr-FR');

async function render() {
  const s = await send({ type: 'getStats' });
  platforms = s.platforms;
  $('total').textContent = fmtN(s.total);
  $('series').textContent = fmtN(s.series);
  $('hours').textContent = fmtN(s.hours);

  if (s.last) {
    $('lastBox').hidden = false;
    $('lastTitle').textContent = s.last.title;
    $('lastSub').textContent = [s.last.episode, s.platforms[s.last.platform], when(s.last.date, s.last.hasTime)].filter(Boolean).join(' · ');
  }

  const ul = $('platforms');
  ul.textContent = '';
  for (const [id, name] of Object.entries(s.platforms)) {
    const importable = s.importable.includes(id);
    const sync = s.sync[id];
    const sub = !importable ? 'Suivi pendant la lecture'
      : sync?.enabled ? (sync.last ? `Synchronisé ${when(sync.last, true)}` : 'Synchro active') : 'Pas encore importé';

    const li = document.createElement('li');
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = COLORS[id];
    const nm = document.createElement('span'); nm.className = 'p-name'; nm.textContent = name;
    const sb = document.createElement('span'); sb.className = 'p-sub'; sb.textContent = sub; nm.appendChild(sb);
    const ct = document.createElement('span'); ct.className = 'p-count'; ct.textContent = fmtN(s.counts[id] || 0);
    const act = document.createElement('span'); act.className = 'p-act';
    if (importable) {
      const b = document.createElement('button');
      b.className = 'p-btn';
      b.textContent = sync?.enabled ? 'Réimporter' : 'Importer';
      b.onclick = () => askImport(id);
      act.appendChild(b);
    } else {
      act.innerHTML = '<span class="p-auto">Auto</span>';
    }
    li.append(dot, nm, ct, act);
    ul.appendChild(li);
  }

  if (document.activeElement !== $('tmdbKey')) $('tmdbKey').value = s.settings.tmdbKey || '';
  $('tmdbState').textContent = s.settings.tmdbKey ? 'Clé enregistrée ✓' : '';
  $('auto').checked = s.settings.autoExport;
  $('autoSync').checked = s.settings.autoSync;
  $('notify').checked = s.settings.notify;
  $('sync').disabled = s.syncing;
  $('sync').classList.toggle('spin', s.syncing);
  $('syncLabel').textContent = s.syncing ? 'En cours' : 'Synchro';
  $('lastExport').textContent = s.lastExport ? `Mis à jour ${when(s.lastExport, true)}` : 'Pas encore créé';
  $('lastBackup').textContent = s.lastBackup
    ? `Dernière sauvegarde ${when(s.lastBackup, true)} · une copie automatique est faite chaque jour dans Téléchargements / Tsukiboshi`
    : 'Une copie automatique sera faite chaque jour dans Téléchargements / Tsukiboshi';
}

function askImport(id) {
  pendingImport = id;
  $('confirmTitle').textContent = `Importer tout l'historique ${platforms[id]} ?`;
  show('confirm');
}

$('go').onclick = () => send({ type: 'startImport', platform: pendingImport }).then(() => window.close());
$('cancel').onclick = () => show('home');
// ouvre une page de l'extension (ou revient sur l'onglet déjà ouvert)
async function openPage(path) {
  const url = chrome.runtime.getURL(path);
  const [tab] = await chrome.tabs.query({ url: url + '*' });
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else await chrome.tabs.create({ url });
  window.close();
}
$('openList').onclick = () => openPage('list/list.html');
$('openBilan').onclick = () => openPage('bilan/bilan.html');
$('openSearch').onclick = () => openPage('recherche/recherche.html');
$('gear').onclick = () => show($('settings').hidden ? 'settings' : 'home');
$('back').onclick = () => show('home');

$('export').onclick = async (e) => {
  const b = e.currentTarget;
  b.disabled = true;
  b.textContent = 'Mise à jour…';
  const r = await send({ type: 'export' });
  b.disabled = false;
  b.textContent = r?.error ? 'Erreur, réessayer' : 'Excel mis à jour ✓';
  setTimeout(() => (b.textContent = "Mettre à jour l'Excel"), 2500);
  render();
};
$('sync').onclick = async () => {
  await send({ type: 'syncNow' });
  setTimeout(render, 300);
};
$('tmdbKey').onchange = async (e) => {
  await send({ type: 'setSettings', settings: { tmdbKey: e.target.value.trim() } });
  $('tmdbState').textContent = e.target.value.trim() ? 'Clé enregistrée ✓ — les affiches vont être recherchées à nouveau' : '';
};
$('auto').onchange = (e) => send({ type: 'setSettings', settings: { autoExport: e.target.checked } });
$('autoSync').onchange = (e) => send({ type: 'setSettings', settings: { autoSync: e.target.checked } });
$('notify').onchange = (e) => send({ type: 'setSettings', settings: { notify: e.target.checked } });
$('backupBtn').onclick = async (e) => {
  const b = e.currentTarget;
  b.disabled = true;
  const r = await send({ type: 'backup' });
  b.textContent = r && r.file ? 'Sauvegardé ✓' : 'Échec';
  setTimeout(() => { b.textContent = 'Sauvegarder maintenant'; b.disabled = false; }, 3000);
  render();
};
// le choix du fichier se fait dans Ma liste (le popup se fermerait pendant la sélection)
$('restoreBtn').onclick = () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('list/list.html#restaurer') });
  window.close();
};
$('diag').onclick = () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('diag/diag.html') });
  window.close();
};
$('clear').onclick = async () => {
  if (confirm("Effacer tout l'historique enregistré dans Tsukiboshi ?\nLe fichier Excel déjà créé n'est pas supprimé.")) {
    await send({ type: 'clear' });
    location.reload();
  }
};

render();
setInterval(render, 3000);

// nouvelle version publiée sur GitHub ?
send({ type: 'checkUpdate' }).then((u) => {
  if (!u || !u.available || !u.url) return;
  $('updateText').textContent = `Nouvelle version ${u.latest} disponible (tu as la ${u.current})`;
  $('updateBar').href = u.url;
  $('updateBar').hidden = false;
}).catch(() => {});
