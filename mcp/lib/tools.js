'use strict';
/*
 * The tools Claude can call. Each is { name, description, inputSchema, annotations, run(args) }, and run
 * returns { text, png? }: words, and optionally a picture (a PNG Buffer). server.js turns that into MCP
 * messages; nothing here knows about the protocol, so the tools can be tried directly.
 */
const { load, renderPng } = require('./dm');
const { describeDungeon, SIDES, STYLES } = require('./describe');
const { Store } = require('./store');
const { ToolError } = require('./errors');

/** What the app starts with (see index.html), so a call with no settings gives the dungeon the page would. */
const APP_DEFAULTS = {
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

const MAX_EDITS = 50;
const MAX_NAME = 60; // longest room name, in characters
const MAX_POINTS = 200;
const MAX_STROKE = 5000; // squares one hallway stroke may cover, as in the page

// ---- the shapes of what Claude may send ------------------------------------------------------------

const int = (minimum, maximum, description) => ({ type: 'integer', minimum, maximum, description });

const SETTINGS = {
  roomCount: int(1, 99, 'How many rooms (default 12).'),
  avgRoomSize: int(1, 999, 'Average room size in squares of floor; one square is 5 ft by 5 ft, so 30 is about 750 sq ft (default 30).'),
  minRoomWidth: int(1, 30, 'Least a room measures across the map (east-west), in squares (default 3; 1 means no minimum).'),
  minRoomLength: int(1, 30, 'Least a room measures up and down the map (north-south), in squares (default 3; 1 means no minimum).'),
  sizeVariance: int(0, 100, 'How much room sizes vary, as a percentage of the average (default 30).'),
  spacing: { type: 'string', enum: ['compact', 'normal', 'spaced'], description: 'How far apart rooms are: compact (rooms may touch; default), normal or spaced.' },
  layout: { type: 'string', enum: ['random', 'cathedral', 'ring', 'spiral', 'gauntlet', 'radial', 'mainst', 'square', 'long', 'wide'], description: 'The overall shape the dungeon leans towards: random (default, no shape), cathedral (a long nave crossed by a transept), ring (rooms circling an empty middle, closed into a loop), spiral (rooms winding outward from the first room to a tip; the first two entrances are at the two ends where they can be on the outside), gauntlet (one chain of rooms, each joined only to the next, snaking back and forth: no spines or loops; with Branching on, a hallway can fork to a single dead-end side room while the chain goes on), radial (the biggest room in the middle, every hallway running out from it like the spokes of a wheel and the other rooms along them; all hallways, no doorways between rooms unless hallways are switched off), mainst (Main St.: one very long straight hallway, up and down the map, with the rooms along its sides and on branches off it; all hallways), square, long (taller than wide) or wide (wider than tall).' },
  roomShapes: {
    type: 'array',
    items: { type: 'string', enum: ['rect', 'chamfer', 'L', 'T', 'U', 'H', 'Z', 'plus'] },
    description: 'Room shapes that may be used (default ["rect","chamfer"]): rect, chamfer (cut corners), L, T, U, H, Z, plus.',
  },
  connectionType: { type: 'string', enum: ['hall', 'door'], description: '"hall": rooms are joined by hallways (default). "door": rooms are joined by doorways straight through shared walls.' },
  connectionRandomness: int(0, 100, 'Percent of connections that use the other type from connectionType (default 14, about 1 in 7).'),
  hallTypes: {
    type: 'array',
    items: { type: 'string', enum: ['short', 'spine', 'curly', 'branching'] },
    description: 'Hallway types that may be built (default ["short","spine","branching"]): short, spine (a long straight passage with rooms along it), curly (winding), branching (hallways fork, and rooms hang off any hallway). At least one of short, spine or curly is needed if hallways are built.',
  },
  hallDoors: { type: 'string', enum: ['none', 'less', 'more', 'all'], description: 'How many hallway openings into rooms have a door rather than an open archway (default "all").' },
  hallWidth: int(1, 10, 'How many squares across the generated hallways are (default 1). Wider hallways make a bigger dungeon. Hallways added later with edit_dungeon are always 1 wide.'),
  levels: int(1, 20, 'How many floors the dungeon has (default 1). Every floor is built from the same settings and has the same size of map, and rooms are then numbered by level, such as 2-5 for room 5 of level 2. Level 1 is the top and has the entrances; the floors below are reached by stairs only. Dungeons of several levels cannot be changed with edit_dungeon yet.'),
  levelStairs: int(1, 10, 'How many stairs join each floor to the one below it (default 1; only matters with more than one level). A stair is one square in a room, at the same place on both floors, and away from doors. Where the floors have no room for that many, there are fewer, and the answer says so.'),
  entrances: int(1, 10, 'How many ways in from outside (default 1).'),
  edgeEntrancesOnly: { type: 'boolean', description: 'Entrances only as doors in the outer walls (default true). If false, some may be stairs inside the dungeon.' },
  seed: { type: 'string', description: 'Any text or number. The same settings and seed always give the same dungeon. Leave out for a random one.' },
};

const COLORS = ['background', 'rooms', 'hallways', 'lines', 'grid', 'doors', 'entrances'];

const LOOK = {
  legend: { type: 'boolean', description: 'Put a strip under the map with the seed, a scale bar and a key (default true).' },
  labelPosition: { type: 'string', enum: ['inside', 'outside'], description: 'Room numbers on the rooms (default) or just outside their walls.' },
  showGrid: { type: 'boolean', description: 'Draw the 5 ft grid (default true).' },
  showRoomNumbers: { type: 'boolean', description: 'Draw the room numbers (default true).' },
  level: int(1, 20, 'A dungeon of several levels: draw only this level (default: every level, one above the other).'),
  showCoordinates: { type: 'boolean', description: 'Number the squares along the top (x) and left (y) edges of the map, the same x and y that edit_dungeon takes (default false). Use it to read off where a door or hallway should go.' },
  colors: {
    type: 'object',
    description: 'Colours as #rrggbb. Any of: background, rooms, hallways, lines, grid, doors, entrances. The rest keep the usual parchment colours.',
    properties: Object.fromEntries(COLORS.map((c) => [c, { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }])),
    additionalProperties: false,
  },
};

const ID = { type: 'string', description: 'Which dungeon: the id (such as "d1") that generate_dungeon or open_dungeon gave. Leave out for the one last used.' };
const PICTURE = { type: 'boolean', description: 'Include a picture of the map (default true).' };

// ---- reading what Claude sent ----------------------------------------------------------------------

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Only these keys; anything else is a typo Claude should hear about, not have ignored. */
function only(args, allowed, what) {
  const unknown = Object.keys(args).filter((k) => !allowed.includes(k));
  if (unknown.length) throw new ToolError(`${what} has no ${unknown.map((k) => `"${k}"`).join(', ')}. It takes: ${allowed.join(', ')}.`);
}

function readLook(args) {
  const dm = load();
  const look = {};
  if (args.legend !== undefined) {
    if (typeof args.legend !== 'boolean') throw new ToolError('"legend" must be true or false.');
    look.legend = args.legend;
  }
  if (args.labelPosition !== undefined) {
    if (!['inside', 'outside'].includes(args.labelPosition)) throw new ToolError('"labelPosition" must be "inside" or "outside".');
    look.labelPosition = args.labelPosition;
  }
  if (args.level !== undefined) {
    if (!Number.isInteger(args.level) || args.level < 1) throw new ToolError('"level" must be a whole number from 1.');
    look.level = args.level;
  }
  for (const [from, to] of [['showGrid', 'showGrid'], ['showRoomNumbers', 'showLabels'], ['showCoordinates', 'showCoordinates']]) {
    if (args[from] === undefined) continue;
    if (typeof args[from] !== 'boolean') throw new ToolError(`"${from}" must be true or false.`);
    look[to] = args[from];
  }
  if (args.colors !== undefined) {
    if (!isObject(args.colors)) throw new ToolError('"colors" must be an object such as {"rooms":"#ffffff"}.');
    for (const [name, hex] of Object.entries(args.colors)) {
      if (!COLORS.includes(name)) throw new ToolError(`"${name}" is not a colour to set. They are: ${COLORS.join(', ')}.`);
      if (typeof hex !== 'string' || !dm.isHexColor(hex)) throw new ToolError(`The colour for "${name}" must look like #c0392b.`);
    }
    look.colors = args.colors;
  }
  return look;
}

/** Which side of a square is meant: N, E, S, W or the word. Returns 0..3. */
function readSide(side) {
  const i = typeof side === 'string' ? ['n', 'e', 's', 'w'].indexOf(side.trim().charAt(0).toLowerCase()) : -1;
  if (i < 0) throw new ToolError('"side" must be one of N, E, S, W (or north, east, south, west).');
  return i;
}

const needInt = (v, name) => {
  if (!Number.isInteger(v)) throw new ToolError(`"${name}" must be a whole number.`);
  return v;
};

// ---- the tools -------------------------------------------------------------------------------------

function createTools({ store = new Store() } = {}) {
  const dm = () => load();

  /** What most tools answer with: the dungeon in words, and its picture unless that was turned off. */
  function answer(item, { picture = true, intro = '', look } = {}) {
    const text = [intro, describeDungeon(item.dungeon, { id: item.id, edited: store.isEdited(item) })].filter(Boolean).join('\n\n');
    return picture ? { text, png: renderPng(item.dungeon, look) } : { text };
  }

  const wantsPicture = (args) => {
    if (args.picture !== undefined && typeof args.picture !== 'boolean') throw new ToolError('"picture" must be true or false.');
    return args.picture !== false;
  };

  const tools = [];

  tools.push({
    name: 'generate_dungeon',
    description:
      "Make a new dungeon map with Duckweed's Dungeon Drafter: rooms of several shapes on a 5 ft grid, joined by hallways and doors, with entrances from outside. " +
      'Every setting is optional (the defaults are the app\'s). The same settings and seed always give the same dungeon. ' +
      'With levels above 1 it makes a dungeon of several floors joined by stairs (a stair is the same square on both floors it joins). ' +
      'Answers with a picture of the map and a room-by-room description using the numbers printed on the map, so the content you write for each room matches it. ' +
      'The dungeon is kept under an id (d1, d2, ...) for the other tools.',
    inputSchema: { type: 'object', properties: { ...SETTINGS, picture: PICTURE }, additionalProperties: false },
    annotations: { title: 'Generate a dungeon', readOnlyHint: true, openWorldHint: false },
    run(args) {
      only(args, [...Object.keys(SETTINGS), 'picture'], 'generate_dungeon');
      const picture = wantsPicture(args);
      const raw = { ...APP_DEFAULTS };
      for (const k of Object.keys(SETTINGS)) if (args[k] !== undefined) raw[k] = args[k];
      const check = dm().validateParams(raw);
      if (!check.ok) throw new ToolError(`These settings do not work: ${Object.values(check.errors).join(' ')}`);
      let dungeon;
      try {
        dungeon = dm().generateDungeon(check.params);
      } catch (err) {
        throw new ToolError(`The dungeon could not be made: ${err.message}`);
      }
      return answer(store.add(dungeon), { picture });
    },
  });

  tools.push({
    name: 'open_dungeon',
    description:
      'Open a dungeon that was saved as a "Data (JSON)" file, from the app\'s Data (JSON) button or from save_dungeon, so it can be described, edited and drawn here. ' +
      'A bare file name is looked for in the maps folder first. Answers like generate_dungeon.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Full path of the .json file, or just its name if it is in the maps folder.' }, picture: PICTURE },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { title: 'Open a saved dungeon', readOnlyHint: true, openWorldHint: false },
    run(args) {
      only(args, ['path', 'picture'], 'open_dungeon');
      const picture = wantsPicture(args);
      return answer(store.open(args.path), { picture });
    },
  });

  tools.push({
    name: 'describe_dungeon',
    description:
      'The dungeon in words, without a picture: every room by the number on the map (shape, size in feet, where it is), its doors and what they lead to, the hallways and the entrances. ' +
      'Use it to write content for a dungeon you already have.',
    inputSchema: { type: 'object', properties: { id: ID }, additionalProperties: false },
    annotations: { title: 'Describe a dungeon', readOnlyHint: true, openWorldHint: false },
    run(args) {
      only(args, ['id'], 'describe_dungeon');
      return answer(store.get(args.id), { picture: false });
    },
  });

  tools.push({
    name: 'draw_map',
    description:
      'A picture of the dungeon\'s map (the same picture as the app\'s "Picture (PNG)" button). Choose whether the legend, grid and room numbers show, ' +
      'whether room numbers sit on the rooms or outside their walls, and the colours.',
    inputSchema: { type: 'object', properties: { id: ID, ...LOOK }, additionalProperties: false },
    annotations: { title: 'Draw the map', readOnlyHint: true, openWorldHint: false },
    run(args) {
      only(args, ['id', ...Object.keys(LOOK)], 'draw_map');
      const look = readLook(args);
      const item = store.get(args.id);
      checkLevel(item.dungeon, look);
      return { text: `Map of dungeon ${item.id} (seed ${item.dungeon.seed}).`, png: renderPng(item.dungeon, look) };
    },
  });

  tools.push({
    name: 'edit_dungeon',
    description:
      'Change a dungeon by hand, as the app\'s Edit mode does. Give a list of edits, applied in order; each has a "type":\n' +
      '- "door": change one door. Give "x", "y" and "side" (N, E, S or W) as written next to the door in the description, e.g. "(12,7) east" is x 12, y 7, side E, and "state": door, locked, secret (drawn as solid wall with an S) or open (an archway with no door). Entrance doors cannot be changed.\n' +
      '- "draw_hallway": draw a hallway. Give "points", a list of [x, y] squares to pass through; the squares between them are filled in (straight runs along rows and columns are best; a diagonal comes out as a staircase). ' +
      'Squares that touch a hallway join it, so starting at one makes a branch; a hallway may be a dead end. Where it ends against a room\'s wall it opens into that room (a door or an archway, following the dungeon\'s Hallway doors setting). Rooms cannot be drawn over. The map grows to fit.\n' +
      '- "delete_hallway": delete hallway and the doors on it. Either give "hall", a hallway\'s number from the description (3 for H3), to delete all of that hallway, or give "x" and "y" of any square to delete just one stretch of it (up to the next junction, side door or dead end). Hall numbers in one call are those before the call, even though hallways are numbered again afterwards.\n' +
      '- "add_entrance": add a way in from outside. Give "x", "y" (a room square) and "side" (N, E, S or W): a door in that outer wall of the room. The wall must face open ground with a clear line out of the map (no other room or hallway in the way). Or give "kind": "stairs" to put stairs on the room floor at that square, climbing toward that side.\n' +
      '- "remove_entrance": remove an entrance. Give "entrance", its number (2 for E2). At least one entrance must remain, and entrances are numbered E1, E2, ... again afterwards. To move an entrance, add the new one first, then remove the old one.\n' +
      '- "renumber_room": change a room\'s number. Give "room" (its number on the map now) and "number" (the number it should have). Numbers always stay 1 to N, so the room that had that number takes the old one of this room (they swap). Later renumber_room edits in the same call see the numbers as the earlier ones left them.\n' +
      '- "name_room": give a room a name. Give "room" (its number on the map) and "name", e.g. "Foyer". The map still shows numbers; a key under the picture lists "number - name" for every named room, and the description shows the name beside the number. An empty name removes it. A room keeps its name if it is renumbered.\n' +
      'A dungeon of several levels is edited one level at a time: give "level" with each edit (or once, at the top, for all of them). Rooms, hallways, doors and entrances of an edit are those of that level, and "room" is the number on that level\'s map (the 5 of 2-5). ' +
      'Only level 1 has entrances. All levels share one map, so if a hallway makes it bigger every level moves together, and so do the stairs; no door can be put on a square where stairs lead to another level.\n' +
      '- "add_stair": put stairs between two levels of a dungeon of several levels. Give "level" (the upper one: the stairs join it and the level below), and "x" and "y": a square that is a room square on both levels, with no door, opening or entrance on it and no other stairs. They get the next free letter.\n' +
      '- "move_stair": move stairs to another square. Give "stair" (its letter, A for the stairs marked A) and "x" and "y" (the new square, with the same conditions as add_stair; it stays between the same two levels). No "level" is needed.\n' +
      '- "remove_stair": remove stairs. Give "stair" (the letter). Each pair of levels keeps at least one stair, so every level can be reached.\n' +
      'Coordinates in one call are all read against the map as it was before the call. If a hallway reaches past the top or left edge, the map grows and every coordinate moves; the answer says so and gives the new description.',
    inputSchema: {
      type: 'object',
      properties: {
        id: ID,
        level: int(1, 20, 'A dungeon of several levels: the level the edits are made to, unless an edit gives its own "level".'),
        edits: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_EDITS,
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['door', 'draw_hallway', 'delete_hallway', 'add_entrance', 'remove_entrance', 'renumber_room', 'name_room', 'add_stair', 'move_stair', 'remove_stair'] },
              stair: { type: 'string', description: 'move_stair, remove_stair: the stairs\' letter (A, B, ...), as in the description' },
              level: int(1, 20, 'A dungeon of several levels: the level this edit is made to (default: the "level" at the top).'),
              name: { type: 'string', description: `name_room: the room's name (up to ${MAX_NAME} characters); empty text removes it` },
              hall: { type: 'integer', description: 'delete_hallway: the hallway\'s number (3 for H3), to delete all of it' },
              kind: { type: 'string', enum: ['door', 'stairs'], description: 'add_entrance: a door in an outer wall (default) or stairs on the floor' },
              entrance: { type: 'integer', description: 'remove_entrance: the entrance\'s number (2 for E2)' },
              room: { type: 'integer', description: 'renumber_room: the room\'s current number on the map' },
              number: { type: 'integer', description: 'renumber_room: the number it should have (1 to the number of rooms)' },
              x: { type: 'integer', description: 'door, add_entrance, delete_hallway (a stretch): the square\'s x (east-west, from the left edge)' },
              y: { type: 'integer', description: 'door, add_entrance, delete_hallway (a stretch): the square\'s y (north-south, from the top edge)' },
              side: { type: 'string', description: 'door, add_entrance: which side of that square the door is on: N, E, S or W' },
              state: { type: 'string', enum: ['door', 'locked', 'secret', 'open'], description: 'door: what it becomes' },
              points: { type: 'array', items: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 }, description: 'draw_hallway: [x, y] squares to pass through, in order' },
            },
            required: ['type'],
          },
        },
        picture: PICTURE,
      },
      required: ['edits'],
      additionalProperties: false,
    },
    annotations: { title: 'Edit a dungeon', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run(args) {
      only(args, ['id', 'level', 'edits', 'picture'], 'edit_dungeon');
      const picture = wantsPicture(args);
      if (!Array.isArray(args.edits) || args.edits.length === 0) throw new ToolError('"edits" must be a list with at least one edit.');
      if (args.edits.length > MAX_EDITS) throw new ToolError(`At most ${MAX_EDITS} edits at a time.`);
      const item = store.get(args.id);
      const d = item.dungeon;
      const levels = dm().levelCount(d);
      if (args.level !== undefined && (!Number.isInteger(args.level) || args.level < 1)) throw new ToolError('"level" must be a whole number from 1.');
      const before = item.history.snapshot(d); // (for undo_edit)
      const shift = { x: 0, y: 0 }; // how far the map has moved so far in this call
      // a square of each hallway of each level, to find it again by its H number
      const snap = { hallCells: Array.from({ length: levels }, (_, i) => dm().floorView(d, i + 1).halls.map((h) => h.cells[0])) };
      const report = [];
      let done = 0;
      let hallwaysChanged = false;
      args.edits.forEach((edit, i) => {
        try {
          if (!isObject(edit)) throw new ToolError('an edit must be an object with a "type".');
          const level = edit.level !== undefined ? edit.level : args.level;
          const needsLevel = edit.type !== 'move_stair' && edit.type !== 'remove_stair';
          if (levels > 1 && needsLevel && level === undefined) throw new ToolError(`this dungeon has ${levels} levels: say which one with "level".`);
          if (level !== undefined && (!Number.isInteger(level) || level < 1 || level > levels)) throw new ToolError(`this dungeon has ${levels === 1 ? 'one level' : `${levels} levels`}, so there is no level ${level}.`);
          // the floor as it is now (the map may have moved since the last edit)
          report.push(`${i + 1}. ${applyEdit(dm().floorView(d, level || 1), edit, shift, snap)}`);
          done++;
          if (edit.type === 'draw_hallway' || edit.type === 'delete_hallway') hallwaysChanged = true;
        } catch (err) {
          if (!(err instanceof ToolError)) throw err;
          report.push(`${i + 1}. FAILED, nothing changed: ${err.message}`);
        }
      });
      if (done === 0) throw new ToolError(`None of the edits could be made.\n${report.join('\n')}`);
      const kinds = [...new Set(args.edits.filter(isObject).map((e) => String(e.type)))];
      item.history.push(d, `${done} edit${done === 1 ? '' : 's'} (${kinds.slice(0, 4).join(', ')}${kinds.length > 4 ? ', ...' : ''})`, before, { dx: shift.x, dy: shift.y });
      const moved = shift.x !== 0 || shift.y !== 0;
      const notes = [];
      if (moved) notes.push(`The map changed size at its top or left, so every square has moved by (${shift.x >= 0 ? '+' : ''}${shift.x},${shift.y >= 0 ? '+' : ''}${shift.y}). Use the coordinates in the description below from now on.`);
      if (hallwaysChanged) notes.push('Hallways are numbered again after a hallway edit, so H1, H2, ... below may not be the ones they were before.');
      return answer(item, { picture, intro: [`${done} of ${args.edits.length} edits made:`, ...report, ...notes].join('\n') });
    },
  });

  tools.push({
    name: 'regenerate_level',
    description:
      'Build one level of a dungeon of several levels again, from other random numbers, and leave every other level as it is. Use it when one floor came out badly. ' +
      'The new level has the same settings as the dungeon (room count, shapes, layout, hallways), its rooms are numbered from 1 and have no names, and any edits made to that level are lost. ' +
      'The stairs to the levels next to it stay where they still fit on the new floor; others are placed again on squares that work for both floors, and the answer says how many. ' +
      'If the new level makes the map bigger or smaller every level moves together, and the answer says by how much. Answers with the new description and picture.',
    inputSchema: {
      type: 'object',
      properties: {
        id: ID,
        level: int(1, 20, 'The level to build again (1 is the top, with the entrances).'),
        seed: { type: 'string', description: 'Optional text to build the level from: the same seed on the same dungeon gives the same level. Default: a random one, so each call gives a different level.' },
        picture: PICTURE,
      },
      required: ['level'],
      additionalProperties: false,
    },
    annotations: { title: 'Build a level again', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    run(args) {
      only(args, ['id', 'level', 'seed', 'picture'], 'regenerate_level');
      const picture = wantsPicture(args);
      if (!Number.isInteger(args.level) || args.level < 1) throw new ToolError('"level" must be a whole number from 1.');
      if (args.seed !== undefined && typeof args.seed !== 'string') throw new ToolError('"seed" must be text.');
      const item = store.get(args.id);
      const d = item.dungeon;
      const dm = load();
      if (dm.levelCount(d) < 2) throw new ToolError('This dungeon has only one level. Make a new one with generate_dungeon, or one with several levels.');
      if (args.level > dm.levelCount(d)) throw new ToolError(`This dungeon has ${dm.levelCount(d)} levels, so there is no level ${args.level}.`);
      const before = item.history.snapshot(d);
      const res = dm.regenerateLevel(d, args.level, args.seed === undefined || args.seed === '' ? {} : { seed: args.seed });
      if (!res.ok) throw new ToolError(`Level ${args.level} was not built again: ${res.reason}`);
      item.history.push(d, `level ${args.level} built again`, before, { dx: res.dx, dy: res.dy });
      const notes = [`Level ${args.level} was built again (seed ${res.seed}): ${res.kept} stair${res.kept === 1 ? '' : 's'} kept where they were, ${res.added} placed anew. The other levels are as they were.`];
      if (res.dx !== 0 || res.dy !== 0) notes.push(`The map changed size at its top or left, so every square has moved by (${res.dx >= 0 ? '+' : ''}${res.dx},${res.dy >= 0 ? '+' : ''}${res.dy}). Use the coordinates in the description below from now on.`);
      return answer(item, { picture, intro: notes.join('\n') });
    },
  });

  for (const [name, verb, past, title] of [['undo_edit', 'undo', 'Undid', 'Undo an edit'], ['redo_edit', 'redo', 'Redid', 'Redo an edit']]) {
    tools.push({
      name,
      description:
        verb === 'undo'
          ? 'Take back the last change made to a dungeon with edit_dungeon or regenerate_level (room names included), putting it back as it was. Can be called again to go further back, and redo_edit makes a change again that was taken back. ' +
            'Answers with what was undone, the new description and the picture. Changes made in the app are not in this history: it holds what was done to the dungeon here, since it was made or opened.'
          : 'Make a change again that undo_edit took back. A new change made after an undo ends what could be redone. Answers with what was redone, the new description and the picture.',
      inputSchema: { type: 'object', properties: { id: ID, picture: PICTURE }, additionalProperties: false },
      annotations: { title, readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      run(args) {
        only(args, ['id', 'picture'], name);
        const picture = wantsPicture(args);
        const item = store.get(args.id);
        const res = item.history[verb](item.dungeon);
        if (!res.ok) throw new ToolError(`Nothing to ${verb}: ${item.id} has no ${verb === 'undo' ? 'changes made here to take back' : 'undone changes to make again'}.`);
        const notes = [`${past}: ${res.label}.`];
        if (res.dx !== 0 || res.dy !== 0) notes.push(`The map changed size at its top or left, so every square has moved by (${res.dx >= 0 ? '+' : ''}${res.dx},${res.dy >= 0 ? '+' : ''}${res.dy}). Use the coordinates in the description below from now on.`);
        const more = [item.history.canUndo ? `${item.history.undos.length} more to undo` : '', item.history.canRedo ? `${item.history.redos.length} to redo` : ''].filter(Boolean);
        if (more.length) notes.push(`(${more.join(', ')}.)`);
        return answer(item, { picture, intro: notes.join('\n') });
      },
    });
  }

  tools.push({
    name: 'save_dungeon',
    description:
      'Save the dungeon to the maps folder as two files: the picture (.png, to print or share) and the data (.json, to open again later with open_dungeon). ' +
      'A name that is taken gets -2, -3, ... after it unless overwrite is true. Answers with the paths.',
    inputSchema: {
      type: 'object',
      properties: {
        id: ID,
        name: { type: 'string', description: 'File name without an extension, e.g. "crypt-of-the-pale-king". Default: dungeon-<seed>.' },
        overwrite: { type: 'boolean', description: 'Replace files that already have this name (default false).' },
        ...LOOK,
      },
      additionalProperties: false,
    },
    annotations: { title: 'Save a dungeon', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run(args) {
      only(args, ['id', 'name', 'overwrite', ...Object.keys(LOOK)], 'save_dungeon');
      if (args.name !== undefined && typeof args.name !== 'string') throw new ToolError('"name" must be text.');
      if (args.overwrite !== undefined && typeof args.overwrite !== 'boolean') throw new ToolError('"overwrite" must be true or false.');
      const look = readLook(args);
      const item = store.get(args.id);
      checkLevel(item.dungeon, look);
      const files = store.save(item, { name: args.name, look, overwrite: args.overwrite === true });
      return { text: `Saved dungeon ${item.id}:\nPicture: ${files.png}\nData: ${files.json}\nOpen the data again later with open_dungeon.` };
    },
  });

  tools.push({
    name: 'list_dungeons',
    description: 'The dungeons in use now (with their ids) and the saved maps in the maps folder, newest first.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'List dungeons', readOnlyHint: true, openWorldHint: false },
    run(args) {
      only(args, [], 'list_dungeons');
      const lines = ['IN USE NOW'];
      for (const item of store.items.values()) {
        const d = item.dungeon;
        const levels = load().levelCount(d);
        lines.push(`- ${item.id}: seed ${d.seed}, ${levels > 1 ? `${levels} levels of ${d.rooms.length} rooms` : `${d.rooms.length} rooms`}, ${d.width}×${d.height} squares${store.isEdited(item) ? ', edited' : ''}${item.file ? `, from/saved as ${item.file}` : ', not saved'}`);
      }
      if (store.items.size === 0) lines.push('- none yet');
      lines.push('', `SAVED IN ${store.dir}`);
      const saved = store.saved();
      for (const f of saved) lines.push(`- ${f.name} (${f.modified.toISOString().slice(0, 16).replace('T', ' ')})`);
      if (saved.length === 0) lines.push('- nothing saved yet');
      return { text: lines.join('\n') };
    },
  });

  return tools;
}

/** A level to draw has to be one the dungeon has. */
function checkLevel(d, look) {
  const n = load().levelCount(d);
  if (look.level !== undefined && look.level > n) throw new ToolError(`This dungeon has ${n === 1 ? 'one level' : `${n} levels`}, so there is no level ${look.level}.`);
}

// ---- edits -----------------------------------------------------------------------------------------

/** The opening on the edge of square (x, y) on side dir, whichever of the two squares it is listed from. */
function findOpening(d, x, y, dir) {
  const { DX, DY, OPP } = load().DIRS;
  for (const c of d.connections) {
    for (const o of c.openings) {
      if (o.x === x && o.y === y && o.d === dir) return o;
      if (o.x + DX[o.d] === x && o.y + DY[o.d] === y && OPP[o.d] === dir) return o;
    }
  }
  return null;
}

/** Make one edit; returns a line saying what was done, or throws a ToolError. `shift` follows how far the map moves. */
function applyEdit(d, edit, shift, snap) {
  const dm = load();
  const label = (roomId) => dm.roomTag(d.rooms[roomId]);
  const floorNo = (d.level || 1) - 1;
  switch (edit.type) {
    case 'door': {
      const x = needInt(edit.x, 'x');
      const y = needInt(edit.y, 'y');
      const dir = readSide(edit.side);
      if (!dm.DOOR_STYLES.includes(edit.state)) throw new ToolError(`"state" must be one of: ${dm.DOOR_STYLES.join(', ')}.`);
      const at = `(${x},${y}) ${SIDES[dir]}`;
      const o = findOpening(d, x + shift.x, y + shift.y, dir);
      if (!o) {
        const entrance = d.entrances.some((e) => e.kind !== 'stairs' && e.x === x + shift.x && e.y === y + shift.y && e.d === dir);
        throw new ToolError(entrance ? `${at} is an entrance, and entrance doors cannot be changed.` : `there is no door at ${at}. Doors are written like that in the description.`);
      }
      const from = o.style;
      o.style = edit.state;
      return from === edit.state ? `${at}: already a ${STYLES[from]}.` : `${at}: ${STYLES[from]} became ${STYLES[edit.state]}.`;
    }
    case 'draw_hallway': {
      if (!Array.isArray(edit.points) || edit.points.length === 0) throw new ToolError('"points" must be a list of [x, y] squares.');
      if (edit.points.length > MAX_POINTS) throw new ToolError(`At most ${MAX_POINTS} points in one hallway: split it up.`);
      const points = edit.points.map((p, i) => {
        if (!Array.isArray(p) || p.length !== 2 || !Number.isInteger(p[0]) || !Number.isInteger(p[1])) throw new ToolError(`point ${i + 1} must be [x, y], two whole numbers.`);
        return [p[0] + shift.x, p[1] + shift.y];
      });
      const stroke = [points[0]];
      for (let i = 1; i < points.length; i++) {
        stroke.push(...dm.walkCells(points[i - 1], points[i]));
        if (stroke.length > MAX_STROKE) throw new ToolError(`That hallway runs over ${MAX_STROKE} squares: draw it in pieces.`);
      }
      const plan = dm.planHallway(d, stroke);
      const res = dm.addHallway(d, stroke);
      if (!res.ok) throw new ToolError(res.reason);
      shift.x += res.dx;
      shift.y += res.dy;
      const opened = plan.openings.map((o) => `${STYLES[o.style]} into room ${label(o.room)}'s ${SIDES[o.d]} wall`);
      return `hallway drawn: ${plan.floor.length} new squares${opened.length ? `; opened ${opened.join(', ')}` : '; it opens into no room'}.`;
    }
    case 'delete_hallway': {
      if (edit.hall !== undefined) {
        // whole hallway, by the H number it had before this call
        const n = needInt(edit.hall, 'hall');
        const at = snap && snap.hallCells[floorNo][n - 1];
        if (!at) throw new ToolError(`there is no hallway H${n}.`);
        const now = d.halls.find((h) => h.cells.some(([cx, cy]) => cx === at[0] + shift.x && cy === at[1] + shift.y));
        if (!now) throw new ToolError(`hallway H${n} is already gone.`);
        const size = now.cells.length;
        const res = dm.deleteHall(d, now.id);
        shift.x += res.dx;
        shift.y += res.dy;
        return `deleted hallway H${n}: ${size} squares, with the doors on it.`;
      }
      const x = needInt(edit.x, 'x');
      const y = needInt(edit.y, 'y');
      const res = dm.deleteHallStretch(d, x + shift.x, y + shift.y);
      if (!res.ok) throw new ToolError(`there is no hallway at (${x},${y}).`);
      shift.x += res.dx;
      shift.y += res.dy;
      return `deleted the stretch of hallway at (${x},${y}): ${res.removed.length} squares, with the doors on them.`;
    }
    case 'add_entrance': {
      const x = needInt(edit.x, 'x');
      const y = needInt(edit.y, 'y');
      const dir = readSide(edit.side);
      const kind = edit.kind === undefined ? 'door' : edit.kind;
      if (kind !== 'door' && kind !== 'stairs') throw new ToolError('"kind" must be "door" or "stairs".');
      const res = dm.addEntrance(d, kind, x + shift.x, y + shift.y, dir);
      if (!res.ok) throw new ToolError(`no entrance at (${x},${y}) ${SIDES[dir]}: ${res.reason}`);
      const e = res.entrance;
      return kind === 'stairs'
        ? `added ${e.label}: stairs in room ${label(e.room)} at (${x},${y}), climbing toward its ${SIDES[dir]} wall.`
        : `added ${e.label}: a door in the ${SIDES[dir]} wall of room ${label(e.room)} at (${x},${y}).`;
    }
    case 'remove_entrance': {
      const n = needInt(edit.entrance, 'entrance');
      const res = dm.removeEntrance(d, n - 1);
      if (!res.ok) throw new ToolError(`cannot remove E${n}: ${res.reason}`);
      return `removed E${n} (from room ${label(res.entrance.room)}). Entrances are numbered E1, E2, ... again.`;
    }
    case 'name_room': {
      const num = needInt(edit.room, 'room');
      const r = d.rooms.find((x) => x.label === num);
      if (!r) throw new ToolError(`there is no room ${num}${d.level ? ` on level ${d.level}` : ''}. Rooms are numbered 1 to ${d.rooms.length}, as printed on the map.`);
      if (typeof edit.name !== 'string') throw new ToolError('"name" must be text (an empty one removes the name).');
      // eslint-disable-next-line no-control-regex
      const name = edit.name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
      if (name.length > MAX_NAME) throw new ToolError(`a room name can be at most ${MAX_NAME} characters (this one is ${name.length}).`);
      if (name === '') {
        delete r.name;
        return `room ${dm.roomTag(r)} no longer has a name.`;
      }
      r.name = name;
      return `room ${dm.roomTag(r)} is now named "${name}".`;
    }
    case 'renumber_room': {
      const from = needInt(edit.room, 'room');
      const to = needInt(edit.number, 'number');
      const n = d.rooms.length;
      for (const [v, what] of [[from, 'room'], [to, 'number']]) {
        if (v < 1 || v > n) throw new ToolError(`"${what}" must be a room number from 1 to ${n}, as printed on the map (got ${v}).`);
      }
      const a = d.rooms.find((r) => r.label === from);
      const b = d.rooms.find((r) => r.label === to);
      if (a === b) return `room ${d.level ? `${d.level}-` : ''}${from} already has number ${to}.`;
      // rooms keep numbers 1..N with no repeats, so the room that had the number takes the other's
      a.label = to;
      b.label = from;
      const tag = (k) => (d.level ? `${d.level}-${k}` : String(k));
      return `room ${tag(from)} is now room ${tag(to)}, and the room that was ${tag(to)} is now ${tag(from)}.`;
    }
    case 'add_stair': {
      const upper = d.level || 1;
      const x = needInt(edit.x, 'x');
      const y = needInt(edit.y, 'y');
      const res = dm.addStair(d, upper, x + shift.x, y + shift.y);
      if (!res.ok) throw new ToolError(`no stairs at (${x},${y}): ${res.reason}`);
      const s = res.stair;
      const tag = (lv, id) => dm.roomTag(dm.floorView(d._model || d, lv).rooms[id]);
      return `added stairs ${s.letter} at (${x},${y}): room ${tag(s.upper, s.upperRoom)} on level ${s.upper} down to room ${tag(s.lower, s.lowerRoom)} on level ${s.lower}.`;
    }
    case 'move_stair':
    case 'remove_stair': {
      if (typeof edit.stair !== 'string' || !/^[A-Za-z]+$/.test(edit.stair)) throw new ToolError('"stair" must be the stairs\' letter, such as A.');
      const letter = edit.stair.toUpperCase();
      if (edit.type === 'remove_stair') {
        const res = dm.removeStair(d, letter);
        if (!res.ok) throw new ToolError(`cannot remove stairs ${letter}: ${res.reason}`);
        return `removed stairs ${letter} (they joined level ${res.stair.upper} and level ${res.stair.lower}).`;
      }
      const x = needInt(edit.x, 'x');
      const y = needInt(edit.y, 'y');
      const res = dm.moveStair(d, letter, x + shift.x, y + shift.y);
      if (!res.ok) throw new ToolError(`cannot move stairs ${letter} to (${x},${y}): ${res.reason}`);
      return `stairs ${letter} are now at (${x},${y}).`;
    }
    default:
      throw new ToolError(`"type" must be one of: door, draw_hallway, delete_hallway, add_entrance, remove_entrance, renumber_room, name_room, add_stair, move_stair, remove_stair.`);
  }
}

module.exports = { createTools, APP_DEFAULTS, SETTINGS, applyEdit, findOpening };
