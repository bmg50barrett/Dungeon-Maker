/*
 * Tests for the MCP server in mcp/ (Claude's way into the dungeon maker). Run with:  node tests/mcp.js
 *
 * Needs the mcp folder's packages (for the canvas library that draws the picture): run  npm install
 * in the mcp folder first. The main suite, node tests/run.js, does not need them.
 *
 * Three layers, each tested on its own:
 *   - the tools      what each does with what Claude sends, and what it answers
 *   - the protocol   the JSON-RPC messages, as a function
 *   - the process    node mcp/server.js itself, over stdin and stdout
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

try {
  require(path.join(ROOT, 'mcp', 'node_modules', '@napi-rs', 'canvas'));
} catch (err) {
  console.log('The mcp folder needs its packages first: run  npm install  in the mcp folder, then try again.');
  process.exit(1);
}

const { createTools, APP_DEFAULTS, SETTINGS, applyEdit } = require('../mcp/lib/tools.js');
const { Store, whatIsWrong, safeName } = require('../mcp/lib/store.js');
const { createServer, SUPPORTED } = require('../mcp/server.js');
const { renderPng } = require('../mcp/lib/dm.js');
const { ToolError } = require('../mcp/lib/errors.js');
const DM = require('../mcp/lib/dm.js').load();
const { DX, DY, OPP } = DM.DIRS;

let failures = 0;
function fail(ctx, msg) {
  failures++;
  if (failures <= 25) console.log(`  FAIL [${ctx}] ${msg}`);
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const isPng = (b) => Buffer.isBuffer(b) && b.length > 100 && b.subarray(0, 8).equals(PNG_SIGNATURE);
const pngSize = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });

/** Run fn and return the ToolError it throws (or null if it does not throw one). */
function toolError(fn) {
  try {
    fn();
  } catch (err) {
    if (err instanceof ToolError) return err;
    throw err;
  }
  return null;
}

function freshTools() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-mcp-test-'));
  const store = new Store({ dir });
  const tools = Object.fromEntries(createTools({ store }).map((t) => [t.name, t]));
  return { dir, store, tools, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** Two 3 x 3 rooms with `gap` empty squares between them, and an entrance in the west wall of the first. */
function fixture(gap = 3, hallDoors = 'all') {
  const sq = (x0, y0, w, h) => {
    const c = [];
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) c.push([x, y]);
    return c;
  };
  const room = (id, x, y, w, h) => ({ id, label: id + 1, kind: 'rect', area: w * h, bbox: { x, y, w, h }, labelCell: [x + 1, y + 1], cells: sq(x, y, w, h) });
  return {
    version: 1,
    cellSizeFt: 5,
    seed: 'fixture',
    params: { hallDoors },
    width: 6 + gap,
    height: 3,
    rooms: [room(0, 0, 0, 3, 3), room(1, 3 + gap, 0, 3, 3)],
    halls: [],
    connections: [],
    entrances: [{ id: 0, label: 'E1', kind: 'door', room: 0, x: 0, y: 1, d: 3 }],
    stats: { rooms: 2, hallConnections: 0, doorConnections: 0, floorCells: 18 },
    warnings: [],
  };
}

const noId = (text) => text.replace(/^Dungeon d\d+/, 'Dungeon dN');

// ---------------------------------------------------------------------------------------------------
console.log('== defaults: the same as the page');
{
  const html = read('index.html');
  const num = (id) => {
    const m = new RegExp(`id="${id}"[^>]*\\svalue="(\\d+)"`).exec(html);
    return m ? Number(m[1]) : undefined;
  };
  for (const id of ['roomCount', 'avgRoomSize', 'minRoomWidth', 'minRoomLength', 'sizeVariance', 'connectionRandomness', 'entrances']) {
    if (num(id) !== APP_DEFAULTS[id]) fail('defaults', `${id} is ${APP_DEFAULTS[id]} here but ${num(id)} on the page`);
  }
  for (const name of ['spacing', 'connectionType', 'hallDoors']) {
    const m = new RegExp(`name="${name}" value="(\\w+)" checked`).exec(html);
    if (!m || m[1] !== APP_DEFAULTS[name]) fail('defaults', `${name} is ${APP_DEFAULTS[name]} here but ${m && m[1]} on the page`);
  }
  for (const [name, key] of [['roomShape', 'roomShapes'], ['hallType', 'hallTypes']]) {
    const on = [...html.matchAll(new RegExp(`name="${name}" value="(\\w+)" checked`, 'g'))].map((m) => m[1]).sort();
    if (on.join() !== [...APP_DEFAULTS[key]].sort().join()) fail('defaults', `${key} are [${APP_DEFAULTS[key]}] here but [${on}] on the page`);
  }
  if (!/id="edgeEntrancesOnly"[^>]*checked/.test(html) || APP_DEFAULTS.edgeEntrancesOnly !== true) fail('defaults', 'entrances on the outer edge only should start on, as on the page');
  const settings = Object.keys(SETTINGS).sort().join();
  if (settings !== [...Object.keys(APP_DEFAULTS), 'seed'].sort().join()) fail('defaults', `the settings Claude can give are [${settings}]`);
  // a call with only a seed makes the dungeon the page makes with its starting values
  const { tools, done } = freshTools();
  const viaTool = tools.generate_dungeon.run({ seed: 'same-as-page', picture: false });
  const direct = DM.generateDungeon({ ...APP_DEFAULTS, seed: 'same-as-page' });
  const summary = (d) => `${d.width}x${d.height} ${d.rooms.length} rooms ${d.halls.length} halls ${JSON.stringify(d.rooms.map((r) => r.cells))}`;
  const second = freshTools();
  second.tools.generate_dungeon.run({ seed: 'same-as-page', picture: false });
  if (summary(second.store.get('d1').dungeon) !== summary(direct)) fail('defaults', 'the tool does not make the dungeon the generator makes with the page settings');
  if (!viaTool.text.includes('seed same-as-page')) fail('defaults', 'the answer does not say the seed');
  done();
  second.done();
  console.log('  done');
}

