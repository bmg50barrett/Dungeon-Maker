/*
 * Room shape generation.
 *
 * A room is a set of whole grid cells, which guarantees that every wall is a
 * straight horizontal/vertical line whose corners fall on grid vertices, and
 * that every corner is either a 90 degree (inside) or 270 degree (outside)
 * corner. Shapes are built by cutting rectangles out of a bounding box:
 *
 *   rect, L, T, U, H, plus, Z (step), chamfer (cut corners)
 *
 * Which of these may be used is up to the caller (see makeRoomShape).
 *
 * Every shape is validated to be a single connected piece with no holes and no
 * "bow-tie" vertices (two cells touching only at a corner).
 */
(function () {
  const DM = (globalThis.DM = globalThis.DM || {});

  const DX = [0, 1, 0, -1]; // N, E, S, W
  const DY = [-1, 0, 1, 0];

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const clampInt = (v, lo, hi) => clamp(Math.round(v), lo, Math.max(lo, hi));

  // ---- grid helpers (cell grids are Uint8Array, row-major, 1 = floor) -------

  function fullGrid(W, H) {
    return new Uint8Array(W * H).fill(1);
  }

  function clearRect(g, W, x0, y0, x1, y1) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g[y * W + x] = 0;
  }

  function countFloor(g) {
    let n = 0;
    for (let i = 0; i < g.length; i++) n += g[i];
    return n;
  }

  /** Rotate a W x H grid 90 degrees clockwise. Returns { g, W, H } (dims swapped). */
  function rotate(g, W, H) {
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // (x, y) -> (H - 1 - y, x) in an H x W grid
        out[x * H + (H - 1 - y)] = g[y * W + x];
      }
    }
    return { g: out, W: H, H: W };
  }

  /** True if the cells form one 4-connected piece, with no holes and no pinch points. */
  function isValidShape(g, W, H) {
    const total = countFloor(g);
    if (total === 0) return false;

    // connectivity of floor cells
    const seen = new Uint8Array(W * H);
    const stack = [g.indexOf(1)];
    seen[stack[0]] = 1;
    let reached = 0;
    while (stack.length) {
      const i = stack.pop();
      reached++;
      const x = i % W;
      const y = (i - x) / W;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (g[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (reached !== total) return false;

    // no holes: every empty cell must connect to the outside of a padded grid
    const PW = W + 2;
    const PH = H + 2;
    const empty = new Uint8Array(PW * PH);
    for (let y = 0; y < PH; y++) {
      for (let x = 0; x < PW; x++) {
        const gx = x - 1;
        const gy = y - 1;
        const filled = gx >= 0 && gy >= 0 && gx < W && gy < H && g[gy * W + gx] === 1;
        empty[y * PW + x] = filled ? 0 : 1;
      }
    }
    const outside = new Uint8Array(PW * PH);
    const q = [0];
    outside[0] = 1;
    let outsideCount = 0;
    while (q.length) {
      const i = q.pop();
      outsideCount++;
      const x = i % PW;
      const y = (i - x) / PW;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= PW || ny >= PH) continue;
        const j = ny * PW + nx;
        if (empty[j] && !outside[j]) {
          outside[j] = 1;
          q.push(j);
        }
      }
    }
    if (outsideCount !== PW * PH - total) return false;

    // no bow-tie vertices (checkerboard 2x2 blocks)
    const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? g[y * W + x] : 0);
    for (let y = -1; y < H; y++) {
      for (let x = -1; x < W; x++) {
        const a = at(x, y);
        const b = at(x + 1, y);
        const c = at(x, y + 1);
        const d = at(x + 1, y + 1);
        if (a === d && b === c && a !== b) return false;
      }
    }
    return true;
  }

  // ---- shape builders -------------------------------------------------------
  // Each builder works in a canonical orientation and returns a grid (or null if
  // the bounding box is too small for the shape). p holds random fractions in
  // [0, 1) so that a builder is a pure function of (W, H, p).

  const BUILDERS = {
    rect: { weight: 47, minArea: 1, keep: 1, minW: 1, minH: 1, build: (W, H) => fullGrid(W, H) },

    L: {
      weight: 14, minArea: 5, keep: 0.7, minW: 2, minH: 2,
      build(W, H, p) {
        const g = fullGrid(W, H);
        const cw = clampInt(W * (0.3 + 0.35 * p.a), 1, W - 1);
        const ch = clampInt(H * (0.3 + 0.35 * p.b), 1, H - 1);
        clearRect(g, W, 0, 0, cw, ch);
        return g;
      },
    },

    T: {
      weight: 6, minArea: 8, keep: 0.7, minW: 3, minH: 2,
      build(W, H, p) {
        const g = fullGrid(W, H);
        const stem = clampInt(W * (0.25 + 0.3 * p.a), 1, W - 2);
        const left = Math.floor((W - stem) / 2);
        const right = W - stem - left;
        const ch = clampInt(H * (0.35 + 0.3 * p.b), 1, H - 1);
        clearRect(g, W, 0, H - ch, left, H);
        clearRect(g, W, W - right, H - ch, W, H);
        return g;
      },
    },

    U: {
      weight: 7, minArea: 8, keep: 0.75, minW: 3, minH: 2,
      build(W, H, p) {
        const g = fullGrid(W, H);
        const nw = clampInt(W * (0.25 + 0.3 * p.a), 1, W - 2);
        const x0 = clampInt((W - nw) * (0.3 + 0.4 * p.c), 1, W - nw - 1);
        const nd = clampInt(H * (0.35 + 0.3 * p.b), 1, H - 1);
        clearRect(g, W, x0, 0, x0 + nw, nd);
        return g;
      },
    },

    // two legs joined by a crossbar: a notch cut into the top and one into the bottom
    H: {
      weight: 5, minArea: 7, keep: 0.72, minW: 3, minH: 3,
      build(W, H, p) {
        const g = fullGrid(W, H);
        const gap = clampInt(W * (0.2 + 0.2 * p.a), 1, W - 2);
        const left = Math.floor((W - gap) / 2);
        const right = W - gap - left;
        // the two notches must leave at least one row for the crossbar
        const top = clampInt(H * (0.3 + 0.2 * p.b), 1, H - 2);
        const bottom = clampInt(H * (0.3 + 0.2 * p.c), 1, H - 1 - top);
        clearRect(g, W, left, 0, W - right, top);
        clearRect(g, W, left, H - bottom, W - right, H);
        return g;
      },
    },

    plus: {
      weight: 5, minArea: 10, keep: 0.6, minW: 3, minH: 3,
      build(W, H, p) {
        const g = fullGrid(W, H);
        const sw = clampInt(W * (0.3 + 0.2 * p.a), 1, W - 2);
        const sh = clampInt(H * (0.3 + 0.2 * p.b), 1, H - 2);
        const left = Math.floor((W - sw) / 2);
        const right = W - sw - left;
        const top = Math.floor((H - sh) / 2);
        const bottom = H - sh - top;
        clearRect(g, W, 0, 0, left, top);
        clearRect(g, W, W - right, 0, W, top);
        clearRect(g, W, 0, H - bottom, left, H);
        clearRect(g, W, W - right, H - bottom, W, H);
        return g;
      },
    },

    Z: {
      weight: 5, minArea: 10, keep: 0.65, minW: 3, minH: 2,
      build(W, H, p) {
        const g = fullGrid(W, H);
        const cw1 = clampInt(W * (0.25 + 0.2 * p.a), 1, W - 2);
        const cw2 = clampInt(W * (0.25 + 0.2 * p.b), 1, W - 1 - cw1);
        const ch1 = clampInt(H * (0.3 + 0.3 * p.c), 1, H - 1);
        const ch2 = clampInt(H * (0.3 + 0.3 * p.d), 1, H - 1);
        clearRect(g, W, 0, 0, cw1, ch1);
        clearRect(g, W, W - cw2, H - ch2, W, H);
        return g;
      },
    },

    chamfer: {
      weight: 11, minArea: 16, keep: 0.9, minW: 4, minH: 4,
      build(W, H, p) {
        const g = fullGrid(W, H);
        const m = Math.min(W, H);
        const cs = clampInt(m * (0.15 + 0.15 * p.a), 1, Math.floor((m - 1) / 2));
        clearRect(g, W, 0, 0, cs, cs);
        clearRect(g, W, W - cs, 0, W, cs);
        clearRect(g, W, 0, H - cs, cs, H);
        clearRect(g, W, W - cs, H - cs, W, H);
        return g;
      },
    },
  };
  const KIND_NAMES = Object.keys(BUILDERS);

  /**
   * Bounding-box dimensions with area ~ boxArea and the given aspect ratio (>= 1).
   * The box is at least minW wide and minH tall, so it may end up larger than boxArea.
   */
  function dimsFor(boxArea, aspect, swap, minW, minH) {
    // h is worked out first and becomes the height unless the box is swapped
    const hMin = swap ? minW : minH;
    const wMin = swap ? minH : minW;
    const h = Math.max(hMin, Math.round(Math.sqrt(boxArea / aspect)));
    const w = Math.max(wMin, Math.round(boxArea / h));
    return swap ? { W: h, H: w } : { W: w, H: h };
  }

  function buildKind(kind, targetArea, rng, minW, minH) {
    const spec = BUILDERS[kind];
    const aspectMax = kind === 'rect' ? 2.4 : 1.8;
    const aspect = Math.exp(rng.range(0, Math.log(aspectMax)));
    const swap = rng.chance(0.5);
    const p = { a: rng.next(), b: rng.next(), c: rng.next(), d: rng.next() };
    const rotations = rng.int(0, 3);
    // The grid is built upright and then turned, so a quarter turn swaps width and height.
    const [gridMinW, gridMinH] = rotations % 2 === 1 ? [minH, minW] : [minW, minH];

    let boxArea = targetArea / spec.keep;
    let best = null;
    for (let iter = 0; iter < 5; iter++) {
      const { W, H } = dimsFor(boxArea, aspect, swap, gridMinW, gridMinH);
      if (W < spec.minW || H < spec.minH) {
        boxArea *= 1.5;
        continue;
      }
      let g = spec.build(W, H, p);
      if (!g || !isValidShape(g, W, H)) {
        boxArea *= 1.2;
        continue;
      }
      const area = countFloor(g);
      let gw = W;
      let gh = H;
      for (let r = 0; r < rotations; r++) {
        const rot = rotate(g, gw, gh);
        g = rot.g;
        gw = rot.W;
        gh = rot.H;
      }
      if (!best || Math.abs(area - targetArea) < Math.abs(best.area - targetArea)) {
        best = { g, W: gw, H: gh, area, kind };
      }
      if (Math.abs(area - targetArea) <= Math.max(1, targetArea * 0.1)) break;
      boxArea *= targetArea / area;
    }
    return best;
  }

  /** Pick the closest-area rectangle out of a few random aspect ratios. */
  function buildRect(targetArea, rng, minW, minH) {
    let best = null;
    for (let i = 0; i < 4; i++) {
      const aspect = Math.exp(rng.range(0, Math.log(2.4)));
      const { W, H } = dimsFor(targetArea, aspect, rng.chance(0.5), minW, minH);
      const area = W * H;
      if (!best || Math.abs(area - targetArea) < Math.abs(best.area - targetArea)) {
        best = { g: fullGrid(W, H), W, H, area, kind: 'rect' };
      }
    }
    return best;
  }

  /** Convert a grid into the shape object used by the generator. */
  function finishShape(built) {
    const { g, W, H, kind } = built;
    const isFloor = (x, y) => x >= 0 && y >= 0 && x < W && y < H && g[y * W + x] === 1;

    const perimeter = [];
    const interior = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!isFloor(x, y)) continue;
        let onEdge = false;
        for (let d = 0; d < 4; d++) if (!isFloor(x + DX[d], y + DY[d])) onEdge = true;
        (onEdge ? perimeter : interior).push([x, y]);
      }
    }
    // Perimeter cells first: collisions are almost always found there, so
    // placement checks can reject a candidate quickly.
    const cells = perimeter.concat(interior);

    // open[d] = indices of cells whose side facing direction d is exposed
    const open = [[], [], [], []];
    for (let i = 0; i < perimeter.length; i++) {
      const [x, y] = perimeter[i];
      for (let d = 0; d < 4; d++) if (!isFloor(x + DX[d], y + DY[d])) open[d].push(i);
    }

    return {
      kind,
      w: W,
      h: H,
      area: cells.length,
      cells,
      perimeterCount: perimeter.length,
      open,
    };
  }

  /**
   * Generate a room shape with roughly `targetArea` cells.
   *
   * `allowedKinds` limits the choice to those shapes (default: all of them). A shape
   * is only offered when the room is big enough for it to look like itself, so a
   * very small room may have no allowed shape that fits; it then becomes a plain
   * rectangle, which is the one shape that fits any size. Check `shape.kind` against
   * the allowed list to tell when that happened.
   *
   * `minW` and `minH` (default 1) are the least the room's bounding box may measure,
   * across the map (x) and up and down the map (y). The room is never smaller than
   * minW x minH squares, and it is never turned to fit: a 3 x 8 minimum means at
   * least 3 wide and 8 tall, never 8 wide and 3 tall.
   * @returns {{kind:string,w:number,h:number,area:number,cells:number[][],perimeterCount:number,open:number[][]}}
   */
  function makeRoomShape(rng, targetArea, allowedKinds, minW = 1, minH = 1) {
    targetArea = Math.max(minW * minH, Math.round(targetArea));
    const allowed = allowedKinds ? new Set(allowedKinds) : null;

    const weights = KIND_NAMES.map((k) =>
      (!allowed || allowed.has(k)) && targetArea >= BUILDERS[k].minArea ? BUILDERS[k].weight : 0
    );
    let built = null;
    // Pick by weight; if a builder cannot manage this size, drop it and pick again.
    while (!built && weights.some((w) => w > 0)) {
      const i = rng.weightedIndex(weights);
      const kind = KIND_NAMES[i];
      built = kind === 'rect' ? buildRect(targetArea, rng, minW, minH) : buildKind(kind, targetArea, rng, minW, minH);
      weights[i] = 0;
    }
    if (!built) built = buildRect(targetArea, rng, minW, minH);
    return finishShape(built);
  }

  DM.makeRoomShape = makeRoomShape;
  DM.isValidShape = isValidShape; // exposed for tests
  DM.SHAPE_KINDS = KIND_NAMES;
  /** Smallest room area (squares) at which each shape is offered; below it, only rectangles fit. */
  DM.SHAPE_MIN_AREA = Object.fromEntries(KIND_NAMES.map((k) => [k, BUILDERS[k].minArea]));
})();
