/*
 * The look of the page: Parchment (the default, like a printed page) or Dark (for a dim room).
 * It is a choice about the page around the map only. The map is drawn in the colors picked in the
 * Display column (src/palette.js), in either theme, so the picture, the PNG and the printout match.
 *
 * The page's colors are CSS custom properties in styles.css; this file only sets `data-theme` on
 * <html> and remembers the choice on this device. It is loaded in the <head>, before the page is
 * drawn, so a returning visitor never sees a flash of the wrong theme.
 */
(function () {
  const DM = (globalThis.DM = globalThis.DM || {});

  const THEMES = ['parchment', 'dark'];
  const DEFAULT_THEME = 'parchment';
  /** Kept apart from the other settings: it is about the viewer, so Reset all and share links leave it alone. */
  const THEME_KEY = 'dungeonMaker.theme';

  function isTheme(name) {
    return THEMES.includes(name);
  }

  /** The theme kept on this device, or Parchment if none is kept (or storage cannot be reached). */
  function savedTheme() {
    try {
      const kept = localStorage.getItem(THEME_KEY);
      return isTheme(kept) ? kept : DEFAULT_THEME;
    } catch (err) {
      return DEFAULT_THEME;
    }
  }

  /** Show the page in this theme (anything unknown becomes Parchment). Returns the theme used. */
  function applyTheme(name) {
    const theme = isTheme(name) ? name : DEFAULT_THEME;
    document.documentElement.setAttribute('data-theme', theme);
    return theme;
  }

  /** Remember the theme on this device. */
  function saveTheme(name) {
    if (!isTheme(name)) return;
    try {
      localStorage.setItem(THEME_KEY, name);
    } catch (err) {
      // storage can be blocked (private mode, a local file in some browsers): the page just opens in Parchment next time
    }
  }

  DM.THEMES = THEMES;
  DM.DEFAULT_THEME = DEFAULT_THEME;
  DM.THEME_KEY = THEME_KEY;
  DM.savedTheme = savedTheme;
  DM.applyTheme = applyTheme;
  DM.saveTheme = saveTheme;

  if (typeof document !== 'undefined') applyTheme(savedTheme());
})();
