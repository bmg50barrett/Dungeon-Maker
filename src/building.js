/*
 * Building mode: dungeons laid out like architecture.
 *
 * The other layouts place rooms one by one and thread hallways between them. A building works the other way round: it starts
 * from the outline (the footprint) and carves it up, so rooms share walls and the outside is a neat shape.
 *
 *   footprint    'rect'       a rectangle, square to about 2:1
 *                'courtyard'  a rectangle round an open courtyard (drawn and numbered as a room)
 *   circulation  'corridor'   straight corridors with rooms off both sides (a cloister round a courtyard)
 *                'hall'       one great hall (or the courtyard) that most rooms open off
 *                'rooms'      no corridors: rooms open into one another
 *                'mix'        a corridor with a great hall at one end (round a courtyard: a cloister on three sides, and the
 *                             rooms on the fourth open straight onto the courtyard)
 *
 * Steps: size the footprint from the room count and size; mark the corridors, hall or courtyard; cut the rest into
 * rectangular rooms by repeatedly halving the biggest piece; leave a few inner pieces as solid stone (never cutting anyone
 * off); join every room up (corridor openings, then doorways in a random spanning tree, then a few extra doorways); put the
 * entrances in the outer wall.
 *
 * Every floor of a building of several levels has the same footprint (it comes from the dungeon's own seed, not the
 * floor's), so the floors stack and their stairs line up. Levels go down from the entrances, so only level 1 has an open
 * courtyard; on the floors below, the same space is a central hall. Stairs never go in a courtyard.
 *
 * DM.buildingFloor(params, seed, entrances, ctx) returns the same model as any other floor; ctx gives the generator's own
 * pieces (baseRoomArea, modelOf, hallDoorChance).
 */
