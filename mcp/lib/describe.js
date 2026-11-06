'use strict';
/*
 * A dungeon in words: what Claude reads to write the content for it. Every room is called by the number
 * printed on the map (its `label`, not its index in the data), so what Claude writes matches the picture.
 *
 * Each door carries a reference like "(12,7) east": the square of a room and the side of it the door is
 * on. That is how edit_dungeon is told which door to change.
 */
const { load } = require('./dm');

const SIDES = ['north', 'east', 'south', 'west'];
const SIDE_LETTERS = ['N', 'E', 'S', 'W'];

const SHAPES = {
  rect: 'rectangular',
  chamfer: 'rectangular with cut corners',
  L: 'L-shaped',
  T: 'T-shaped',
  U: 'U-shaped',
  H: 'H-shaped',
  Z: 'Z-shaped',
  plus: 'plus-shaped (a cross)',
};

const STYLES = {
  door: 'door',
  locked: 'locked door',
  secret: 'secret door',
  open: 'open archway (no door)',
};

const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (items) => (items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** "(12,7) east": the east side of square (12,7). */
const ref = (x, y, d) => `(${x},${y}) ${SIDES[d]}`;

/** Where on the map a room sits, in the words of a compass: "north-west", "centre", ... */
function whereOnMap(d, room) {
  const cx = (room.bbox.x + room.bbox.w / 2) / d.width;
  const cy = (room.bbox.y + room.bbox.h / 2) / d.height;
  const row = cy < 1 / 3 ? 'north' : cy > 2 / 3 ? 'south' : '';
  const col = cx < 1 / 3 ? 'west' : cx > 2 / 3 ? 'east' : '';
  return row && col ? `${row}-${col}` : row || col || 'centre';
}

/**
 * @param {object} d  a dungeon (DM.generateDungeon's result)
 * @param {object} [about]
 * @param {string} [about.id]       how the tools refer to it
 * @param {boolean} [about.edited]  has it been changed by hand since it was made or opened here?
 * @returns {string}
 */
function describeDungeon(d, { id, edited } = {}) {
  const { OPP } = load().DIRS;
  const ft = d.cellSizeFt;
  const byId = new Map(d.rooms.map((r) => [r.id, r]));
  const num = (roomId) => byId.get(roomId).label;
  const hallName = (hallId) => `H${hallId + 1}`;
  const hallRooms = (hallId) => list(d.halls[hallId].rooms.map(num).sort((a, b) => a - b).map(String));

  // every door of every room: { wall (this room's own wall), x, y, d (where the door is, for edit_dungeon), style, to }
  const exits = new Map(d.rooms.map((r) => [r.id, []]));
  for (const c of d.connections) {
    for (const o of c.openings) {
      if (c.type === 'hall') {
        exits.get(o.room).push({ wall: o.d, x: o.x, y: o.y, d: o.d, style: o.style, to: `hallway ${hallName(c.hall)}`, hall: c.hall });
      } else {
        const other = c.rooms.find((r) => r !== o.room);
        exits.get(o.room).push({ wall: o.d, x: o.x, y: o.y, d: o.d, style: o.style, to: `room ${num(other)}` });
        exits.get(other).push({ wall: OPP[o.d], x: o.x, y: o.y, d: o.d, style: o.style, to: `room ${num(o.room)}` });
      }
    }
  }

  const lines = [];
  const title = id ? `Dungeon ${id}` : 'Dungeon';
  lines.push(`${title} (seed ${d.seed}${edited ? ', edited by hand in this session' : ''}): ${count(d.rooms.length, 'room')}, ${count(d.halls.length, 'hallway')}, ${d.width}×${d.height} squares (${d.width * ft}×${d.height * ft} ft).`);
  lines.push(`One square is ${ft} ft. North is up. Rooms are numbered as on the map. Squares are written (x,y), counted from the top left corner (0,0): x grows to the east, y to the south.`);
  lines.push('A door written like "(12,7) east" is on the east side of square (12,7); edit_dungeon takes that square and side to change it.');
  for (const w of d.warnings) lines.push(`Note: ${w}`);

  lines.push('', 'ENTRANCES (ways in from outside)');
  for (const e of d.entrances) {
    if (e.kind === 'stairs') lines.push(`- ${e.label}: stairs inside room ${num(e.room)}, at (${e.x},${e.y}), climbing toward its ${SIDES[e.d]} wall`);
    else lines.push(`- ${e.label}: a door in the ${SIDES[e.d]} wall of room ${num(e.room)}, at (${e.x},${e.y})`);
  }
  if (d.entrances.length === 0) lines.push('- none');

  lines.push('', 'ROOMS');
  for (const r of [...d.rooms].sort((a, b) => a.label - b.label)) {
    const shape = SHAPES[r.kind] || r.kind;
    lines.push(`Room ${r.label}: ${shape}, ${r.bbox.w * ft}×${r.bbox.h * ft} ft overall (${r.bbox.w}×${r.bbox.h} squares), ${count(r.area, 'square')} of floor (${r.area * ft * ft} sq ft), in the ${whereOnMap(d, r)} of the map.`);
    for (const e of d.entrances.filter((x) => x.room === r.id)) lines.push(`  - entrance ${e.label} (${e.kind === 'stairs' ? 'stairs' : `door in its ${SIDES[e.d]} wall`})`);
    const mine = exits.get(r.id).sort((a, b) => a.wall - b.wall || a.y - b.y || a.x - b.x);
    for (const x of mine) {
      const also = x.hall === undefined ? '' : ` (which also reaches ${hallRoomsExcept(d, x.hall, r.id, num)})`;
      lines.push(`  - ${SIDES[x.wall]} wall: ${STYLES[x.style] || x.style} to ${x.to}${also}  [${ref(x.x, x.y, x.d)}]`);
    }
    if (mine.length === 0) lines.push('  - no doors (this room cannot be reached)');
  }

  lines.push('', 'HALLWAYS');
  for (const h of d.halls) {
    const serves = h.rooms.length === 0 ? 'joins no rooms (a loose piece of passage)' : h.rooms.length === 1 ? `a dead end off room ${hallRooms(h.id)}` : `joins rooms ${hallRooms(h.id)}`;
    lines.push(`${hallName(h.id)}: ${count(h.cells.length, 'square')} (${h.cells.length * ft} ft of passage), ${serves}.`);
  }
  if (d.halls.length === 0) lines.push('none: rooms open straight into each other');
  return lines.join('\n');
}

/** The rooms a hallway reaches other than `roomId`, as "rooms 4 and 5". */
function hallRoomsExcept(d, hallId, roomId, num) {
  const others = d.halls[hallId].rooms.filter((r) => r !== roomId).map(num).sort((a, b) => a - b);
  if (others.length === 0) return 'no other room';
  return `${others.length === 1 ? 'room' : 'rooms'} ${list(others.map(String))}`;
}

module.exports = { describeDungeon, ref, SIDES, SIDE_LETTERS, STYLES };
