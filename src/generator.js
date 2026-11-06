/*
 * Dungeon layout generator.
 *
 * Coordinates: x grows right, y grows DOWN. Cell (x, y) covers the square
 * [x, x+1] x [y, y+1], so every wall lies on a grid line and every wall corner
 * falls on a grid vertex. 1 cell = 5 ft.
 *
 * Directions are indices 0..3 = North, East, South, West (DX/DY/OPP below).
 *
 * Algorithm (see README.md for the long version):
 *   1. Draw a target area for every room from a normal distribution and build a
 *      rectilinear shape for it (shapes.js).
 *   2. Grow the dungeon as a tree: each new room is attached to the existing
 *      dungeon either DIRECTLY (sharing a wall with a room, joined by a doorway)
 *      or via a HALLWAY. A hallway is a 1-cell-wide passage that can serve many
 *      rooms: a new room may start a new hallway from a room's wall, hang flush
 *      against the long side of an existing hallway, or sit at the end of a
 *      branch that grows off an existing hallway. Some hallways are generated long
 *      and straight so that rooms can line up along them. The chosen connection
 *      type follows the user's setting, flipped with the randomization chance.
 *      How far apart rooms are is set by the spacing (SPACING): Compact lets rooms touch and keeps
 *      rooms a hallway joins within 4 squares; Normal and Spaced Out keep rooms at least 1 or 2
 *      squares apart and within 6 or 12 squares of the rooms a hallway joins them to. A doorway
 *      overrides the minimum: the two rooms it joins share a wall, in every spacing.
 *   3. Add a few extra doorways between rooms that share a wall (hallways never loop).
 *   4. Place external entrances: on the outer walls, spread as far apart as possible
 *      (or, if edgeEntrancesOnly is off, in any room, using a stairway for rooms
 *      that are buried inside the dungeon).
 *   5. Number the rooms in breadth-first order from the first entrance.
 */