// ---------------------------------------------------------------------------------------------------
console.log('== generate and describe');
{
  const { tools, store, done } = freshTools();
  const out = tools.generate_dungeon.run({ seed: 't1', roomCount: 9, entrances: 2 });
  if (!isPng(out.png)) fail('generate', 'no picture came with the dungeon');
  if (tools.generate_dungeon.run({ seed: 't1', picture: false }).png !== undefined) fail('generate', 'picture:false still made a picture');
  const d = store.get('d1').dungeon;
  const text = out.text;

  // every room once, by the number on the map; every door with its reference; every hallway and entrance
  const roomLines = text.match(/^Room \d+:/gm) || [];
  if (roomLines.length !== d.rooms.length) fail('describe', `${roomLines.length} room lines for ${d.rooms.length} rooms`);
  for (const r of d.rooms) {
    const line = text.split('\n').find((l) => l.startsWith(`Room ${r.label}:`));
    if (!line) {
      fail('describe', `no line for room ${r.label}`);
      continue;
    }
    if (!line.includes(`${r.bbox.w * 5}×${r.bbox.h * 5} ft overall (${r.bbox.w}×${r.bbox.h} squares)`) || !line.includes(`${r.area} squares of floor (${r.area * 25} sq ft)`)) fail('describe', `room ${r.label}'s size is wrong: ${line}`);
  }
  // every door is listed with its reference; one between two rooms is listed from both, each on its own wall
  const SIDE = ['north', 'east', 'south', 'west'];
  const checkDoors = (dungeon, words, ctx) => {
    let between = 0;
    for (const c of dungeon.connections) {
      for (const o of c.openings) {
        const where = `[(${o.x},${o.y}) ${SIDE[o.d]}]`;
        if (!words.includes(where)) fail(ctx, `the door ${where} is not in the description`);
        if (c.type !== 'door') continue;
        between++;
        const other = c.rooms.find((id) => id !== o.room);
        const mine = dungeon.rooms[o.room].label;
        const theirs = dungeon.rooms[other].label;
        const lineOf = (n) => words.slice(words.indexOf(`Room ${n}:`)).split('\nRoom ')[0];
        const hasLine = (n, wall, to) => new RegExp(`^  - ${wall} wall: [^\\n]*to room ${to}  ${where.replace(/[()[\]]/g, '\\$&')}$`, 'm').test(lineOf(n));
        if (!hasLine(mine, SIDE[o.d], theirs)) fail(ctx, `room ${mine} does not list its ${SIDE[o.d]} door to room ${theirs}`);
        if (!hasLine(theirs, SIDE[OPP[o.d]], mine)) fail(ctx, `room ${theirs} does not list its ${SIDE[OPP[o.d]]} door to room ${mine}`);
      }
    }
    return between;
  };
  const labelsDiffer = d.rooms.some((r) => r.label !== r.id + 1);
  checkDoors(d, text, 'describe');
  for (const h of d.halls) if (!new RegExp(`^H${h.id + 1}: ${h.cells.length} squares`, 'm').test(text)) fail('describe', `hallway H${h.id + 1} is not described`);
  for (const e of d.entrances) if (!text.includes(`${e.label}:`)) fail('describe', `entrance ${e.label} is missing`);
  if (!/ENTRANCES/.test(text) || !/ROOMS/.test(text) || !/HALLWAYS/.test(text)) fail('describe', 'a section is missing');

  // with doorways instead of hallways there are no hallways to describe
  const doors = tools.generate_dungeon.run({ seed: 'dd', connectionType: 'door', connectionRandomness: 0, picture: false });
  if (!/rooms open straight into each other/.test(doors.text)) fail('describe', 'a dungeon with no hallways should say so');
  if (checkDoors(store.get(/^Dungeon (d\d+)/.exec(doors.text)[1]).dungeon, doors.text, 'describe doors') < 5) fail('describe', 'a dungeon of doorways should have doors between rooms to check');

  // stairs, when entrances may be inside
  let stairs = null;
  for (let i = 0; i < 60 && !stairs; i++) {
    const t = tools.generate_dungeon.run({ seed: `st${i}`, edgeEntrancesOnly: false, entrances: 6, picture: false }).text;
    if (/stairs inside room/.test(t)) stairs = t;
  }
  if (!stairs || !/climbing toward its \w+ wall/.test(stairs)) fail('describe', 'stairs entrances are not described');

  // the same settings give the same words and picture, on another server
  const other = freshTools();
  const again = other.tools.generate_dungeon.run({ seed: 't1', roomCount: 9, entrances: 2 });
  if (noId(again.text) !== noId(text) || !again.png.equals(out.png)) fail('generate', 'the same settings did not give the same answer');
  other.done();

  // what Claude gets told when it asks for something that does not work
  const bad = (args) => toolError(() => tools.generate_dungeon.run(args));
  if (!bad({ roomCount: 500 }) || !/Room count/.test(bad({ roomCount: 500 }).message)) fail('generate', 'a room count of 500 was accepted');
  if (!bad({ rooms: 5 }) || !/has no "rooms"/.test(bad({ rooms: 5 }).message) || !/roomCount/.test(bad({ rooms: 5 }).message)) fail('generate', 'a made-up setting should be named, with the real ones listed');
  if (!bad({ roomShapes: ['star'] })) fail('generate', 'a shape that does not exist was accepted');
  if (!bad({ hallTypes: ['curly', 'banana'] })) fail('generate', 'a hallway type that does not exist was accepted');
  if (!bad({ picture: 'yes' })) fail('generate', '"yes" was accepted for picture');
  if (!bad({ hallDoors: 'some' })) fail('generate', 'a made-up hallDoors was accepted');
  if (!bad({ hallWidth: 11 }) || !bad({ hallWidth: 0 })) fail('generate', 'a hallway width outside 1 to 10 was accepted');
  {
    // a hallway width is passed on to the generator: the same seed comes out differently for it
    const plain = tools.generate_dungeon.run({ roomCount: 8, seed: 'wide-mcp', picture: false }).text;
    const wide = tools.generate_dungeon.run({ roomCount: 8, hallWidth: 3, seed: 'wide-mcp', picture: false }).text;
    if (plain === wide) fail('generate', 'hallWidth 3 made no difference to the dungeon');
  }
  if (labelsDiffer === false) {
    // not an error: some dungeons number rooms as they are stored. The check above used labels either way.
  }
  done();
  console.log('  done');
}

