/*
 * Getting a dungeon out of the app and back in: the text of a share link, the JSON file, file
 * names, and the line of details that goes under an exported picture.
 *
 * A share link holds everything needed to rebuild the same dungeon (the inputs, with the seed that
 * was actually used, even if the seed box was blank) and how the map is drawn (label position,
 * grid, room numbers, colors). It lives in the part of the address after "#", so it is never sent
 * to a server. It only holds what differs from the page's usual starting values (FORM_DEFAULTS for the inputs, the
 * usual look for the display), so a link reads like  #ent=2&shapes=rect,L&seed=482910337  and what it leaves out is the
 * usual. (A page that opens a link has to put the usual values back for everything the link leaves out: DM.formDefaults().)
 *
 * The edited dungeon is also kept on the device between visits (see encodeKept): the whole dungeon as it now is, with what the
 * page needs to tell, afterwards, what has been changed since it was built.
 *
 * Pure functions, no page, so they can be tested without a browser.
 */
(function () {
  const DM = (globalThis.DM = globalThis.DM || {});

  /** What the page starts with (see index.html; tests/mcp.js checks these against it, and against the MCP server's own copy). */
  const FORM_DEFAULTS = {
    roomCount: 12,
    avgRoomSize: 30,
    minRoomWidth: 3,
    minRoomLength: 3,
    sizeVariance: 30,
    spacing: 'compact',
    layout: 'random',
    roomShapes: ['rect', 'chamfer'],
    connectionType: 'hall',
    connectionRandomness: 14,
    hallTypes: ['short', 'spine', 'branching'],
    hallDoors: 'all',
    hallWidth: 1,
    levels: 1,
    levelStairs: 1,
    entrances: 1,
    edgeEntrancesOnly: true,
  };

  /** A fresh copy of the page's starting values, to change as you like. */
  function formDefaults() {
    return { ...FORM_DEFAULTS, roomShapes: FORM_DEFAULTS.roomShapes.slice(), hallTypes: FORM_DEFAULTS.hallTypes.slice() };
  }

  /** Is this the usual value for the input? (Typed text counts: '12' is the usual 12. A list is the same whatever its order.) */
  function isUsual(name, value) {
    const usual = FORM_DEFAULTS[name];
    if (Array.isArray(usual)) return Array.isArray(value) && [...value].sort().join() === [...usual].sort().join();
    return String(value) === String(usual);
  }

  // [key in the link, name of the input]
  const NUMBERS = [
    ['rooms', 'roomCount'],
    ['size', 'avgRoomSize'],
    ['minw', 'minRoomWidth'],
    ['minl', 'minRoomLength'],
    ['var', 'sizeVariance'],
    ['ent', 'entrances'],
    ['rand', 'connectionRandomness'],
    ['hallw', 'hallWidth'],
    ['levels', 'levels'],
    ['lstairs', 'levelStairs'],
  ];

  // inputs that are fine on their own, used to check one value at a time (it takes a whole set to validate)
  const BASE = { roomCount: 12, avgRoomSize: 30, sizeVariance: 30, entrances: 2, connectionType: 'door', connectionRandomness: 0 };

  const pair = (key, value) => `${key}=${encodeURIComponent(value).replace(/%2C/g, ',')}`;

  /**
   * The text for after the "#" of a link.
   * @param {object} state
   * @param {object} state.params   the dungeon's validated inputs (dungeon.params, which includes the seed)
   * @param {object} [state.display] { labelPosition, showGrid, showLabels, colors: { categoryId: '#rrggbb' } }
   */
  function encodeShare({ params = {}, display = {} } = {}) {
    const parts = [];
    // an input is left out when it has the usual value (or none)
    const differs = (name) => params[name] !== undefined && params[name] !== null && !isUsual(name, params[name]);
    for (const [key, name] of NUMBERS) {
      if (differs(name)) parts.push(pair(key, params[name]));
    }
    if (params.connectionType && differs('connectionType')) parts.push(pair('conn', params.connectionType));
    if (typeof params.edgeEntrancesOnly === 'boolean' && differs('edgeEntrancesOnly')) parts.push(pair('edge', params.edgeEntrancesOnly ? 1 : 0));
    if (Array.isArray(params.roomShapes) && differs('roomShapes')) parts.push(pair('shapes', params.roomShapes.join(',')));
    if (Array.isArray(params.hallTypes) && differs('hallTypes')) parts.push(pair('halls', params.hallTypes.join(',')));
    if (params.hallDoors && differs('hallDoors')) parts.push(pair('doors', params.hallDoors));
    if (params.spacing && differs('spacing')) parts.push(pair('spacing', params.spacing));
    if (params.layout && differs('layout')) parts.push(pair('layout', params.layout));
    if (params.seed !== undefined && params.seed !== null && String(params.seed) !== '') parts.push(pair('seed', params.seed));

    // how it is drawn: only what is not the usual
    if (display.labelPosition && display.labelPosition !== 'inside') parts.push(pair('label', display.labelPosition));
    if (display.showGrid === false) parts.push(pair('grid', 0));
    if (display.showLabels === false) parts.push(pair('nums', 0));
    const defaults = DM.defaultColors ? DM.defaultColors() : {};
    for (const [id, hex] of Object.entries(display.colors || {})) {
      if (Object.prototype.hasOwnProperty.call(defaults, id) && DM.isHexColor(hex) && hex.toLowerCase() !== defaults[id]) parts.push(pair(`color.${id}`, hex.slice(1).toLowerCase()));
    }
    return parts.join('&');
  }

  /**
   * Read a link's text (with or without the "#") back into settings. Never throws: anything it
   * cannot make sense of (a missing key, a value out of range, a name it does not know) is left
   * out, so the page falls back to its usual value for it.
   * @returns {{ form: object, display: object, hasSettings: boolean }}
   *   form: the inputs found, as generateDungeon takes them (roomCount, ..., roomShapes, hallTypes, seed). Only the inputs the
   *   link names: the rest have their usual values (DM.formDefaults()).
   *   display: { labelPosition?, showGrid?, showLabels?, colors: { categoryId: '#rrggbb' } }
   */
  function decodeShare(text) {
    const form = {};
    const display = { colors: {} };
    let q;
    try {
      q = new URLSearchParams(String(text || '').replace(/^[#?]/, ''));
    } catch (err) {
      return { form, display, hasSettings: false };
    }
    // accept a value only if the generator accepts it (checked on its own, among inputs that are fine)
    const accept = (name, value) => {
      const errors = DM.validateParams({ ...BASE, [name]: value }).errors;
      if (errors[name] === undefined) form[name] = value;
    };

    for (const [key, name] of NUMBERS) {
      const value = q.get(key);
      if (value !== null && /^\d{1,4}$/.test(value)) accept(name, Number(value));
    }
    if (q.get('conn') !== null) accept('connectionType', q.get('conn'));
    if (q.get('doors') !== null) accept('hallDoors', q.get('doors'));
    if (q.get('spacing') !== null) accept('spacing', q.get('spacing'));
    if (q.get('layout') !== null) accept('layout', q.get('layout'));
    if (q.get('shapes') !== null) accept('roomShapes', q.get('shapes').split(',').filter(Boolean));
    if (q.get('halls') !== null) accept('hallTypes', q.get('halls').split(',').filter(Boolean));
    if (q.get('edge') === '1' || q.get('edge') === '0') form.edgeEntrancesOnly = q.get('edge') === '1';
    const seed = q.get('seed');
    if (seed !== null && seed.trim() !== '' && seed.length <= 100) form.seed = seed;

    const label = q.get('label');
    if (label !== null && DM.LABEL_POSITIONS && DM.LABEL_POSITIONS.includes(label)) display.labelPosition = label;
    if (q.get('grid') === '0' || q.get('grid') === '1') display.showGrid = q.get('grid') === '1';
    if (q.get('nums') === '0' || q.get('nums') === '1') display.showLabels = q.get('nums') === '1';
    for (const cat of DM.COLOR_CATEGORIES || []) {
      const hex = q.get(`color.${cat.id}`);
      if (hex !== null && /^[0-9a-f]{6}$/i.test(hex)) display.colors[cat.id] = `#${hex.toLowerCase()}`;
    }

    const hasSettings = Object.keys(form).length > 0 || Object.keys(display).some((k) => k !== 'colors') || Object.keys(display.colors).length > 0;
    return { form, display, hasSettings };
  }

  const KEPT_VERSION = 1;

  const isFloor = (f) => !!f && typeof f === 'object' && ['rooms', 'halls', 'connections', 'entrances'].every((k) => Array.isArray(f[k]));

  /**
   * The text that keeps a dungeon on this device: { dungeon, asBuilt, floors, builtMs }. `asBuilt` and `floors` are the page's record of
   * the dungeon as it was built (DM.editState), so that a dungeon brought back still knows it has been edited.
   */
  function encodeKept({ dungeon, asBuilt, floors, builtMs }) {
    return JSON.stringify({ v: KEPT_VERSION, dungeon, asBuilt, floors, builtMs: Number(builtMs) || 0 });
  }

  /** What encodeKept made, or null if the text is not that (nothing kept, damaged, or from a different version of the page). */
  function decodeKept(text) {
    if (typeof text !== 'string' || text === '') return null;
    let kept;
    try {
      kept = JSON.parse(text);
    } catch (err) {
      return null;
    }
    if (!kept || kept.v !== KEPT_VERSION || typeof kept.asBuilt !== 'string' || !Array.isArray(kept.floors) || !kept.floors.every((f) => typeof f === 'string')) return null;
    const d = kept.dungeon;
    if (!isFloor(d) || !Number.isInteger(d.width) || !Number.isInteger(d.height) || d.width < 1 || d.height < 1) return null;
    if (d.levels > 1 && !(Array.isArray(d.floors) && d.floors.length === d.levels - 1 && d.floors.every(isFloor) && Array.isArray(d.stairs))) return null;
    return { dungeon: d, asBuilt: kept.asBuilt, floors: kept.floors, builtMs: Number.isFinite(kept.builtMs) ? kept.builtMs : 0 };
  }

  /** A file name for an export, such as "dungeon-482910337.png": the seed, made safe for a file name. */
  function exportFileName(dungeon, extension) {
    const safe = String(dungeon && dungeon.seed !== undefined ? dungeon.seed : '')
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    return `dungeon-${safe || 'map'}.${extension}`;
  }

  /** The dungeon as JSON text, with each part (rooms, halls, ...) on its own line. */
  function dungeonJson(dungeon) {
    const lines = Object.keys(dungeon).map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(dungeon[key])}`);
    return `{\n${lines.join(',\n')}\n}\n`;
  }

  /** The line of details under an exported picture. */
  function exportCaption(dungeon) {
    const ft = (n) => n * dungeon.cellSizeFt;
    const rooms = dungeon.rooms.length;
    return `Seed ${dungeon.seed} · ${rooms} ${rooms === 1 ? 'room' : 'rooms'} · ${dungeon.width}×${dungeon.height} squares (${ft(dungeon.width)}×${ft(dungeon.height)} ft)`;
  }

  DM.FORM_DEFAULTS = FORM_DEFAULTS;
  DM.formDefaults = formDefaults;
  DM.encodeShare = encodeShare;
  DM.decodeShare = decodeShare;
  DM.encodeKept = encodeKept;
  DM.decodeKept = decodeKept;
  DM.exportFileName = exportFileName;
  DM.dungeonJson = dungeonJson;
  DM.exportCaption = exportCaption;
})();
