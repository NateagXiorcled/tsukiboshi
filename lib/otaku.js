// Mode otaku : l'application ne montre que les animés (réglage gardé en mémoire).
// Un titre est un animé s'il vient de Crunchyroll ou d'ADN, ou si sa fiche (genres) dit « Animé ».
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const ANIME_PLATFORMS = new Set(['crunchyroll', 'adn']);

export function isAnimeTitle(platform, key, genres) {
  return ANIME_PLATFORMS.has(platform) || (((genres || {})[key] || {}).genres || []).includes('Animé');
}
export const isAnimeEntry = (e, genres) => isAnimeTitle(e.platform, `${e.platform}|${norm(e.title)}`, genres);

export async function otakuMode() {
  try { return !!(((await chrome.storage.local.get('settings')).settings || {}).otaku); } catch { return false; }
}

// mode changé (popup ou autre onglet) : la page se recharge pour tout réafficher
export function watchOtaku(current) {
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.settings && !!(c.settings.newValue || {}).otaku !== current) location.reload();
  });
}

// petit badge dans la barre du haut : rappelle que le mode est actif, un clic le désactive
export function otakuBadge(on) {
  if (!on || document.getElementById('otakuBadge')) return;
  const tabs = document.querySelector('.top .tabs');
  if (!tabs) return;
  const b = document.createElement('button');
  b.id = 'otakuBadge';
  b.type = 'button';
  b.className = 'otaku-badge';
  b.textContent = '🎌 Mode otaku';
  b.title = 'Seuls les animés sont affichés. Cliquer pour tout afficher (séries et films compris).';
  b.onclick = async () => {
    b.disabled = true;
    try { await chrome.runtime.sendMessage({ type: 'setSettings', settings: { otaku: false } }); } catch {}
  };
  (document.getElementById('layoutBtn') || tabs).insertAdjacentElement('afterend', b);
}