// ---------------------------------------------------------------------------------------------------
console.log('== levels');
{
  const { tools, store, dir, done } = freshTools();
  const out = tools.generate_dungeon.run({ seed: 'lv', roomCount: 8, levels: 3, levelStairs: 2, picture: false });
  const d = store.get('d1').dungeon;
  if (DM.levelCount(d) !== 3 || d.stairs.length === 0) fail('levels', 'generate_dungeon with levels: 3 did not make a dungeon of three levels with stairs');
  if (!/3 levels of 8 rooms each/.test(out.text) || !/STAIRS/.test(out.text)) fail('levels', 'the description does not say it has three levels and list the stairs');
  for (let n = 1; n <= 3; n++) if (!out.text.includes(`==== LEVEL ${n} of 3 ====`)) fail('levels', `no section for level ${n}`);
  for (const r of DM.allRooms(d)) if (!out.text.includes(`Room ${r.level}-${r.label}:`)) fail('levels', `no line for room ${r.level}-${r.label}`);
  for (const s of d.stairs) if (!out.text.includes(`${s.letter}: at (${s.x},${s.y})`)) fail('levels', `stair ${s.letter} is not listed`);

  // the picture: every level one above the other, or one level on its own
  const all = tools.draw_map.run({}).png;
  const one = tools.draw_map.run({ level: 2 }).png;
  if (!isPng(all) || !isPng(one)) fail('levels', 'draw_map did not make PNG files for a dungeon of several levels');
  if (pngSize(all).h <= pngSize(one).h) fail('levels', 'the picture of all three levels should be taller than that of one');
  if (one.equals(tools.draw_map.run({ level: 1 }).png)) fail('levels', 'levels 1 and 2 are drawn the same');
  for (const [args, re] of [[{ level: 4 }, /no level 4/], [{ level: 0 }, /1 and 20|whole number|at least|from 1/i]]) {
    const err = toolError(() => tools.draw_map.run(args));
    if (!err || !re.test(err.message)) fail('levels', `draw_map ${JSON.stringify(args)} should fail mentioning ${re}: ${err && err.message}`);
  }
  // one level asked for in a dungeon of one level is also an error, and the setting is checked on generate
  tools.generate_dungeon.run({ seed: 'flat', picture: false });
  if (!toolError(() => tools.draw_map.run({ id: 'd2', level: 2 }))) fail('levels', 'level 2 of a dungeon of one level was drawn');
  const bad = (a) => toolError(() => tools.generate_dungeon.run({ picture: false, ...a }));
  if (!bad({ levels: 0 }) || !bad({ levels: 21 }) || !bad({ levelStairs: 0 }) || !bad({ levelStairs: 11 }) || !bad({ levels: 2.5 })) fail('levels', 'levels outside 1 to 20 or stairs outside 1 to 10 were accepted');

  // edits are made one level at a time
  {
    const fails = (args, re, what) => {
      const err = toolError(() => tools.edit_dungeon.run({ id: 'd1', picture: false, ...args }));
      if (!err || !re.test(err.message)) fail('levels', `${what}: ${err && err.message}`);
    };
    const level2 = DM.floorView(d, 2);
    const level3 = DM.floorView(d, 3);
    fails({ edits: [{ type: 'name_room', room: 1, name: 'Hall' }] }, /3 levels: say which/, 'an edit with no level on a dungeon of three levels');
    fails({ edits: [{ type: 'name_room', room: 1, name: 'Hall', level: 4 }] }, /no level 4/, 'an edit of level 4');
    fails({ level: 0, edits: [{ type: 'name_room', room: 1, name: 'Hall' }] }, /whole number/, 'level 0');
    fails({ edits: [{ type: 'add_entrance', level: 2, x: 0, y: 0, side: 'N' }] }, /level 1/, 'an entrance on level 2');

    // a name on level 2 and another on level 3 (a level for the whole call, and one of its own), the same number on both
    const named = tools.edit_dungeon.run({ id: 'd1', level: 2, edits: [{ type: 'name_room', room: 1, name: 'Cistern' }, { type: 'name_room', level: 3, room: 1, name: 'Crypt' }], picture: false });
    if (level2.rooms.find((r) => r.label === 1).name !== 'Cistern' || level3.rooms.find((r) => r.label === 1).name !== 'Crypt') fail('levels', 'the names went to the wrong rooms');
    if (DM.floorView(d, 1).rooms.some((r) => r.name)) fail('levels', 'a name went to level 1');
    if (!/room 2-1 is now named "Cistern"/.test(named.text) || !/room 3-1 is now named "Crypt"/.test(named.text)) fail('levels', `the answer does not say which rooms: ${named.text}`);
    if (!/Room 2-1 \(Cistern\)/.test(named.text)) fail('levels', 'the description does not show the name beside the room');
    if (!store.isEdited(store.get('d1'))) fail('levels', 'a dungeon with a room named on level 2 is not counted as edited');

    // a door on level 2, by its square and side as the description gives them
    const opening = level2.connections.flatMap((c) => c.openings)[0];
    const door = tools.edit_dungeon.run({ id: 'd1', level: 2, edits: [{ type: 'door', x: opening.x, y: opening.y, side: 'NESW'[opening.d], state: 'secret' }], picture: false });
    if (opening.style !== 'secret' || !/became secret door|already a secret door/.test(door.text)) fail('levels', `a door on level 2: ${door.text}`);

    // a hallway drawn out past the top left of level 3: the whole map grows, and every level and every stair moves with it
    const before = JSON.stringify([d, ...d.floors].map((f) => f.rooms.map((r) => r.cells[0])));
    const stairsBefore = d.stairs.map((s) => [s.x, s.y]);
    const from = level3.rooms[0].cells[0];
    const drawn = tools.edit_dungeon.run({ id: 'd1', level: 3, edits: [{ type: 'draw_hallway', points: [from, [-4, from[1]]] }], picture: false });
    const m = /every square has moved by \(\+(\d+),\+0\)/.exec(drawn.text);
    if (!m) fail('levels', `a hallway past the left edge: ${drawn.text}`);
    else {
      const dx = Number(m[1]);
      const want = JSON.stringify(JSON.parse(before).map((lv) => lv.map(([x, y]) => [x + dx, y])));
      if (JSON.stringify([d, ...d.floors].map((f) => f.rooms.map((r) => r.cells[0]))) !== want) fail('levels', 'the levels did not all move with the map');
      if (d.stairs.some((s, i) => s.x !== stairsBefore[i][0] + dx)) fail('levels', 'the stairs did not move with the map');
      for (const s of d.stairs) {
        for (const [lv, room] of [[s.upper, s.upperRoom], [s.lower, s.lowerRoom]]) if (!DM.floorView(d, lv).rooms[room].cells.some(([x, y]) => x === s.x && y === s.y)) fail('levels', `stair ${s.letter} is no longer on a room square of level ${lv}`);
      }
    }
    if (!/==== LEVEL 3 of 3 ====/.test(drawn.text) || !/Hallways are numbered again/.test(drawn.text)) fail('levels', 'the answer after a hallway on level 3 is not the new description');

    // deleting that hallway by its number, on its own level
    const h = DM.floorView(d, 3).halls.length;
    const gone = tools.edit_dungeon.run({ id: 'd1', level: 3, edits: [{ type: 'delete_hallway', hall: h }], picture: false });
    if (DM.floorView(d, 3).halls.length !== h - 1 || !/deleted hallway/.test(gone.text)) fail('levels', `deleting a hallway on level 3: ${gone.text}`);


    // stairs: add one, move it, remove it; the last of a pair stays
    {
      const dm2 = DM;
      const free = (upper) => {
        for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) if (dm2.stairProblem(d, upper, x, y).ok) return [x, y];
        return null;
      };
      const count = d.stairs.length;
      const at = free(1);
      if (!at) fail('levels', 'no square for a new stair');
      else {
        const added = tools.edit_dungeon.run({ id: 'd1', edits: [{ type: 'add_stair', level: 1, x: at[0], y: at[1] }], picture: false });
        const stair = d.stairs.find((s) => s.x === at[0] && s.y === at[1] && s.upper === 1);
        if (!stair || d.stairs.length !== count + 1 || !/added stairs [A-Z]+ at/.test(added.text)) fail('levels', `add_stair: ${added.text}`);
        if (stair && !new RegExp(`${stair.letter}: at \\(${at[0]},${at[1]}\\)`).test(added.text)) fail('levels', 'the description does not list the new stair');
        const to = (() => {
          for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) if ((x !== at[0] || y !== at[1]) && dm2.stairProblem(d, 1, x, y, stair).ok) return [x, y];
          return null;
        })();
        if (stair && to) {
          const moved = tools.edit_dungeon.run({ id: 'd1', edits: [{ type: 'move_stair', stair: stair.letter.toLowerCase(), x: to[0], y: to[1] }], picture: false });
          if (stair.x !== to[0] || stair.y !== to[1] || !/are now at/.test(moved.text)) fail('levels', `move_stair: ${moved.text}`);
        }
        if (stair) {
          const gone = tools.edit_dungeon.run({ id: 'd1', edits: [{ type: 'remove_stair', stair: stair.letter }], picture: false });
          if (d.stairs.length !== count || d.stairs.some((s) => s.letter === stair.letter) || !/removed stairs/.test(gone.text)) fail('levels', `remove_stair: ${gone.text}`);
        }
        // the only stair of a pair cannot be removed; a bad square and a bad letter are said so
        const only = d.stairs.find((s) => d.stairs.filter((o) => o.upper === s.upper).length === 1);
        const lone = only ? toolError(() => tools.edit_dungeon.run({ id: 'd1', edits: [{ type: 'remove_stair', stair: only.letter }], picture: false })) : null;
        if (only && (!lone || !/only stairs/.test(lone.message))) fail('levels', `removing the only stair: ${lone && lone.message}`);
        for (const [edit, re] of [[{ type: 'add_stair', level: 1, x: -3, y: -3 }, /not a room square/], [{ type: 'remove_stair', stair: 'QQQ' }, /no stairs QQQ/], [{ type: 'remove_stair' }, /letter/], [{ type: 'add_stair', level: 3, x: 0, y: 0 }, /no stairs between level 3/]]) {
          const err = toolError(() => tools.edit_dungeon.run({ id: 'd1', edits: [edit], picture: false }));
          if (!err || !re.test(err.message)) fail('levels', `${JSON.stringify(edit)} should fail mentioning ${re}: ${err && err.message}`);
        }
      }
    }

    // a hallway cannot be given a door into the square of a stair: plan one beside the stair
    const stair = d.stairs.find((s) => s.upper === 1);
    const f1 = DM.floorView(d, 1);
    const around = [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy]) => [stair.x + dx, stair.y + dy]).filter(([x, y]) => !f1.rooms[stair.upperRoom].cells.some(([cx, cy]) => cx === x && cy === y));
    for (const sq of around) if (DM.planHallway(f1, [sq]).openings.some((o) => o.x === stair.x && o.y === stair.y)) fail('levels', 'a hallway was given a door into a stair square');
  }

  // listed, saved, opened again: the same dungeon with all its levels
  if (!/3 levels of 8 rooms/.test(tools.list_dungeons.run({}).text)) fail('levels', 'list_dungeons does not say how many levels');
  const saved = tools.save_dungeon.run({ name: 'Deep' }).text;
  const jsonFile = /Data: (.*)/.exec(saved)[1];
  const reopened = tools.open_dungeon.run({ path: jsonFile, picture: false });
  if (JSON.stringify(store.get('d3').dungeon) !== JSON.stringify(d)) fail('levels', 'a saved dungeon of several levels did not come back the same');
  if (!/3 levels of 8 rooms each/.test(reopened.text)) fail('levels', 'a reopened dungeon of several levels is described differently');
  // a data file with the levels damaged is refused
  const damaged = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  damaged.floors.pop();
  fs.writeFileSync(path.join(dir, 'damaged.json'), JSON.stringify(damaged));
  if (!toolError(() => tools.open_dungeon.run({ path: 'damaged.json', picture: false }))) fail('levels', 'a dungeon with a floor missing was opened');
  done();
  console.log('  done');
}

