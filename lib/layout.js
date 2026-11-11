// Affichage vertical (affiches en hauteur, jours en colonnes) ou horizontal (images larges, jours en lignes),
// réglage commun à toute l'app (enregistré dans les réglages, bouton dans la barre du haut).
const ICON_V = '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="6.5" height="18" rx="1.5"/><rect x="13.5" y="3" width="6.5" height="18" rx="1.5"/></svg>';
const ICON_H = '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="6.5" rx="1.5"/><rect x="3" y="13.5" width="18" height="6.5" rx="1.5"/></svg>';

export const isHorizontal = () => document.documentElement.dataset.layout === 'horizontal';
function apply(l) {
  document.documentElement.dataset.layout = l === 'horizontal' ? 'horizontal' : 'vertical';
  const b = document.getElementById('layoutBtn');
  if (b) {
    const h = isHorizontal();
    b.innerHTML = h ? ICON_H : ICON_V;
    b.title = h ? 'Affichage horizontal (cliquer pour passer en vertical)' : 'Affichage vertical (cliquer pour passer en horizontal)';
    b.setAttribute('aria-label', b.title);
    b.setAttribute('aria-pressed', String(h));
  }
}

// sur petit écran les onglets défilent : celui de la page en cours est amené à l'écran
export function showActiveTab() {
  const on = document.querySelector('.top .tabs a.on');
  if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
}

export async function initLayout(onChange = () => {}) {
  showActiveTab();
  let l = 'vertical';
  try { l = ((await chrome.storage.local.get('settings')).settings || {}).layout || 'vertical'; } catch {}
  // bouton à droite des onglets
  const tabs = document.querySelector('.top .tabs');
  if (tabs && !document.getElementById('layoutBtn')) {
    const b = document.createElement('button');
    b.id = 'layoutBtn';
    b.className = 'layout-btn';
    b.type = 'button';
    tabs.insertAdjacentElement('afterend', b);
    b.onclick = async () => {
      const next = isHorizontal() ? 'vertical' : 'horizontal';
      apply(next);
      onChange();
      try { await chrome.runtime.sendMessage({ type: 'setSettings', settings: { layout: next } }); } catch {}
    };
  }
  apply(l);
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local' || !c.settings) return;
    const n = (c.settings.newValue || {}).layout || 'vertical';
    if ((n === 'horizontal') !== isHorizontal()) { apply(n); onChange(); }
  });
}