(function () {
  const DM = (globalThis.DM = globalThis.DM || {});
  const DX = [0, 1, 0, -1];
  const DY = [-1, 0, 1, 0];
  const OPP = [2, 3, 0, 1];

  const FOOTPRINTS = ['rect', 'courtyard', 'random'];
  const CIRCULATIONS = ['corridor', 'hall', 'rooms', 'mix'];
  const SOLID = [0.04, 0.1]; // share of the inner pieces left as solid stone

  const EMPTY = -1; // solid stone, inside or outside
  const HALL = -2; // corridor

  /** The seed the footprint comes from: the dungeon's own, without a floor's ':level2' (or ':level2:3' for a retry). */
  const footprintSeed = (seed) => String(seed).replace(/:level\d+(:\d+)?$/, '');

  // ---- cutting rectangles into rooms ---------------------------------------------------------------------------------

  /**
   * Cut the zones into `count` rectangles by halving the biggest piece again and again. A zone may only be cut one way
   * ('w': across its width, so every piece keeps the zone's full depth; 'h': across its height; 'any').
   * mins: { w, h } the least a room may measure. Returns the pieces, as many as fit.
   */
  function partition(zones, count, mins, spread, rng) {
    const leaves = zones.map((z) => ({ ...z }));
    const can = (l, dir) => (dir === 'w' ? l.cut !== 'h' && l.w >= 2 * mins.w : l.cut !== 'w' && l.h >= 2 * mins.h);
    while (leaves.length < count) {
      let best = null;
      let bestScore = -1;
      for (const l of leaves) {
        if (!can(l, 'w') && !can(l, 'h')) continue;
        const score = l.w * l.h * rng.range(0.75, 1.25);
        if (score > bestScore) {
          bestScore = score;
          best = l;
        }
      }
      if (!best) break;
      // cut across the longer side (for rooms that are not too long and thin), now and then the other way
      let dir;
      if (can(best, 'w') && can(best, 'h')) dir = best.w / mins.w >= best.h / mins.h ? 'w' : 'h';
      else dir = can(best, 'w') ? 'w' : 'h';
      if (can(best, 'w') && can(best, 'h') && rng.chance(0.2)) dir = dir === 'w' ? 'h' : 'w';
      const len = dir === 'w' ? best.w : best.h;
      const least = dir === 'w' ? mins.w : mins.h;
      const at = Math.max(least, Math.min(len - least, Math.round(len * (0.5 + rng.range(-spread, spread)))));
      const other = { ...best };
      if (dir === 'w') {
        other.x = best.x + at;
        other.w = best.w - at;
        best.w = at;
      } else {
        other.y = best.y + at;
        other.h = best.h - at;
        best.h = at;
      }
      leaves.push(other);
    }
    return leaves;
  }

  // ---- footprints and their circulation ------------------------------------------------------------------------------
  //
  // Each plan is worked out with the long side across (x); a building that is taller than wide is the same plan turned,
  // so the least room width and length swap while it is worked out. A plan gives:
  //   W, H       the footprint
  //   halls      rectangles of corridor
  //   specials   rooms that are not cut up: { x, y, w, h, role: 'hall' | 'courtyard' }
  //   zones      rectangles to cut into rooms: { x, y, w, h, cut }
  //   hub        the role whose room the others should open into first ('hall' / 'courtyard'), if any

  /** A plain rectangle of the given area, aspect 1 to `maxAspect` (long side across), at least `minW` x `minH`. */
  function rectOf(area, aspect, minW, minH) {
    let H = Math.max(minH, Math.round(Math.sqrt(area / aspect)));
    let W = Math.max(minW, Math.round(area / H));
    if (W < H && H >= minW && W >= minH) [W, H] = [H, W]; // long side across, where the least sizes allow it
    return { W, H };
  }

  /** Corridors: k straight corridors across, joined by one corridor down the middle, rooms off both sides, end rooms at the ends. */
  function corridorPlan(n, base, hw, mins, rng, endHall) {
    const d = Math.max(mins.h, Math.round(Math.sqrt(base) * rng.range(0.9, 1.25))); // depth of the rooms off a corridor
    const e = Math.max(mins.w, Math.round(Math.sqrt(base) * rng.range(0.9, 1.3))); // width of the end rooms
    const block = 2 * d + hw;
    const area = n * base * (1 + 0.15 * hw);
    const aspect = rng.range(1.2, 2);
    // every piece of the plan needs a room: 2 ends (1 with a hall), 2 sides per corridor, 2 more for each corridor the joining one cuts
    const kMax = Math.max(1, Math.floor((n - (endHall ? 1 : 2) - 2) / 4) + 1);
    // as many parallel corridors as bring the outline nearest the proportions wanted
    let k = 1;
    let bestOff = Infinity;
    for (let c = 1; c <= kMax; c++) {
      const h = c * block;
      const w = Math.max(h / 3, area / h);
      const off = Math.abs(Math.log(Math.max(w, h) / Math.min(w, h) / aspect));
      if (off < bestOff) (bestOff = off), (k = c);
    }
    const H = k * block;
    // a mix ends in a great hall: about 4 rooms' worth, near square, on the corridors' line, with rooms above and below it
    const hallArea = base * 4;
    const hallEnd = endHall ? Math.max(e, mins.w, Math.min(Math.round(Math.sqrt(hallArea * 1.2)), Math.round(hallArea / Math.max(mins.h, 2 * d + hw)))) : e;
    const W = Math.max(e + hallEnd + 3 * mins.w, Math.round(area / H));
    const halls = [];
    const zones = [];
    const x0 = e;
    const x1 = W - hallEnd; // corridors run from x0 to x1
    for (let i = 0; i < k; i++) halls.push({ x: x0, y: i * block + d, w: x1 - x0, h: hw });
    // the corridor that joins them, away from the ends
    let xc = null;
    if (k > 1) {
      const lo = x0 + mins.w;
      const hi = x1 - mins.w - hw;
      xc = lo <= hi ? rng.int(lo + Math.floor((hi - lo) / 3), hi - Math.floor((hi - lo) / 3)) : x0;
      halls.push({ x: xc, y: d + hw, w: hw, h: (k - 1) * block - hw });
    }
    for (let i = 0; i < k; i++) {
      for (const [y, inner] of [[i * block, i > 0], [i * block + d + hw, i < k - 1]]) {
        if (inner && xc !== null) {
          zones.push({ x: x0, y, w: xc - x0, h: d, cut: 'w' });
          zones.push({ x: xc + hw, y, w: x1 - xc - hw, h: d, cut: 'w' });
        } else zones.push({ x: x0, y, w: x1 - x0, h: d, cut: 'w' });
      }
    }
    zones.push({ x: 0, y: 0, w: e, h: H, cut: 'h' });
    const specials = [];
    if (endHall) {
      // the hall's height: its area over its width, kept to the building and lined up on a corridor; what is left above and
      // below is end rooms, unless too small for a room, when the hall takes it
      let hh = Math.max(mins.h, 2 * d + hw, Math.min(H, Math.round(hallArea / hallEnd)));
      const corridorRow = Math.floor((k - 1) / 2) * block + d + Math.floor(hw / 2);
      let hy = Math.max(0, Math.min(H - hh, corridorRow - Math.floor(hh / 2)));
      if (hy < mins.h) (hh += hy), (hy = 0);
      if (H - hy - hh < mins.h) hh = H - hy;
      specials.push({ x: x1, y: hy, w: hallEnd, h: hh, role: 'hall' });
      if (hy > 0) zones.push({ x: x1, y: 0, w: hallEnd, h: hy, cut: 'h' });
      if (hy + hh < H) zones.push({ x: x1, y: hy + hh, w: hallEnd, h: H - hy - hh, cut: 'h' });
    } else zones.push({ x: x1, y: 0, w: hallEnd, h: H, cut: 'h' });
    return { W, H, halls, specials, zones: zones.filter((z) => z.w > 0 && z.h > 0), hub: null };
  }

  /** A great hall in the middle, rooms all round it. */
  function hallPlan(n, base, mins, rng) {
    const hallArea = Math.round(base * rng.range(3.5, 5));
    const { W, H } = rectOf((n - 1) * base + hallArea, rng.range(1, 1.6), 3 * mins.w, 3 * mins.h);
    const hw = Math.max(mins.w, Math.min(W - 2 * mins.w, Math.round(Math.sqrt(hallArea * (W / H)))));
    const hh = Math.max(mins.h, Math.min(H - 2 * mins.h, Math.round(hallArea / hw)));
    const hx = rng.int(mins.w, Math.max(mins.w, W - hw - mins.w));
    const hy = rng.int(mins.h, Math.max(mins.h, H - hh - mins.h));
    const zones = [
      { x: 0, y: 0, w: W, h: hy, cut: 'any' },
      { x: 0, y: hy + hh, w: W, h: H - hy - hh, cut: 'any' },
      { x: 0, y: hy, w: hx, h: hh, cut: 'any' },
      { x: hx + hw, y: hy, w: W - hx - hw, h: hh, cut: 'any' },
    ];
    return { W, H, halls: [], specials: [{ x: hx, y: hy, w: hw, h: hh, role: 'hall' }], zones: zones.filter((z) => z.w > 0 && z.h > 0), hub: 'hall' };
  }

  /** Rooms only: one rectangle, cut up. */
  function roomsPlan(n, base, mins, rng) {
    const { W, H } = rectOf(n * base, rng.range(1, 1.8), mins.w, mins.h);
    return { W, H, halls: [], specials: [], zones: [{ x: 0, y: 0, w: W, h: H, cut: 'any' }], hub: null };
  }

  /** A ring of rooms round an open courtyard, with a cloister (a corridor round the courtyard) if `cloister` (true: all four sides; 'u': three). */
  function courtyardPlan(n, base, hw, mins, rng, cloister) {
    const q = rng.range(0.32, 0.45); // how much of each side the courtyard takes
    const cl = cloister ? hw : 0;
    const ring = (n - 1) * base * (cloister ? 1.15 : 1);
    const aspect = rng.range(1, 1.5);
    let H = Math.max(2 * mins.h + 2 * cl + 3, Math.round(Math.sqrt(ring / (1 - q * q) / aspect)));
    let W = Math.max(2 * mins.w + 2 * cl + 3, Math.round(H * aspect));
    const dTop = Math.max(mins.h, Math.round((H * (1 - q)) / 2) - cl);
    const dSide = Math.max(mins.w, Math.round((W * (1 - q)) / 2) - cl);
    H = Math.max(H, 2 * (dTop + cl) + Math.max(3, mins.h));
    W = Math.max(W, 2 * (dSide + cl) + Math.max(3, mins.w));
    const cx = dSide + cl;
    const cy = dTop + cl;
    // 'u' (for mix): the cloister runs round three sides only, and the rooms on the fourth (south) side open straight onto the courtyard
    const u = cloister === 'u';
    const court = { x: cx, y: cy, w: W - 2 * cx, h: H - cy - (u ? dTop : cy), role: 'courtyard' };
    const sideH = H - 2 * dTop - (u ? cl : 2 * cl);
    const halls = cloister
      ? [
          { x: dSide, y: dTop, w: W - 2 * dSide, h: cl },
          ...(u ? [] : [{ x: dSide, y: H - dTop - cl, w: W - 2 * dSide, h: cl }]),
          { x: dSide, y: dTop + cl, w: cl, h: sideH },
          { x: W - dSide - cl, y: dTop + cl, w: cl, h: sideH },
        ]
      : [];
    const zones = [
      { x: 0, y: 0, w: W, h: dTop, cut: 'any' },
      { x: 0, y: H - dTop, w: W, h: dTop, cut: 'any' },
      { x: 0, y: dTop, w: dSide, h: H - 2 * dTop, cut: 'any' },
      { x: W - dSide, y: dTop, w: dSide, h: H - 2 * dTop, cut: 'any' },
    ];
    return { W, H, halls, specials: [court], zones, hub: cloister === true ? null : 'courtyard' };
  }

  /** How many rooms of the least size the plan's zones could hold, each cut only the way its zone allows. */
  function capacity(plan, mins) {
    let n = 0;
    for (const z of plan.zones) {
      if (z.w < mins.w || z.h < mins.h) continue;
      const across = Math.floor(z.w / mins.w);
      const down = Math.floor(z.h / mins.h);
      n += z.cut === 'w' ? across : z.cut === 'h' ? down : across * down;
    }
    return n;
  }

  /** Every corridor, zone and special room lies inside the footprint, and every room-to-be is at least the least size. */
  function checkPlan(plan, mins) {
    const inside = (r) => r.x >= 0 && r.y >= 0 && r.w >= 0 && r.h >= 0 && r.x + r.w <= plan.W && r.y + r.h <= plan.H;
    for (const h of plan.halls) if (!inside(h)) throw new Error(`building plan: a corridor ${JSON.stringify(h)} is outside the ${plan.W}x${plan.H} footprint`);
    for (const r of [...plan.zones, ...plan.specials]) {
      if (!inside(r)) throw new Error(`building plan: ${JSON.stringify(r)} is outside the ${plan.W}x${plan.H} footprint`);
      if (r.w < mins.w || r.h < mins.h) throw new Error(`building plan: ${JSON.stringify(r)} is under the least room size ${mins.w}x${mins.h}`);
    }
  }

  // ---- the floor -----------------------------------------------------------------------------------------------------

  function buildingFloor(params, seed, wantEntrances, ctx) {
    const warnings = [];
    const base = ctx.baseRoomArea(params);
    const n = params.roomCount;
    const hw = params.hallWidth || 1;
    // the outline comes from the dungeon's own seed, so every level (and a level built again with other numbers) has the same one
    const fRng = new DM.Rng(`${params.seed !== null && params.seed !== undefined ? params.seed : footprintSeed(seed)}:footprint`);
    const rng = new DM.Rng(`${seed}:building`);

    // the footprint and circulation asked for, as far as the room count allows
    let footprint = params.footprint === 'random' ? fRng.pick(['rect', 'courtyard']) : params.footprint;
    let circulation = params.circulation;
    if (footprint === 'courtyard' && n < 5) {
      warnings.push(`A courtyard needs at least 5 rooms (the courtyard and 4 round it): built a plain rectangle instead.`);
      footprint = 'rect';
    }
    if (footprint === 'rect' && (circulation === 'corridor' || circulation === 'mix') && n < 8) {
      circulation = n >= 5 ? 'hall' : 'rooms';
      warnings.push(`Too few rooms for corridors (at least 8): ${circulation === 'hall' ? 'a great hall' : 'rooms open into one another'} instead.`);
    }
    if (footprint === 'rect' && circulation === 'hall' && n < 5) {
      if (params.circulation === 'hall') warnings.push(`Too few rooms for a great hall (at least 5): rooms open into one another instead.`);
      circulation = 'rooms';
    }

    // worked out long side across; a building taller than wide is the same plan turned
    const turned = fRng.chance(0.5);
    const mins = turned ? { w: params.minRoomLength, h: params.minRoomWidth } : { w: params.minRoomWidth, h: params.minRoomLength };
    // the footprint's size and shape come from fRng, so every floor of a building gets the same one; what goes inside comes from rng
    // Grow the footprint until it has room to spare for the rooms (a sum over the plan, the same on every floor)
    const makePlan = (b) => {
      if (footprint === 'courtyard') return courtyardPlan(n, b, hw, mins, fRng, circulation === 'corridor' ? true : circulation === 'mix' ? 'u' : false);
      if (circulation === 'corridor') return corridorPlan(n, b, hw, mins, fRng, false);
      if (circulation === 'mix') return corridorPlan(n, b, hw, mins, fRng, true);
      if (circulation === 'hall') return hallPlan(n, b, mins, fRng);
      return roomsPlan(n, b, mins, fRng);
    };
    let plan = makePlan(base);
    for (let grow = 1.2, t = 0; t < 20 && capacity(plan, mins) < Math.ceil((n - plan.specials.length) * 1.3) + 1; t++, grow *= 1.2) plan = makePlan(base * grow);
    checkPlan(plan, mins);
    // Levels go down from the entrances, so only level 1's courtyard is open sky: below it, the same space is a central hall
    const below = wantEntrances === false; // a floor below level 1 (only level 1 has ways in from outside)
    if (below) {
      for (const sp of plan.specials) if (sp.role === 'courtyard') sp.role = 'hall';
      if (plan.hub === 'courtyard') plan.hub = 'hall';
    }

    // ---- rooms: the specials, then the zones cut into the rest (plus a few pieces of solid stone)
    const ordinary = n - plan.specials.length;
    const inner = (l) => l.x > 0 && l.y > 0 && l.x + l.w < plan.W && l.y + l.h < plan.H;
    const solidWanted = ordinary >= 6 ? Math.round(ordinary * rng.range(SOLID[0], SOLID[1])) : 0;
    const spread = 0.12 + 0.3 * Math.min(1, params.sizeVariance / 100);
    // cut the zones; if the cuts happen to waste too much, cut again from other numbers (the footprint stays the same)
    let leaves = partition(plan.zones, ordinary + solidWanted, mins, spread, rng);
    for (let t = 1; t <= 8 && leaves.length < ordinary; t++) {
      const again = partition(plan.zones, ordinary + solidWanted, mins, spread, new DM.Rng(`${seed}:building:${t}`));
      if (again.length > leaves.length) leaves = again;
    }

    // the grid: who owns each square
    const W = plan.W;
    const H = plan.H;
    const owner = new Int32Array(W * H).fill(EMPTY);
    const fill = (r, v) => {
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) owner[y * W + x] = v;
    };
    for (const h of plan.halls) fill(h, HALL);
    const rects = [...plan.specials.map((s) => ({ ...s })), ...leaves.map((l) => ({ ...l }))];
    rects.forEach((r, i) => fill(r, i));

    // which pieces touch which (by a shared wall), and which touch the corridors
    const touches = () => {
      const pairs = new Map();
      const byHall = new Set();
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const a = owner[y * W + x];
          if (a < 0) continue;
          for (const d of [1, 2]) {
            const nx = x + DX[d];
            const ny = y + DY[d];
            if (nx >= W || ny >= H) continue;
            const b = owner[ny * W + nx];
            if (b >= 0 && b !== a) {
              const k = a < b ? `${a},${b}` : `${b},${a}`;
              pairs.set(k, true);
            }
          }
          for (let d = 0; d < 4; d++) {
            const nx = x + DX[d];
            const ny = y + DY[d];
            if (nx >= 0 && ny >= 0 && nx < W && ny < H && owner[ny * W + nx] === HALL) byHall.add(a);
          }
        }
      }
      return { pairs: [...pairs.keys()].map((k) => k.split(',').map(Number)), byHall };
    };
    const connected = (gone) => {
      const { pairs, byHall } = touches();
      const live = rects.map((_, i) => !gone.has(i));
      const nb = rects.map(() => []);
      for (const [a, b] of pairs) if (live[a] && live[b]) (nb[a].push(b), nb[b].push(a));
      const hallRooms = [...byHall].filter((i) => live[i]);
      for (const a of hallRooms) for (const b of hallRooms) if (a !== b) nb[a].push(b);
      const start = live.indexOf(true);
      const seen = new Set([start]);
      const stack = [start];
      while (stack.length) for (const v of nb[stack.pop()]) if (!seen.has(v)) (seen.add(v), stack.push(v));
      return seen.size === live.filter(Boolean).length;
    };

    // solid stone: small inner pieces, never one that cuts a room off, never more than wanted
    const solids = new Set();
    const surplus = Math.max(0, rects.length - n);
    // (only pieces that look like a block of masonry: not long thin strips, not much bigger than a room)
    const blocky = (r) => Math.max(r.w, r.h) <= 2.5 * Math.min(r.w, r.h) && r.w * r.h <= 1.25 * base;
    const candidates = rects.map((r, i) => i).filter((i) => i >= plan.specials.length && inner(rects[i]) && blocky(rects[i]));
    rng.shuffle(candidates);
    candidates.sort((a, b) => rects[a].w * rects[a].h - rects[b].w * rects[b].h);
    for (const i of candidates) {
      if (solids.size >= surplus) break;
      solids.add(i);
      if (!connected(solids)) solids.delete(i);
    }
    // anything still over the count (no inner piece could go solid) is merged into a neighbour it lines up with exactly
    const merged = new Set();
    let over = rects.length - solids.size - n;
    for (let i = rects.length - 1; i >= plan.specials.length && over > 0; i--) {
      if (solids.has(i) || merged.has(i)) continue;
      const r = rects[i];
      const j = rects.findIndex((s, k) => k !== i && k >= plan.specials.length && !solids.has(k) && !merged.has(k) &&
        ((s.y === r.y && s.h === r.h && (s.x + s.w === r.x || r.x + r.w === s.x)) || (s.x === r.x && s.w === r.w && (s.y + s.h === r.y || r.y + r.h === s.y))));
      if (j < 0) continue;
      const s = rects[j];
      const side = s.y === r.y && s.h === r.h;
      rects[j] = { ...s, x: Math.min(s.x, r.x), y: Math.min(s.y, r.y), w: side ? s.w + r.w : s.w, h: side ? s.h : s.h + r.h };
      merged.add(i);
      over--;
    }
    for (const i of solids) fill(rects[i], EMPTY);

    // the rooms, numbered from 0, in the order the rectangles came
    const keep = rects.map((r, i) => i).filter((i) => !solids.has(i) && !merged.has(i));
    const roomOf = new Map(keep.map((i, id) => [i, id]));
    owner.fill(EMPTY);
    for (const h of plan.halls) fill(h, HALL);
    keep.forEach((i) => fill(rects[i], roomOf.get(i)));
    if (keep.length < n) warnings.push(`Could only fit ${keep.length} of ${n} rooms.`);

    const rooms = keep.map((i, id) => {
      const r = rects[i];
      const cells = [];
      let sumX = 0;
      let sumY = 0;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) (cells.push([x, y]), (sumX += x + 0.5), (sumY += y + 0.5));
      return { id, shape: { kind: 'rect' }, cells, sumX, sumY, role: r.role || null, rect: r };
    });
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? EMPTY : owner[y * W + x]);

    // ---- joining up
    const doorChance = ctx.hallDoorChance[params.hallDoors];
    const connections = [];
    const halls = [];
    const linked = new Set();
    const pairKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

    // the squares along the wall between room a and room b (or the corridors, for b === HALL), as openings out of a
    const wallBetween = (a, b) => {
      const out = [];
      for (const [x, y] of rooms[a].cells) for (let d = 0; d < 4; d++) if (at(x + DX[d], y + DY[d]) === b) out.push({ x, y, d });
      return out;
    };
    // a doorway away from the ends of the wall where there is room
    const pickDoor = (list) => {
      if (list.length <= 2) return rng.pick(list);
      const lo = Math.floor(list.length * 0.25);
      const hi = Math.max(lo, Math.ceil(list.length * 0.75) - 1);
      return list[rng.int(lo, hi)];
    };

    // corridors: one hallway, serving every room along it (each by one opening)
    const hallCells = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (owner[y * W + x] === HALL) hallCells.push([x, y]);
    if (hallCells.length > 0) {
      const served = [];
      const openings = [];
      for (const r of rooms) {
        const wall = wallBetween(r.id, HALL);
        if (wall.length === 0) continue;
        const o = pickDoor(wall);
        served.push(r.id);
        openings.push({ x: o.x, y: o.y, d: o.d, style: rng.chance(doorChance) ? 'door' : 'open', room: r.id });
      }
      const conn = { id: 0, type: 'hall', rooms: served, hall: 0, openings };
      connections.push(conn);
      halls.push({ id: 0, kind: 'spine', cells: hallCells, conn });
      for (const a of served) for (const b of served) if (a < b) linked.add(pairKey(a, b));
    }

    // doorways: rooms next to each other, by shared walls
    const nb = rooms.map(() => new Set());
    for (const r of rooms) for (const [x, y] of r.cells) for (let d = 0; d < 4; d++) {
      const v = at(x + DX[d], y + DY[d]);
      if (v >= 0 && v !== r.id) nb[r.id].add(v);
    }
    const addDoor = (a, b) => {
      const o = pickDoor(wallBetween(a, b));
      connections.push({ id: connections.length, type: 'door', rooms: [a, b], hall: null, openings: [{ x: o.x, y: o.y, d: o.d, style: 'door', room: a }] });
      linked.add(pairKey(a, b));
    };
    // first the rooms round the hub open into it, then a spanning tree from everything joined so far
    const joined = new Set(connections.length ? connections[0].rooms : []);
    const hub = plan.hub ? rooms.find((r) => r.role === plan.hub) : null;
    if (hub) {
      joined.add(hub.id);
      for (const v of [...nb[hub.id]].sort((p, q) => p - q)) if (!linked.has(pairKey(hub.id, v))) (addDoor(v, hub.id), joined.add(v));
    }
    if (joined.size === 0) joined.add(rooms.find((r) => r.role)?.id ?? rng.int(0, rooms.length - 1));
    for (let guard = 0; joined.size < rooms.length && guard < rooms.length * 4; guard++) {
      const options = [];
      for (const a of joined) for (const b of nb[a]) if (!joined.has(b)) options.push([a, b]);
      if (options.length === 0) break;
      const [a, b] = rng.pick(options);
      addDoor(b, a);
      joined.add(b);
    }
    if (joined.size < rooms.length) warnings.push(`${rooms.length - joined.size} rooms could not be joined to the rest.`);
    // a few extra doorways between neighbours, so the plan is not a tree (more with connection randomization, more in a mix)
    const extraShare = 0.08 + 0.35 * (params.connectionRandomness / 100) + (circulation === 'mix' ? 0.1 : 0);
    const spare = [];
    for (const r of rooms) for (const v of nb[r.id]) if (r.id < v && !linked.has(pairKey(r.id, v))) spare.push([r.id, v]);
    rng.shuffle(spare);
    const extra = Math.min(spare.length, Math.round((rooms.length - 1) * extraShare));
    for (let i = 0; i < extra; i++) addDoor(spare[i][0], spare[i][1]);

    // ---- entrances: doors in the outer wall, spread out (or stairs on a room floor, when not only on the edge)
    const entrances = [];
    if (wantEntrances) {
      const outer = [];
      for (const r of rooms) {
        if (r.role === 'courtyard') continue;
        for (const [x, y] of r.cells) for (let d = 0; d < 4; d++) {
          const nx = x + DX[d];
          const ny = y + DY[d];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) outer.push({ room: r.id, x, y, d });
        }
      }
      const doorSquares = new Set();
      for (const c of connections) for (const o of c.openings) (doorSquares.add(`${o.x},${o.y}`), doorSquares.add(`${o.x + DX[o.d]},${o.y + DY[o.d]}`));
      // away from corners: not the end square of a wall
      const middle = outer.filter((e) => at(e.x + DX[(e.d + 1) % 4], e.y + DY[(e.d + 1) % 4]) === e.room && at(e.x + DX[(e.d + 3) % 4], e.y + DY[(e.d + 3) % 4]) === e.room);
      const pool = middle.length >= params.entrances ? middle : outer;
      const chosen = [];
      const mid = (e) => [e.x + 0.5 + DX[e.d] * 0.5, e.y + 0.5 + DY[e.d] * 0.5];
      // the first: in an end room on a corridor's line, or any outer wall
      const first = rng.pick(pool);
      if (first) chosen.push(first);
      while (chosen.length < params.entrances) {
        let best = null;
        let bestD = -1;
        for (const e of pool) {
          if (chosen.includes(e)) continue;
          const [ex, ey] = mid(e);
          const near = Math.min(...chosen.map((c) => Math.hypot(ex - mid(c)[0], ey - mid(c)[1])));
          if (near > bestD) (bestD = near), (best = e);
        }
        if (!best) break;
        chosen.push(best);
      }
      chosen.forEach((e, i) => {
        if (i > 0 && !params.edgeEntrancesOnly && rng.chance(0.4)) {
          // stairs down from above, on a floor square of some room away from its doorways
          const room = rng.pick(rooms.filter((r) => r.role !== 'courtyard'));
          const spots = room.cells.filter(([x, y]) => !doorSquares.has(`${x},${y}`) && !entrances.some((s) => s.x === x && s.y === y));
          if (spots.length) {
            const [x, y] = rng.pick(spots);
            entrances.push({ kind: 'stairs', room: room.id, x, y, d: 0 });
            return;
          }
        }
        entrances.push({ kind: 'door', room: e.room, x: e.x, y: e.y, d: e.d });
      });
      if (entrances.length < params.entrances) warnings.push(`Could only place ${entrances.length} of ${params.entrances} entrances.`);
    }

    // turn a building that was worked out on its side
    if (turned) {
      const sw = ([x, y]) => [y, x];
      const DT = [3, 2, 1, 0]; // N<->W, E<->S when x and y swap
      for (const r of rooms) {
        r.cells = r.cells.map(sw);
        [r.sumX, r.sumY] = [r.sumY, r.sumX];
      }
      for (const h of halls) h.cells = h.cells.map(sw);
      for (const c of connections) for (const o of c.openings) ([o.x, o.y] = [o.y, o.x], (o.d = DT[o.d]));
      for (const e of entrances) {
        [e.x, e.y] = [e.y, e.x];
        if (e.kind === 'door') e.d = DT[e.d];
      }
    }

    const model = ctx.modelOf(
      {
        rooms,
        halls,
        connections,
        entrances,
        warnings,
        cellCount: rooms.reduce((a, r) => a + r.cells.length, 0) + hallCells.length,
        used: { short: 0, spine: halls.length, curly: 0, branching: 0 },
        params,
      },
      seed
    );
    // the great hall and the courtyard say what they are
    for (const r of model.rooms) if (rooms[r.id].role) r.role = rooms[r.id].role;
    model.building = { footprint, circulation };
    return model;
  }

  DM.BUILDING_FOOTPRINTS = FOOTPRINTS;
  DM.BUILDING_CIRCULATIONS = CIRCULATIONS;
  DM.buildingFloor = buildingFloor;
})();