// ---------------------------------------------------------------------------------------------------
console.log('== editing doors');
{
  const { tools, store, done } = freshTools();
  tools.generate_dungeon.run({ seed: 'doors', picture: false });
  const item = store.get('d1');
  const d = item.dungeon;
  const o = d.connections.find((c) => c.type === 'hall').openings[0];
  const sideLetter = 'NESW'[o.d];
  const before = renderPng(d);
  const run = (edits, extra = {}) => tools.edit_dungeon.run({ edits, picture: false, ...extra });

  const out = run([{ type: 'door', x: o.x, y: o.y, side: sideLetter, state: 'locked' }]);
  if (o.style !== 'locked' || !/became locked door/.test(out.text) || !/locked door to hallway/.test(out.text)) fail('door', `locking a door: style ${o.style}, answer: ${out.text.split('\n')[0]}`);
  if (!/edited by hand/.test(out.text) || !store.isEdited(item)) fail('door', 'an edited dungeon does not say so');
  if (renderPng(d).equals(before)) fail('door', 'a locked door looks the same in the picture');
  if (!/already a locked door/.test(run([{ type: 'door', x: o.x, y: o.y, side: sideLetter, state: 'locked' }]).text)) fail('door', 'setting the state a door already has should say so');
  run([{ type: 'door', x: o.x, y: o.y, side: sideLetter, state: 'door' }]);
  if (store.isEdited(item)) fail('door', 'a door put back as it was still counts as an edit');
  // the words for the side work too, and so does naming the square on the other side of the edge
  run([{ type: 'door', x: o.x, y: o.y, side: ['north', 'east', 'south', 'west'][o.d], state: 'secret' }]);
  if (o.style !== 'secret') fail('door', 'the side given as a word was not understood');
  run([{ type: 'door', x: o.x + DX[o.d], y: o.y + DY[o.d], side: 'NESW'[OPP[o.d]], state: 'open' }]);
  if (o.style !== 'open') fail('door', 'a door could not be named from the other side of its edge');

  // a failed edit among good ones is reported and does not stop the rest; all failing is an error
  const mixed = run([{ type: 'door', x: 999, y: 999, side: 'N', state: 'door' }, { type: 'door', x: o.x, y: o.y, side: sideLetter, state: 'locked' }]);
  if (!/1 of 2 edits made/.test(mixed.text) || !/1\. FAILED/.test(mixed.text) || o.style !== 'locked') fail('door', 'one bad edit among two should be reported and the other made');
  const allBad = toolError(() => run([{ type: 'door', x: 999, y: 999, side: 'N', state: 'door' }]));
  if (!allBad || !/None of the edits/.test(allBad.message)) fail('door', 'edits that all fail should be an error');
  const entrance = d.entrances.find((e) => e.kind === 'door');
  const refused = toolError(() => run([{ type: 'door', x: entrance.x, y: entrance.y, side: 'NESW'[entrance.d], state: 'locked' }]));
  if (!refused || !/entrance/.test(refused.message)) fail('door', 'an entrance door was not refused as one');
  for (const [edit, re] of [
    [{ type: 'door', x: o.x, y: o.y, side: 'up', state: 'door' }, /side/],
    [{ type: 'door', x: o.x, y: o.y, side: sideLetter, state: 'broken' }, /state/],
    [{ type: 'door', x: 'a', y: o.y, side: sideLetter, state: 'door' }, /"x"/],
    [{ type: 'paint' }, /type/],
    ['door', /object/],
  ]) {
    const err = toolError(() => run([edit]));
    if (!err || !re.test(err.message)) fail('door', `${JSON.stringify(edit)} should fail mentioning ${re}: ${err && err.message}`);
  }
  if (!toolError(() => run([]))) fail('door', 'an empty list of edits was accepted');
  if (!toolError(() => run(new Array(51).fill({ type: 'door', x: o.x, y: o.y, side: sideLetter, state: 'door' })))) fail('door', '51 edits were accepted');
  if (!toolError(() => tools.edit_dungeon.run({ edits: [{ type: 'door', x: o.x, y: o.y, side: sideLetter, state: 'door' }], id: 'd77' }))) fail('door', 'an unknown dungeon id was accepted');

  // a dungeon whose rooms open straight into each other: a door can be named from either room
  const direct = freshTools();
  direct.tools.generate_dungeon.run({ seed: 'direct', connectionType: 'door', connectionRandomness: 0, picture: false });
  const dd = direct.store.get('d1').dungeon;
  const link = dd.connections[0].openings[0];
  direct.tools.edit_dungeon.run({ edits: [{ type: 'door', x: link.x + DX[link.d], y: link.y + DY[link.d], side: 'NESW'[OPP[link.d]], state: 'secret' }], picture: false });
  if (link.style !== 'secret') fail('door', 'a door between two rooms could not be named from the second room');
  direct.done();
  done();
  console.log('  done');
}

