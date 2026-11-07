/*
 * Editing a finished dungeon: drawing and deleting hallways (Edit mode). The state of a door is
 * in generator.js (DM.nextDoorStyle); this is the rest of what Edit mode changes.
 *
 * The dungeon model (see generator.js) is changed in place. All of it comes down to one idea: a
 * hallway is a set of squares, and two hallway squares that touch are the same hallway. So every
 * change is made to the set of hallway squares, and the hallways, the connections that go with
 * them and the size of the map are worked out again from it (`rebuild`).
 *
 *   - planHallway / addHallway  a stroke (the squares the pointer went over) becomes hallway.
 *     Squares that are rooms, or just outside an entrance door, are left out. A stroke that starts or
 *     ends on a hallway (or touches one) is part of that hallway: that is how a hallway branches.
 *     A stroke that starts or ends heading into a room's wall opens the wall there: a door or an
 *     open archway, by the dungeon's Hallway doors setting, as for a generated hallway.
 *   - hallStretchAt / deleteHallStretch  the stretch of hallway under a square: from one junction
 *     (or a side door) to the next, or to a dead end.
 *   - deleteHall  a whole hallway, by its id.
 *   - planRoom / addRoom, planMoveRoom / moveRoom, deleteRoomProblem / deleteRoom  rooms: draw a rectangle, slide a room (its doors go with it where
 *     they still meet a hallway), take a room away (the numbers after it close up).
 *   - addEntrance / removeEntrance  ways in from outside (a door in an outer wall, or stairs on a floor).
 *   - addStair / moveStair / removeStair  stairs between two floors of a dungeon of several levels: one square that is a room square
 *     on both, with no door or entrance on it and no other stairs. Each pair of floors keeps at least one stair.
 *   - editState  one text for everything Edit mode can change, to tell whether anything was.
 *
 * A dungeon of several levels is edited one floor at a time: the functions here take the floor as DM.floorView(dungeon, level)
 * gives it. The floors share one map, so when the map changes size every floor moves together, and so do the stairs (fitMap).
 * Entrances are on level 1 only, and nothing is opened or put on a square where stairs lead to another level.
 *
 * A hallway drawn here may serve fewer than two rooms (a dead end serves one, a loose piece none),
 * and may have more than one opening into the same room.
 */
