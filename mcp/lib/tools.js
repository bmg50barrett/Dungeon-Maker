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
  minRoomWidth: 1,
  minRoomLength: 1,
  sizeVariance: 30,
  spacing: 'compact',
  layout: 'random',
  roomShapes: ['rect', 'chamfer'],
  connectionType: 'hall',
  connectionRandomness: 14,
  hallTypes: ['short', 'spine', 'branching'],
  hallDoors: 'all',
  entrances: 1,
  edgeEntrancesOnly: true,
};

const MAX_EDITS = 50;
const MAX_POINTS = 200;
const MAX_STROKE = 5000; // squares one hallway stroke may cover, as in the page

// ---- the shapes of what Claude may send ------------------------------------------------------------

const int = (minimum, maximum, description) => ({ type: 'integer', minimum, maximum, description });

const SETTINGS = {
  roomCount: int(1, 99, 'How many rooms (default 12).'),
  avgRoomSize: int(1, 999, 'Average room size in squares of floor; one square is 5 ft by 5 ft, so 30 is about 750 sq ft (default 30).'),
  minRoomWidth: int(1, 30, 'Least a room measures across the map (east-west), in squares (default 1: no minimum).'),
  minRoomLength: int(1, 30, 'Least a room measures up and down the map (north-south), in squares (default 1: no minimum).'),
  sizeVariance: int(0, 100, 'How much room sizes vary, as a percentage of the average (default 30).'),
  spacing: { type: 'string', enum: ['compact', 'normal', 'spaced'], description: 'How far apart rooms are: compact (rooms may touch; default), normal or spaced.' },
  layout: { type: 'string', enum: ['random', 'cathedral', 'ring', 'cavern', 'square', 'long', 'wide'], description: 'The overall shape the dungeon leans towards: random (default, no shape), cathedral (a long nave crossed by a transept), ring (rooms circling an empty middle, closed into a loop), cavern (a few round chambers), square, long (taller than wide) or wide (wider than tall).' },
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
  for (const [from, to] of [['showGrid', 'showGrid'], ['showRoomNumbers', 'showLabels']]) {
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
      '- "delete_hallway": delete one stretch of hallway (up to the next junction, side door or dead end) and the doors on it. Give "x" and "y" of any square of it.\n' +
      'Coordinates in one call are all read against the map as it was before the call. If a hallway reaches past the top or left edge, the map grows and every coordinate moves; the answer says so and gives the new description.',
    inputSchema: {
      type: 'object',
      properties: {
        id: ID,
        edits: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_EDITS,
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['door', 'draw_hallway', 'delete_hallway'] },
              x: { type: 'integer', description: 'door, delete_hallway: the square\'s x (east-west, from the left edge)' },
              y: { type: 'integer', description: 'door, delete_hallway: the square\'s y (north-south, from the top edge)' },
              side: { type: 'string', description: 'door: which side of that square the door is on: N, E, S or W' },
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
      only(args, ['id', 'edits', 'picture'], 'edit_dungeon');
      const picture = wantsPicture(args);
      if (!Array.isArray(args.edits) || args.edits.length === 0) throw new ToolError('"edits" must be a list with at least one edit.');
      if (args.edits.length > MAX_EDITS) throw new ToolError(`At most ${MAX_EDITS} edits at a time.`);
      const item = store.get(args.id);
      const d = item.dungeon;
      const shift = { x: 0, y: 0 }; // how far the map has moved so far in this call
      const report = [];
      let done = 0;
      let hallwaysChanged = false;
      args.edits.forEach((edit, i) => {
        try {
          if (!isObject(edit)) throw new ToolError('an edit must be an object with a "type".');
          report.push(`${i + 1}. ${applyEdit(d, edit, shift)}`);
          done++;
          if (edit.type === 'draw_hallway' || edit.type === 'delete_hallway') hallwaysChanged = true;
        } catch (err) {
          if (!(err instanceof ToolError)) throw err;
          report.push(`${i + 1}. FAILED, nothing changed: ${err.message}`);
        }
      });
      if (done === 0) throw new ToolError(`None of the edits could be made.\n${report.join('\n')}`);
      const moved = shift.x !== 0 || shift.y !== 0;
      const notes = [];
      if (moved) notes.push(`The map changed size at its top or left, so every square has moved by (${shift.x >= 0 ? '+' : ''}${shift.x},${shift.y >= 0 ? '+' : ''}${shift.y}). Use the coordinates in the description below from now on.`);
      if (hallwaysChanged) notes.push('Hallways are numbered again after a hallway edit, so H1, H2, ... below may not be the ones they were before.');
      return answer(item, { picture, intro: [`${done} of ${args.edits.length} edits made:`, ...report, ...notes].join('\n') });
    },
  });

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
        lines.push(`- ${item.id}: seed ${d.seed}, ${d.rooms.length} rooms, ${d.width}×${d.height} squares${store.isEdited(item) ? ', edited' : ''}${item.file ? `, from/saved as ${item.file}` : ', not saved'}`);
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
function applyEdit(d, edit, shift) {
  const dm = load();
  const label = (roomId) => d.rooms[roomId].label;
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
      const x = needInt(edit.x, 'x');
      const y = needInt(edit.y, 'y');
      const res = dm.deleteHallStretch(d, x + shift.x, y + shift.y);
      if (!res.ok) throw new ToolError(`there is no hallway at (${x},${y}).`);
      shift.x += res.dx;
      shift.y += res.dy;
      return `deleted the stretch of hallway at (${x},${y}): ${res.removed.length} squares, with the doors on them.`;
    }
    default:
      throw new ToolError(`"type" must be one of: door, draw_hallway, delete_hallway.`);
  }
}

module.exports = { createTools, APP_DEFAULTS, SETTINGS, applyEdit, findOpening };