// ---------------------------------------------------------------------------------------------------
console.log('== editing hallways');
{
  const { tools, store, done } = freshTools();
  const item = store.add(fixture());
  const d = item.dungeon;
  const run = (edits) => tools.edit_dungeon.run({ id: item.id, edits, picture: false }); // by id: other dungeons are made below
  const pristine = DM.editState(d);

  // a hallway across the gap opens into both rooms, by the Hallway doors setting
  const drawn = run([{ type: 'draw_hallway', points: [[3, 1], [5, 1]] }]);
  if (!/3 new squares/.test(drawn.text) || !/door into room 1's east wall/.test(drawn.text) || !/door into room 2's west wall/.test(drawn.text)) fail('hall', `drawing across the gap: ${drawn.text.split('\n').slice(0, 3).join(' | ')}`);
  if (d.halls.length !== 1 || d.connections[0].openings.length !== 2) fail('hall', 'a hallway between the rooms should be one hallway with two openings');
  if (!/H1: 3 squares.*joins rooms 1 and 2/.test(drawn.text)) fail('hall', 'the new hallway is not described');
  if (!/Hallways are numbered again/.test(drawn.text)) fail('hall', 'a hallway edit should warn that hallways are renumbered');
  const none = freshTools();
  none.tools.edit_dungeon.run({ id: none.store.add(fixture(3, 'none')).id, edits: [{ type: 'draw_hallway', points: [[3, 1], [5, 1]] }], picture: false });
  if (!none.store.get('d1').dungeon.connections[0].openings.every((o) => o.style === 'open')) fail('hall', 'with Hallway doors on none, new openings should be archways');
  none.done();

  // waypoints are filled in between: an L-shaped hallway from the first room's north side
  const ell = store.add(fixture());
  const lOut = tools.edit_dungeon.run({ id: ell.id, edits: [{ type: 'draw_hallway', points: [[1, -1], [1, -3], [4, -3]] }], picture: false });
  if (!/6 new squares/.test(lOut.text) || ell.dungeon.halls.length !== 1 || ell.dungeon.halls[0].cells.length !== 6) fail('hall', `an L of waypoints should be 6 squares: ${lOut.text.split('\n')[1]}`);
  if (!/opened door into room 1's north wall/.test(lOut.text)) fail('hall', `a hallway starting at a wall did not open it: ${lOut.text.split('\n')[1]}`);
  if (!/moved by \(\+0,\+3\)/.test(lOut.text)) fail('hall', 'a hallway three squares past the top should move the map by 3');

  // growing past the top: coordinates in one call are read against the map as it was
  const doorAt = d.connections[0].openings[0]; // room 1's east door, now at (2,1) facing east
  const grow = run([
    { type: 'draw_hallway', points: [[4, 1], [4, -2]] },
    { type: 'door', x: doorAt.x, y: doorAt.y, side: 'E', state: 'locked' },
  ]);
  if (!/moved by \(\+0,\+2\)/.test(grow.text)) fail('hall', `growing past the top should say how far squares moved: ${grow.text.split('\n').slice(0, 4).join(' | ')}`);
  if (!/2 of 2 edits made/.test(grow.text)) fail('hall', `a door edit after growth, in the old coordinates, failed: ${grow.text.split('\n').slice(0, 3).join(' | ')}`);
  const nowAt = d.connections.flatMap((c) => c.openings).find((o) => o.style === 'locked');
  if (!nowAt || nowAt.y !== 3 || d.height !== 5) fail('hall', 'the door in the old coordinates was not found where the map moved it');
  // in the next call the coordinates are the new ones, and deleting the branch shrinks the map back
  const gone = run([{ type: 'delete_hallway', x: 4, y: 1 }]);
  if (!/deleted the stretch/.test(gone.text) || !/moved by \(\+0,-2\)/.test(gone.text) || d.height !== 3) fail('hall', `deleting the branch: ${gone.text.split('\n').slice(0, 3).join(' | ')} (height ${d.height})`);
  // delete the rest: back to the start, so not an edit any more
  run([{ type: 'door', x: 2, y: 1, side: 'E', state: 'door' }]);
  run([{ type: 'delete_hallway', x: 4, y: 1 }]);
  if (DM.editState(d) !== pristine || store.isEdited(item)) fail('hall', 'drawing and deleting everything should leave the dungeon as it was');

  // deleting whole hallways by their H numbers, read against the map before the call
  run([{ type: 'draw_hallway', points: [[3, 1], [5, 1]] }]);
  run([{ type: 'draw_hallway', points: [[1, 3], [1, 5]] }]);
  if (d.halls.length !== 2 || d.height !== 6) fail('hall', 'two hallways expected before deleting by number');
  const both = run([{ type: 'delete_hallway', hall: 1 }, { type: 'delete_hallway', hall: 2 }]);
  if (!/2 of 2 edits made/.test(both.text) || !/deleted hallway H1: 3 squares/.test(both.text) || !/deleted hallway H2: 3 squares/.test(both.text)) fail('hall', `deleting by number: ${both.text.split('\n').slice(0, 4).join(' | ')}`);
  if (d.halls.length !== 0 || DM.editState(d) !== pristine) fail('hall', 'deleting both hallways by number should restore the dungeon');
  for (const [edit, re] of [[{ type: 'delete_hallway', hall: 1 }, /no hallway H1/], [{ type: 'delete_hallway', hall: 'x' }, /"hall"/]]) {
    const err = toolError(() => run([edit]));
    if (!err || !re.test(err.message)) fail('hall', `${JSON.stringify(edit)} should fail mentioning ${re}: ${err && err.message}`);
  }
  run([{ type: 'draw_hallway', points: [[3, 1], [5, 1]] }]);
  const again = run([{ type: 'delete_hallway', hall: 1 }, { type: 'delete_hallway', hall: 1 }]);
  if (!/1 of 2 edits made/.test(again.text) || !/already gone/.test(again.text)) fail('hall', `deleting the same hallway twice: ${again.text.split('\n').slice(0, 3).join(' | ')}`);

  // entrances: add a door or stairs, remove one, numbers E1.. stay in order
  const added = run([{ type: 'add_entrance', x: 1, y: 0, side: 'N' }]);
  if (!/added E2: a door in the north wall of room 1 at \(1,0\)/.test(added.text) || d.entrances.length !== 2 || d.stats.entrances !== 2) fail('entrance', `adding a door: ${added.text.split('\n').slice(0, 2).join(' | ')}`);
  if (!store.isEdited(item)) fail('entrance', 'adding an entrance should count as an edit');
  const stairs = run([{ type: 'add_entrance', x: 7, y: 1, side: 'E', kind: 'stairs' }]);
  if (!/added E3: stairs in room 2/.test(stairs.text) || d.stats.stairsEntrances !== 1) fail('entrance', `adding stairs: ${stairs.text.split('\n').slice(0, 2).join(' | ')}`);
  const gone2 = run([{ type: 'remove_entrance', entrance: 3 }, { type: 'remove_entrance', entrance: 2 }]);
  if (!/2 of 2 edits made/.test(gone2.text) || d.entrances.length !== 1 || d.stats.entrances !== 1) fail('entrance', `removing: ${gone2.text.split('\n').slice(0, 3).join(' | ')}`);
  for (const [edit, re, why] of [
    [{ type: 'add_entrance', x: 1, y: 0, side: 'N', kind: 'window' }, /kind/, 'an unknown kind'],
    [{ type: 'add_entrance', x: 0, y: 1, side: 'W' }, /already an entrance/, 'a second entrance on the same edge'],
    [{ type: 'add_entrance', x: 6, y: 1, side: 'W' }, /shut in/, 'a wall facing another room'],
    [{ type: 'add_entrance', x: 4, y: 1, side: 'N' }, /not a room square/, 'a square that is not a room'],
    [{ type: 'remove_entrance', entrance: 5 }, /no such entrance/, 'an entrance that is not there'],
    [{ type: 'remove_entrance', entrance: 1 }, /at least one entrance/, 'the last entrance'],
  ]) {
    const err = toolError(() => run([edit]));
    if (!err || !re.test(err.message)) fail('entrance', `${why} should fail mentioning ${re}: ${err && err.message}`);
  }
  if (DM.editState(d) !== pristine) fail('entrance', 'adding and removing entrances, and the failed edits, should leave the dungeon as it was');
  // a hallway in the way of a wall's line out shuts a door in, so a new door there is refused
  run([{ type: 'draw_hallway', points: [[1, 3], [1, 5]] }]);
  const blocked = toolError(() => run([{ type: 'add_entrance', x: 1, y: 2, side: 'S' }]));
  if (!blocked || !/(not an outer wall|shut in)/.test(blocked.message)) fail('entrance', `a door onto a hallway should be refused: ${blocked && blocked.message}`);
  run([{ type: 'delete_hallway', hall: 1 }]);

  // room names: shown in the description and in a key under the picture, kept when renumbered, cleared by empty text
  const named = tools.edit_dungeon.run({ id: item.id, edits: [{ type: 'name_room', room: 1, name: '  Foyer ' }, { type: 'name_room', room: 2, name: 'Dining   Room' }], picture: true });
  if (!/room 1 is now named "Foyer"/.test(named.text) || !/Room 1 \(Foyer\):/.test(named.text) || !/Room 2 \(Dining Room\):/.test(named.text)) fail('name', `naming rooms: ${named.text.split('\n').slice(0, 3).join(' | ')}`);
  if (!store.isEdited(item)) fail('name', 'naming a room should count as an edit');
  const plain = tools.draw_map.run({ id: item.id, legend: false }).png;
  const keyed = tools.draw_map.run({ id: item.id }).png;
  const unnamed = store.add(fixture());
  if (pngSize(keyed).h <= pngSize(tools.draw_map.run({ id: unnamed.id }).png).h) fail('name', 'named rooms should add a key and make the legend taller');
  if (!isPng(plain)) fail('name', 'no picture');
  run([{ type: 'renumber_room', room: 1, number: 2 }]);
  if (d.rooms[0].name !== 'Foyer' || d.rooms[0].label !== 2) fail('name', 'a room should keep its name when renumbered');
  run([{ type: 'renumber_room', room: 1, number: 2 }]);
  run([{ type: 'name_room', room: 1, name: '' }, { type: 'name_room', room: 2, name: '' }]);
  if (d.rooms.some((r) => r.name !== undefined) || DM.editState(d) !== pristine) fail('name', 'empty names should remove the names');
  for (const [edit, re] of [[{ type: 'name_room', room: 9, name: 'x' }, /no room 9/], [{ type: 'name_room', room: 1 }, /"name"/], [{ type: 'name_room', room: 1, name: 'x'.repeat(61) }, /at most 60/]]) {
    const err = toolError(() => run([edit]));
    if (!err || !re.test(err.message)) fail('name', `${JSON.stringify(edit)} should fail mentioning ${re}: ${err && err.message}`);
  }

  // what cannot be done
  for (const [edit, re, why] of [
    [{ type: 'draw_hallway', points: [[1, 1], [2, 1]] }, /nothing to add/, 'a hallway drawn over a room'],
    [{ type: 'draw_hallway', points: [[-1, 1]] }, /nothing to add/, 'a hallway in front of an entrance door'],
    [{ type: 'draw_hallway', points: [] }, /points/, 'no points'],
    [{ type: 'draw_hallway', points: [[1, 'a']] }, /point 1/, 'a point that is not a pair of numbers'],
    [{ type: 'draw_hallway', points: new Array(201).fill([4, 1]) }, /At most 200/, 'too many points'],
    [{ type: 'draw_hallway', points: [[4, 1], [4, 9000]] }, /5000|1200/, 'a hallway miles long'],
    [{ type: 'delete_hallway', x: 4, y: 1 }, /no hallway/, 'deleting where there is none'],
  ]) {
    const err = toolError(() => run([edit]));
    if (!err || !re.test(err.message)) fail('hall', `${why} should fail mentioning ${re}: ${err && err.message}`);
  }
  if (DM.editState(d) !== pristine) fail('hall', 'edits that failed changed the dungeon');

  // renumbering: two rooms swap numbers, numbers stay 1..N, and it counts as an edit
  const before = d.rooms.map((r) => r.label);
  const swap = run([{ type: 'renumber_room', room: 1, number: 2 }]);
  const after = d.rooms.map((r) => r.label);
  if (!/1 of 1 edits made/.test(swap.text) || after[before.indexOf(1)] !== 2 || after[before.indexOf(2)] !== 1) fail('renumber', `swap: ${swap.text.split('\n').slice(0, 2).join(' | ')}`);
  if (!store.isEdited(item)) fail('renumber', 'renumbering should count as an edit');
  if (!/Room 1:/.test(swap.text)) fail('renumber', 'the description should list the new numbers');
  run([{ type: 'renumber_room', room: 1, number: 2 }]);
  if (DM.editState(d) !== pristine) fail('renumber', 'swapping back should restore the dungeon');
  for (const [edit, re] of [[{ type: 'renumber_room', room: 0, number: 1 }, /from 1 to/], [{ type: 'renumber_room', room: 1, number: 99 }, /from 1 to/], [{ type: 'renumber_room', room: 1 }, /number/]]) {
    const err = toolError(() => run([edit]));
    if (!err || !re.test(err.message)) fail('renumber', `${JSON.stringify(edit)} should fail mentioning ${re}: ${err && err.message}`);
  }
  done();
  console.log('  done');
}

// ---------------------------------------------------------------------------------------------------
console.log('== the picture');
{
  const { tools, store, done } = freshTools();
  tools.generate_dungeon.run({ seed: 'pic', picture: false });
  const draw = (args) => tools.draw_map.run(args).png;
  const full = draw({});
  const bare = draw({ legend: false });
  if (!isPng(full) || !isPng(bare)) fail('picture', 'draw_map did not make PNG files');
  if (pngSize(bare).h >= pngSize(full).h) fail('picture', 'the legend should make the picture taller');
  for (const [name, args] of [['no grid', { showGrid: false }], ['no numbers', { showRoomNumbers: false }], ['coordinates', { showCoordinates: true }], ['outside numbers', { labelPosition: 'outside' }], ['colours', { colors: { rooms: '#ffffff', doors: '#00aa00' } }]]) {
    if (draw(args).equals(full)) fail('picture', `${name} looks the same as the usual picture`);
  }
  if (!draw({}).equals(full)) fail('picture', 'the same picture twice should be the same bytes');
  for (const [args, re] of [[{ colors: { rooms: 'red' } }, /#c0392b/], [{ colors: { floor: '#ffffff' } }, /not a colour/], [{ labelPosition: 'middle' }, /inside/], [{ legend: 'no' }, /true or false/], [{ id: 'd9' }, /no dungeon/], [{ shade: 1 }, /no "shade"/]]) {
    const err = toolError(() => tools.draw_map.run(args));
    if (!err || !re.test(err.message)) fail('picture', `${JSON.stringify(args)} should fail mentioning ${re}: ${err && err.message}`);
  }
  // the page's own export is the same code: a picture made here is what the page would make
  const text = tools.draw_map.run({}).text;
  if (!/Map of dungeon d1 \(seed pic\)/.test(text)) fail('picture', `the words with the picture: ${text}`);
  done();
  console.log('  done');
}

// ---------------------------------------------------------------------------------------------------
console.log('== saving, opening and listing');
{
  const { tools, store, dir, done } = freshTools();
  tools.generate_dungeon.run({ seed: 'keep me', roomCount: 7, picture: false });
  const item = store.get('d1');
  const saved = tools.save_dungeon.run({ name: 'My Crypt' }).text;
  const files = { json: /Data: (.*)/.exec(saved)[1], png: /Picture: (.*)/.exec(saved)[1] };
  if (path.dirname(files.json) !== dir || path.basename(files.json) !== 'My-Crypt.json' || path.basename(files.png) !== 'My-Crypt.png') fail('save', `files: ${files.json} ${files.png}`);
  if (fs.readFileSync(files.json, 'utf8') !== DM.dungeonJson(item.dungeon)) fail('save', 'the data file is not what the page\'s Data (JSON) button writes');
  if (!isPng(fs.readFileSync(files.png))) fail('save', 'the picture file is not a PNG');
  const second = /Data: (.*)/.exec(tools.save_dungeon.run({ name: 'My Crypt' }).text)[1];
  if (path.basename(second) !== 'My-Crypt-2.json') fail('save', `a taken name should get -2, not ${path.basename(second)}`);
  const over = /Data: (.*)/.exec(tools.save_dungeon.run({ name: 'My Crypt', overwrite: true }).text)[1];
  if (path.basename(over) !== 'My-Crypt.json') fail('save', 'overwrite should reuse the name');
  const plain = /Data: (.*)/.exec(tools.save_dungeon.run({}).text)[1];
  if (path.basename(plain) !== 'dungeon-keep-me.json') fail('save', `the usual name is ${path.basename(plain)}`);
  const trick = /Data: (.*)/.exec(tools.save_dungeon.run({ name: '../../evil name' }).text)[1];
  if (path.dirname(trick) !== dir) fail('save', `a name with .. wrote to ${trick}`);
  if (safeName('') !== '' || safeName('CON') === 'CON' || safeName('a/b\\c:d') !== 'a-b-c-d') fail('save', 'safeName');
  if (!toolError(() => tools.save_dungeon.run({ name: 5 })) || !toolError(() => tools.save_dungeon.run({ overwrite: 'yes' }))) fail('save', 'a name that is not text, or overwrite that is not true or false, was accepted');

  // an edited dungeon is saved with -edited in its usual name, and comes back as it was, picture and all
  const doorOpening = item.dungeon.connections.find((c) => c.type === 'hall').openings[0];
  tools.edit_dungeon.run({ edits: [{ type: 'door', x: doorOpening.x, y: doorOpening.y, side: 'NESW'[doorOpening.d], state: 'secret' }], picture: false });
  const editedFile = /Data: (.*)/.exec(tools.save_dungeon.run({}).text)[1];
  if (path.basename(editedFile) !== 'dungeon-keep-me-edited.json') fail('save', `an edited dungeon is named ${path.basename(editedFile)}`);
  const reopened = tools.open_dungeon.run({ path: path.basename(editedFile) });
  const back = store.get('d2');
  if (JSON.stringify(back.dungeon) !== JSON.stringify(item.dungeon)) fail('open', 'a saved dungeon did not come back the same');
  if (noId(reopened.text).replace(', edited by hand in this session', '') !== noId(describeText(item)).replace(', edited by hand in this session', '')) fail('open', 'a reopened dungeon is described differently');
  if (!reopened.png.equals(renderPng(item.dungeon))) fail('open', 'a reopened dungeon is drawn differently');
  if (store.isEdited(back)) fail('open', 'a dungeon just opened should not count as edited');
  if (tools.open_dungeon.run({ path: editedFile, picture: false }).png !== undefined) fail('open', 'picture:false still made a picture');
  tools.edit_dungeon.run({ id: 'd2', edits: [{ type: 'door', x: doorOpening.x, y: doorOpening.y, side: 'NESW'[doorOpening.d], state: 'open' }], picture: false });
  if (!store.isEdited(back) || store.isEdited(item) === false) fail('open', 'edits to the copy and to the original are counted apart');

  // files that are not dungeons
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello');
  fs.writeFileSync(path.join(dir, 'broken.json'), '{ nope');
  fs.writeFileSync(path.join(dir, 'other.json'), JSON.stringify({ rooms: 'many' }));
  for (const [name, re] of [['notes.txt', /\.json/], ['broken.json', /not valid JSON/], ['other.json', /"rooms"|rooms/], ['missing.json', /There is no file/], ['', /Give the path/]]) {
    const err = toolError(() => tools.open_dungeon.run({ path: name }));
    if (!err || !re.test(err.message)) fail('open', `opening "${name}" should fail mentioning ${re}: ${err && err.message}`);
  }
  const good = JSON.parse(fs.readFileSync(editedFile, 'utf8'));
  const damaged = [
    (x) => delete x.halls,
    (x) => (x.width = 0),
    (x) => (x.rooms[1].id = 5),
    (x) => (x.rooms[0].cells = []),
    (x) => (x.connections[0].openings[0].room = 99),
    (x) => (x.connections[0].openings[0].d = 7),
    (x) => (x.connections.find((c) => c.type === 'hall').hall = 99),
    (x) => (x.entrances[0].room = 99),
  ];
  for (const [i, damage] of damaged.entries()) {
    const copy = JSON.parse(JSON.stringify(good));
    damage(copy);
    if (!whatIsWrong(copy)) fail('open', `damage ${i} was not noticed`);
  }
  if (whatIsWrong(good) !== null || whatIsWrong(null) === null || whatIsWrong([]) === null) fail('open', 'whatIsWrong on good and bad input');

  const listed = tools.list_dungeons.run({}).text;
  if (!/IN USE NOW/.test(listed) || !/- d1:/.test(listed) || !/My-Crypt\.json/.test(listed) || !/dungeon-keep-me-edited\.json/.test(listed)) fail('list', `the list: ${listed}`);
  if (!/d2: .*edited/.test(listed)) fail('list', 'an edited dungeon is not marked in the list');
  const empty = freshTools();
  if (!/none yet/.test(empty.tools.list_dungeons.run({}).text) || !/nothing saved yet/.test(empty.tools.list_dungeons.run({}).text)) fail('list', 'an empty list should say so');
  empty.done();
  if (!/no dungeon yet|There is no dungeon yet/i.test(toolError(() => empty.tools.describe_dungeon.run({})).message)) fail('list', 'asking about a dungeon before there is one should say to make one');
  // describe and draw_map with no id use the dungeon last touched
  tools.describe_dungeon.run({ id: 'd1' });
  if (!/^Dungeon d1/.test(tools.describe_dungeon.run({}).text)) fail('list', 'with no id, the dungeon last used should be taken');
  done();
  console.log('  done');

  function describeText(it) {
    return require('../mcp/lib/describe.js').describeDungeon(it.dungeon, { id: it.id, edited: false });
  }
}

// ---------------------------------------------------------------------------------------------------
console.log('== many settings (nothing should throw)');
{
  const { tools, done } = freshTools();
  let seeds = 0;
  let pictures = 0;
  const pick = (list, i) => list[i % list.length];
  for (let i = 0; i < 24; i++) {
    const args = {
      seed: `fuzz-${i}`,
      roomCount: pick([1, 2, 5, 12, 30, 60], i),
      avgRoomSize: pick([4, 12, 30, 80], i + 1),
      sizeVariance: pick([0, 30, 100], i),
      spacing: pick(['compact', 'normal', 'spaced'], i),
      connectionType: pick(['hall', 'door'], i >> 1),
      connectionRandomness: pick([0, 14, 50, 100], i),
      hallDoors: pick(['none', 'less', 'more', 'all'], i),
      roomShapes: pick([['rect'], ['L', 'T', 'plus'], ['rect', 'chamfer', 'U', 'H', 'Z']], i),
      entrances: pick([1, 3, 8], i),
      edgeEntrancesOnly: i % 3 !== 0,
      picture: i % 4 === 0,
    };
    let out;
    try {
      out = tools.generate_dungeon.run(args);
    } catch (err) {
      if (err instanceof ToolError) continue; // a combination the generator turns down, with a reason
      fail('fuzz', `${JSON.stringify(args)} threw ${err.stack}`);
      continue;
    }
    seeds++;
    if (!/^Dungeon d\d+/.test(out.text) || !/ROOMS/.test(out.text)) fail('fuzz', `${JSON.stringify(args)} gave a strange answer`);
    if (args.picture) {
      pictures++;
      if (!isPng(out.png)) fail('fuzz', `${JSON.stringify(args)} gave no picture`);
    }
    const pic = tools.draw_map.run({ labelPosition: i % 2 ? 'outside' : 'inside', showGrid: i % 3 !== 0 });
    if (!isPng(pic.png)) fail('fuzz', `${JSON.stringify(args)} could not be drawn`);
  }
  if (seeds < 18) fail('fuzz', `only ${seeds} of 24 combinations could be made`);
  console.log(`  ${seeds} dungeons made and drawn, ${pictures} pictures with the answer`);
  done();
}

// ---------------------------------------------------------------------------------------------------
console.log('== the protocol');
{
  const { tools, done } = freshTools();
  const server = createServer({ tools: createTools({ store: new Store({ dir: path.join(os.tmpdir(), 'dm-mcp-unused') }) }), log: () => {} });
  const call = (method, params, id = 1) => server.handle({ jsonrpc: '2.0', id, method, params });

  for (const v of SUPPORTED) {
    const r = call('initialize', { protocolVersion: v, capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    if (r.result.protocolVersion !== v) fail('protocol', `a client asking for ${v} should get ${v}, not ${r.result.protocolVersion}`);
  }
  const init = call('initialize', { protocolVersion: '1999-01-01' });
  if (init.result.protocolVersion !== SUPPORTED[0]) fail('protocol', 'an unknown version should be answered with the newest we speak');
  if (!init.result.capabilities.tools || init.result.serverInfo.name !== 'dungeon-maker' || !/numbers printed on the map/.test(init.result.instructions) || init.id !== 1 || init.jsonrpc !== '2.0') fail('protocol', `initialize: ${JSON.stringify(init).slice(0, 200)}`);
  if (server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }) !== null) fail('protocol', 'a notification should get no reply');
  if (JSON.stringify(call('ping').result) !== '{}') fail('protocol', 'ping');

  const list = call('tools/list').result.tools;
  const names = list.map((t) => t.name).sort().join();
  if (names !== 'describe_dungeon,draw_map,edit_dungeon,generate_dungeon,list_dungeons,open_dungeon,save_dungeon') fail('protocol', `the tools are ${names}`);
  for (const t of list) {
    if (!/^[a-z_]+$/.test(t.name) || typeof t.description !== 'string' || t.description.length < 40) fail('protocol', `${t.name} needs a name in snake_case and a real description`);
    const s = t.inputSchema;
    if (s.type !== 'object' || s.additionalProperties !== false || typeof s.properties !== 'object') fail('protocol', `${t.name} has a loose input schema`);
    for (const need of s.required || []) if (!(need in s.properties)) fail('protocol', `${t.name} requires ${need}, which it does not have`);
    const walk = (schema, where) => {
      if (!schema.type && !schema.enum) fail('protocol', `${t.name} ${where} has neither a type nor choices`);
      if (schema.type === 'integer' && schema.minimum !== undefined && schema.minimum > schema.maximum) fail('protocol', `${t.name} ${where} has a bad range`);
      if (schema.properties) for (const [k, v] of Object.entries(schema.properties)) walk(v, `${where}.${k}`);
      if (schema.items) walk(schema.items, `${where}[]`);
    };
    for (const [k, v] of Object.entries(s.properties)) walk(v, k);
    if (!t.annotations || typeof t.annotations.title !== 'string' || typeof t.annotations.readOnlyHint !== 'boolean') fail('protocol', `${t.name} has no annotations`);
  }
  const hint = (n) => list.find((t) => t.name === n).annotations.readOnlyHint;
  if (hint('edit_dungeon') || hint('save_dungeon') || !hint('describe_dungeon') || !hint('draw_map') || !hint('list_dungeons')) fail('protocol', 'the read-only hints are wrong: saving and editing change things, the rest do not');

  const gen = call('tools/call', { name: 'generate_dungeon', arguments: { seed: 'p1', roomCount: 4 } }).result;
  if (gen.isError || gen.content.length !== 2 || gen.content[0].type !== 'text' || gen.content[1].type !== 'image' || gen.content[1].mimeType !== 'image/png' || !isPng(Buffer.from(gen.content[1].data, 'base64'))) fail('protocol', 'a dungeon should come back as text then a PNG image');
  const noPic = call('tools/call', { name: 'generate_dungeon', arguments: { seed: 'p2', picture: false } }).result;
  if (noPic.content.length !== 1) fail('protocol', 'with picture:false only text should come back');
  const bad = call('tools/call', { name: 'generate_dungeon', arguments: { roomCount: 0 } }).result;
  if (!bad.isError || bad.content[0].type !== 'text' || !/Room count/.test(bad.content[0].text)) fail('protocol', 'a bad setting should be a tool error that says why');
  const noArgs = call('tools/call', { name: 'list_dungeons' }).result;
  if (noArgs.isError || !/IN USE NOW/.test(noArgs.content[0].text)) fail('protocol', 'a call with no arguments at all should work for a tool that takes none');
  if (!call('tools/call', { name: 'list_dungeons', arguments: [1] }).result.isError || !call('tools/call', { name: 'list_dungeons', arguments: 'x' }).result.isError) fail('protocol', 'arguments that are not an object should be an error');
  if (call('tools/call', { name: 'no_such_tool', arguments: {} }).error.code !== -32602) fail('protocol', 'an unknown tool should be -32602');
  if (call('tools/call').error.code !== -32602) fail('protocol', 'a call without params should be -32602');
  if (call('resources/list').error.code !== -32601) fail('protocol', 'a method we do not have should be -32601');
  if (server.handle({ id: 5 }).error.code !== -32600 || server.handle(null).error.code !== -32600 || server.handle({ jsonrpc: '2.0', id: 'a', method: 5 }).error.code !== -32600) fail('protocol', 'a message that is not JSON-RPC should be -32600');
  const strId = server.handle({ jsonrpc: '2.0', id: 'abc', method: 'ping' });
  if (strId.id !== 'abc') fail('protocol', 'the id (a string here) must come back as it was sent');

  // a tool that breaks is an error for Claude, not a crash, and the details go to the log
  const logged = [];
  const shaky = createServer({ tools: [{ name: 'boom', description: 'x', inputSchema: { type: 'object' }, run() { throw new Error('kaboom'); } }], log: (s) => logged.push(s) });
  const boom = shaky.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'boom', arguments: {} } }).result;
  if (!boom.isError || !/kaboom/.test(boom.content[0].text) || logged.length !== 1) fail('protocol', 'a tool that throws should be an error result, and be logged');
  done();
  console.log('  done');
}

