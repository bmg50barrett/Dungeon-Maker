'use strict';
/*
 * Duckweed's Dungeon Drafter, outside the browser.
 *
 * Loads the app's own code (the ../../src folder) into Node, so Claude gets exactly the dungeons the
 * page makes: the same generator, the same hallway editing, and the same picture. The picture comes
 * from the page's renderer (DM.DungeonRenderer.exportImage, the code behind "Picture (PNG)"), drawn
 * on a canvas from @napi-rs/canvas instead of the page's.
 *
 * Nothing here knows about MCP; server.js is the only file that does.
 */
const path = require('path');
const { createCanvas, Path2D, GlobalFonts } = require('@napi-rs/canvas');

const SRC = path.join(__dirname, '..', '..', 'src');
const MODULES = ['rng', 'shapes', 'layout', 'generator', 'edit', 'labels', 'palette', 'share', 'render'];

let DM = null;

/** What the renderer takes from a browser, made up for Node. */
function installShims() {
  globalThis.Path2D = Path2D;
  globalThis.document = { createElement: () => createCanvas(1, 1) };
  globalThis.window = globalThis.window || { devicePixelRatio: 1, addEventListener() {} };
  globalThis.requestAnimationFrame = () => 1; // the picture is drawn on request, never on a timer

  // the page draws legends in the system's UI font, which Node does not know by that name
  if (!GlobalFonts.has('system-ui')) {
    const stand = ['Segoe UI', 'Helvetica Neue', 'Helvetica', 'Arial', 'DejaVu Sans', 'Liberation Sans'].find((f) => GlobalFonts.has(f));
    if (stand) GlobalFonts.setAlias(stand, 'system-ui');
  }
}

/** The page's code, loaded once. */
function load() {
  if (DM) return DM;
  installShims();
  for (const name of MODULES) require(path.join(SRC, `${name}.js`));
  DM = globalThis.DM;
  return DM;
}

/** A stand-in for the page's <canvas>: the renderer only measures text on it and never draws on it. */
function screenCanvas() {
  const ctx = createCanvas(1, 1).getContext('2d');
  return {
    clientWidth: 0,
    clientHeight: 0,
    width: 1,
    height: 1,
    getContext: () => ctx,
    addEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    style: {},
  };
}

/**
 * The map as the page's "Picture (PNG)" makes it.
 * @param {object} dungeon
 * @param {object} [look]
 * @param {boolean} [look.legend=true]          the strip under the map: details, scale bar, key
 * @param {'inside'|'outside'} [look.labelPosition='inside']  room numbers on the rooms or outside their walls
 * @param {boolean} [look.showGrid=true]
 * @param {boolean} [look.showLabels=true]      room numbers
 * @param {boolean} [look.showCoordinates=false] x and y square numbers along the top and left edges
 * @param {object} [look.colors]                { categoryId: '#rrggbb' }, see DM.COLOR_CATEGORIES
 * @param {number} [look.level]                 a dungeon of several levels: the one level to draw (default: all of them, one above the other)
 * @returns {Buffer} PNG
 */
function renderPng(dungeon, look = {}) {
  const dm = load();
  const renderer = new dm.DungeonRenderer(screenCanvas());
  renderer.setTheme(dm.themeFrom({ ...dm.defaultColors(), ...(look.colors || {}) }));
  renderer.options.labelPosition = look.labelPosition === 'outside' ? 'outside' : 'inside';
  renderer.options.showGrid = look.showGrid !== false;
  renderer.options.showLabels = look.showLabels !== false;
  renderer.options.showCoordinates = look.showCoordinates === true;
  const levels = dm.levelCount(dungeon);
  const drawn = levels === 1 ? [1] : look.level ? [look.level] : Array.from({ length: levels }, (_, i) => i + 1);
  // (the more levels in one picture, the smaller each, as in the page, so that the picture stays a size that can be made)
  const size = drawn.length === 1 ? 3920 : Math.max(500, Math.min(3920, Math.floor(14000 / drawn.length) - 300));
  const pictures = drawn.map((n) => {
    const view = dm.floorView(dungeon, n);
    const caption = levels === 1 ? dm.exportCaption(dungeon) : `Level ${n} of ${levels} · ${dm.exportCaption(view)}`;
    return renderer.imageOf(view, { legend: look.legend !== false, caption, size });
  });
  if (pictures.length === 1) return pictures[0].toBuffer('image/png');
  const gap = 40;
  const sheet = createCanvas(Math.max(...pictures.map((c) => c.width)), pictures.reduce((h, c) => h + c.height, 0) + gap * (pictures.length - 1));
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = renderer.theme.background;
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  let y = 0;
  for (const c of pictures) {
    ctx.drawImage(c, Math.floor((sheet.width - c.width) / 2), y);
    y += c.height + gap;
  }
  return sheet.toBuffer('image/png');
}

module.exports = { load, renderPng };