(function () {
  const DM = (globalThis.DM = globalThis.DM || {});
  const { DX, DY, OPP } = DM.DIRS;

  /** The longest the map may become along either side, in squares. */
  const MAX_SIDE = 1200;

  const key = (x, y) => `${x},${y}`;

  /** key -> id of the room that has the square */
  function roomSquares(d) {
    const m = new Map();
    for (const r of d.rooms) for (const [x, y] of r.cells) m.set(key(x, y), r.id);
    return m;
  }

  /** key -> { x, y, hall } for every hallway square */
  function hallSquares(d) {
    const m = new Map();
    for (const h of d.halls) for (const [x, y] of h.cells) m.set(key(x, y), { x, y, hall: h.id });
    return m;
  }

  const hallOpenings = (d) => d.connections.filter((c) => c.type === 'hall').flatMap((c) => c.openings);

  /** The squares just outside the doors of the outer wall: the entrance arrow points in from there. */
  function entranceSquares(d) {
    const s = new Set();
    for (const e of d.entrances) if (e.kind !== 'stairs') s.add(key(e.x + DX[e.d], e.y + DY[e.d]));
    return s;
  }

  /** Which way (0 = N ... 3 = W) is square b from the next-door square a? Null if it is not next door. */
  function dirTo(a, b) {
    for (let k = 0; k < 4; k++) if (a[0] + DX[k] === b[0] && a[1] + DY[k] === b[1]) return k;
    return null;
  }

  /** Does a new opening in the wall of room square (x, y), on side dir, get a door? (Same chance as a generated one.) */
  function openingStyle(d, x, y, dir) {
    const chance = DM.GENERATOR_CONFIG.hallDoorChance[d.params && d.params.hallDoors];
    // decided by where the opening is, so the picture shown while drawing is what is made
    const rng = new DM.Rng(`${d.seed}:hall-door:${x},${y},${dir}`);
    return rng.chance(chance === undefined ? DM.GENERATOR_CONFIG.hallDoorChance.less : chance) ? 'door' : 'open';
  }

  /**
   * What a stroke would make, without changing anything. `stroke` is the squares the pointer went over,
   * in order, each next to the one before: [[x, y], ...] (they may be outside the map).
   * Returns { floor: the new hallway squares, openings: the new openings into rooms (as in
   * connections[].openings) }.
   */
  function planHallway(d, stroke) {
    const rooms = roomSquares(d);
    const halls = hallSquares(d);
    const shut = entranceSquares(d);
    const kind = stroke.map(([x, y]) => (rooms.has(key(x, y)) ? 'room' : shut.has(key(x, y)) ? 'shut' : 'floor'));

    const floor = [];
    const seen = new Set();
    stroke.forEach(([x, y], i) => {
      const k = key(x, y);
      if (kind[i] === 'floor' && !halls.has(k) && !seen.has(k)) {
        seen.add(k);
        floor.push([x, y]);
      }
    });

    // an end of the hallway that is heading into a room's wall opens the wall (an end is where the stroke
    // starts, ends or comes to a room); a stroke only running along a wall opens nothing
    const taken = new Set(d.connections.flatMap((c) => c.openings.map((o) => `${o.x},${o.y},${o.d}`)));
    const stairs = new Set((d.stairs || []).map((s) => key(s.x, s.y))); // no door into a square where stairs lead to another level
    for (const e of d.entrances) if (e.kind !== 'stairs') taken.add(`${e.x},${e.y},${e.d}`);
    const openings = [];
    const last = stroke.length - 1;
    stroke.forEach((at, i) => {
      if (kind[i] !== 'floor') return;
      const starts = i === 0 || kind[i - 1] !== 'floor';
      const ends = i === last || kind[i + 1] !== 'floor';
      if (!starts && !ends) return;
      const towardPrev = i > 0 ? dirTo(at, stroke[i - 1]) : null;
      const towardNext = i < last ? dirTo(at, stroke[i + 1]) : null;
      const opp = (k) => (k === null ? null : OPP[k]);
      const sides = [];
      if (starts) sides.push(i > 0 ? towardPrev : opp(towardNext)); // the way it came from
      if (ends) sides.push(i < last ? towardNext : opp(towardPrev)); // the way it was going
      // a single square on its own joins every room it touches
      const heading = sides.filter((k) => k !== null);
      for (const side of heading.length > 0 ? heading : [0, 1, 2, 3]) {
        const nx = at[0] + DX[side];
        const ny = at[1] + DY[side];
        const room = rooms.get(key(nx, ny));
        if (room === undefined || stairs.has(key(nx, ny))) continue;
        const edge = `${nx},${ny},${OPP[side]}`;
        if (taken.has(edge)) continue;
        taken.add(edge);
        openings.push({ x: nx, y: ny, d: OPP[side], style: openingStyle(d, nx, ny, OPP[side]), room });
      }
    });
    return { floor, openings };
  }

  /**
   * Make the hallway a stroke draws. Returns { ok, dx, dy }: dx and dy are how far every square of the
   * dungeon moved (the map grows to fit, and its top left stays at 0, 0), or { ok: false, reason }.
   */
  function addHallway(d, stroke) {
    const plan = planHallway(d, stroke);
    if (plan.floor.length === 0 && plan.openings.length === 0) return { ok: false, reason: 'There is nothing to add there.' };
    const squares = hallSquares(d);
    for (const [x, y] of plan.floor) squares.set(key(x, y), { x, y, hall: -1 });
    if (spanOf(d, squares).tooBig) return { ok: false, reason: `The map cannot be more than ${MAX_SIDE} squares across.` };
    return { ok: true, ...rebuild(d, squares, [...hallOpenings(d), ...plan.openings]) };
  }

  /** How far the squares of rooms and hallways reach: { x0, y0, x1, y1, tooBig }. */
  function spanOf(d, halls) {
    const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const grow = (x, y) => {
      b.x0 = Math.min(b.x0, x);
      b.y0 = Math.min(b.y0, y);
      b.x1 = Math.max(b.x1, x);
      b.y1 = Math.max(b.y1, y);
    };
    for (const r of d.rooms) for (const [x, y] of r.cells) grow(x, y);
    for (const { x, y } of halls.values()) grow(x, y);
    b.tooBig = b.x1 - b.x0 + 1 > MAX_SIDE || b.y1 - b.y0 + 1 > MAX_SIDE;
    return b;
  }

  /**
   * Make the model say what the hallway squares and openings say: one hallway for each set of touching
   * squares, a connection for each hallway (what rooms it serves comes from its openings), an opening is
   * dropped if its hallway square is gone, and the map is as small as it can be round the rooms and
   * hallways. Returns { dx, dy }.
   */
  function rebuild(d, squares, openings) {
    const oldKind = new Map(d.halls.map((h) => [h.id, h.kind]));
    const sorted = [...squares.values()].sort((a, b) => a.y - b.y || a.x - b.x);
    const compOf = new Map();
    const comps = [];
    for (const start of sorted) {
      if (compOf.has(key(start.x, start.y))) continue;
      const comp = { cells: [], from: new Map() };
      comps.push(comp);
      const stack = [start];
      compOf.set(key(start.x, start.y), comps.length - 1);
      while (stack.length) {
        const c = stack.pop();
        comp.cells.push(c);
        if (c.hall >= 0) comp.from.set(c.hall, (comp.from.get(c.hall) || 0) + 1);
        for (let k = 0; k < 4; k++) {
          const n = squares.get(key(c.x + DX[k], c.y + DY[k]));
          if (n && !compOf.has(key(n.x, n.y))) {
            compOf.set(key(n.x, n.y), comps.length - 1);
            stack.push(n);
          }
        }
      }
      comp.cells.sort((a, b) => a.y - b.y || a.x - b.x);
    }

    const byComp = comps.map(() => []);
    for (const o of openings) {
      const ci = compOf.get(key(o.x + DX[o.d], o.y + DY[o.d]));
      if (ci !== undefined) byComp[ci].push(o);
    }

    const doors = d.connections.filter((c) => c.type !== 'hall');
    doors.forEach((c, i) => (c.id = i));
    const halls = [];
    const hallConns = [];
    comps.forEach((comp, i) => {
      // a piece keeps the kind of the generated hallway most of it came from; squares only drawn make a 'drawn' one
      let kind = 'drawn';
      let most = 0;
      for (const [id, n] of [...comp.from].sort((a, b) => a[0] - b[0])) {
        if (n > most) {
          most = n;
          kind = oldKind.get(id);
        }
      }
      const rooms = [...new Set(byComp[i].map((o) => o.room))].sort((a, b) => a - b);
      const cid = doors.length + i;
      halls.push({ id: i, kind, cells: comp.cells.map((c) => [c.x, c.y]), rooms, connection: cid });
      hallConns.push({ id: cid, type: 'hall', rooms: rooms.slice(), hall: i, openings: byComp[i] });
    });
    d.halls = halls;
    d.connections = [...doors, ...hallConns];
    const shift = fitMap(d);
    refreshStats(d);
    return shift;
  }

  /** Make the map just big enough for its rooms and hallways, top left at (0, 0). Returns how far everything moved. */
  function fitMap(d) {
    if (d._model) return fitLevels(d);
    const b = spanOf(d, hallSquares(d));
    const dx = -b.x0;
    const dy = -b.y0;
    if (dx !== 0 || dy !== 0) {
      const move = ([x, y]) => [x + dx, y + dy];
      for (const r of d.rooms) {
        r.cells = r.cells.map(move);
        r.labelCell = move(r.labelCell);
        r.bbox = { ...r.bbox, x: r.bbox.x + dx, y: r.bbox.y + dy };
      }
      for (const h of d.halls) h.cells = h.cells.map(move);
      for (const at of [...d.connections.flatMap((c) => c.openings), ...d.entrances]) {
        at.x += dx;
        at.y += dy;
      }
    }
    d.width = b.x1 - b.x0 + 1;
    d.height = b.y1 - b.y0 + 1;
    return { dx, dy };
  }

  /**
   * The same for a floor of a dungeon of several levels: the map is as small as it can be round the rooms and hallways of every floor,
   * and when its top left moves, every floor and every stair moves with it. (The new hallways of the floor are first put in the dungeon.)
   */
  function fitLevels(d) {
    const root = d._model;
    const own = d.level > 1 ? root.floors[d.level - 2] : root;
    own.halls = d.halls;
    own.connections = d.connections;
    const shift = DM.fitLevelsBox(root);
    d.width = root.width;
    d.height = root.height;
    d.stairs = DM.floorStairs(root, d.level);
    return shift;
  }

  /** The counts in `stats` that hallways change. (Room shapes, sizes and how the hallways were first made stay as built.) */
  function refreshStats(d) {
    const hallConns = d.connections.filter((c) => c.type === 'hall');
    const s = d.stats;
    s.hallConnections = hallConns.length;
    s.doorConnections = d.connections.length - hallConns.length;
    s.hallLinks = hallConns.reduce((n, c) => n + Math.max(0, c.rooms.length - 1), 0);
    s.multiRoomHalls = hallConns.filter((c) => c.rooms.length >= 3).length;
    s.maxRoomsPerHall = hallConns.reduce((n, c) => Math.max(n, c.rooms.length), 0);
    s.floorCells = d.rooms.reduce((n, r) => n + r.cells.length, 0) + d.halls.reduce((n, h) => n + h.cells.length, 0);
  }

  /**
   * The stretch of hallway that holds square (x, y): the squares from one junction (three ways on, or a
   * side door into a room) to the next, up to a dead end, as [[x, y], ...]. A junction square is a
   * stretch of its own. Null if the square is not hallway.
   */
  function hallStretchAt(d, x, y) {
    const squares = hallSquares(d);
    if (!squares.has(key(x, y))) return null;
    const opened = new Set(hallOpenings(d).map((o) => key(o.x + DX[o.d], o.y + DY[o.d])));
    const ways = (c) => [0, 1, 2, 3].filter((k) => squares.has(key(c.x + DX[k], c.y + DY[k])));
    const junction = (c) => {
      const n = ways(c).length;
      return n >= 3 || (n >= 2 && opened.has(key(c.x, c.y)));
    };
    const start = squares.get(key(x, y));
    if (junction(start)) return [[x, y]];
    const out = [];
    const seen = new Set([key(x, y)]);
    const stack = [start];
    while (stack.length) {
      const c = stack.pop();
      out.push([c.x, c.y]);
      for (const k of ways(c)) {
        const n = squares.get(key(c.x + DX[k], c.y + DY[k]));
        if (!seen.has(key(n.x, n.y)) && !junction(n)) {
          seen.add(key(n.x, n.y));
          stack.push(n);
        }
      }
    }
    return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  }

  /** Delete the stretch of hallway under square (x, y), with the doors it has into rooms. Returns { ok, removed, dx, dy }. */
  function deleteHallStretch(d, x, y) {
    const removed = hallStretchAt(d, x, y);
    if (!removed) return { ok: false, reason: 'There is no hallway there.' };
    const squares = hallSquares(d);
    for (const [rx, ry] of removed) squares.delete(key(rx, ry));
    return { ok: true, removed, ...rebuild(d, squares, hallOpenings(d)) };
  }

  /** Delete the whole hallway with this id (every square of it, with its doors into rooms). Returns { ok, removed, dx, dy }. */
  function deleteHall(d, hallId) {
    const hall = d.halls.find((h) => h.id === hallId);
    if (!hall) return { ok: false, reason: 'There is no such hallway.' };
    const squares = hallSquares(d);
    for (const [x, y] of hall.cells) squares.delete(key(x, y));
    return { ok: true, removed: hall.cells.map(([x, y]) => [x, y]), ...rebuild(d, squares, hallOpenings(d)) };
  }

  // ---- rooms ---------------------------------------------------------------------------------------------------
  // A room is a set of squares. Drawing one (a rectangle), moving one and deleting one all end the way hallway edits do: the hallways and
  // connections are worked out again (`rebuild`) and the map is fitted. Room ids are the places of the rooms in `rooms` and the numbers on the
  // map count 1, 2, 3 ... in the same order as before, so taking a room away renumbers the ones after it.

  /** The most a room may measure along either side when it is drawn, in squares. */
  const MAX_ROOM_SIDE = 60;

  /** Is the straight line from square (x, y) outward (side dir) clear of rooms and hallways all the way off the map? */
  function lineOutClear(rooms, halls, x, y, dir) {
    for (let i = 0; i <= MAX_SIDE + 1; i++, x += DX[dir], y += DY[dir]) if (rooms.has(key(x, y)) || halls.has(key(x, y))) return false;
    return true;
  }

  /** The room of this floor with this id, or undefined. */
  const roomById = (d, id) => d.rooms.find((r) => r.id === id);

  /** The stairs between levels that are in this room (as the room of its floor). */
  function stairsInRoom(d, room) {
    const root = d._model || d;
    const level = d.level || 1;
    return (root.stairs || []).filter((s) => (s.upper === level && s.upperRoom === room.id) || (s.lower === level && s.lowerRoom === room.id));
  }

  /** The counts in `stats` that rooms change (how many, what shapes, how big). */
  function refreshRoomStats(d) {
    const s = d.stats;
    const areas = d.rooms.map((r) => r.cells.length);
    const mean = areas.reduce((a, b) => a + b, 0) / areas.length;
    s.rooms = d.rooms.length;
    s.shapeCounts = d.rooms.reduce((m, r) => ((m[r.kind] = (m[r.kind] || 0) + 1), m), {});
    s.meanRoomArea = mean;
    s.roomAreaStdDev = Math.sqrt(areas.reduce((a, b) => a + (b - mean) ** 2, 0) / areas.length);
    s.floorCells = d.rooms.reduce((n, r) => n + r.cells.length, 0) + d.halls.reduce((n, h) => n + h.cells.length, 0);
  }

  /**
   * What drawing a rectangular room between squares a and b (two opposite corners, in any order) would do, without changing anything.
   * Returns { ok, cells } or { ok: false, reason, cells }. Its squares must be empty: no room, no hallway, and not the square just
   * outside the door of an entrance. The map grows to take it.
   */
  function planRoom(d, a, b) {
    const x0 = Math.min(a[0], b[0]);
    const x1 = Math.max(a[0], b[0]);
    const y0 = Math.min(a[1], b[1]);
    const y1 = Math.max(a[1], b[1]);
    const cells = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push([x, y]);
    if (x1 - x0 + 1 > MAX_ROOM_SIDE || y1 - y0 + 1 > MAX_ROOM_SIDE) return { ok: false, cells, reason: `a room can be at most ${MAX_ROOM_SIDE} squares across.` };
    const rooms = roomSquares(d);
    const halls = hallSquares(d);
    const shut = entranceSquares(d);
    for (const [x, y] of cells) {
      const k = key(x, y);
      if (rooms.has(k)) return { ok: false, cells, reason: `(${x},${y}) is already part of room ${roomById(d, rooms.get(k)).label}.` };
      if (halls.has(k)) return { ok: false, cells, reason: `there is a hallway at (${x},${y}).` };
      if (shut.has(k)) return { ok: false, cells, reason: `(${x},${y}) is just outside the door of an entrance.` };
    }
    const span = spanOf(d, halls);
    if (Math.max(span.x1, x1) - Math.min(span.x0, x0) + 1 > MAX_SIDE || Math.max(span.y1, y1) - Math.min(span.y0, y0) + 1 > MAX_SIDE) return { ok: false, cells, reason: `the map cannot be more than ${MAX_SIDE} squares across.` };
    return { ok: true, cells };
  }

  /**
   * Draw a rectangular room between squares a and b (two opposite corners). It gets the next number. Returns { ok, room, dx, dy } (dx and dy:
   * how far every square moved when the map grew up or left), or { ok: false, reason }.
   */
  function addRoom(d, a, b) {
    const plan = planRoom(d, a, b);
    if (!plan.ok) return plan;
    const { cells } = plan;
    const x = cells[0][0];
    const y = cells[0][1];
    const w = cells[cells.length - 1][0] - x + 1;
    const h = cells[cells.length - 1][1] - y + 1;
    const room = {
      id: d.rooms.length,
      label: d.rooms.reduce((m, r) => Math.max(m, r.label), 0) + 1,
      kind: 'rect',
      area: cells.length,
      bbox: { x, y, w, h },
      labelCell: DM.labelCandidates(cells)[0].slice(0, 2),
      cells,
    };
    if (d._model) room.level = d.level;
    d.rooms.push(room);
    const shift = rebuild(d, hallSquares(d), hallOpenings(d));
    refreshRoomStats(d);
    return { ok: true, room, ...shift };
  }

  /**
   * What moving a room by (mx, my) squares would do, without changing anything. The squares it would stand on must be empty (its own
   * included). Its doors go with it where a hallway (or the room a doorway joins) is still on the other side of them, and the others are
   * taken away; so are entrance doors that no longer stand on an outer wall. A room with stairs to another level cannot be moved: they would
   * have to be taken away first. Returns { ok, cells, ... } with what would be kept and dropped, or { ok: false, reason, cells }.
   */
  function planMoveRoom(d, id, mx, my) {
    const room = roomById(d, id);
    if (!room) return { ok: false, cells: [], reason: 'there is no such room.' };
    const cells = room.cells.map(([x, y]) => [x + mx, y + my]);
    const no = (reason) => ({ ok: false, cells, reason });
    if (mx === 0 && my === 0) return { ...no('the room is already there.'), same: true };
    const stairs = stairsInRoom(d, room);
    if (stairs.length > 0) return no(`there are stairs ${stairs.map((s) => s.letter).join(', ')} in room ${DM.roomTag(room)}: remove them first.`);
    const rooms = roomSquares(d);
    const halls = hallSquares(d);
    const mine = new Set(room.cells.map(([x, y]) => key(x, y)));
    const shut = new Set();
    for (const e of d.entrances) if (e.kind !== 'stairs' && e.room !== id) shut.add(key(e.x + DX[e.d], e.y + DY[e.d]));
    for (const [x, y] of cells) {
      const k = key(x, y);
      if (rooms.has(k) && !mine.has(k)) return no(`room ${roomById(d, rooms.get(k)).label} is in the way at (${x},${y}).`);
      if (halls.has(k)) return no(`there is a hallway at (${x},${y}).`);
      if (shut.has(k)) return no(`(${x},${y}) is just outside the door of an entrance.`);
    }
    const xs = cells.map((c) => c[0]);
    const ys = cells.map((c) => c[1]);
    const keepsRooms = d.rooms.filter((r) => r.id !== id);
    const sx = [...keepsRooms.flatMap((r) => r.cells.map((c) => c[0])), ...xs, ...[...halls.values()].map((c) => c.x)];
    const sy = [...keepsRooms.flatMap((r) => r.cells.map((c) => c[1])), ...ys, ...[...halls.values()].map((c) => c.y)];
    if (Math.max(...sx) - Math.min(...sx) + 1 > MAX_SIDE || Math.max(...sy) - Math.min(...sy) + 1 > MAX_SIDE) return no(`the map cannot be more than ${MAX_SIDE} squares across.`);

    // the squares as they will be
    const after = new Map(rooms);
    for (const k of mine) after.delete(k);
    for (const [x, y] of cells) after.set(key(x, y), id);

    const keepHall = new Set();
    let dropHall = 0;
    for (const c of d.connections) {
      if (c.type !== 'hall') continue;
      for (const o of c.openings) {
        if (o.room !== id) continue;
        if (halls.has(key(o.x + mx + DX[o.d], o.y + my + DY[o.d]))) keepHall.add(o);
        else dropHall++;
      }
    }
    const keepDoors = new Set();
    const dropDoors = new Set();
    for (const c of d.connections) {
      if (c.type === 'hall' || !c.rooms.includes(id)) continue;
      const o = c.openings[0];
      const other = c.rooms.find((r) => r !== id);
      const at = o.room === id ? [o.x + mx, o.y + my] : [o.x, o.y];
      const across = after.get(key(at[0] + DX[o.d], at[1] + DY[o.d]));
      (across === (o.room === id ? other : id) ? keepDoors : dropDoors).add(c);
    }
    const keepEntrances = [];
    const dropEntrances = [];
    for (const e of d.entrances) {
      if (e.room !== id) continue;
      let keeps = true;
      if (e.kind !== 'stairs') {
        const nx = e.x + mx + DX[e.d];
        const ny = e.y + my + DY[e.d];
        keeps = !after.has(key(nx, ny)) && !halls.has(key(nx, ny)) && lineOutClear(after, halls, nx, ny, e.d);
      }
      (keeps ? keepEntrances : dropEntrances).push(e);
    }
    if (d.entrances.length > 0 && dropEntrances.length === d.entrances.length) return no('it would take away the last entrance: the door of the room would not be on an outer wall there.');
    return { ok: true, cells, keepHall, dropHall, keepDoors, dropDoors, keepEntrances, dropEntrances, mx, my };
  }

  /**
   * Move a room by (mx, my) squares: see planMoveRoom for what goes with it. The map grows or shrinks to fit. Returns
   * { ok, room, dropped: { openings, doorways, entrances }, dx, dy } or { ok: false, reason }.
   */
  function moveRoom(d, id, mx, my) {
    const plan = planMoveRoom(d, id, mx, my);
    if (!plan.ok) return plan;
    const room = roomById(d, id);
    room.cells = plan.cells;
    room.labelCell = [room.labelCell[0] + mx, room.labelCell[1] + my];
    room.bbox = { ...room.bbox, x: room.bbox.x + mx, y: room.bbox.y + my };
    const hallOps = [];
    for (const o of hallOpenings(d)) {
      if (o.room !== id) hallOps.push(o);
      else if (plan.keepHall.has(o)) {
        o.x += mx;
        o.y += my;
        hallOps.push(o);
      }
    }
    for (const c of plan.keepDoors) {
      const o = c.openings[0];
      if (o.room === id) {
        o.x += mx;
        o.y += my;
      }
    }
    d.connections = d.connections.filter((c) => !plan.dropDoors.has(c));
    for (const e of plan.keepEntrances) {
      e.x += mx;
      e.y += my;
    }
    for (const e of plan.dropEntrances) d.entrances.splice(d.entrances.indexOf(e), 1);
    if (plan.dropEntrances.length > 0) renumberEntrances(d);
    const shift = rebuild(d, hallSquares(d), hallOps);
    refreshRoomStats(d);
    return { ok: true, room, dropped: { openings: plan.dropHall, doorways: plan.dropDoors.size, entrances: plan.dropEntrances.length }, ...shift };
  }

  /**
   * Why room `id` cannot be deleted, or '' if it can. The dungeon keeps at least one room and (on level 1) one entrance, and each pair of
   * floors keeps at least one stair: stairs in the room go with it.
   */
  function deleteRoomProblem(d, id) {
    const room = roomById(d, id);
    if (!room) return 'there is no such room.';
    if (d.rooms.length === 1) return 'a dungeon needs at least one room.';
    const root = d._model || d;
    const here = stairsInRoom(d, room);
    for (const upper of new Set(here.map((s) => s.upper))) {
      if (root.stairs.filter((s) => s.upper === upper && !here.includes(s)).length === 0) return `its stairs are the only ones between level ${upper} and level ${upper + 1}, and every level must stay reachable: add others first.`;
    }
    if (d.entrances.length > 0 && d.entrances.every((e) => e.room === id)) return 'it has the only entrance: add another first.';
    return '';
  }

  /**
   * Delete a room: its squares are empty again, and its doors, the doorways it was in, its entrances and any stairs in it go with it
   * (hallways stay, as dead ends if they led only there). The rooms after it are renumbered. Returns
   * { ok, room, removed: { openings, doorways, entrances, stairs }, dx, dy } or { ok: false, reason }.
   */
  function deleteRoom(d, id) {
    const problem = deleteRoomProblem(d, id);
    if (problem) return { ok: false, reason: problem };
    const root = d._model || d;
    const room = roomById(d, id);
    const level = d.level || 1;
    const removed = { openings: 0, doorways: 0, entrances: 0, stairs: [] };
    // stairs first (they point at rooms by id)
    const gone = stairsInRoom(d, room);
    for (const s of gone) {
      root.stairs.splice(root.stairs.indexOf(s), 1);
      removed.stairs.push(s.letter);
    }
    d.rooms.splice(d.rooms.indexOf(room), 1);
    const renumbered = new Map();
    d.rooms.forEach((r, i) => {
      renumbered.set(r.id, i);
      r.id = i;
      if (r.label > room.label) r.label--;
    });
    const hallOps = [];
    for (const c of d.connections) {
      if (c.type !== 'hall') continue;
      for (const o of c.openings) {
        if (o.room === id) {
          removed.openings++;
          continue;
        }
        o.room = renumbered.get(o.room);
        hallOps.push(o);
      }
    }
    d.connections = d.connections.filter((c) => {
      if (c.type === 'hall') return true;
      if (c.rooms.includes(id)) {
        removed.doorways++;
        return false;
      }
      c.rooms = c.rooms.map((r) => renumbered.get(r));
      for (const o of c.openings) o.room = renumbered.get(o.room);
      return true;
    });
    for (let i = d.entrances.length - 1; i >= 0; i--) {
      if (d.entrances[i].room === id) {
        d.entrances.splice(i, 1);
        removed.entrances++;
      } else {
        d.entrances[i].room = renumbered.get(d.entrances[i].room);
      }
    }
    if (d.entrances.length > 0 || removed.entrances > 0) renumberEntrances(d);
    for (const s of root.stairs || []) {
      if (s.upper === level) s.upperRoom = renumbered.get(s.upperRoom);
      if (s.lower === level) s.lowerRoom = renumbered.get(s.lowerRoom);
    }
    const shift = rebuild(d, hallSquares(d), hallOps);
    refreshRoomStats(d);
    if (root.stairs) tidyStairs(root, d);
    return { ok: true, room, removed, ...shift };
  }

  // ---- stairs between levels ---------------------------------------------------------------------------------

  const floorOf = (root, n) => (n === 1 ? root : root.floors[n - 2]);

  /** The room of floor `f` that has square (x, y), or null. */
  function roomAt(f, x, y) {
    return f.rooms.find((r) => r.cells.some(([cx, cy]) => cx === x && cy === y)) || null;
  }

  /** The stair on level `level` at square (x, y), or null. */
  function stairAt(d, level, x, y) {
    const root = d._model || d;
    return (root.stairs || []).find((s) => s.x === x && s.y === y && (s.upper === level || s.lower === level)) || null;
  }

  /** Is anything at square (x, y) of floor `f` that a stair must not be on: a doorway, an opening of a hallway, an entrance? */
  function busy(f, x, y) {
    for (const c of f.connections) {
      for (const o of c.openings) {
        if (o.x === x && o.y === y) return true;
        if (c.type === 'door' && o.x + DX[o.d] === x && o.y + DY[o.d] === y) return true; // the room on the other side of a doorway
      }
    }
    return f.entrances.some((e) => e.x === x && e.y === y);
  }

  /**
   * Could stairs between level `upper` and the one below it go at square (x, y)? The square has to be a room square on both floors, with no
   * doorway, opening or entrance on it, and not already used by stairs on either floor. `except` is a stair that is being moved (its own
   * square does not count against it). Returns { ok, upperRoom, lowerRoom } or { ok: false, reason }.
   */
  function stairProblem(d, upper, x, y, except) {
    const root = d._model || d;
    const n = root.levels || 1;
    if (!(n > 1)) return { ok: false, reason: 'this dungeon has only one level.' };
    if (!Number.isInteger(upper) || upper < 1 || upper >= n) return { ok: false, reason: `there are no stairs between level ${upper} and level ${upper + 1}.` };
    const rooms = [];
    for (const level of [upper, upper + 1]) {
      const f = floorOf(root, level);
      const room = roomAt(f, x, y);
      if (!room) return { ok: false, reason: `(${x},${y}) is not a room square on level ${level}: stairs need a room square on both levels.` };
      if (busy(f, x, y)) return { ok: false, reason: `there is a door or an entrance at (${x},${y}) on level ${level}.` };
      rooms.push(room.id);
    }
    const other = (root.stairs || []).find((s) => s !== except && s.x === x && s.y === y && s.upper >= upper - 1 && s.upper <= upper + 1);
    if (other) return { ok: false, reason: `stairs ${other.letter} already use (${x},${y}) on level ${other.upper === upper + 1 ? upper + 1 : upper}.` };
    return { ok: true, upperRoom: rooms[0], lowerRoom: rooms[1] };
  }

  /** Keep the stairs in order, with ids that are their places (and the floor view, if given one, up to date). */
  function tidyStairs(root, d) {
    DM.tidyStairs(root);
    // (the numbers of rooms keep clear of the stairs' badges, and go back to the middle where a stair was taken away)
    for (let level = 1; level <= root.levels; level++) DM.settleLabels(floorOf(root, level), DM.floorStairs(root, level));
    if (d && d._model) d.stairs = DM.floorStairs(root, d.level);
  }

  /** Put stairs between level `upper` and the one below it at square (x, y). Returns { ok, stair } or { ok: false, reason }. */
  function addStair(d, upper, x, y) {
    const root = d._model || d;
    const p = stairProblem(d, upper, x, y);
    if (!p.ok) return p;
    const used = new Set(root.stairs.map((s) => s.letter));
    let k = 0;
    while (used.has(DM.stairLetter(k))) k++;
    const stair = { id: root.stairs.length, letter: DM.stairLetter(k), x, y, upper, lower: upper + 1, upperRoom: p.upperRoom, lowerRoom: p.lowerRoom };
    root.stairs.push(stair);
    tidyStairs(root, d);
    return { ok: true, stair };
  }

  /** Take away the stairs with this letter. Each pair of floors keeps at least one. Returns { ok, stair } or { ok: false, reason }. */
  function removeStair(d, letter) {
    const root = d._model || d;
    const stair = (root.stairs || []).find((s) => s.letter === letter);
    if (!stair) return { ok: false, reason: `there are no stairs ${letter}.` };
    if (root.stairs.filter((s) => s.upper === stair.upper).length === 1) return { ok: false, reason: `they are the only stairs between level ${stair.upper} and level ${stair.lower}, and every level must stay reachable: add others first.` };
    root.stairs.splice(root.stairs.indexOf(stair), 1);
    tidyStairs(root, d);
    return { ok: true, stair };
  }

  /** Move the stairs with this letter to square (x, y), between the same two floors. Returns { ok, stair } or { ok: false, reason }. */
  function moveStair(d, letter, x, y) {
    const root = d._model || d;
    const stair = (root.stairs || []).find((s) => s.letter === letter);
    if (!stair) return { ok: false, reason: `there are no stairs ${letter}.` };
    const p = stairProblem(d, stair.upper, x, y, stair);
    if (!p.ok) return p;
    Object.assign(stair, { x, y, upperRoom: p.upperRoom, lowerRoom: p.lowerRoom });
    tidyStairs(root, d);
    return { ok: true, stair };
  }

  /** Number the entrances E1, E2, ... in their order, and bring the entrance counts in `stats` up to date. */
  function renumberEntrances(d) {
    d.entrances.forEach((e, i) => {
      e.id = i;
      e.label = `E${i + 1}`;
    });
    d.stats.entrances = d.entrances.length;
    d.stats.stairsEntrances = d.entrances.filter((e) => e.kind === 'stairs').length;
  }

  /**
   * Add an entrance. A door ('door') is on the outside of the wall of room square (x, y), on side dir
   * (0 = N ... 3 = W): the square beyond it must be empty and a straight line out from it must leave the
   * map without meeting a room or hallway (as for a generated entrance). Stairs ('stairs') are on the
   * room floor at (x, y), climbing toward side dir. Returns { ok, entrance } or { ok: false, reason }.
   */
  function addEntrance(d, kind, x, y, dir) {
    if (d.level > 1) return { ok: false, reason: 'only level 1 has entrances from outside; the floors below are reached by stairs.' };
    const rooms = roomSquares(d);
    const halls = hallSquares(d);
    const room = rooms.get(key(x, y));
    if (room === undefined) return { ok: false, reason: `(${x},${y}) is not a room square.` };
    if ((d.stairs || []).some((s) => s.x === x && s.y === y)) return { ok: false, reason: `stairs lead to another level at (${x},${y}).` };
    if (kind === 'stairs') {
      if (d.entrances.some((e) => e.kind === 'stairs' && e.x === x && e.y === y)) return { ok: false, reason: `there are already stairs at (${x},${y}).` };
    } else {
      const nx = x + DX[dir];
      const ny = y + DY[dir];
      if (rooms.has(key(nx, ny)) || halls.has(key(nx, ny))) return { ok: false, reason: 'that side of the room is not an outer wall: there is a room or hallway beside it.' };
      for (let cx = nx, cy = ny; cx >= 0 && cy >= 0 && cx < d.width && cy < d.height; cx += DX[dir], cy += DY[dir]) {
        if (rooms.has(key(cx, cy)) || halls.has(key(cx, cy))) return { ok: false, reason: 'that wall is shut in: a line straight out from it meets another room or hallway before it leaves the map.' };
      }
      if (d.entrances.some((e) => e.kind !== 'stairs' && e.x === x && e.y === y && e.d === dir)) return { ok: false, reason: 'there is already an entrance there.' };
    }
    const entrance = { id: d.entrances.length, label: '', kind: kind === 'stairs' ? 'stairs' : 'door', room, x, y, d: dir };
    d.entrances.push(entrance);
    renumberEntrances(d);
    return { ok: true, entrance };
  }

  /** Remove the entrance at index `i` of d.entrances (the dungeon keeps at least one). Returns { ok, entrance } or { ok: false, reason }. */
  function removeEntrance(d, i) {
    if (!d.entrances[i]) return { ok: false, reason: 'there is no such entrance.' };
    if (d.entrances.length === 1) return { ok: false, reason: 'a dungeon needs at least one entrance: add another first.' };
    const [entrance] = d.entrances.splice(i, 1);
    renumberEntrances(d);
    return { ok: true, entrance };
  }

  /**
   * The squares from a (left out) to b, each next to the one before (a straight run, or as straight as
   * squares allow). A stroke is the squares between the points it was given: the page gets a point per
   * pointer move, and a caller with only the corners of a hallway gets the squares between them.
   */
  function walkCells(a, b) {
    const out = [];
    let x = a[0];
    let y = a[1];
    const nx = Math.abs(b[0] - x);
    const ny = Math.abs(b[1] - y);
    const sx = Math.sign(b[0] - x);
    const sy = Math.sign(b[1] - y);
    let ix = 0;
    let iy = 0;
    while (ix < nx || iy < ny) {
      if (iy >= ny || (ix < nx && (0.5 + ix) * ny <= (0.5 + iy) * nx)) {
        x += sx;
        ix++;
      } else {
        y += sy;
        iy++;
      }
      out.push([x, y]);
    }
    return out;
  }

  /**
   * Every hallway square, every opening (with its state) and the room numbers in one text, the same for the same dungeon
   * whatever order the hallways are in: two dungeons are alike, as far as Edit mode goes, exactly when
   * their texts are.
   */
  function editState(d) {
    const root = d._model || d;
    if (root.levels > 1) return [...[root, ...root.floors].map(floorState), root.stairs.map((s) => `${s.letter}${s.x},${s.y}`).join(';')].join('||');
    return floorState(root);
  }

  function floorState(d) {
    const cells = d.halls.flatMap((h) => h.cells.map(([x, y]) => key(x, y))).sort();
    const doors = d.connections.flatMap((c) => c.openings.map((o) => `${o.x},${o.y},${o.d},${o.style}`)).sort();
    const numbers = d.rooms.map((r) => `${r.label}${r.name ? `:${r.name}` : ''}${r.bbox ? `@${r.bbox.x},${r.bbox.y},${r.bbox.w}x${r.bbox.h}` : ''}`).join(',');
    const entrances = d.entrances.map((e) => `${e.kind},${e.x},${e.y},${e.d}`).join(';');
    return `${cells.join(';')}|${doors.join(';')}|${numbers}|${entrances}`;
  }

  DM.MAX_SIDE = MAX_SIDE;
  DM.walkCells = walkCells;
  DM.planHallway = planHallway;
  DM.addHallway = addHallway;
  DM.hallStretchAt = hallStretchAt;
  DM.deleteHallStretch = deleteHallStretch;
  DM.deleteHall = deleteHall;
  DM.roomAt = roomAt;
  DM.MAX_ROOM_SIDE = MAX_ROOM_SIDE;
  DM.planRoom = planRoom;
  DM.addRoom = addRoom;
  DM.planMoveRoom = planMoveRoom;
  DM.moveRoom = moveRoom;
  DM.deleteRoomProblem = deleteRoomProblem;
  DM.deleteRoom = deleteRoom;
  DM.addEntrance = addEntrance;
  DM.stairProblem = stairProblem;
  DM.stairAt = stairAt;
  DM.addStair = addStair;
  DM.moveStair = moveStair;
  DM.removeStair = removeStair;
  DM.removeEntrance = removeEntrance;
  DM.editState = editState;
})();
