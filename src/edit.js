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
 *   - editState  one text for everything Edit mode can change, to tell whether anything was.
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
        if (room === undefined) continue;
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

  /**
   * Every hallway square and every opening (with its state) in one text, the same for the same dungeon
   * whatever order the hallways are in: two dungeons are alike, as far as Edit mode goes, exactly when
   * their texts are.
   */
  function editState(d) {
    const cells = d.halls.flatMap((h) => h.cells.map(([x, y]) => key(x, y))).sort();
    const doors = d.connections.flatMap((c) => c.openings.map((o) => `${o.x},${o.y},${o.d},${o.style}`)).sort();
    return `${cells.join(';')}|${doors.join(';')}`;
  }

  DM.MAX_SIDE = MAX_SIDE;
  DM.planHallway = planHallway;
  DM.addHallway = addHallway;
  DM.hallStretchAt = hallStretchAt;
  DM.deleteHallStretch = deleteHallStretch;
  DM.editState = editState;
})();
