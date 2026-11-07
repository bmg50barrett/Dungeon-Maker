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
 *      rooms a hallway joins within 4 squares; Normal and Spread keep rooms at least 1 or 2
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
    // how wide the hallways the generator builds are, in squares (1 when not given)
    hallWidth: [1, 10],
    // how many floors the dungeon has (1 when not given), and how many stairs join each floor to the one below it (1 when not given)
    levels: [1, 20],
    levelStairs: [1, 10],
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
    /** In a gauntlet with Branching on: chance that the next room is a side branch (a single dead-end room) off the latest hallway. */
    gauntletBranchChance: 0.3,
    /** While a hallway type that is switched on has not been used yet: chance that the next hallway is one of the unused types. */
    freshKindChance: 0.7,
    /** How many more times a dungeon is built, from other numbers, when a hallway type that is switched on has not turned up in it. */
    typeRetries: 8,
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
      hallWidth: 'Hallway width',
      levels: 'Levels',
      levelStairs: 'Stairs between levels',
    };
    for (const key of Object.keys(LIMITS)) {
      const [lo, hi] = LIMITS[key];
      let v = raw[key];
      if (key === 'connectionRandomness' && (v === undefined || v === null)) v = DEFAULT_CONNECTION_RANDOMNESS;
      if ((key === 'minRoomWidth' || key === 'minRoomLength' || key === 'hallWidth' || key === 'levels' || key === 'levelStairs') && (v === undefined || v === null)) v = 1; // no minimum / one square wide / one floor / one stair

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
    // The overall shape the dungeon leans towards: random / cathedral / ring / gauntlet / square / long / wide (default: random).
    const layout = raw.layout === undefined || raw.layout === null ? DM.DEFAULT_LAYOUT : raw.layout;
    if (DM.LAYOUTS.includes(layout)) {
      params.layout = layout;
    } else {
      errors.layout = `Layout must be one of: ${DM.LAYOUTS.join(', ')}.`;
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
      // the overall layout the dungeon leans towards (none for random), drawn from its own stream of numbers so that
      // switching it on never changes how the rooms themselves come out
      const typical = (this.gap.min + this.gap.max) / 2;
      const layoutRng = new DM.Rng(`${params.seed}:layout`);
      this.layout = DM.makeLayout(params.layout, {
        rooms: shapes.length,
        area: sumArea,
        side: Math.sqrt(baseRoomArea(params)),
        gap: Math.min(typical, 6),
        spacing: params.spacing,
        random: () => layoutRng.next(),
      });
      // a radial dungeon is all hallways, running out from the hub (the first room). Where the settings allow no
      // hallway at all, its rooms are doorways off the hub instead (and off each other, once the hub's walls are full)
      // a gauntlet is one chain of rooms, each joined only to the one before: no spines, and with Branching off no branches
      // either. (With Branching on, a hallway can fork to a side room that is a dead end, one room and no more, while the
      // main path goes on.) It needs a hallway that can start, so short is switched on if none else is
      this.gauntlet = !!(this.layout && this.layout.gauntlet);
      this.branchRooms = new Set(); // the gauntlet's side rooms (ids)
      this.pathEnd = 0; // the room the path has got to (the latest room that is not a side room)
      this.inBranch = false; // a side room is being placed just now
      this.branchIndex = 0; // (and the place in the layout it is drawn to: where the hallway it forks from is)
      this.lastWasBranch = false;
      if (this.gauntlet) {
        const allowed = params.hallTypes.filter((k) => k !== 'spine');
        if (!allowed.some((k) => HALL_KINDS.includes(k))) allowed.push('short');
        this.types = new Set(allowed);
        this.kinds = HALL_KINDS.filter((k) => this.types.has(k));
      }
      this.radial = !!(this.layout && this.layout.radial);
      this.radialDoors = this.radial && !hallwaysPossible(params);
      // Main St.: one long straight hallway, with the rooms along its sides and branching off it (doorways in a row instead,
      // where the settings allow no hallway). Its length grows with the number of rooms: about 7 in 10 rooms go directly
      // along its two sides, and the rest on branches
      this.main = !!(this.layout && this.layout.main);
      this.mainDoors = this.main && !hallwaysPossible(params);
      if (this.main) {
        const roomSide = Math.sqrt(baseRoomArea(params));
        const perSide = Math.ceil((0.7 * Math.max(shapes.length - 1, 1)) / 2);
        this.streetLen = Math.max(14, Math.min(130, Math.ceil(perSide * (1.6 * roomSide + Math.max(1, this.gap.min)))));
        // the first room is at one end, so that the street, running from it, is centred on the map
        const first = shapes[0];
        const shift = Math.round((this.layout.vertical ? first.h + this.streetLen : first.w + this.streetLen) / 2);
        this.layout.start = this.layout.vertical ? { x: 0, y: -shift + Math.floor(first.h / 2) } : { x: -shift + Math.floor(first.w / 2), y: 0 };
      }
      // how many spokes run out from the hub (more rooms, more spokes, up to one from each side), and which sides they leave by
      this.armTarget = Math.min(4, Math.max(1, Math.ceil((shapes.length - 1) / 5)));
      // (with neither spines nor branching, a hallway serves one room only, so every room needs a spoke of its own)
      if (this.radial && !this.types.has('spine') && !this.types.has('branching')) this.armTarget = Math.max(1, shapes.length - 1);
      this.armDirs = [];
      this.layoutTol = Infinity; // how far beyond the layout's shape a room may go just now (opens up as attempts run out)
      const base = Math.max(Math.ceil(Math.sqrt(sumArea * 4)) * 2 + 80 + 2 * this.hall.spine[1] + spread, maxDim * 4 + 40);
      // (wide hallways take up room too, so the map is bigger for them)
      this.hw = params.hallWidth || 1;
      this.bandLo = -Math.floor((this.hw - 1) / 2);
      this.bandHi = Math.ceil((this.hw - 1) / 2);
      const wideExtra = this.hw > 1 ? Math.ceil((this.hw - 1) * Math.sqrt(shapes.length) * 8) : 0;
      const side = (this.layout ? Math.ceil(base * 1.5) : base) + wideExtra; // (a shape that is long or has arms reaches further from the middle)
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
      if (this.radial) return this.radialDoors ? 'door' : 'hall'; // every room hangs off a hallway
      if (this.main) return this.mainDoors ? 'door' : 'hall';
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
    addHall(path, kind, len = path.length) {
      const id = this.halls.length;
      for (const [x, y] of path) {
        this.occ[y * this.W + x] = -(id + 1);
        this.sumX += x + 0.5;
        this.sumY += y + 0.5;
      }
      this.cellCount += path.length;
      // kind: how the hallway started ('short', 'spine' or 'curly'); branches it grows later do not change it
      // (len: how long the passage is, which for a wide hallway is not how many cells it has)
      const hall = { id, kind, cells: path.slice(), isHall: true, conn: null, len };
      this.halls.push(hall);
      return hall;
    }

    /** Add more passage cells (a branch) to an existing hallway. */
    extendHall(hall, path, len = path.length) {
      hall.len += len;
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
     * (Fewer than `maxGap` empty squares in a straight line between them: Chebyshev distance.
     * `maxGap` is the spacing's greatest gap unless a spine, which is longer, is being built.)
     */
    withinReach(shape, ox, oy, ids, maxGap = this.gap.max) {
      const reach = maxGap + 1; // Chebyshev distance of the nearest cells
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
     * How long a short hallway may be, in cells, when this spacing lets rooms be no further apart
     * than `gap.max`: the natural length is cut down to fit, and never below the least gap.
     * A spine is not held to the spacing's greatest gap. It is a long straight passage by nature,
     * so it keeps its own length range (and the spacing's least gap still applies).
     * `extra` stretches the top of the range (to reach further when the dungeon is crowded).
     */
    lengthRange(kind, extra = 0, isBranch = false) {
      const bottom = Math.max(1, this.gap.min);
      if (kind === 'spine' && !isBranch) {
        const [lo, hi] = this.hall.spine;
        const top = hi + Math.min(extra, Math.ceil(hi / 2)); // (already long: a crowded dungeon stretches it by half at most)
        return [Math.max(lo, bottom), Math.max(top, lo, bottom)];
      }
      // (a branch off a hallway takes a spine's length range cut down to the spacing, like any other hallway)
      const natural = kind === 'spine' ? this.hall.spine : this.hall.length;
      let lo = natural[0];
      const hi = Math.min(natural[1] + extra, this.gap.max);
      if (lo > hi) lo = kind === 'spine' ? Math.ceil(this.gap.max * 0.6) : hi;
      lo = Math.max(lo, bottom);
      return [lo, Math.max(hi, lo)];
    }

    /** The greatest gap, in squares, between rooms joined by a hallway of this kind: a spine's own length range, otherwise the spacing's. */
    reachFor(isSpine, spineTop = 0) {
      return isSpine ? Math.max(this.gap.max, spineTop) : this.gap.max;
    }

    /**
     * The place in the layout the room being placed belongs to: how many rooms there are so far. In a gauntlet the side rooms
     * do not count, as they are off the path, and one is drawn to where the path has got to.
     */
    layoutIndex() {
      if (!this.gauntlet) return this.rooms.length;
      if (this.inBranch) return this.branchIndex;
      return Math.max(0, this.rooms.length - this.branchRooms.size);
    }

    /** Is a room of this shape at (ox, oy) close enough to the overall layout's shape, on this attempt? (Always, with no layout.) */
    layoutOk(shape, ox, oy) {
      if (!this.layout || this.layoutTol === Infinity) return true;
      if (this.layout.outside(ox + shape.w / 2 - this.W / 2, oy + shape.h / 2 - this.H / 2, this.layoutIndex()) > this.layoutTol) return false;
      // the last room of a ring has to come round close enough to the first to be joined to it
      if (this.layout.closes && this.rooms.length === this.shapes.length - 1 && this.rooms.length > 3) return this.withinReach(shape, ox, oy, [0]);
      return true;
    }

    /** Lower is better. Prefers placements near the centre of mass (compact dungeons), or the layout's shape if there is one. */
    score(shape, ox, oy) {
      const cx = ox + shape.w / 2;
      const cy = oy + shape.h / 2;
      if (this.layout) {
        // drawn towards the layout's shape instead of the middle of the dungeon so far
        const last = this.rooms.length > 0 ? this.rooms[this.rooms.length - 1] : null;
        const lastAt = last ? { x: last.ox + last.shape.w / 2 - this.W / 2, y: last.oy + last.shape.h / 2 - this.H / 2 } : null;
        return this.layout.score(cx - this.W / 2, cy - this.H / 2, lastAt, this.layoutIndex()) * (1 + this.rng.next() * CONFIG.scoreNoise);
      }
      const mx = this.sumX / this.cellCount;
      const my = this.sumY / this.cellCount;
      const d2 = (cx - mx) * (cx - mx) + (cy - my) * (cy - my);
      return d2 * (1 + this.rng.next() * CONFIG.scoreNoise);
    }

    /**
     * The cells a wide hallway covers along a route (a list of centre cells): a band `hw` squares across, with a full
     * square at each bend. `d0` is the direction the route leaves its start in, `d1` the direction it arrives at its end in
     * (the end of a hallway is square against a wall). Returns the cells as [x, y] pairs, each once.
     */
    widen(route, d0, d1) {
      if (this.hw === 1) return route;
      const { W, bandLo: lo, bandHi: hi } = this;
      const seen = new Set();
      const out = [];
      const put = (x, y) => {
        const k = y * W + x;
        if (!seen.has(k)) {
          seen.add(k);
          out.push([x, y]);
        }
      };
      const dirOf = (a, b) => (b[0] > a[0] ? 1 : b[0] < a[0] ? 3 : b[1] > a[1] ? 2 : 0);
      for (let i = 0; i < route.length; i++) {
        const [x, y] = route[i];
        const din = i > 0 ? dirOf(route[i - 1], route[i]) : d0;
        const dout = i < route.length - 1 ? dirOf(route[i], route[i + 1]) : d1;
        if (din !== dout) {
          for (let a = lo; a <= hi; a++) for (let b = lo; b <= hi; b++) put(x + a, y + b);
        } else if (DX[dout] !== 0) {
          for (let b = lo; b <= hi; b++) put(x, y + b);
        } else {
          for (let a = lo; a <= hi; a++) put(x + a, y);
        }
      }
      return out;
    }

    /**
     * Can a wide hallway follow `route` between regions idA and idB? Every cell it covers must be empty, and all that it
     * touches must be those two regions (a hallway only where `startsAtHall` / `endsAtHall` say a branch meets one, and only
     * at that end), and the route must not come back alongside itself closer than a width.
     * @returns {number[][]|null} the cells covered, or null
     */
    checkWide(route, d0, d1, idA, idB) {
      const { W, H, occ } = this;
      const cells = this.widen(route, d0, d1);
      const inside = new Set();
      for (const [x, y] of cells) {
        if (x < 2 || y < 2 || x > W - 3 || y > H - 3) return null;
        if (occ[y * W + x] !== 0) return null;
        inside.add(y * W + x);
      }
      // the ends of the route, where a hallway may be touched
      const ends = new Set();
      if (idA < 0) for (const [x, y] of this.widen(route.slice(0, 1), d0, d0)) ends.add(y * W + x);
      if (idB < 0) for (const [x, y] of this.widen(route.slice(-1), d1, d1)) ends.add(y * W + x);
      for (const [x, y] of cells) {
        const k = y * W + x;
        for (let d = 0; d < 4; d++) {
          const n = k + DY[d] * W + DX[d];
          if (inside.has(n)) continue;
          const v = occ[n];
          if (v === 0) continue;
          if (v !== idA && v !== idB) return null;
          if (v < 0 && !ends.has(k)) return null;
        }
      }
      // two stretches of the route that are not simply a bend in one another must be a clear gap apart, or they merge
      const at = new Map();
      route.forEach(([x, y], i) => at.set(y * W + x, i));
      const w = this.hw;
      for (let i = 0; i < route.length; i++) {
        const [x, y] = route[i];
        for (let dy = -w; dy <= w; dy++) {
          for (let dx = -w; dx <= w; dx++) {
            const j = at.get((y + dy) * W + x + dx);
            if (j === undefined || j <= i + 1) continue;
            if (Math.abs(dx) + Math.abs(dy) !== j - i) return null; // (a detour: the route has come back on itself)
          }
        }
      }
      return cells;
    }

    /**
     * A hallway cell must be empty and may only touch the regions it joins
     * (idA / idB, each a room or a hallway). It may touch a hallway only at an
     * `endpoint` of a route (where a branch meets it), never along the way, and
     * then at exactly one cell. Otherwise a new passage would hug the old one
     * and merge into a hallway wider than one cell.
     * (For a wide hallway this is only the first, rough test of a centre cell: the whole box round it, a width and a
     * square either side, must be empty or one of the two regions. checkWide makes the exact check of a finished route.)
     */
    hallCellOk(x, y, idA, idB, endpoint = true) {
      const { W, occ } = this;
      if (this.hw > 1) {
        const reach = this.bandHi + 1;
        if (x < reach || y < reach || x >= W - reach || y >= this.H - reach) return false;
        for (let b = this.bandLo - 1; b <= this.bandHi + 1; b++) {
          for (let a = this.bandLo - 1; a <= this.bandHi + 1; a++) {
            const v = occ[(y + b) * W + x + a];
            if (v !== 0 && v !== idA && v !== idB) return false;
          }
        }
        return occ[y * W + x] === 0;
      }
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
    findPath(sx, sy, sdir, gx, gy, idA, idB, gdir = sdir) {
      const { W } = this;
      const wide = this.hw > 1; // (a wide hallway leaves its start and meets its end square on, so it cannot bend there)
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
          if (wide && ((cx === sx && cy === sy && nd !== sdir) || (nx === gx && ny === gy && nd !== gdir))) continue;
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
    checkRoute(route, idA, idB, startsAtHall, anyLength = false) {
      const { W, H } = this;
      if (route.length > this.hall.maxPath && !anyLength) return null; // (Main St. is as long as it needs to be)
      if (this.hw > 1) return route; // (a wide hallway is checked as a whole, by checkWide)
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
    pickKind(allowSpine = true, only = null) {
      let kinds = allowSpine ? this.kinds : this.kinds.filter((k) => k !== 'spine');
      if (only) kinds = kinds.filter((k) => only.includes(k));
      if (kinds.length === 0) return null;
      // a type that is on but not used yet is favoured, so that every one turns up in the dungeon
      const fresh = kinds.filter((k) => this.used[k] === 0);
      if (fresh.length > 0 && fresh.length < kinds.length && this.rng.chance(CONFIG.freshKindChance)) kinds = fresh;
      const winding = this.layout ? this.layout.winding : 1; // (1 unless a layout asks for more winding)
      return kinds[this.rng.weightedIndex(kinds.map((k) => CONFIG.hallKindWeights[k] * (k === 'curly' ? winding : 1)))];
    }

    hallStyle() {
      return this.rng.chance(CONFIG.hallDoorChance[this.params.hallDoors]) ? 'door' : 'open';
    }

    /** Record a hallway between edge ea (a cell of room a) and edge eb (a cell of room b). */
    commitHall(path, a, b, ea, eb, kind, len = path.length) {
      this.connectHall(this.addHall(path, kind, len), a, b, ea, eb);
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
      if (this.radial) return rooms[0]; // (the hub)
      // a ring is built one room after another round the circle, so each hangs off the one before
      if (this.layout && (this.layout.closes || this.layout.chain) && rooms.length > 1 && rng.chance(0.85)) return rooms[rooms.length - 1];
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
        if (!this.layoutOk(shape, ox, oy)) continue;
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
    tryHall(parent, shape, tries, extra = 0, plan = null) {
      const { rng, W, occ } = this;
      const fromHall = parent.isHall === true;
      // A spine always has at least 3 rooms: the two it joins and one along its side. So a spine can only be
      // started with another room still to place (it is built together with the new room, see below).
      const spineOk = fromHall || this.rooms.length + 1 < this.shapes.length;
      // (a radial dungeon's plan for a spoke can ask for a spine, as long a one as it needs, leaving the hub by a given side)
      let kind = plan && plan.spine && spineOk && this.kinds.includes('spine') ? 'spine' : this.pickKind(spineOk);
      // (Main St. is a spine if spines are on, or else as straight and long a hallway as the types allow)
      // (and a branch off Main St. is a straight alley, short or a spine, out from the street)
      // (a winding alley too, while that type has not turned up yet)
      if (plan && plan.alley) {
        const alleys = this.used.curly === 0 ? ['short', 'spine', 'curly'] : ['short', 'spine'];
        kind = (alleys.filter((k) => this.kinds.includes(k))[0] && this.pickKind(spineOk, alleys)) || kind;
      }
      if (plan && plan.street) kind = ['spine', 'short', 'curly'].find((k) => this.kinds.includes(k) && (k !== 'spine' || spineOk)) || kind;
      if (kind === null) return null; // every way of starting a hallway is switched off (or only a spine, with no room to spare)
      const allowId = fromHall ? -(parent.id + 1) : parent.id + 1;
      let sides = null;
      let straightSides = null;
      if (fromHall) {
        sides = this.hallSides(parent);
        if (sides.length === 0) return null;
        straightSides = sides.filter((s) => s.straight);
      }
      const planned = !!(plan && plan.range && !fromHall && kind === 'spine');
      const [lo, hi] = planned ? plan.range : this.lengthRange(kind, extra, fromHall);
      const lateralMax = Math.min(this.hall.lateral, this.gap.max + 1); // (a room off to the side is still within the greatest gap)
      const served = fromHall ? parent.conn.rooms : [parent.id]; // the rooms the new one has to be near enough to
      const newSpine = kind === 'spine' && !fromHall; // a hallway that starts as a spine (a branch of that length off another hallway does not)

      // a new spoke leaves the hub where there is most room from the spokes already there, so they fan out
      let hubEdges = null;
      if (plan && plan.dir !== undefined && !fromHall) {
        const facing = parent.edges.filter((e) => e.d === plan.dir && occ[(e.y + DY[e.d]) * W + e.x + DX[e.d]] === 0);
        const middle = facing.filter((e) => e.interior);
        hubEdges = middle.length > 0 ? middle : facing.length > 0 ? facing : null;
      }
      if (!hubEdges && this.radial && !fromHall && parent === this.rooms[0]) hubEdges = this.spreadEdges(parent);

      const cands = [];
      for (let t = 0; t < tries && cands.length < CONFIG.candidatesPerParent; t++) {
        const e = fromHall
          ? rng.pick(straightSides.length > 0 && (rng.chance(0.6) || (plan && plan.alley)) ? straightSides : sides)
          : hubEdges
            ? rng.pick(hubEdges)
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
          const lat = kind === 'spine' || (planned && plan.street) || (plan && plan.alley) ? 0 : rng.int(-lateralMax, lateralMax);
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
        if (!this.layoutOk(shape, ox, oy)) continue;
        if (!this.canPlace(shape, ox, oy, 'hall')) continue;
        if (!this.withinReach(shape, ox, oy, served, this.reachFor(newSpine || planned, hi))) continue;
        cands.push({ e, ox, oy, mx, my, route, score: this.score(shape, ox, oy) });
      }
      cands.sort((a, b) => a.score - b.score);

      for (let i = 0; i < Math.min(4, cands.length); i++) {
        const c = cands[i];
        const room = this.addRoom(shape, c.ox, c.oy); // stamped so the route avoids it
        const company = newSpine ? this.shapes[this.rooms.length] : null; // the next room to place, which goes along this spine
        let path = c.route
          ? this.checkRoute(c.route, allowId, room.id + 1, fromHall, planned && plan.street)
          : this.findPath(
              c.e.x + DX[c.e.d],
              c.e.y + DY[c.e.d],
              c.e.d,
              c.mx - DX[c.e.d],
              c.my - DY[c.e.d],
              allowId,
              room.id + 1,
              c.e.d
            );
        // a wide hallway covers more than its route: the cells it covers, if it fits
        let cells = path;
        if (path && this.hw > 1) {
          cells = this.checkWide(path, c.e.d, c.e.d, allowId, room.id + 1);
          if (!cells) path = null;
        }
        // a new spine is laid down first, to see that a room fits along its side; if none does, it is not built
        let hall = null;
        let along = null;
        if (path && newSpine) {
          hall = this.addHall(cells, kind, path.length);
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
            this.extendHall(parent, cells, path.length);
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
            this.commitHall(cells, parent, room, c.e, { x: c.mx, y: c.my, d: OPP[c.e.d] }, kind, path.length);
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
        if (!this.layoutOk(shape, ox, oy)) continue;
        if (!this.canPlace(shape, ox, oy, 'door', hall.id + 1)) continue;
        if (!this.withinReach(shape, ox, oy, served, this.reachFor(hall.kind === 'spine' || hall.street === true, hall.len))) continue; // (beside a spine, a room is within the spine's length of its ends)
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
      const start = this.layout ? this.layout.start : { x: 0, y: 0 };
      const ox = Math.floor((this.W - shape.w) / 2 + start.x);
      const oy = Math.floor((this.H - shape.h) / 2 + start.y);
      return this.addRoom(shape, ox, oy);
    }

    /** Place the next room. Returns how many rooms that took: 1, or 2 when a new spine comes with its third room; 0 if it would not fit. */
    placeNext(shape) {
      const { rng } = this;
      this.extraPlaced = 0;
      if (this.radial) return this.placeNextRadial(shape);
      if (this.main) return this.placeNextMain(shape);
      if (this.gauntlet) return this.placeNextGauntlet(shape);
      let type = this.chooseType();
      // Branching is on and nothing has branched yet: rooms are hung off hallways, and in time a hallway is started to hang one off
      // (so that a type that is switched on turns up in the dungeon)
      const late = this.rooms.length >= this.shapes.length - 3;
      if (this.types.has('branching') && this.used.branching === 0 && this.halls.length === 0 && this.rooms.length >= this.shapes.length / 2 && hallwaysPossible(this.params)) type = 'hall';
      const needBranch = this.types.has('branching') && this.used.branching === 0 && this.halls.length > 0;
      const other = type === 'door' ? 'hall' : 'door';
      // A spine needs a room to spare and rooms along its side, so where spines are the only hallways, a hallway
      // is harder to find than usual: a doorway is then the very last resort, after the long reaches below.
      const spinesOnly = type === 'hall' && this.kinds.length === 1 && this.kinds[0] === 'spine';

      for (let attempt = 0; attempt < 60; attempt++) {
        if (this.layout) this.layoutTol = this.layout.tolerance(attempt);
        const parent = this.pickParent();
        // Try the chosen type with many different parents before giving in and
        // using the other type, so the randomization setting is respected.
        const t = !spinesOnly && attempt >= 40 && attempt % 2 === 1 ? other : type;
        let room = null;
        if (t === 'door') {
          if (needBranch && rng.chance(late ? 1 : 0.3)) room = this.tryAttachToHall(shape);
          if (!room) room = this.tryDoor(parent, shape);
        } else {
          // hang the room off an existing hallway that can take it (see attachableHalls), or start a new hallway from a room
          if (this.halls.length > 0 && rng.chance(needBranch ? 1 : CONFIG.hallParentChance)) room = this.tryAttachToHall(shape);
          if (!room) room = this.tryHall(parent, shape, CONFIG.placementTries);
        }
        if (room) return 1 + this.extraPlaced;
      }
      // Crowded: reach out further with longer hallways from any room.
      this.layoutTol = Infinity;
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

    // ---- a gauntlet --------------------------------------------------------------

    /**
     * The next room of a gauntlet: always off the room before it, by a doorway or a hallway as the connection settings
     * say (and the other kind when that is not possible), so the rooms form one chain. Only when the dungeon is too
     * crowded for that does a room hang off an earlier one, so that no room is lost.
     */
    placeNextGauntlet(shape) {
      const { rng } = this;
      // (the path goes on from its latest room, never from a side room)
      const last = this.rooms[this.pathEnd];
      // with Branching on, sometimes a hallway forks to a room of its own, a dead end: the path carries on from where it was.
      // (Never the last room, so that the path ends the dungeon)
      // Until one has, it is likelier, and certain at the last chance: a type that is switched on has to turn up
      const forked = this.used.branching > 0;
      const chance = forked ? CONFIG.gauntletBranchChance : this.rooms.length >= this.shapes.length - 2 ? 1 : 0.5;
      if (this.types.has('branching') && !this.lastWasBranch && this.rooms.length >= 2 && this.rooms.length < this.shapes.length - 1 && rng.chance(chance)) {
        if (this.tryGauntletBranch(shape)) {
          this.lastWasBranch = true;
          return 1;
        }
      }
      this.lastWasBranch = false;
      const placed = this.placeGauntletRoom(shape, last);
      if (placed) this.pathEnd = this.rooms.length - 1;
      return placed;
    }

    /** The hallways a gauntlet's side room can fork from: those that serve two rooms so far (one fork each). */
    forkableHalls() {
      return this.halls.filter((h) => h.conn && h.conn.rooms.length === 2);
    }

    /** A side room off one of the latest hallways: a branch of the hallway, ending at a room of its own. */
    tryGauntletBranch(shape) {
      // (the latest few, or with none yet, any of them: wherever the path has been)
      const pool = this.forkableHalls().slice(this.used.branching > 0 ? -3 : -8).reverse();
      if (pool.length === 0) return null;
      this.inBranch = true;
      let room = null;
      for (let attempt = 0; attempt < 24 && !room; attempt++) {
        this.layoutTol = this.layout.tolerance(attempt);
        for (const hall of pool) {
          // drawn to the place in the layout where the hallway is (its later room, not counting side rooms before it)
          const later = hall.conn.rooms[1];
          this.branchIndex = later - [...this.branchRooms].filter((id) => id < later).length;
          room = this.tryHall(hall, shape, CONFIG.placementTries);
          if (room) break;
        }
      }
      this.inBranch = false;
      this.layoutTol = Infinity;
      if (room) this.branchRooms.add(room.id);
      return room;
    }

    /** The next room of the path itself, off the room `last`. */
    placeGauntletRoom(shape, last) {
      const { rng } = this;
      let type = this.chooseType();
      // with Branching on and no hallway yet to fork from, this link is a hallway (where the settings allow any)
      if (this.types.has('branching') && this.used.branching === 0 && this.forkableHalls().length === 0 && this.shapes.length >= 4 && hallwaysPossible(this.params)) type = 'hall';
      const other = type === 'door' ? 'hall' : 'door';
      const build = (t, parent, tries, extra) => (t === 'door' ? this.tryDoor(parent, shape) : this.tryHall(parent, shape, tries, extra));
      for (let attempt = 0; attempt < 80; attempt++) {
        this.layoutTol = this.layout.tolerance(attempt);
        const t = attempt >= 50 && attempt % 2 === 1 ? other : type;
        if (build(t, last, CONFIG.placementTries, 0)) return 1;
      }
      this.layoutTol = Infinity;
      for (let attempt = 0; attempt < 150; attempt++) {
        const parent = attempt < 60 ? last : rng.pick(this.rooms.filter((r) => !this.branchRooms.has(r.id)));
        if (build(attempt % 2 === 0 ? type : other, parent, 30, 2 + Math.floor(attempt / 3))) return 1;
      }
      return 0;
    }

    // ---- a radial dungeon --------------------------------------------------------

    /** The hallways that run out from the hub (the first room). */
    arms() {
      return this.halls.filter((h) => h.conn && h.conn.rooms[0] === 0);
    }

    /**
     * A few places on the hub's walls for a new spoke to start, the ones furthest from the spokes already there
     * (the first of them can start anywhere, so then it is a few at random).
     */
    spreadEdges(hub) {
      const { W, occ } = this;
      const starts = this.arms().map((h) => h.conn.openings[0]);
      const open = hub.edges.filter((e) => occ[(e.y + DY[e.d]) * W + e.x + DX[e.d]] === 0);
      if (open.length === 0) return hub.edges;
      const sample = this.rng.shuffle(open.slice()).slice(0, 40);
      const scored = sample.map((e) => {
        let near = Infinity;
        for (const s of starts) near = Math.min(near, Math.hypot(e.x + DX[e.d] * 0.5 - (s.x + DX[s.d] * 0.5), e.y + DY[e.d] * 0.5 - (s.y + DY[s.d] * 0.5)));
        return { e, near };
      });
      scored.sort((a, b) => b.near - a.near);
      return scored.slice(0, 5).map((s) => s.e);
    }

    /**
     * The plan for the spoke with this number: the side of the hub it leaves by, and how long a spine it needs (a
     * spoke gets its share of the rooms, some at its end and the rest along its two sides). The sides are spread
     * round the hub: opposite ones first.
     */
    armPlan(index) {
      if (this.armDirs.length === 0) {
        const axis = this.rng.int(0, 1); // which pair of sides comes first: north and south, or east and west
        const first = axis === 0 ? [0, 2] : [1, 3];
        const second = axis === 0 ? [1, 3] : [0, 2];
        const lead = first[this.rng.int(0, 1)];
        this.armDirs = [lead, (lead + 2) % 4, ...(this.rng.int(0, 1) === 0 ? second : [second[1], second[0]])];
      }
      const others = this.shapes.length - 1;
      const share = Math.ceil(others / this.armTarget);
      const perSide = Math.max(1, Math.ceil((share - 1) / 2));
      const side = Math.sqrt(baseRoomArea(this.params));
      const wanted = Math.min(60, Math.ceil(perSide * (side + Math.max(1, this.gap.min))));
      const [lo, hi] = this.lengthRange('spine');
      return { dir: index < 4 && this.armTarget <= 4 ? this.armDirs[index] : undefined, spine: true, range: [Math.max(lo, wanted), Math.max(hi, wanted + 3)] };
    }

    /**
     * The next room of a radial dungeon: every room hangs off a hallway, and every hallway starts at the hub. The first
     * rooms go at the ends of the spokes (long straight spines out of the hub's sides, each with a room along it as
     * well); then the rest go along the sides of the spokes. Only when that is not possible does a hallway fork (the fork
     * belongs to the spoke it leaves), then does a spoke leave the hub wherever it can, and only as a last resort does a
     * room hang off anything else, so that no room is lost.
     */
    placeNextRadial(shape) {
      const { rng } = this;
      const hub = this.rooms[0];
      const arms = () => this.arms();
      if (this.radialDoors) {
        for (let attempt = 0; attempt < 150; attempt++) {
          this.layoutTol = attempt < 60 ? this.layout.tolerance(attempt) : Infinity;
          if (this.tryDoor(attempt < 60 ? hub : rng.pick(this.rooms), shape)) return 1;
        }
        return 0;
      }
      const side = () => {
        // along the side of the spoke with the fewest rooms first
        const pool = this.attachableHalls().filter((h) => h.conn); // (Branching off: only spines take rooms along their sides)
        const picks = [];
        while (picks.length < CONFIG.hallsTriedPerPlacement && pool.length > 0) {
          const weights = pool.map((h) => Math.sqrt(h.cells.length) / (1 + 0.8 * (h.conn.rooms.length - 2)));
          picks.push(pool.splice(rng.weightedIndex(weights), 1)[0]);
        }
        for (const hall of picks) {
          const room = this.tryFlush(hall, shape);
          if (room) return room;
        }
        return null;
      };
      const fork = () => {
        const pool = this.types.has('branching') ? arms() : [];
        return pool.length > 0 ? this.tryHall(rng.pick(pool), shape, CONFIG.placementTries) : null;
      };
      for (let attempt = 0; attempt < 80; attempt++) {
        this.layoutTol = this.layout.tolerance(attempt);
        const made = arms().length;
        let room = null;
        if (made < this.armTarget) {
          // the next spoke, by the side planned for it (any side, if that one will not do)
          const plan = this.armPlan(made);
          if (attempt >= 25) delete plan.dir;
          room = this.tryHall(hub, shape, CONFIG.placementTries, 0, plan) || (made > 0 && attempt >= 10 ? side() : null);
        } else {
          room = side() || (attempt >= 10 ? fork() : null) || (attempt >= 40 ? this.tryHall(hub, shape, CONFIG.placementTries) : null);
        }
        if (room) return 1 + this.extraPlaced;
      }
      // Crowded: longer reaches, from the hub, along or off any spoke, and finally from any room
      this.layoutTol = Infinity;
      for (let attempt = 0; attempt < 150; attempt++) {
        const reach = 2 + Math.floor(attempt / 3);
        const room = this.tryHall(hub, shape, 30, reach) || (attempt % 3 === 2 ? side() || fork() : null) || (attempt >= 100 ? this.tryHall(rng.pick(this.rooms), shape, 30, reach) : null);
        if (room) return 1 + this.extraPlaced;
      }
      // (where spines are the only hallways, a spoke needs a room to spare: the last rooms of a small dungeon get a doorway from the hub)
      if (this.kinds.length === 1 && this.kinds[0] === 'spine') {
        for (let attempt = 0; attempt < 60; attempt++) if (this.tryDoor(hub, shape)) return 1;
      }
      return 0;
    }

    // ---- Main St. -----------------------------------------------------------

    /**
     * The next room of a Main St. dungeon. The first room is at one end, and the second is at the far end of the street, a
     * long straight hallway from it (a third goes along its side, if the street is a spine). After that rooms open straight
     * onto the street, along either side, or (with Branching on) hang off a branch that forks from it. A branch is part of
     * the street, so the whole dungeon is one hallway. A room goes anywhere else only as a last resort, so none is lost.
     */
    placeNextMain(shape) {
      const { rng } = this;
      const first = this.rooms[0];
      if (this.mainDoors) {
        // no hallways allowed: the rooms follow one another in a row, kept to a band along the street's line
        for (let attempt = 0; attempt < 150; attempt++) {
          this.layoutTol = attempt < 60 ? this.layout.tolerance(attempt) : Infinity;
          const parent = attempt < 60 && rng.chance(0.7) ? this.rooms[this.rooms.length - 1] : rng.pick(this.rooms);
          if (this.tryDoor(parent, shape)) return 1;
        }
        return 0;
      }
      const street = this.halls.find((h) => h.street);
      if (!street) {
        const plan = { street: true, spine: true, dir: this.layout.vertical ? 2 : 1, range: [this.streetLen, this.streetLen + 2] };
        for (let attempt = 0; attempt < 60; attempt++) {
          const room = this.tryHall(first, shape, CONFIG.placementTries, 0, plan);
          if (room) {
            this.halls[0].street = true;
            return 1 + this.extraPlaced;
          }
        }
        // no room for a street that long: a shorter one, then any hallway from the first room
        const shorter = { ...plan, range: [Math.max(3, Math.floor(this.streetLen / 2)), this.streetLen] };
        for (let attempt = 0; attempt < 120; attempt++) {
          const room = this.tryHall(first, shape, 30, Math.floor(attempt / 4), attempt < 40 ? shorter : { street: true, spine: true });
          if (room) {
            this.halls[0].street = true;
            return 1 + this.extraPlaced;
          }
        }
        return 0;
      }
      const flush = () => {
        const pool = this.attachableHalls().filter((h) => h.conn); // (the street, a spine or with Branching on, and any other hallway that can take rooms)
        pool.sort((p, q) => (q.street === true) - (p.street === true));
        for (const hall of pool.slice(0, 3)) {
          const room = this.tryFlush(hall, shape);
          if (room) return room;
        }
        return null;
      };
      const fork = () => (this.types.has('branching') ? this.tryHall(street, shape, CONFIG.placementTries, 0, { alley: true }) : null);
      for (let attempt = 0; attempt < 80; attempt++) {
        this.layoutTol = this.layout.tolerance(attempt);
        const forkFirst = this.types.has('branching') && rng.chance(0.3);
        const room = forkFirst ? fork() || flush() : flush() || fork();
        if (room) return 1 + this.extraPlaced;
      }
      // Crowded: longer branches, then a hallway from any room
      this.layoutTol = Infinity;
      for (let attempt = 0; attempt < 150; attempt++) {
        const reach = 2 + Math.floor(attempt / 3);
        const room = flush() || (this.types.has('branching') ? this.tryHall(street, shape, 30, reach) : null) || (attempt >= 60 ? this.tryHall(rng.pick(this.rooms), shape, 30, reach) : null);
        if (room) return 1 + this.extraPlaced;
      }
      if (this.kinds.length === 1 && this.kinds[0] === 'spine') {
        for (let attempt = 0; attempt < 60; attempt++) if (this.tryDoor(this.pickParent(), shape)) return 1;
      }
      return 0;
    }

    // ---- closing a ring --------------------------------------------------------

    /** Empty squares between two rooms in a straight line (0 when they touch, a corner counting as touching). */
    roomGap(a, b) {
      let best = Infinity;
      for (const [x, y] of a.perim) {
        for (const [p, q] of b.perim) best = Math.min(best, Math.max(Math.abs(x - p), Math.abs(y - q)));
      }
      return best - 1;
    }

    /**
     * Join up a ring: the two rooms that are furthest round the circle from each other (by way of the
     * connections) but near enough to be joined get a connection of their own, a doorway where they share a
     * wall or else a short hallway, so the circle is closed. It is the one place a hallway links rooms that are
     * already joined. Does nothing if no such pair is near enough, or if the settings allow no way to do it.
     */
    closeLoop() {
      const { rooms } = this;
      const n = rooms.length;
      if (n < 4) return false;
      // how many connections apart every pair of rooms is
      const next = rooms.map(() => []);
      for (const c of this.connections) for (const p of c.rooms) for (const q of c.rooms) if (p !== q) next[p].push(q);
      const apart = rooms.map((_, from) => {
        const d = new Array(n).fill(-1);
        d[from] = 0;
        for (let queue = [from], i = 0; i < queue.length; i++) {
          for (const to of next[queue[i]]) if (d[to] < 0) ((d[to] = d[queue[i]] + 1), queue.push(to));
        }
        return d;
      });
      const canHall = hallwaysPossible(this.params) && this.types.has('short');
      const pairs = [];
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (this.pairs.has(this.pairKey(i, j)) || apart[i][j] < Math.max(3, Math.floor(n / 3))) continue;
          const gap = this.roomGap(rooms[i], rooms[j]);
          if (gap === 0 || (canHall && gap <= this.gap.max)) pairs.push({ a: rooms[i], b: rooms[j], gap, score: gap * 100 - apart[i][j] });
        }
      }
      pairs.sort((p, q) => p.score - q.score);
      for (const { a, b, gap } of pairs.slice(0, 6)) {
        if (gap === 0 && this.connectByDoor(a, b)) return true;
        if (canHall && gap <= this.gap.max && this.connectByHall(a, b)) return true;
      }
      return false;
    }

    /** A short hallway between two rooms that are not touching, along the shortest route found between their walls. */
    connectByHall(a, b) {
      const { W, occ } = this;
      const open = (room) => room.edges.filter((e) => occ[(e.y + DY[e.d]) * W + e.x + DX[e.d]] === 0);
      const pairs = [];
      for (const ea of open(a)) {
        for (const eb of open(b)) {
          const dist = Math.abs(ea.x + DX[ea.d] - (eb.x + DX[eb.d])) + Math.abs(ea.y + DY[ea.d] - (eb.y + DY[eb.d]));
          pairs.push({ ea, eb, dist });
        }
      }
      pairs.sort((p, q) => p.dist - q.dist);
      for (const { ea, eb } of pairs.slice(0, 30)) {
        const path = this.findPath(ea.x + DX[ea.d], ea.y + DY[ea.d], ea.d, eb.x + DX[eb.d], eb.y + DY[eb.d], a.id + 1, b.id + 1, OPP[eb.d]);
        if (!path) continue;
        const cells = this.hw > 1 ? this.checkWide(path, ea.d, OPP[eb.d], a.id + 1, b.id + 1) : path;
        if (!cells) continue;
        this.used.short++;
        this.commitHall(cells, a, b, ea, { x: eb.x, y: eb.y, d: eb.d }, 'short', path.length);
        return true;
      }
      return false;
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

      const chosen = [];
      // (a spiral has its first two entrances at its two ends: the tip, and the middle where it began, if that is on the outside)
      if (this.layout && this.layout.ends) {
        for (const room of new Set([this.rooms[this.rooms.length - 1], this.rooms[0]])) {
          if (chosen.length >= count) break;
          const mine = all.filter((e) => e.room === room);
          const mid = mine.filter((e) => e.interior);
          const pool = mid.length > 0 ? mid : mine;
          if (pool.length > 0) chosen.push(rng.pick(pool));
        }
      }
      if (chosen.length === 0) chosen.push(rng.pick(interior.length >= count ? interior : all));
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
     * The cell a room's number sits on. It is the cell nearest the middle of the room among those with
     * floor on all eight sides, so the number (which is a little taller than a cell) never lands on a wall,
     * as it could in an L or T where the middle falls beside a notch. A room with no such cell (a
     * very narrow one) gets the cell with the most floor round it, and its number spills over the walls.
     * This is separate from roomCenterCell, which entrances and stairs use, so those stay where they were.
     */
    roomLabelCell(room) {
      if (room.labelAt) return room.labelAt;
      const set = new Set(room.cells.map((c) => `${c[0]},${c[1]}`));
      const has = (x, y) => set.has(`${x},${y}`);
      const cx = room.sumX / room.cells.length;
      const cy = room.sumY / room.cells.length;
      let best = room.cells[0];
      let bestKey = null;
      for (const c of room.cells) {
        let around = 0; // how many of the 8 neighbours are floor
        let sides = 0; // how many of the 4 side neighbours are floor
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if ((dx || dy) && has(c[0] + dx, c[1] + dy)) {
              around++;
              if (!dx || !dy) sides++;
            }
          }
        }
        const d = (c[0] + 0.5 - cx) ** 2 + (c[1] + 0.5 - cy) ** 2;
        const key = [around === 8 ? 0 : 1, -sides, -around, d];
        let better = !bestKey;
        for (let i = 0; !better && i < key.length; i++) {
          if (key[i] !== bestKey[i]) better = key[i] < bestKey[i]; // the first difference decides
          if (key[i] !== bestKey[i]) break;
        }
        if (better) {
          best = c;
          bestKey = key;
        }
      }
      room.labelAt = best;
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
      // (a spiral has its first two entrances at its two ends: the tip, then the middle where it began)
      const ends = this.layout && this.layout.ends ? [...new Set([this.rooms[this.rooms.length - 1], this.rooms[0]])] : [];
      for (const room of ends) {
        if (this.entrances.length >= count) break;
        if (placeIn(room)) lap.add(room.id);
        else full.add(room.id);
      }
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
      const center = this.roomLabelCell(room); // the number's cell: stairs keep off it
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
        const labelCell = this.roomLabelCell(r);
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
  /**
   * Make sure each room shape that is switched on is used by at least one room: for a shape that no room has, one room of a
   * shape that has several is remade as it (the first it can be, as a room may be too small for some shapes). Done from a
   * stream of numbers of its own, so the other rooms come out as they would have.
   */
  function ensureEachShape(rng, shapes, params) {
    const count = {};
    for (const s of shapes) count[s.kind] = (count[s.kind] || 0) + 1;
    for (const kind of rng.shuffle(params.roomShapes.filter((k) => !count[k]))) {
      for (const i of rng.shuffle(shapes.map((s, n) => n))) {
        if (count[shapes[i].kind] < 2) continue; // (that would only lose another shape)
        // (a shape can fall through at some sizes, so a few goes)
        let made = null;
        for (let t = 0; t < 4 && !(made && made.kind === kind); t++) made = DM.makeRoomShape(rng, shapes[i].area, [kind], params.minRoomWidth, params.minRoomLength);
        if (made.kind !== kind) continue;
        count[shapes[i].kind]--;
        count[kind] = 1;
        shapes[i] = made;
        break;
      }
    }
  }

  /**
   * One floor: the dungeon the settings describe, from this seed (the model of a single-level dungeon). `entrances` false
   * leaves out the entrances (a floor below the first is reached by its stairs only).
   */
  function generateFloor(params, seed, entrances = true) {
    const rng = new DM.Rng(seed);
    // Rooms are built around the average size, or around the smallest room if that is bigger.
    const base = baseRoomArea(params);
    const { minRoomWidth, minRoomLength } = params;
    const sampleArea = makeAreaSampler(rng, base, (base * params.sizeVariance) / 100, minRoomWidth * minRoomLength);
    const shapes = [];
    for (let i = 0; i < params.roomCount; i++) {
      shapes.push(DM.makeRoomShape(rng, sampleArea(), params.roomShapes, minRoomWidth, minRoomLength));
    }

    // every room shape that is switched on turns up at least once (where there are rooms enough, and a room big enough for it)
    ensureEachShape(new DM.Rng(`${seed}:shapes`), shapes, params);

    // a radial dungeon has its biggest room in the middle, as the hub
    if (params.layout === 'radial') {
      let big = 0;
      shapes.forEach((s, i) => {
        if (s.area > shapes[big].area) big = i;
      });
      shapes.unshift(...shapes.splice(big, 1));
    }

    const buildRooms = (r) => {
      const builder = new Builder(params, r, shapes);
      builder.placeFirst(shapes[0]);
      for (let i = 1; i < shapes.length; ) {
        const placed = builder.placeNext(shapes[i]); // (2 when a new spine brought a room with it)
        if (placed === 0) {
          builder.warnings.push(`Could only fit ${i} of ${shapes.length} rooms.`);
          break;
        }
        i += placed;
      }
      return builder;
    };
    // Every hallway type that is switched on should turn up in the dungeon (where hallways can occur at all). The builder leans
    // that way, but where it did not manage, the dungeon is built again from other numbers (a few times, then the best of them)
    const missingTypes = (builder) => {
      if (!hallwaysPossible(params)) return 0;
      const wanted = [...builder.kinds, ...(builder.types.has('branching') ? ['branching'] : [])];
      return wanted.filter((k) => builder.used[k] === 0).length;
    };
    const rank = (builder) => (builder.warnings.length > 0 ? 1000 : 0) + missingTypes(builder);
    let b = buildRooms(rng);
    for (let k = 1; k <= CONFIG.typeRetries && missingTypes(b) > 0; k++) {
      const again = buildRooms(new DM.Rng(`${seed}:retry${k}`));
      if (rank(again) < rank(b)) b = again;
    }

    // A room that none of the shapes switched on will fit (too small, or too narrow for the
    // minimum width and length) is a plain rectangle instead.
    const allowed = new Set(params.roomShapes);
    const stray = b.rooms.filter((r) => !allowed.has(r.shape.kind)).length;
    if (stray > 0) {
      const them = stray === 1 ? 'is a plain rectangle' : 'are plain rectangles';
      b.warnings.push(`${stray} of ${b.rooms.length} rooms ${them}: none of the room shapes that are switched on fit.`);
    }

    if (b.layout && b.layout.closes) b.closeLoop();

    // (a radial dungeon has no other doorways: every room is reached by a hallway from the hub)
    const extra = b.radial || b.main || b.gauntlet ? 0 : Math.round((b.rooms.length - 1) * CONFIG.extraConnectionFraction);
    for (let i = 0; i < extra; i++) if (!b.addExtraConnection()) break;

    if (entrances) b.placeEntrances(params.entrances);
    return b.buildModel(seed);
  }

  // ---- several levels ---------------------------------------------------------
  //
  // A dungeon of several levels is made of floors, each built as a dungeon of its own from the same settings (and its own numbers).
  // They share one bounding box, the size of the biggest floor, and a stair joins two floors in a square that is a room square on
  // both, at the same place on the map. To make the stairs fit, each floor is slid about inside the box until enough such squares
  // are where it meets the floor above; if none will do, the floor is built again from other numbers.
  //
  // The model of a dungeon of several levels is that of its first floor (level 1: the top, with the entrances), with
  //   levels   how many floors there are
  //   floors   the floors below, each { level, width, height, rooms, halls, connections, entrances, warnings, stats }
  //   stairs   [{ id, letter, x, y, upper, lower, upperRoom, lowerRoom }]: a stair between level `upper` and level `lower` (= upper + 1)
  // and width / height the shared box. Every room has its `level`. A model of one level has none of these (see levelCount).

  const LEVEL_TRIES = 12; // new floors built when the stairs do not fit, before settling for fewer
  const LEVEL_TRIES_MAX = 40; // ... and before giving up on a floor with no stair at all
  const LEVEL_OFFSETS = 120; // places tried for a floor in the box

  /** How many levels a model has. */
  function levelCount(model) {
    return model && model.levels ? model.levels : 1;
  }

  /** The name of a stair: A, B, ... Z, AA, AB, ... */
  function stairLetter(n) {
    let s = '';
    for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }

  /** Slide a floor's model by (dx, dy) squares. */
  function moveFloor(f, dx, dy) {
    if (dx === 0 && dy === 0) return;
    const mv = ([x, y]) => [x + dx, y + dy];
    for (const r of f.rooms) {
      r.bbox.x += dx;
      r.bbox.y += dy;
      r.labelCell = mv(r.labelCell);
      r.cells = r.cells.map(mv);
    }
    for (const h of f.halls) h.cells = h.cells.map(mv);
    for (const c of f.connections) {
      for (const o of c.openings) {
        o.x += dx;
        o.y += dy;
      }
    }
    for (const e of f.entrances) {
      e.x += dx;
      e.y += dy;
    }
  }

  const cellKey = (x, y) => x * 65536 + y;

  /**
   * The squares of a floor where a stair could go: room squares that are not at a doorway, a hallway's opening or an entrance
   * (nor next to one, on either side of it). Returns { cells: [[x, y, room id]], keys: Set of the squares }.
   */
  function stairSquares(f) {
    const blocked = new Set();
    const block = (x, y) => {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) blocked.add(cellKey(x + dx, y + dy));
    };
    for (const c of f.connections) {
      for (const o of c.openings) {
        block(o.x, o.y);
        block(o.x + DX[o.d], o.y + DY[o.d]);
      }
    }
    for (const e of f.entrances) {
      block(e.x, e.y);
      if (e.kind !== 'stairs') block(e.x + DX[e.d], e.y + DY[e.d]);
    }
    const cells = [];
    const keys = new Set();
    for (const r of f.rooms) {
      for (const [x, y] of r.cells) {
        if (blocked.has(cellKey(x, y))) continue;
        cells.push([x, y, r.id]);
        keys.add(cellKey(x, y));
      }
    }
    return { cells, keys };
  }

  /**
   * Choose up to `count` of these squares for stairs, spread out: each next one is far from the stairs the floor already has
   * (`anchors`) and from those chosen, and never next to one of them. With `rng` the pick is at random among the farthest tenth;
   * without it, the first that is farthest (to count what fits).
   */
  function pickStairs(squares, count, anchors, rng) {
    const chosen = [];
    const taken = anchors.slice();
    for (let n = 0; n < count; n++) {
      const scored = [];
      for (const s of squares) {
        let near = Infinity;
        let touching = false;
        for (const t of taken) {
          if (Math.abs(s[0] - t[0]) <= 1 && Math.abs(s[1] - t[1]) <= 1) {
            touching = true;
            break;
          }
          near = Math.min(near, Math.hypot(s[0] - t[0], s[1] - t[1]));
        }
        if (!touching) scored.push({ s, near });
      }
      if (scored.length === 0) break;
      scored.sort((p, q) => q.near - p.near);
      const pick = rng ? scored[rng.int(0, Math.max(0, Math.ceil(scored.length / 10) - 1))].s : scored[0].s;
      chosen.push(pick);
      taken.push(pick);
    }
    return chosen;
  }

  /** The squares that are valid stair squares on both floors, where `above` is slid to (ax, ay) in the box and `below` to (ox, oy). */
  function sharedSquares(above, ax, ay, below, ox, oy) {
    const out = [];
    for (const [x, y, room] of above.cells) {
      const bx = x + ax - ox;
      const by = y + ay - oy;
      if (bx < 0 || by < 0) continue;
      if (below.keys.has(cellKey(bx, by))) out.push([x + ax, y + ay, room]);
    }
    return out;
  }

  /** Several levels: see above. */
  function generateLevels(params, seed) {
    const stairRng = new DM.Rng(`${seed}:stairs`);
    const want = params.levelStairs;
    const first = generateFloor(params, seed, true);
    // each floor: its model (at its own origin), what its squares are, where it is slid to in the box
    const floors = [{ model: first, squares: stairSquares(first), at: [0, 0] }];
    let boxW = first.width;
    let boxH = first.height;
    const stairs = [];
    const warnings = [];

    for (let i = 1; i < params.levels; i++) {
      const upper = floors[i - 1];
      // the stairs the floor above already has (to the floor over it), in box squares: new stairs keep away from them
      const anchors = stairs.filter((s) => s.lower === i).map((s) => [s.x, s.y]);
      let best = null;
      for (let t = 0; t < LEVEL_TRIES_MAX; t++) {
        const model = generateFloor(params, `${seed}:level${i + 1}${t > 0 ? ':' + t : ''}`, false);
        const squares = stairSquares(model);
        const W = Math.max(boxW, model.width);
        const H = Math.max(boxH, model.height);
        // where in the box this floor can be slid to
        const spots = [];
        const rx = W - model.width;
        const ry = H - model.height;
        if ((rx + 1) * (ry + 1) <= LEVEL_OFFSETS) {
          for (let x = 0; x <= rx; x++) for (let y = 0; y <= ry; y++) spots.push([x, y]);
        } else {
          for (let n = 0; n < LEVEL_OFFSETS; n++) spots.push([stairRng.int(0, rx), stairRng.int(0, ry)]);
        }
        let top = -1;
        let tops = [];
        for (const at of spots) {
          const shared = sharedSquares(upper.squares, upper.at[0], upper.at[1], squares, at[0], at[1]);
          const fit = shared.length === 0 ? 0 : pickStairs(shared, want, anchors, null).length;
          if (fit > top) {
            top = fit;
            tops = [at];
          } else if (fit === top) tops.push(at);
        }
        if (!best || top > best.fit) best = { model, squares, at: tops[stairRng.int(0, tops.length - 1)], fit: top };
        if (top >= want) break;
        if (t + 1 >= LEVEL_TRIES && best.fit >= 1) break;
      }
      floors.push({ model: best.model, squares: best.squares, at: best.at });
      boxW = Math.max(boxW, best.model.width);
      boxH = Math.max(boxH, best.model.height);
      const shared = best.fit === 0 ? [] : sharedSquares(upper.squares, upper.at[0], upper.at[1], best.squares, best.at[0], best.at[1]);
      const picked = pickStairs(shared, want, anchors, stairRng);
      for (const [x, y, room] of picked) {
        const lx = x - best.at[0];
        const ly = y - best.at[1];
        const lowerRoom = best.model.rooms.find((r) => r.cells.some(([cx, cy]) => cx === lx && cy === ly)).id;
        stairs.push({ id: stairs.length, letter: stairLetter(stairs.length), x, y, upper: i, lower: i + 1, upperRoom: room, lowerRoom });
      }
      if (picked.length === 0) warnings.push(`No stair could be placed between level ${i} and level ${i + 1}.`);
      else if (picked.length < want) warnings.push(`Levels ${i} and ${i + 1} could only get ${picked.length} of ${want} stairs.`);
    }

    // every floor in the one box
    for (const f of floors) moveFloor(f.model, f.at[0], f.at[1]);
    floors.forEach((f, n) => {
      f.model.width = boxW;
      f.model.height = boxH;
      for (const r of f.model.rooms) r.level = n + 1;
      if (n > 0) for (const w of f.model.warnings) warnings.push(`Level ${n + 1}: ${w}`);
    });
    const model = floors[0].model;
    model.levels = params.levels;
    model.floors = floors.slice(1).map((f, n) => ({
      level: n + 2,
      width: boxW,
      height: boxH,
      rooms: f.model.rooms,
      halls: f.model.halls,
      connections: f.model.connections,
      entrances: f.model.entrances,
      warnings: f.model.warnings,
      stats: f.model.stats,
    }));
    model.stairs = stairs;
    model.warnings = [...model.warnings, ...warnings];
    model.stats.levels = params.levels;
    model.stats.stairs = stairs.length;
    return model;
  }

  /** The stairs on a floor (level `n`, from 1), each as { id, letter, x, y, dir: 'down' | 'up', to: the level it leads to, room }. */
  function floorStairs(model, n) {
    const out = [];
    for (const s of model.stairs || []) {
      if (s.upper === n) out.push({ id: s.id, letter: s.letter, x: s.x, y: s.y, dir: 'down', to: s.lower, room: s.upperRoom });
      else if (s.lower === n) out.push({ id: s.id, letter: s.letter, x: s.x, y: s.y, dir: 'up', to: s.upper, room: s.lowerRoom });
    }
    return out;
  }

  /**
   * The model of one floor (level `n`, from 1), as a model of a dungeon of its own, plus its stairs and its level; for a single level, the model.
   * Its rooms, entrances and stats are the floor's own, so changing a room or a door changes the dungeon. It also knows the dungeon it
   * is a view of (`_model`, which does not show when it is copied or written out), so that Edit mode, which can change the size of the map
   * and so move every floor, can do that (see edit.js).
   */
  function floorView(model, n = 1) {
    if (levelCount(model) === 1) return model;
    const own = n > 1 ? model.floors[n - 2] : {};
    const view = { ...model, ...own, floors: undefined, level: n, stairs: floorStairs(model, n) };
    Object.defineProperty(view, '_model', { value: model, enumerable: false, writable: true });
    return view;
  }

  function generateDungeon(raw) {
    const v = validateParams(raw);
    if (!v.ok) throw new RangeError(Object.values(v.errors).join(' '));
    const params = v.params;
    const seed = params.seed !== null ? params.seed : String(Math.floor(Math.random() * 1e9));
    params.seed = seed;
    return params.levels > 1 ? generateLevels(params, seed) : generateFloor(params, seed);
  }

  /** Every room of a model, level by level (for a single level, its rooms). */
  function allRooms(model) {
    return levelCount(model) === 1 ? model.rooms : [model.rooms, ...model.floors.map((f) => f.rooms)].flat();
  }

  DM.levelCount = levelCount;
  DM.allRooms = allRooms;
  DM.floorView = floorView;
  DM.moveFloor = moveFloor;
  DM.floorStairs = floorStairs;
  DM.stairLetter = stairLetter;

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