// ---------------------------------------------------------------------------------------------------
console.log('== the real process');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-mcp-proc-'));
  const lines = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'generate_dungeon', arguments: { seed: 'proc', roomCount: 5 } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'save_dungeon', arguments: { name: 'from-process' } } },
  ].map((m) => JSON.stringify(m));
  lines.splice(3, 0, '{ this is not json');
  lines[0] = String.fromCharCode(0xfeff) + lines[0]; // as PowerShell sends it: a byte-order mark before the first line
  const run = spawnSync(process.execPath, [path.join(ROOT, 'mcp', 'server.js')], { input: `${lines.join('\n')}\n`, encoding: 'utf8', timeout: 60000, env: { ...process.env, DUNGEON_MAKER_MAPS: dir } });
  if (run.status !== 0) fail('process', `the server exited with ${run.status} (${run.error || run.stderr})`);
  const out = run.stdout.split('\n').filter(Boolean);
  const parsed = [];
  for (const l of out) {
    try {
      parsed.push(JSON.parse(l));
    } catch (err) {
      fail('process', `stdout has a line that is not JSON (it would break the connection): ${l.slice(0, 80)}`);
    }
  }
  const byId = new Map(parsed.map((m) => [m.id, m]));
  if (parsed.length !== 5) fail('process', `${parsed.length} replies for 4 requests and 1 bad line (the notification gets none)`);
  if (!byId.get(1) || byId.get(1).result.protocolVersion !== '2025-06-18') fail('process', 'no answer to initialize');
  if (!byId.get(2) || byId.get(2).result.tools.length !== 7) fail('process', 'no list of seven tools');
  const generated = byId.get(3) && byId.get(3).result;
  if (!generated || generated.content.length !== 2 || !isPng(Buffer.from(generated.content[1].data, 'base64'))) fail('process', 'no dungeon with a picture');
  if (!parsed.some((m) => m.error && m.error.code === -32700 && m.id === null)) fail('process', 'a line that is not JSON should get a parse error');
  const saved = byId.get(4) && byId.get(4).result;
  if (!saved || saved.isError || !fs.existsSync(path.join(dir, 'from-process.json')) || !isPng(fs.readFileSync(path.join(dir, 'from-process.png')))) fail('process', 'DUNGEON_MAKER_MAPS did not choose where files go, or they were not written');
  if (!/ready/.test(run.stderr)) fail('process', 'the server should say on stderr that it is ready');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('  done');
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} FAILURE${failures === 1 ? '' : 'S'}`);
process.exit(failures === 0 ? 0 : 1);