(function () {
  const DM = (globalThis.DM = globalThis.DM || {});

  const DX = [0, 1, 0, -1];
  const DY = [-1, 0, 1, 0];
  const OPP = [2, 3, 0, 1];

  const LIMITS = {
    roomCount: [1, 99],
    avgRoomSize: [1, 999],
    // least a room may measure across the map (width) and up and down it (length), in squares
    minRoomWidth: [1, 30],
    minRoomLength: [1, 30],
    sizeVariance: [0, 100], // standard deviation as a % of the average
    entrances: [1, 10],
    // % of connections that use the opposite type from the chosen one
    connectionRandomness: [0, 100],
  };

  /** Used when a caller does not supply connectionRandomness: 14% is the nearest whole percent to 1 in 7. */
  const DEFAULT_CONNECTION_RANDOMNESS = 14;

  /** The three ways a new hallway can start: short, a long straight spine, or curly (winding). */
  const HALL_KINDS = ['short', 'spine', 'curly'];
  /**
   * Hallway types that can be switched on and off. The first three are the kinds above.
   * A spine always serves at least 3 rooms (the two it joins and one along its side; it is built
   * together with that third room) and takes more rooms along its sides whatever else is on;
   * 'branching' lets every other hallway do the same, and lets hallways grow forks, so any
   * hallway can serve 3+ rooms. Hallways never run back round to rooms
   * that are already connected, so there is no loop type.
   */
  const HALL_TYPES = [...HALL_KINDS, 'branching'];

  /** How many of a hallway's openings into rooms get a door: none, a few, most, or every one. */
  const HALL_DOORS = ['none', 'less', 'more', 'all'];
  const DEFAULT_HALL_DOORS = 'less';

  /**
   * How far apart rooms are. A gap is the number of empty squares between two rooms (a room that
   * touches another is 0 apart; one that only meets it at a corner counts as touching too):
   *   min - no two rooms are closer than this, except rooms joined by a doorway: a door in a shared wall
   *         overrides the minimum for the two rooms it joins (and only those two)
   *   max - rooms that a hallway joins are no further apart than this, measured in a straight line
   */
  const SPACING = {
    compact: { min: 0, max: 4 },
    normal: { min: 1, max: 6 },
    spaced: { min: 2, max: 12 },
  };
  const SPACINGS = Object.keys(SPACING);
  const DEFAULT_SPACING = 'compact';

  /**
   * The longest a routed hallway may be, in cells: `direct` is the number of cells in the straight run
   * between its two ends (Manhattan distance, both ends counted); `maxPath` the absolute limit.
   */
  function hallPathLimit(direct, maxPath) {
    return Math.min(maxPath, Math.ceil(direct * CONFIG.maxDetour) + CONFIG.detourSlack);
  }

  /** Can a dungeon with these (validated) settings contain any hallway at all? */
  function hallwaysPossible(params) {
    const r = params.connectionRandomness;
    return params.connectionType === 'hall' ? r < 100 : r > 0;
  }

  const CONFIG = {
    /** Extra doorways between rooms that share a wall, as a fraction of the room count. */
    extraConnectionFraction: 0.2,
    /*
     * Hallway distances (hallLength, hallLateral, spineLength, curlySegment, maxHallPath,
     * pathMargin) are given for rooms of `hallScaleSize` squares
     * and scale with the room's side (the square root of its area) for other sizes,
     * so tiny rooms get short hallways and big rooms long ones. The factor is
     * clamped to [hallScaleMin, hallScaleMax]; set both to 1 to switch scaling off.
     */
    hallScaleSize: 30,
    hallScaleMin: 0.3,
    hallScaleMax: 3,
    /** Length range (in cells) of the straight gap left for a hallway. */
    hallLength: [2, 8],
    /** Max sideways offset (cells) between the two ends of a new hallway. */
    hallLateral: 3,
    /**
     * Chance that a hallway's opening into a room has a door (otherwise it is an open
     * archway), for each setting of the Doors choice. 'less' is the everyday mix.
     */
    hallDoorChance: { none: 0, less: 0.35, more: 0.7, all: 1 },
    /**
     * How often each kind of new hallway is chosen, among the kinds that are switched on
     * (the weights are relative, so switching a kind off shares its weight out):
     *   short - a short passage that may end a few squares off to one side
     *   spine - a long straight passage with rooms lined up along it: always 3 or more rooms
     *   curly - a winding passage that jogs sideways several times
     */
    hallKindWeights: { short: 40, spine: 40, curly: 20 },
    /** How long a spine is. */
    spineLength: [8, 20],
    /** Curly hallways: length of each straight run, and how many sideways jogs there are. */
    curlySegment: [2, 4],
    curlyJogs: [2, 3],
    /** Chance that a hallway-type placement attaches to an existing hallway rather than starting a new one. */
    hallParentChance: 0.65,
    /** How many different existing hallways are tried when attaching a room to one. */
    hallsTriedPerPlacement: 6,
    /** When attaching to an existing hallway: chance of a branching hallway rather than a room flush against its side. */
    hallBranchChance: 0.25,
    /** Random placements sampled per (parent, attempt). */
    placementTries: 40,
    /** Stop sampling once this many valid placements have been found. */
    candidatesPerParent: 10,
    /** Hallway A* may not exceed this many cells. */
    maxHallPath: 60,
    /**
     * A routed hallway (short, spine, or a branch) may be no more than maxDetour times as long as the
     * direct gap between its two ends, plus detourSlack cells, so it can bend round a room that is in the
     * way but never wraps round a whole stretch of the dungeon to reach a room that is close by.
     * (Curly hallways wind on purpose and are not held to this.)
     */
    maxDetour: 1.5,
    detourSlack: 4,
    /** A* search window margin around the two endpoints. */
    pathMargin: 10,
    bendCost: 2.5,
    adjacencyCost: 1.5,
    /** Random multiplier range on the compactness score (bigger = more sprawl). */
    scoreNoise: 1.0,
    /** Probability that the next room hangs off the previously placed room. */
    chainChance: 0.3,
  };

  /**
   * The hallway distances to use for rooms of about `avgRoomSize` squares: the CONFIG
   * values (which are for `hallScaleSize`) scaled with the room's side length.
   * Hallways never shrink below one cell, and the routing window keeps a floor so that
   * even tiny rooms can still be linked.
   */
  function hallSettings(avgRoomSize) {
    const scale = Math.max(CONFIG.hallScaleMin, Math.min(CONFIG.hallScaleMax, Math.sqrt(avgRoomSize / CONFIG.hallScaleSize)));
    const sc = (v, floor) => Math.max(floor, Math.round(v * scale));
    const lo = sc(CONFIG.hallLength[0], 1);
    const hi = Math.max(lo, sc(CONFIG.hallLength[1], 2));
    const spineLo = Math.max(hi, sc(CONFIG.spineLength[0], 2));
    const spineHi = Math.max(spineLo + 1, sc(CONFIG.spineLength[1], 3));
    const segLo = sc(CONFIG.curlySegment[0], 1);
    const segHi = Math.max(segLo + 1, sc(CONFIG.curlySegment[1], 2));
    return {
      scale,
      length: [lo, hi],
      spine: [spineLo, spineHi],
      curly: [segLo, segHi],
      lateral: sc(CONFIG.hallLateral, 1),
      maxPath: sc(CONFIG.maxHallPath, 20),
      margin: sc(CONFIG.pathMargin, 5),
    };
  }

  // ---- parameters -----------------------------------------------------------

  function validateParams(raw) {
    raw = raw || {};
    const errors = {};
    const params = {};
    const labels = {
      roomCount: 'Room count',
      avgRoomSize: 'Average room size',
      minRoomWidth: 'Minimum room width',
      minRoomLength: 'Minimum room length',
      sizeVariance: 'Size variance',
      entrances: 'Entrances',
      connectionRandomness: 'Connection randomization',
    };
    for (const key of Object.keys(LIMITS)) {
      const [lo, hi] = LIMITS[key];
      let v = raw[key];
      if (key === 'connectionRandomness' && (v === undefined || v === null)) v = DEFAULT_CONNECTION_RANDOMNESS;
      if ((key === 'minRoomWidth' || key === 'minRoomLength') && (v === undefined || v === null)) v = 1; // no minimum

      const n = typeof v === 'string' ? (v.trim() === '' ? NaN : Number(v)) : Number(v);
      if (v === undefined || v === null || !Number.isInteger(n) || n < lo || n > hi) {
        errors[key] = `${labels[key]} must be a whole number from ${lo} to ${hi}.`;
      } else {
        params[key] = n;
      }
    }
    if (raw.connectionType === 'door' || raw.connectionType === 'hall') {
      params.connectionType = raw.connectionType;
    } else {
      errors.connectionType = 'Connection type must be "door" or "hall".';
    }
    // true (default): entrances only on the outer edge. false: entrances may be anywhere.
    const edgeOnly = raw.edgeEntrancesOnly === undefined || raw.edgeEntrancesOnly === null ? true : raw.edgeEntrancesOnly;
    if (typeof edgeOnly === 'boolean') {
      params.edgeEntrancesOnly = edgeOnly;
    } else {
      errors.edgeEntrancesOnly = 'Entrances on outer edge only must be true or false.';
    }
    // Which room shapes may be used: a list of shape names (default: all). Stored in the
    // shapes module's own order, so the same set always gives the same dungeon.
    const allShapes = DM.SHAPE_KINDS;
    const wanted = raw.roomShapes === undefined || raw.roomShapes === null ? allShapes : raw.roomShapes;
    if (!Array.isArray(wanted) || wanted.some((k) => !allShapes.includes(k))) {
      errors.roomShapes = `Room shapes must be a list made of: ${allShapes.join(', ')}.`;
    } else if (wanted.length === 0) {
      errors.roomShapes = 'Switch on at least one room shape.';
    } else {
      params.roomShapes = allShapes.filter((k) => wanted.includes(k));
    }
    // Which kinds of hallway may be built: a list of type names (default: all), kept in
    // HALL_TYPES order. Hallways have to start as a short, spine or curly one; branching
    // only adds to those, so one of the three is needed wherever hallways can occur.
    const wantedHalls = raw.hallTypes === undefined || raw.hallTypes === null ? HALL_TYPES : raw.hallTypes;
    if (!Array.isArray(wantedHalls) || wantedHalls.some((k) => !HALL_TYPES.includes(k))) {
      errors.hallTypes = `Hallway types must be a list made of: ${HALL_TYPES.join(', ')}.`;
    } else {
      const chosen = HALL_TYPES.filter((k) => wantedHalls.includes(k));
      const known = params.connectionType !== undefined && params.connectionRandomness !== undefined;
      if (known && hallwaysPossible(params) && !chosen.some((k) => HALL_KINDS.includes(k))) {
        errors.hallTypes =
          'Switch on Short, Spine or Curly: a hallway has to start somewhere. Branching only adds to hallways.';
      } else {
        params.hallTypes = chosen;
      }
    }
    // How many hallway openings have doors: none / less / more / all (default: less).
    const doors = raw.hallDoors === undefined || raw.hallDoors === null ? DEFAULT_HALL_DOORS : raw.hallDoors;
    if (HALL_DOORS.includes(doors)) {
      params.hallDoors = doors;
    } else {
      errors.hallDoors = `Hallway doors must be one of: ${HALL_DOORS.join(', ')}.`;
    }
    // How far apart rooms are: compact / normal / spaced (default: compact).
    const spacing = raw.spacing === undefined || raw.spacing === null ? DEFAULT_SPACING : raw.spacing;
    if (SPACINGS.includes(spacing)) {
      params.spacing = spacing;
    } else {
      errors.spacing = `Room spacing must be one of: ${SPACINGS.join(', ')}.`;
    }
    params.seed = raw.seed === undefined || raw.seed === null || String(raw.seed).trim() === '' ? null : String(raw.seed).trim();
    return { ok: Object.keys(errors).length === 0, errors, params };
  }

  // ---- room size distribution ----------------------------------------------

  function normalPdf(z) {
    return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  }

  function normalCdf(z) {
    // Abramowitz & Stegun 26.2.17
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp((-z * z) / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  }

  /**
   * The size rooms are built around: the average room size, or the smallest room
   * (minRoomWidth x minRoomLength squares) if that is larger.
   */
  function baseRoomArea(params) {
    return Math.max(params.avgRoomSize, params.minRoomWidth * params.minRoomLength);
  }

  /**
   * Room areas follow a normal distribution, but a room cannot have less than
   * `minArea` cells (one by default). Cutting off the left tail would nudge the
   * mean upwards when the variance is large, so the underlying mean is shifted until
   * the mean of the truncated distribution equals the requested average. When the
   * average is the minimum itself, rooms can only be larger than it, so the mean
   * ends up a little above it however far the shift goes.
   */
  function makeAreaSampler(rng, avg, sd, minArea = 1) {
    const LO = minArea - 0.5; // anything below this rounds to fewer than minArea cells
    if (sd <= 0) return () => avg;

    const truncMean = (mu) => {
      const a = (LO - mu) / sd;
      const tail = Math.max(1 - normalCdf(a), 1e-9);
      return mu + (sd * normalPdf(a)) / tail;
    };
    // (shifting further than 4 deviations below the cut-off is beyond what normalCdf can resolve)
    let lo = LO - 4 * sd;
    let hi = avg;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (truncMean(mid) < avg) lo = mid;
      else hi = mid;
    }
    const mu = (lo + hi) / 2;

    // Standardised cut-off. Far out in the tail (the average is at or near the minimum)
    // plain rejection almost never succeeds, so sample the tail directly instead
    // (Robert 1995: an exponential proposal with rate alpha, accepted by a Gaussian ratio).
    const cut = (LO - mu) / sd;
    if (cut <= 0.5) {
      return () => {
        for (let i = 0; i < 200; i++) {
          const a = rng.normal(mu, sd);
          if (a >= LO) return Math.round(a);
        }
        return minArea;
      };
    }
    const alpha = (cut + Math.sqrt(cut * cut + 4)) / 2;
    return () => {
      for (let i = 0; i < 200; i++) {
        const z = cut - Math.log(1 - rng.next()) / alpha;
        if (rng.next() <= Math.exp(-0.5 * (z - alpha) * (z - alpha))) return Math.round(mu + sd * z);
      }
      return minArea;
    };
  }

  // ---- A* priority queue ----------------------------------------------------

  class MinHeap {
    constructor() {
      this.keys = [];
      this.vals = [];
    }
    get size() {
      return this.keys.length;
    }
    push(key, val) {
      const keys = this.keys;
      const vals = this.vals;
      let i = keys.length;
      keys.push(key);
      vals.push(val);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (keys[p] <= key) break;
        keys[i] = keys[p];
        vals[i] = vals[p];
        i = p;
      }
      keys[i] = key;
      vals[i] = val;
    }
    pop() {
      const keys = this.keys;
      const vals = this.vals;
      const top = vals[0];
      const lastKey = keys.pop();
      const lastVal = vals.pop();
      const n = keys.length;
      if (n > 0) {
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= n) break;
          if (c + 1 < n && keys[c + 1] < keys[c]) c++;
          if (keys[c] >= lastKey) break;
          keys[i] = keys[c];
          vals[i] = vals[c];
          i = c;
        }
        keys[i] = lastKey;
        vals[i] = lastVal;
      }
      return top;
    }
  }

  // ---- the builder ----------------------------------------------------------

  class Builder {
    constructor(params, rng, shapes) {
      this.params = params;
      this.rng = rng;
      this.shapes = shapes;

      let maxDim = 0;
      let sumArea = 0;
      for (const s of shapes) {
        maxDim = Math.max(maxDim, s.w, s.h);
        sumArea += s.area;
      }
      this.hall = hallSettings(baseRoomArea(params));
      // how far apart rooms may be (see SPACING)
      this.gap = SPACING[params.spacing];
      // the hallway types that are switched on, and which of them can start a new hallway
      this.types = new Set(params.hallTypes);
      this.kinds = HALL_KINDS.filter((k) => this.types.has(k));
      // how many times each hallway type has been used (reported in the model's stats)
      this.used = { short: 0, spine: 0, curly: 0, branching: 0 };
      // room for the rooms themselves plus the hallways between them (and the gaps, which add up over the dungeon)
      const spread = shapes.length > 1 ? Math.ceil(Math.sqrt(shapes.length)) * this.gap.max * 2 : 0;
      const side = Math.max(Math.ceil(Math.sqrt(sumArea * 4)) * 2 + 80 + 2 * this.hall.spine[1] + spread, maxDim * 4 + 40);
      this.W = side;
      this.H = side;
      // 0 = empty, +n = room with index n-1, -n = hall with index n-1
      this.occ = new Int32Array(side * side);

      this.rooms = [];
      this.halls = [];
      this.connections = [];
      this.pairs = new Set();
      this.entrances = [];
      this.warnings = [];

      this.cellCount = 0;
      this.sumX = 0;
      this.sumY = 0;
    }

    // ---- bookkeeping --------------------------------------------------------

    pairKey(a, b) {
      return a < b ? `${a}-${b}` : `${b}-${a}`;
    }

    chooseType() {
      const base = this.params.connectionType;
      const other = base === 'door' ? 'hall' : 'door';
      return this.rng.chance(this.params.connectionRandomness / 100) ? other : base;
    }

    addRoom(shape, ox, oy) {
      const { W, occ } = this;
      const id = this.rooms.length;
      const cells = new Array(shape.cells.length);
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < shape.cells.length; i++) {
        const x = shape.cells[i][0] + ox;
        const y = shape.cells[i][1] + oy;
        cells[i] = [x, y];
        occ[y * W + x] = id + 1;
        sx += x + 0.5;
        sy += y + 0.5;
      }

      // wall edges of the room: (cell, side) pairs whose neighbour is not in the room
      const edges = [];
      const interiorEdges = [];
      for (const [x, y] of cells) {
        for (let d = 0; d < 4; d++) {
          if (occ[(y + DY[d]) * W + x + DX[d]] === id + 1) continue;
          const px = DX[(d + 1) % 4];
          const py = DY[(d + 1) % 4];
          // "interior" = the wall continues on both sides of this edge (not a corner edge)
          const inRoom = (cx, cy) => occ[cy * W + cx] === id + 1;
          const interior =
            inRoom(x + px, y + py) &&
            inRoom(x - px, y - py) &&
            !inRoom(x + px + DX[d], y + py + DY[d]) &&
            !inRoom(x - px + DX[d], y - py + DY[d]);
          const edge = { x, y, d, interior };
          edges.push(edge);
          if (interior) interiorEdges.push(edge);
        }
      }

      // perim: the cells with a wall on them, which are all that matter for how near two rooms are
      const room = { id, shape, cells, edges, interiorEdges, degree: 0, sumX: sx, sumY: sy, ox, oy, perim: cells.slice(0, shape.perimeterCount) };
      this.rooms.push(room);
      this.cellCount += cells.length;
      this.sumX += sx;
      this.sumY += sy;
      return room;
    }

    /** Take back the hallway laid down last, if it has not been connected to anything yet. */
    removeLastHall() {
      const hall = this.halls.pop();
      for (const [x, y] of hall.cells) {
        this.occ[y * this.W + x] = 0;
        this.sumX -= x + 0.5;
        this.sumY -= y + 0.5;
      }
      this.cellCount -= hall.cells.length;
    }

    removeLastRoom() {
      const room = this.rooms.pop();
      for (const [x, y] of room.cells) this.occ[y * this.W + x] = 0;
      this.cellCount -= room.cells.length;
      this.sumX -= room.sumX;
      this.sumY -= room.sumY;
    }

    /**
     * A hallway is a connected set of 1-cell-wide passages. It starts as the path
     * between two rooms and can then grow branches and gain more rooms (see
     * extendHall / attachToHall), so one hallway can serve many rooms.
     */
    addHall(path, kind) {
      const id = this.halls.length;
      for (const [x, y] of path) {
        this.occ[y * this.W + x] = -(id + 1);
        this.sumX += x + 0.5;
        this.sumY += y + 0.5;
      }
      this.cellCount += path.length;
      // kind: how the hallway started ('short', 'spine' or 'curly'); branches it grows later do not change it
      const hall = { id, kind, cells: path.slice(), isHall: true, conn: null };
      this.halls.push(hall);
      return hall;
    }

    /** Add more passage cells (a branch) to an existing hallway. */
    extendHall(hall, path) {
      for (const [x, y] of path) {
        this.occ[y * this.W + x] = -(hall.id + 1);
        this.sumX += x + 0.5;
        this.sumY += y + 0.5;
        hall.cells.push([x, y]);
      }
      this.cellCount += path.length;
    }

    /**
     * Record a connection: a doorway between rooms a and b, or (with `hall`) a
     * hallway between them. Returns the connection; hallway connections can later
     * gain rooms through attachToHall.
     */
    addConnection(type, a, b, hall, openings) {
      const conn = {
        id: this.connections.length,
        type,
        rooms: [a.id, b.id],
        hall: hall ? hall.id : null,
        openings,
      };
      this.connections.push(conn);
      if (hall) hall.conn = conn;
      this.pairs.add(this.pairKey(a.id, b.id));
      a.degree++;
      b.degree++;
      return conn;
    }

    /** Join `room` to a hallway that already serves other rooms, through `opening`. */
    attachToHall(hall, room, opening) {
      const conn = hall.conn;
      for (const other of conn.rooms) this.pairs.add(this.pairKey(other, room.id));
      conn.rooms.push(room.id);
      conn.openings.push(opening);
      room.degree++;
    }

    /**
     * Every open side of a hallway: (hall cell, side) pairs whose neighbour is
     * empty. `straight` marks sides along a straight stretch (the hallway
     * continues on both sides of the cell), the best place to hang a room.
     */
    hallSides(hall) {
      const { W, occ } = this;
      const own = -(hall.id + 1);
      const sides = [];
      for (const [x, y] of hall.cells) {
        for (let d = 0; d < 4; d++) {
          if (occ[(y + DY[d]) * W + x + DX[d]] !== 0) continue;
          const px = DX[(d + 1) % 4];
          const py = DY[(d + 1) % 4];
          const straight = occ[(y + py) * W + x + px] === own && occ[(y - py) * W + x - px] === own;
          sides.push({ x, y, d, straight });
        }
      }
      return sides;
    }

    sampleEdge(room) {
      const list = room.interiorEdges.length > 0 && this.rng.chance(0.75) ? room.interiorEdges : room.edges;
      return list[Math.floor(this.rng.next() * list.length)];
    }

    // ---- placement validity -------------------------------------------------

    /**
     * Can `shape` be stamped at offset (ox, oy)?
     * mode 'door': may touch other rooms but never a hallway (except the one
     *   whose index+1 is `allowHall`, for rooms attached to the side of a hallway).
     * mode 'hall': may not touch anything (a gap is needed for the hallway).
     * Either way, with a minimum spacing every other room stays at least that many empty squares away
     * (diagonals too), so rooms that cannot touch have a clear gap all round. The one exception is the room
     * whose index+1 is `joinedRoom`: a room placed against it with a doorway may touch it.
     */
    canPlace(shape, ox, oy, mode, allowHall = 0, joinedRoom = 0) {
      const { W, H, occ } = this;
      const cells = shape.cells;
      const perimeter = shape.perimeterCount;
      const noRoomContact = mode === 'hall';
      const clear = this.gap.min;
      for (let i = 0; i < cells.length; i++) {
        const x = cells[i][0] + ox;
        const y = cells[i][1] + oy;
        if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) return false;
        const k = y * W + x;
        if (occ[k] !== 0) return false;
        if (i < perimeter) {
          for (let d = 0; d < 4; d++) {
            const v = occ[k + DY[d] * W + DX[d]];
            if (v < 0 && v !== -allowHall) return false;
            if (v !== 0 && noRoomContact) return false;
          }
          // (a room's nearest cell to any other room is always one of its wall cells, so these are the only ones to check)
          for (let dy = -clear; dy <= clear; dy++) {
            for (let dx = -clear; dx <= clear; dx++) {
              const v = occ[k + dy * W + dx];
              if (v > 0 && v !== joinedRoom) return false;
            }
          }
        }
      }
      return true;
    }

    /**
     * Is `shape`, stamped at (ox, oy), within the greatest gap of at least one of the rooms `ids`?
     * (Fewer than `gap.max` empty squares in a straight line between them: Chebyshev distance.)
     */
    withinReach(shape, ox, oy, ids) {
      const reach = this.gap.max + 1; // Chebyshev distance of the nearest cells
      const x0 = ox;
      const y0 = oy;
      const x1 = ox + shape.w - 1;
      const y1 = oy + shape.h - 1;
      const per = shape.perimeterCount;
      for (const id of ids) {
        const r = this.rooms[id];
        // the boxes round the two rooms already give a lower bound on how far apart they are
        const bx = Math.max(0, r.ox - x1, x0 - (r.ox + r.shape.w - 1));
        const by = Math.max(0, r.oy - y1, y0 - (r.oy + r.shape.h - 1));
        if (Math.max(bx, by) > reach) continue;
        for (let i = 0; i < per; i++) {
          const cx = shape.cells[i][0] + ox;
          const cy = shape.cells[i][1] + oy;
          for (const [qx, qy] of r.perim) {
            if (Math.max(Math.abs(qx - cx), Math.abs(qy - cy)) <= reach) return true;
          }
        }
      }
      return false;
    }

    /**
     * How long a short or spine hallway may be, in cells, when this spacing lets rooms be no further
     * apart than `gap.max`. The natural lengths are cut down to fit, and never below the least gap.
     * `extra` stretches the top of the range (to reach further when the dungeon is crowded).
     */
    lengthRange(kind, extra = 0) {
      const natural = kind === 'spine' ? this.hall.spine : this.hall.length;
      const top = this.gap.max;
      const bottom = Math.max(1, this.gap.min);
      let lo = natural[0];
      let hi = Math.min(natural[1] + extra, top);
      if (lo > hi) lo = kind === 'spine' ? Math.ceil(top * 0.6) : hi; // a spine is still a long one, for what fits
      lo = Math.max(lo, bottom);
      hi = Math.max(hi, lo);
      return [lo, hi];
    }

    /** Lower is better. Prefers placements near the centre of mass (compact dungeons). */
    score(shape, ox, oy) {
      const cx = ox + shape.w / 2;
      const cy = oy + shape.h / 2;
      const mx = this.sumX / this.cellCount;
      const my = this.sumY / this.cellCount;
      const d2 = (cx - mx) * (cx - mx) + (cy - my) * (cy - my);
      return d2 * (1 + this.rng.next() * CONFIG.scoreNoise);
    }

    /**
     * A hallway cell must be empty and may only touch the regions it joins
     * (idA / idB, each a room or a hallway). It may touch a hallway only at an
     * `endpoint` of a route (where a branch meets it), never along the way, and
     * then at exactly one cell. Otherwise a new passage would hug the old one
     * and merge into a hallway wider than one cell.
     */
    hallCellOk(x, y, idA, idB, endpoint = true) {
      const { W, occ } = this;
      const k = y * W + x;
      if (occ[k] !== 0) return false;
      let hallNeighbours = 0;
      for (let d = 0; d < 4; d++) {
        const v = occ[k + DY[d] * W + DX[d]];
        if (v === 0) continue;
        if (v !== idA && v !== idB) return false;
        if (v < 0 && (!endpoint || ++hallNeighbours > 1)) return false;
      }
      return true;
    }

    // ---- hallway routing ----------------------------------------------------

    /**
     * A* route between two cells through empty space, preferring straight runs
     * and keeping clear of every room except idA / idB.
     * @returns {number[][]|null} cells from start to goal, inclusive
     */
    findPath(sx, sy, sdir, gx, gy, idA, idB) {
      const { W } = this;
      const M = this.hall.margin;
      const minX = Math.max(2, Math.min(sx, gx) - M);
      const maxX = Math.min(W - 3, Math.max(sx, gx) + M);
      const minY = Math.max(2, Math.min(sy, gy) - M);
      const maxY = Math.min(this.H - 3, Math.max(sy, gy) + M);
      if (sx < minX || sx > maxX || sy < minY || sy > maxY) return null;
      if (gx < minX || gx > maxX || gy < minY || gy > maxY) return null;

      const ww = maxX - minX + 1;
      const wh = maxY - minY + 1;
      const states = ww * wh * 4;
      const cost = new Float32Array(states).fill(Infinity);
      const parent = new Int32Array(states).fill(-1);
      const closed = new Uint8Array(states);
      const okCache = new Uint8Array(ww * wh); // 0 unknown, 1 ok, 2 blocked

      const cellOk = (x, y) => {
        const li = (y - minY) * ww + (x - minX);
        let r = okCache[li];
        if (r === 0) {
          // only the end of the route that meets a hallway may touch it; the end that
          // meets a room must not, or a short branch hugs the hallway and widens it
          const endpoint = (x === sx && y === sy && idA < 0) || (x === gx && y === gy && idB < 0);
          r = this.hallCellOk(x, y, idA, idB, endpoint) ? 1 : 2;
          okCache[li] = r;
        }
        return r === 1;
      };
      if (!cellOk(sx, sy) || !cellOk(gx, gy)) return null;

      const occ = this.occ;
      const heuristic = (x, y) => Math.abs(x - gx) + Math.abs(y - gy);
      const heap = new MinHeap();
      const start = (((sy - minY) * ww + (sx - minX)) << 2) | sdir;
      cost[start] = 0;
      heap.push(heuristic(sx, sy), start);

      while (heap.size > 0) {
        const cur = heap.pop();
        if (closed[cur]) continue;
        closed[cur] = 1;
        const dir = cur & 3;
        const cell = cur >> 2;
        const cx = minX + (cell % ww);
        const cy = minY + Math.floor(cell / ww);

        if (cx === gx && cy === gy) {
          const path = [];
          for (let s = cur; s !== -1; s = parent[s]) {
            const c = s >> 2;
            path.push([minX + (c % ww), minY + Math.floor(c / ww)]);
          }
          path.reverse();
          const direct = Math.abs(sx - gx) + Math.abs(sy - gy) + 1;
          return path.length <= hallPathLimit(direct, this.hall.maxPath) ? path : null;
        }

        const base = cost[cur];
        for (let nd = 0; nd < 4; nd++) {
          if (nd === OPP[dir]) continue;
          const nx = cx + DX[nd];
          const ny = cy + DY[nd];
          if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
          if (!cellOk(nx, ny)) continue;
          const ns = (((ny - minY) * ww + (nx - minX)) << 2) | nd;
          if (closed[ns]) continue;

          let c = base + 1 + (nd !== dir ? CONFIG.bendCost : 0);
          const k = ny * W + nx;
          for (let d = 0; d < 4; d++) {
            if (occ[k + DY[d] * W + DX[d]] !== 0) c += CONFIG.adjacencyCost;
          }
          if (c < cost[ns]) {
            cost[ns] = c;
            parent[ns] = cur;
            heap.push(c + heuristic(nx, ny), ns);
          }
        }
      }
      return null;
    }

    /**
     * A ready-made route (a list of cells from start to goal) if every cell of it is a
     * legal hallway cell between regions idA and idB, otherwise null. Used for routes
     * that are laid out directly rather than found by findPath.
     */
    checkRoute(route, idA, idB, startsAtHall) {
      const { W, H } = this;
      if (route.length > this.hall.maxPath) return null;
      for (let i = 0; i < route.length; i++) {
        const [x, y] = route[i];
        if (x < 2 || y < 2 || x > W - 3 || y > H - 3) return null;
        if (!this.hallCellOk(x, y, idA, idB, i === 0 && startsAtHall)) return null;
      }
      // two cells that touch without following each other would make a passage two wide
      const at = new Map();
      route.forEach(([x, y], i) => at.set(y * W + x, i));
      for (let i = 0; i < route.length; i++) {
        for (let d = 0; d < 4; d++) {
          const j = at.get((route[i][1] + DY[d]) * W + route[i][0] + DX[d]);
          if (j !== undefined && Math.abs(i - j) !== 1) return null;
        }
      }
      return route;
    }

    /**
     * Lay out a winding route that starts at cell (sx, sy) and heads in direction `dir`:
     * a straight run, then a jog to one side and another straight run, a few times over,
     * so that it has at least four bends. It always finishes heading in `dir`, so a room
     * can sit square against its end. The route is not checked against the map.
     */
    curlyRoute(sx, sy, dir) {
      const { rng } = this;
      const [lo, hi] = this.hall.curly;
      // (the runs ahead need a square each, and the first needs two to have a bend before the first jog, so a
      // spacing that is tight allows fewer jogs)
      const jogs = Math.min(rng.int(CONFIG.curlyJogs[0], CONFIG.curlyJogs[1]), this.gap.max - 2);
      let turn = rng.chance(0.5) ? 1 : 3; // a quarter turn to the right or to the left of `dir`
      // Lengths of the straight runs: ahead (the first one includes the start cell), then a jog sideways and a run
      // ahead again for every jog. `turns` says which way each jog goes.
      const ahead = [Math.max(2, rng.int(lo, hi))];
      const aside = [];
      const turns = [];
      for (let j = 0; j < jogs; j++) {
        aside.push(rng.int(lo, hi));
        turns.push(turn);
        ahead.push(rng.int(lo, hi));
        if (rng.chance(0.7)) turn = 4 - turn; // mostly weave left and right, sometimes keep going the same way
      }

      // Rooms may be no further apart than the spacing allows, so the winding is shrunk to fit: the squares
      // between the start room and the room at the end (one more than the runs ahead) and how far the end is
      // off to one side. (A hallway of this length is never shorter than the four bends it needs.)
      const shrink = (runs, least, over) => {
        for (let guard = 0; guard < 200 && over(); guard++) {
          let at = -1;
          for (let i = 0; i < runs.length; i++) if (runs[i] > least[i] && (at < 0 || runs[i] - least[i] > runs[at] - least[at])) at = i;
          if (at < 0) break;
          runs[at]--;
        }
      };
      shrink(ahead, [2, ...aside.map(() => 1)], () => ahead.reduce((a, b) => a + b, 0) > this.gap.max);
      const drift = () => Math.abs(aside.reduce((sum, n, j) => sum + (turns[j] === 1 ? n : -n), 0));
      shrink(aside, aside.map(() => 1), () => drift() > this.gap.max + 1);

      const cells = [[sx, sy]];
      let x = sx;
      let y = sy;
      const run = (d, n) => {
        for (let i = 0; i < n; i++) {
          x += DX[d];
          y += DY[d];
          cells.push([x, y]);
        }
      };
      run(dir, ahead[0] - 1); // the start cell is the first cell of the first run
      for (let j = 0; j < jogs; j++) {
        run((dir + turns[j]) % 4, aside[j]);
        run(dir, ahead[j + 1]);
      }
      return cells;
    }

    /**
     * Which kind of hallway to start next: one of the kinds that are switched on, by weight.
     * Null if there is none to pick (every kind is off, or only spines are on and spines are ruled out).
     */
    pickKind(allowSpine = true) {
      const kinds = allowSpine ? this.kinds : this.kinds.filter((k) => k !== 'spine');
      if (kinds.length === 0) return null;
      return kinds[this.rng.weightedIndex(kinds.map((k) => CONFIG.hallKindWeights[k]))];
    }

    hallStyle() {
      return this.rng.chance(CONFIG.hallDoorChance[this.params.hallDoors]) ? 'door' : 'open';
    }

    /** Record a hallway between edge ea (a cell of room a) and edge eb (a cell of room b). */
    commitHall(path, a, b, ea, eb, kind) {
      this.connectHall(this.addHall(path, kind), a, b, ea, eb);
    }

    /** Join rooms a and b through a hallway that has been laid down already (see addHall). */
    connectHall(hall, a, b, ea, eb) {
      this.addConnection('hall', a, b, hall, [
        { x: ea.x, y: ea.y, d: ea.d, style: this.hallStyle(), room: a.id },
        { x: eb.x, y: eb.y, d: eb.d, style: this.hallStyle(), room: b.id },
      ]);
    }

    // ---- growing the dungeon -----------------------------------------------

    pickParent() {
      const { rng, rooms } = this;
      if (rooms.length > 1 && rng.chance(CONFIG.chainChance)) return rooms[rooms.length - 1];
      const weights = rooms.map((r) => 1 / Math.pow(1 + r.degree, 1.5));
      return rooms[rng.weightedIndex(weights)];
    }

    /** Attach `shape` to `parent` so that the two rooms share a wall, joined by a door. */
    tryDoor(parent, shape) {
      const { rng, W, occ } = this;
      let best = null;
      let bestScore = Infinity;
      let valid = 0;
      for (let t = 0; t < CONFIG.placementTries && valid < CONFIG.candidatesPerParent; t++) {
        const e = this.sampleEdge(parent);
        const nx = e.x + DX[e.d];
        const ny = e.y + DY[e.d];
        if (occ[ny * W + nx] !== 0) continue;
        // the new room's cell that will sit just outside the door, on its wall facing the parent
        const openIdx = shape.open[OPP[e.d]];
        const m = shape.cells[openIdx[Math.floor(rng.next() * openIdx.length)]];
        const ox = nx - m[0];
        const oy = ny - m[1];
        if (!this.canPlace(shape, ox, oy, 'door', 0, parent.id + 1)) continue; // (a doorway may touch its own room whatever the spacing)
        valid++;
        const s = this.score(shape, ox, oy);
        if (s < bestScore) {
          bestScore = s;
          best = { e, ox, oy };
        }
      }
      if (!best) return null;
      const room = this.addRoom(shape, best.ox, best.oy);
      this.addConnection('door', parent, room, null, [
        { x: best.e.x, y: best.e.y, d: best.e.d, style: 'door', room: parent.id },
      ]);
      return room;
    }

    /**
     * Attach `shape` to `parent` across a gap bridged by a hallway.
     *
     * `parent` is a room (a new hallway starts at one of its walls) or an existing
     * hallway (a branch grows from one of its open sides, becoming part of it).
     * The hallway is of one of the kinds that are switched on (see pickKind): short,
     * a long straight spine that more rooms can later be attached along, or curly.
     * `extra` stretches the length range of short and spine hallways, to reach further.
     */
    tryHall(parent, shape, tries, extra = 0) {
      const { rng, W, occ } = this;
      const fromHall = parent.isHall === true;
      // A spine always has at least 3 rooms: the two it joins and one along its side. So a spine can only be
      // started with another room still to place (it is built together with the new room, see below).
      const spineOk = fromHall || this.rooms.length + 1 < this.shapes.length;
      const kind = this.pickKind(spineOk);
      if (kind === null) return null; // every way of starting a hallway is switched off (or only a spine, with no room to spare)
      const allowId = fromHall ? -(parent.id + 1) : parent.id + 1;
      let sides = null;
      let straightSides = null;
      if (fromHall) {
        sides = this.hallSides(parent);
        if (sides.length === 0) return null;
        straightSides = sides.filter((s) => s.straight);
      }
      const [lo, hi] = this.lengthRange(kind, extra);
      const lateralMax = Math.min(this.hall.lateral, this.gap.max + 1); // (a room off to the side is still within the greatest gap)
      const served = fromHall ? parent.conn.rooms : [parent.id]; // the rooms the new one has to be near enough to
      const newSpine = kind === 'spine' && !fromHall; // a hallway that starts as a spine (a branch of that length off another hallway does not)

      const cands = [];
      for (let t = 0; t < tries && cands.length < CONFIG.candidatesPerParent; t++) {
        const e = fromHall
          ? rng.pick(straightSides.length > 0 && rng.chance(0.6) ? straightSides : sides)
          : this.sampleEdge(parent);
        const sx = e.x + DX[e.d];
        const sy = e.y + DY[e.d];
        if (occ[sy * W + sx] !== 0 || !this.hallCellOk(sx, sy, allowId, allowId)) continue;

        // cell of the new room that the hallway will end against
        let mx;
        let my;
        let route = null; // curly hallways are laid out in full here; the others are routed later
        if (kind === 'curly') {
          route = this.curlyRoute(sx, sy, e.d);
          const end = route[route.length - 1];
          mx = end[0] + DX[e.d];
          my = end[1] + DY[e.d];
        } else {
          const len = rng.int(lo, hi);
          const lat = kind === 'spine' ? 0 : rng.int(-lateralMax, lateralMax);
          const perp = (e.d + 1) % 4;
          mx = e.x + DX[e.d] * (len + 1) + DX[perp] * lat;
          my = e.y + DY[e.d] * (len + 1) + DY[perp] * lat;
          if (kind === 'spine') {
            // a spine is a straight line, not a route that bends round whatever is in the way
            route = [];
            for (let i = 1; i <= len; i++) route.push([e.x + DX[e.d] * i, e.y + DY[e.d] * i]);
          }
        }
        const openIdx = shape.open[OPP[e.d]];
        const m = shape.cells[openIdx[Math.floor(rng.next() * openIdx.length)]];
        const ox = mx - m[0];
        const oy = my - m[1];
        if (!this.canPlace(shape, ox, oy, 'hall')) continue;
        if (!this.withinReach(shape, ox, oy, served)) continue;
        cands.push({ e, ox, oy, mx, my, route, score: this.score(shape, ox, oy) });
      }
      cands.sort((a, b) => a.score - b.score);

      for (let i = 0; i < Math.min(4, cands.length); i++) {
        const c = cands[i];
        const room = this.addRoom(shape, c.ox, c.oy); // stamped so the route avoids it
        const company = newSpine ? this.shapes[this.rooms.length] : null; // the next room to place, which goes along this spine
        const path = c.route
          ? this.checkRoute(c.route, allowId, room.id + 1, fromHall)
          : this.findPath(
              c.e.x + DX[c.e.d],
              c.e.y + DY[c.e.d],
              c.e.d,
              c.mx - DX[c.e.d],
              c.my - DY[c.e.d],
              allowId,
              room.id + 1
            );
        // a new spine is laid down first, to see that a room fits along its side; if none does, it is not built
        let hall = null;
        let along = null;
        if (path && newSpine) {
          hall = this.addHall(path, kind);
          along = this.findFlush(hall, company, [parent.id, room.id]);
          if (!along) {
            this.removeLastHall();
            this.removeLastRoom();
            continue;
          }
        }
        if (path) {
          this.used[kind]++;
          if (fromHall) this.used.branching++;
          if (fromHall) {
            // the branch becomes part of the hallway, which now also serves the new room
            this.extendHall(parent, path);
            this.attachToHall(parent, room, {
              x: c.mx,
              y: c.my,
              d: OPP[c.e.d],
              style: this.hallStyle(),
              room: room.id,
            });
          } else if (hall) {
            this.connectHall(hall, parent, room, c.e, { x: c.mx, y: c.my, d: OPP[c.e.d] });
            this.placeFlush(hall, company, along); // the third room of the spine
            this.extraPlaced = 1;
          } else {
            this.commitHall(path, parent, room, c.e, { x: c.mx, y: c.my, d: OPP[c.e.d] }, kind);
          }
          return room;
        }
        this.removeLastRoom();
      }
      return null;
    }

    /** Hang `shape` flush against the long side of an existing hallway, with an opening into it. */
    tryFlush(hall, shape) {
      const best = this.findFlush(hall, shape);
      return best ? this.placeFlush(hall, shape, best) : null;
    }

    /**
     * Where `shape` could hang flush against the side of `hall` (the best spot found), or null. Places nothing.
     * `served` lists the rooms the hallway joins (a hallway still being built has no connection yet to say).
     */
    findFlush(hall, shape, served = hall.conn.rooms) {
      const { rng } = this;
      const sides = this.hallSides(hall);
      if (sides.length === 0) return null;
      const straight = sides.filter((s) => s.straight);

      let best = null;
      let bestScore = Infinity;
      let valid = 0;
      for (let t = 0; t < CONFIG.placementTries && valid < CONFIG.candidatesPerParent; t++) {
        const e = rng.pick(straight.length > 0 && rng.chance(0.8) ? straight : sides);
        const nx = e.x + DX[e.d];
        const ny = e.y + DY[e.d];
        const openIdx = shape.open[OPP[e.d]];
        const m = shape.cells[openIdx[Math.floor(rng.next() * openIdx.length)]];
        const ox = nx - m[0];
        const oy = ny - m[1];
        if (!this.canPlace(shape, ox, oy, 'door', hall.id + 1)) continue;
        if (!this.withinReach(shape, ox, oy, served)) continue;
        valid++;
        const s = this.score(shape, ox, oy);
        if (s < bestScore) {
          bestScore = s;
          best = { e, nx, ny, ox, oy };
        }
      }
      return best;
    }

    /** Put `shape` in a spot found by findFlush, with an opening into the hallway. */
    placeFlush(hall, shape, best) {
      const room = this.addRoom(shape, best.ox, best.oy);
      if (this.types.has('branching')) this.used.branching++; // (rooms along a spine are what a spine is for, not branching)
      this.attachToHall(hall, room, {
        x: best.nx,
        y: best.ny,
        d: OPP[best.e.d],
        style: this.hallStyle(),
        room: room.id,
      });
      return room;
    }

    /**
     * The hallways that can take more rooms. A spine always can: rooms line up along it, which
     * is what makes it a spine. Any other hallway only can with Branching switched on.
     */
    attachableHalls() {
      return this.types.has('branching') ? this.halls : this.halls.filter((h) => h.kind === 'spine');
    }

    /**
     * Attach `shape` to an existing hallway: a room along its side or, with Branching on,
     * a branch off it.
     */
    tryAttachToHall(shape) {
      const { rng } = this;
      // Candidate hallways, best first: longer hallways attract more rooms, but busy ones fewer.
      const pool = this.attachableHalls().slice();
      if (pool.length === 0) return null;
      const picks = [];
      while (picks.length < CONFIG.hallsTriedPerPlacement && pool.length > 0) {
        const weights = pool.map((h) => Math.sqrt(h.cells.length) / (1 + 0.4 * (h.conn.rooms.length - 2)));
        picks.push(pool.splice(rng.weightedIndex(weights), 1)[0]);
      }
      // Decide once whether to prefer a room along the side or a branch, and give
      // that choice a go on every candidate hallway before settling for the other.
      // (Without Branching a hallway never forks, so a room along the side is the only way.)
      const order = !this.types.has('branching') ? ['flush'] : rng.chance(CONFIG.hallBranchChance) ? ['branch', 'flush'] : ['flush', 'branch'];
      for (const mode of order) {
        for (const hall of picks) {
          const room = mode === 'flush' ? this.tryFlush(hall, shape) : this.tryHall(hall, shape, CONFIG.placementTries);
          if (room) return room;
        }
      }
      return null;
    }

    placeFirst(shape) {
      const ox = Math.floor((this.W - shape.w) / 2);
      const oy = Math.floor((this.H - shape.h) / 2);
      return this.addRoom(shape, ox, oy);
    }

    /** Place the next room. Returns how many rooms that took: 1, or 2 when a new spine comes with its third room; 0 if it would not fit. */
    placeNext(shape) {
      const { rng } = this;
      this.extraPlaced = 0;
      const type = this.chooseType();
      const other = type === 'door' ? 'hall' : 'door';
      // A spine needs a room to spare and rooms along its side, so where spines are the only hallways, a hallway
      // is harder to find than usual: a doorway is then the very last resort, after the long reaches below.
      const spinesOnly = type === 'hall' && this.kinds.length === 1 && this.kinds[0] === 'spine';

      for (let attempt = 0; attempt < 60; attempt++) {
        const parent = this.pickParent();
        // Try the chosen type with many different parents before giving in and
        // using the other type, so the randomization setting is respected.
        const t = !spinesOnly && attempt >= 40 && attempt % 2 === 1 ? other : type;
        let room = null;
        if (t === 'door') {
          room = this.tryDoor(parent, shape);
        } else {
          // hang the room off an existing hallway that can take it (see attachableHalls), or start a new hallway from a room
          if (this.halls.length > 0 && rng.chance(CONFIG.hallParentChance)) room = this.tryAttachToHall(shape);
          if (!room) room = this.tryHall(parent, shape, CONFIG.placementTries);
        }
        if (room) return 1 + this.extraPlaced;
      }
      // Crowded: reach out further with longer hallways from any room.
      for (let attempt = 0; attempt < 150; attempt++) {
        const parent = rng.pick(this.rooms);
        // (a room along the side of a hallway that can take it is the one way left to place the last room of a
        // dungeon of spines, which cannot start a spine with no room to spare)
        const room = (this.halls.length > 0 && attempt % 3 === 2 ? this.tryAttachToHall(shape) : null) || this.tryHall(parent, shape, 30, 2 + Math.floor(attempt / 3));
        if (room) return 1 + this.extraPlaced;
      }
      if (spinesOnly) {
        for (let attempt = 0; attempt < 60; attempt++) {
          if (this.tryDoor(this.pickParent(), shape)) return 1;
        }
      }
      return 0;
    }

    // ---- extra connections (doorways) ---------------------------------------

    connectByDoor(a, b) {
      const { rng, W, occ } = this;
      const shared = a.edges.filter((e) => occ[(e.y + DY[e.d]) * W + e.x + DX[e.d]] === b.id + 1);
      if (shared.length === 0) return false;
      const interior = shared.filter((e) => e.interior);
      const e = rng.pick(interior.length > 0 ? interior : shared);
      this.addConnection('door', a, b, null, [{ x: e.x, y: e.y, d: e.d, style: 'door', room: a.id }]);
      return true;
    }

    /**
     * Add one more doorway between two rooms that already share a wall and are not yet
     * joined directly, which can close a circuit. Returns false if there is no such pair
     * (or the connection type rolled for the extra link is a hallway: hallways never loop).
     */
    addExtraConnection() {
      const { rooms } = this;
      const order = this.rng.shuffle(rooms.slice());
      for (const a of order.slice(0, 12)) {
        const mx = a.sumX / a.cells.length;
        const my = a.sumY / a.cells.length;
        const near = rooms
          .filter((b) => b !== a && !this.pairs.has(this.pairKey(a.id, b.id)))
          .map((b) => ({ b, d: Math.hypot(b.sumX / b.cells.length - mx, b.sumY / b.cells.length - my) }))
          .sort((u, v) => u.d - v.d)
          .slice(0, 6);
        for (const { b } of near) {
          // Only a doorway can be added: if the type rolled for this link is a hallway, or this
          // pair shares no wall, move on to another pair.
          if (this.chooseType() === 'door' && this.connectByDoor(a, b)) return true;
        }
      }
      return false;
    }

    // ---- entrances ----------------------------------------------------------

    /**
     * Is this wall edge on the outside of the dungeon? Draw a straight line out from the
     * door, away from the room: it must run to the edge of the map without meeting any
     * room or hallway. (Open ground that merely joins the outside by a winding gap between
     * rooms does not count: a door there is shut in.)
     */
    rayEscapes(e) {
      const { W, H, occ } = this;
      for (let x = e.x + DX[e.d], y = e.y + DY[e.d]; x >= 0 && y >= 0 && x < W && y < H; x += DX[e.d], y += DY[e.d]) {
        if (occ[y * W + x] !== 0) return false;
      }
      return true;
    }

    placeEntrances(count) {
      const { rng, W, occ } = this;

      // Candidate edges: wall edges on the outside of the dungeon (see rayEscapes).
      let all = [];
      for (const room of this.rooms) {
        for (const e of room.edges) if (this.rayEscapes(e)) all.push({ room, ...e });
      }
      // An entrance should open onto clear ground: the cell outside the door and
      // the three cells around it must be empty (no hallway squeezed alongside).
      const clearApproach = (e) => {
        const ox = e.x + DX[e.d];
        const oy = e.y + DY[e.d];
        for (let d = 0; d < 4; d++) {
          if (d === OPP[e.d]) continue;
          if (occ[(oy + DY[d]) * W + ox + DX[d]] !== 0) return false;
        }
        return true;
      };
      if (!this.params.edgeEntrancesOnly) {
        this.placeAnywhereEntrances(count, all, clearApproach);
        this.warnShortfall(count);
        return;
      }
      if (all.length === 0) {
        this.warnShortfall(count);
        return;
      }
      const clear = all.filter(clearApproach);
      if (clear.length >= count) all = clear;
      const interior = all.filter((e) => e.interior);
      const mid = (e) => [e.x + 0.5 + DX[e.d] * 0.5, e.y + 0.5 + DY[e.d] * 0.5];

      // Candidates ranked by distance from the entrances chosen so far, farthest first.
      const ranked = (list, chosen) => {
        const mids = chosen.map(mid);
        const scored = [];
        for (const cand of list) {
          if (chosen.includes(cand)) continue;
          const [cx, cy] = mid(cand);
          let minD = Infinity;
          for (const [mx, my] of mids) minD = Math.min(minD, Math.hypot(cx - mx, cy - my));
          scored.push({ cand, minD });
        }
        return scored.sort((u, v) => v.minD - u.minD);
      };

      const chosen = [rng.pick(interior.length >= count ? interior : all)];
      while (chosen.length < count) {
        // Prefer edges in the middle of a wall (not next to a corner), but only while that
        // costs little spread: small rooms have few such edges, and they can all be on one wall.
        const anywhere = ranked(all, chosen);
        if (anywhere.length === 0) break;
        const midWall = ranked(interior, chosen);
        const pool = midWall.length > 0 && midWall[0].minD >= 0.75 * anywhere[0].minD ? midWall : anywhere;
        // one of the three farthest, as long as it is nearly as far as the best (a short list can hold a poor third)
        const best = pool.filter((s, i) => i < 3 && s.minD >= 0.8 * pool[0].minD);
        chosen.push(best[rng.int(0, best.length - 1)].cand);
      }

      for (const e of chosen) {
        this.entrances.push({ kind: 'door', room: e.room.id, x: e.x, y: e.y, d: e.d });
      }
      this.warnShortfall(count);
    }

    warnShortfall(count) {
      if (this.entrances.length >= count) return;
      const why = this.params.edgeEntrancesOnly ? 'the outer walls are too short' : 'there is no room left for more';
      this.warnings.push(`Only ${this.entrances.length} of ${count} entrances fit: ${why}. Use larger rooms or more rooms.`);
    }

    /** The cell of a room closest to its centre of mass (always a floor cell, even for L/U shapes). */
    roomCenterCell(room) {
      if (room.center) return room.center;
      const cx = room.sumX / room.cells.length;
      const cy = room.sumY / room.cells.length;
      let best = room.cells[0];
      let bestD = Infinity;
      for (const c of room.cells) {
        const d = (c[0] + 0.5 - cx) ** 2 + (c[1] + 0.5 - cy) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      room.center = best;
      return best;
    }

    /**
     * Entrances when they are NOT restricted to the outer edge. Rooms are picked
     * spread across the whole dungeon. A room that has a wall on the outside of the dungeon
     * gets an ordinary door in that wall; a room buried in the middle gets a
     * stairway to the surface on its floor instead.
     * @param all every wall edge (with its room) that is on the outside of the dungeon
     */
    placeAnywhereEntrances(count, all, clearApproach) {
      const { rng } = this;
      const edgesOf = this.rooms.map(() => []);
      for (const e of all) edgesOf[e.room.id].push(e);

      // Prefer doors with a clear approach, in the middle of a wall rather than at a corner.
      const preferred = (list) => {
        const clear = list.filter(clearApproach);
        const base = clear.length > 0 ? clear : list;
        const mid = base.filter((e) => e.interior);
        return mid.length > 0 ? mid : base;
      };

      // cells at either side of a doorway: keep stairs out of them
      const doorCells = new Set();
      for (const c of this.connections) {
        for (const o of c.openings) {
          doorCells.add(`${o.x},${o.y}`);
          doorCells.add(`${o.x + DX[o.d]},${o.y + DY[o.d]}`);
        }
      }

      const points = []; // where entrances already are, in cell units
      const usedEdges = new Set();
      const usedCells = new Set();

      const placeIn = (room) => {
        const edges = edgesOf[room.id];
        if (edges.length > 0) {
          const options = preferred(edges.filter((e) => !usedEdges.has(`${e.x},${e.y},${e.d}`)));
          if (options.length === 0) return false;
          const e = rng.pick(options);
          usedEdges.add(`${e.x},${e.y},${e.d}`);
          usedCells.add(`${e.x},${e.y}`);
          this.entrances.push({ kind: 'door', room: room.id, x: e.x, y: e.y, d: e.d });
          points.push([e.x + 0.5 + DX[e.d] * 0.5, e.y + 0.5 + DY[e.d] * 0.5]);
          return true;
        }
        const stairs = this.pickStairsCell(room, doorCells, usedCells);
        if (!stairs) return false;
        usedCells.add(`${stairs.x},${stairs.y}`);
        this.entrances.push({ kind: 'stairs', room: room.id, x: stairs.x, y: stairs.y, d: stairs.d });
        points.push([stairs.x + 0.5, stairs.y + 0.5]);
        return true;
      };

      const full = new Set(); // rooms that cannot host another entrance
      let lap = new Set(); // rooms used in the current pass over the dungeon
      while (this.entrances.length < count) {
        const pool = this.rooms.filter((r) => !full.has(r.id) && !lap.has(r.id));
        if (pool.length === 0) {
          if (lap.size === 0) break; // nothing left that can host an entrance
          lap = new Set(); // every room has one: start another pass
          continue;
        }
        let pick;
        if (points.length === 0) {
          pick = rng.pick(pool);
        } else {
          const scored = pool
            .map((r) => {
              const [cx, cy] = this.roomCenterCell(r);
              let minD = Infinity;
              for (const [px, py] of points) minD = Math.min(minD, Math.hypot(cx + 0.5 - px, cy + 0.5 - py));
              return { r, minD };
            })
            .sort((a, b) => b.minD - a.minD);
          // spread out, but pick from the farther half so it is not always the extreme rooms
          pick = scored[rng.int(0, Math.ceil(scored.length / 2) - 1)].r;
        }
        if (placeIn(pick)) lap.add(pick.id);
        else full.add(pick.id);
      }
    }

    /**
     * A floor cell for a stairway entrance, and the wall side the stairs climb
     * towards. Avoids doorways and the room-number cell where the room is big
     * enough to allow it, and prefers a cell against a wall.
     */
    pickStairsCell(room, doorCells, usedCells) {
      const { rng, W, occ } = this;
      const center = this.roomCenterCell(room);
      const inRoom = (x, y) => occ[y * W + x] === room.id + 1;
      const wallSides = (c) => {
        const sides = [];
        for (let d = 0; d < 4; d++) if (!inRoom(c[0] + DX[d], c[1] + DY[d])) sides.push(d);
        return sides;
      };

      const cells = room.cells.filter((c) => !usedCells.has(`${c[0]},${c[1]}`));
      if (cells.length === 0) return null;
      const clearOfDoors = (c) => !doorCells.has(`${c[0]},${c[1]}`);
      const offCenter = (c) => c !== center || room.cells.length === 1;
      const tiers = [
        cells.filter((c) => clearOfDoors(c) && offCenter(c) && wallSides(c).length > 0),
        cells.filter((c) => clearOfDoors(c) && offCenter(c)),
        cells,
      ];
      const cell = rng.pick(tiers.find((t) => t.length > 0));
      const walls = wallSides(cell);
      return { x: cell[0], y: cell[1], d: walls.length > 0 ? rng.pick(walls) : rng.int(0, 3) };
    }

    // ---- final model --------------------------------------------------------

    /** Rooms are numbered breadth-first starting from the first entrance's room. */
    labelRooms() {
      const n = this.rooms.length;
      const adj = Array.from({ length: n }, () => []);
      for (const c of this.connections) {
        // every room served by the same hallway counts as next to each other
        for (const x of c.rooms) for (const y of c.rooms) if (x !== y) adj[x].push(y);
      }
      const labels = new Array(n).fill(0);
      let next = 1;
      const start = this.entrances.length > 0 ? this.entrances[0].room : 0;
      const queue = [start];
      labels[start] = next++;
      for (let h = 0; h < queue.length; h++) {
        for (const nb of adj[queue[h]].slice().sort((a, b) => a - b)) {
          if (labels[nb] === 0) {
            labels[nb] = next++;
            queue.push(nb);
          }
        }
      }
      for (let i = 0; i < n; i++) if (labels[i] === 0) labels[i] = next++;
      return labels;
    }

    buildModel(seed) {
      const labels = this.labelRooms();

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const grow = (cells) => {
        for (const [x, y] of cells) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      };
      for (const r of this.rooms) grow(r.cells);
      for (const h of this.halls) grow(h.cells);
      const shift = ([x, y]) => [x - minX, y - minY];

      const rooms = this.rooms.map((r) => {
        const labelCell = this.roomCenterCell(r);
        let bx0 = Infinity;
        let by0 = Infinity;
        let bx1 = -Infinity;
        let by1 = -Infinity;
        for (const [x, y] of r.cells) {
          bx0 = Math.min(bx0, x);
          by0 = Math.min(by0, y);
          bx1 = Math.max(bx1, x);
          by1 = Math.max(by1, y);
        }
        return {
          id: r.id,
          label: labels[r.id],
          kind: r.shape.kind,
          area: r.cells.length,
          bbox: { x: bx0 - minX, y: by0 - minY, w: bx1 - bx0 + 1, h: by1 - by0 + 1 },
          labelCell: shift(labelCell),
          cells: r.cells.map(shift),
        };
      });

      const shiftEdge = (o) => ({
        x: o.x - minX,
        y: o.y - minY,
        d: o.d,
        ...(o.style ? { style: o.style } : {}),
        ...(o.room !== undefined ? { room: o.room } : {}),
      });
      const connections = this.connections.map((c) => ({
        id: c.id,
        type: c.type,
        rooms: c.rooms.slice(), // 2 for a doorway; 2 or more for a hallway
        hall: c.hall,
        openings: c.openings.map(shiftEdge),
      }));
      const halls = this.halls.map((h) => ({
        id: h.id,
        kind: h.kind, // how it started: 'short', 'spine' or 'curly'
        cells: h.cells.map(shift),
        rooms: h.conn.rooms.slice(), // every room this hallway serves
        connection: h.conn.id,
      }));
      const entrances = this.entrances.map((e, i) => ({
        id: i,
        label: `E${i + 1}`,
        kind: e.kind, // 'door' (in an outer wall) or 'stairs' (on a room floor)
        room: e.room,
        ...shiftEdge(e),
      }));

      const hallConns = connections.filter((c) => c.type === 'hall');
      const areas = rooms.map((r) => r.area);
      const mean = areas.reduce((a, b) => a + b, 0) / areas.length;
      const sd = Math.sqrt(areas.reduce((a, b) => a + (b - mean) ** 2, 0) / areas.length);

      return {
        version: 1,
        cellSizeFt: 5,
        seed,
        params: this.params,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        rooms,
        halls,
        connections,
        entrances,
        warnings: this.warnings,
        stats: {
          rooms: rooms.length,
          hallConnections: hallConns.length, // number of hallways
          doorConnections: connections.filter((c) => c.type === 'door').length,
          // room-to-room links made by hallways (a hallway serving n rooms makes n-1)
          hallLinks: hallConns.reduce((n, c) => n + c.rooms.length - 1, 0),
          multiRoomHalls: hallConns.filter((c) => c.rooms.length >= 3).length, // hallways serving 3+ rooms
          maxRoomsPerHall: hallConns.reduce((n, c) => Math.max(n, c.rooms.length), 0),
          entrances: entrances.length,
          stairsEntrances: entrances.filter((e) => e.kind === 'stairs').length,
          floorCells: this.cellCount,
          shapeCounts: rooms.reduce((m, r) => ((m[r.kind] = (m[r.kind] || 0) + 1), m), {}), // rooms per shape
          // How often each hallway type was used. A branch off an existing hallway counts as its own kind
          // (short, spine or curly) and as 'branching'; a room hung off a hallway's side counts as 'branching'
          // too, unless Branching is off (only spines take rooms along their sides then, which is just a spine).
          hallTypeCounts: { ...this.used },
          baseRoomArea: baseRoomArea(this.params), // what rooms were built around: the average, or the minimum if larger
          meanRoomArea: mean,
          roomAreaStdDev: sd,
        },
      };
    }
  }

  // ---- public API -----------------------------------------------------------

  /**
   * Generate a dungeon.
   * @param {object} raw
   * @param {number} raw.roomCount       1-99
   * @param {number} raw.avgRoomSize     1-999 (grid squares)
   * @param {number} [raw.minRoomWidth]  1-30 (default 1): no room is narrower than this
   *                                     across the map (squares)
   * @param {number} [raw.minRoomLength] 1-30 (default 1): no room is shorter than this up
   *                                     and down the map. Rooms are never turned to fit, so
   *                                     3 x 8 is at least 3 wide and 8 long. If the average
   *                                     is below width x length, rooms are built around
   *                                     width x length instead.
   * @param {number} raw.sizeVariance    0-100 (std deviation, % of the average)
   * @param {number} raw.entrances       1-10
   * @param {'door'|'hall'} raw.connectionType
   * @param {number} [raw.connectionRandomness]  0-100, % of connections that use the
   *                                     opposite type (default 14, about 1 in 7)
   * @param {boolean} [raw.edgeEntrancesOnly]  true (default): entrances are doors in the
   *                                     outer walls. false: they may be in any room, with
   *                                     a stairway marker in rooms buried inside the dungeon.
   * @param {string[]} [raw.roomShapes]  room shapes that may be used, from DM.SHAPE_KINDS
   *                                     (default: all). At least one.
   * @param {string[]} [raw.hallTypes]   hallway types that may be used, from DM.HALL_TYPES
   *                                     (default: all): 'short', 'spine' and 'curly' are the
   *                                     ways a hallway can start (at least one is needed if
   *                                     hallways can occur at all). A spine takes rooms along
   *                                     its sides whatever else is on; 'branching' lets every
   *                                     hallway do that and lets them grow forks.
   * @param {'none'|'less'|'more'|'all'} [raw.hallDoors]  how many of a hallway's openings into
   *                                     rooms have a door rather than an open archway: none, about
   *                                     1 in 3, about 2 in 3, or all (default 'less'). Doorway
   *                                     connections always have a door.
   * @param {'compact'|'normal'|'spaced'} [raw.spacing]  how far apart rooms are (default 'compact'):
   *                                     compact - rooms may share a wall, and rooms a hallway joins are
   *                                               at most 4 squares apart
   *                                     normal  - 1 to 6 squares apart
   *                                     spaced  - 2 to 12 squares apart
   *                                     Rooms joined by a doorway override the minimum: they share a wall.
   * @param {string|number} [raw.seed]   omit for a random dungeon
   * @returns the dungeon model (plain JSON-serialisable data)
   */
  function generateDungeon(raw) {
    const v = validateParams(raw);
    if (!v.ok) throw new RangeError(Object.values(v.errors).join(' '));
    const params = v.params;
    const seed = params.seed !== null ? params.seed : String(Math.floor(Math.random() * 1e9));
    params.seed = seed;

    const rng = new DM.Rng(seed);
    // Rooms are built around the average size, or around the smallest room if that is bigger.
    const base = baseRoomArea(params);
    const { minRoomWidth, minRoomLength } = params;
    const sampleArea = makeAreaSampler(rng, base, (base * params.sizeVariance) / 100, minRoomWidth * minRoomLength);
    const shapes = [];
    for (let i = 0; i < params.roomCount; i++) {
      shapes.push(DM.makeRoomShape(rng, sampleArea(), params.roomShapes, minRoomWidth, minRoomLength));
    }

    const b = new Builder(params, rng, shapes);
    b.placeFirst(shapes[0]);
    for (let i = 1; i < shapes.length; ) {
      const placed = b.placeNext(shapes[i]); // (2 when a new spine brought a room with it)
      if (placed === 0) {
        b.warnings.push(`Could only fit ${i} of ${shapes.length} rooms.`);
        break;
      }
      i += placed;
    }

    // A room that none of the shapes switched on will fit (too small, or too narrow for the
    // minimum width and length) is a plain rectangle instead.
    const allowed = new Set(params.roomShapes);
    const stray = b.rooms.filter((r) => !allowed.has(r.shape.kind)).length;
    if (stray > 0) {
      const them = stray === 1 ? 'is a plain rectangle' : 'are plain rectangles';
      b.warnings.push(`${stray} of ${b.rooms.length} rooms ${them}: none of the room shapes that are switched on fit.`);
    }

    const extra = Math.round((b.rooms.length - 1) * CONFIG.extraConnectionFraction);
    for (let i = 0; i < extra; i++) if (!b.addExtraConnection()) break;

    b.placeEntrances(params.entrances);
    return b.buildModel(seed);
  }

  DM.LIMITS = LIMITS;
  DM.hallPathLimit = (direct, maxPath = CONFIG.maxHallPath) => hallPathLimit(direct, maxPath); // how long a routed hallway may be
  DM.DEFAULT_CONNECTION_RANDOMNESS = DEFAULT_CONNECTION_RANDOMNESS;
  DM.HALL_DOORS = HALL_DOORS;
  DM.SPACINGS = SPACINGS; // compact, normal, spaced
  DM.SPACING_GAPS = SPACING; // { min, max } empty squares between rooms, for each spacing
  DM.DEFAULT_SPACING = DEFAULT_SPACING;
  DM.HALL_KINDS = HALL_KINDS;
  DM.HALL_TYPES = HALL_TYPES;
  DM.hallwaysPossible = hallwaysPossible; // can these ({connectionType, connectionRandomness}) settings build any hallway?
  DM.GENERATOR_CONFIG = CONFIG;
  DM.hallSettings = hallSettings; // hallway distances for a given average room size (exposed for tests)
  DM.validateParams = validateParams;
  DM.generateDungeon = generateDungeon;
  DM.DIRS = { DX, DY, OPP };

  /**
   * The states an opening between rooms can be in, in the order Edit mode cycles through them:
   * a plain door, a locked door, a secret door (the wall stays solid), no door (an open archway).
   * The generator itself only makes 'door' and 'open'.
   */
  DM.DOOR_STYLES = ['door', 'locked', 'secret', 'open'];
  DM.DOOR_LABELS = { door: 'Door', locked: 'Locked door', secret: 'Secret door', open: 'No door' };
  /** The state after this one (after a state it does not know, a plain door). */
  DM.nextDoorStyle = (style) => {
    const i = DM.DOOR_STYLES.indexOf(style);
    return DM.DOOR_STYLES[(i + 1) % DM.DOOR_STYLES.length];
  };
})();
