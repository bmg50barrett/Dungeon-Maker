/*
 * Headless validation of the dungeon generator. Run with:  node tests/run.js
 *
 * Generates many dungeons across the whole input range and checks, for each:
 *   - requested room count / entrance count are honoured
 *   - rooms are single connected rectilinear shapes (no holes, no bow-ties)
 *   - no two rooms/hallways overlap
 *   - every room can be reached from every other room
 *   - every door/opening joins the two cells it claims to
 *   - hallways are continuous 1-cell-wide paths that touch nothing but their rooms
 *   - entrances sit on exterior walls
 * and prints statistics on room sizes and connection types.
 */
require('../src/rng.js');
require('../src/shapes.js');
require('../src/generator.js');
require('../src/labels.js');
require('../src/palette.js');
require('../src/share.js');
const DM = globalThis.DM;
const { DX, DY, OPP } = DM.DIRS;

let failures = 0;
function fail(ctx, msg) {
  failures++;
  if (failures <= 25) console.log(`  FAIL [${ctx}] ${msg}`);
}

function checkDungeon(dun, ctx) {
  const W = dun.width + 2; // 1-cell padding around the map
  const H = dun.height + 2;
  const owner = new Int32Array(W * H); // +room+1, -(hall+1)
  const at = (x, y) => (x < -1 || y < -1 || x > dun.width || y > dun.height ? 0 : owner[(y + 1) * W + x + 1]);

  // --- rooms
  const allowedShapes = new Set(dun.params.roomShapes);
  const smallestAllowed = Math.min(...dun.params.roomShapes.map((k) => DM.SHAPE_MIN_AREA[k]));
  if (dun.rooms.length !== dun.params.roomCount) {
    fail(ctx, `placed ${dun.rooms.length} rooms, wanted ${dun.params.roomCount} (warnings: ${dun.warnings.join('; ')})`);
  }
  for (const r of dun.rooms) {
    for (const [x, y] of r.cells) {
      if (x < 0 || y < 0 || x >= dun.width || y >= dun.height) {
        fail(ctx, `room ${r.id} cell out of bounds`);
        continue;
      }
      if (owner[(y + 1) * W + x + 1] !== 0) fail(ctx, `cell (${x},${y}) owned twice`);
      owner[(y + 1) * W + x + 1] = r.id + 1;
    }
    // shape validity
    const bw = r.bbox.w;
    const bh = r.bbox.h;
    const g = new Uint8Array(bw * bh);
    for (const [x, y] of r.cells) g[(y - r.bbox.y) * bw + (x - r.bbox.x)] = 1;
    if (!DM.isValidShape(g, bw, bh)) fail(ctx, `room ${r.id} (${r.kind}) is not a valid rectilinear shape`);
    // width is across the map (x), length is up and down it (y); rooms are never turned to fit
    if (bw < dun.params.minRoomWidth || bh < dun.params.minRoomLength) {
      fail(ctx, `room ${r.id} (${r.kind}) is ${bw} wide x ${bh} long, under the ${dun.params.minRoomWidth} x ${dun.params.minRoomLength} minimum`);
    }
    // only shapes that are switched on, except plain rectangles for rooms none of them fit
    if (!allowedShapes.has(r.kind)) {
      const noMinimum = dun.params.minRoomWidth === 1 && dun.params.minRoomLength === 1;
      if (r.kind !== 'rect') fail(ctx, `room ${r.id} is a ${r.kind}, which is switched off`);
      else if (noMinimum && r.area > smallestAllowed + 3) fail(ctx, `room ${r.id} (area ${r.area}) is a rectangle although a switched-on shape fits`);
      else if (!dun.warnings.some((w) => /plain rectangle/.test(w))) fail(ctx, `room ${r.id} fell back to a rectangle without a warning`);
    }
    if (r.area !== r.cells.length) fail(ctx, `room ${r.id} area mismatch`);
    const [lx, ly] = r.labelCell;
    if (at(lx, ly) !== r.id + 1) fail(ctx, `room ${r.id} label cell is not inside the room`);
  }
  const labels = dun.rooms.map((r) => r.label).sort((a, b) => a - b);
  labels.forEach((l, i) => {
    if (l !== i + 1) fail(ctx, 'room labels are not 1..N');
  });

  // --- halls
  for (const h of dun.halls) {
    if (h.cells.length === 0) fail(ctx, `hall ${h.id} has no cells`);
    for (const [x, y] of h.cells) {
      if (owner[(y + 1) * W + x + 1] !== 0) fail(ctx, `hall ${h.id} overlaps something at (${x},${y})`);
      owner[(y + 1) * W + x + 1] = -(h.id + 1);
    }
    // a hallway may branch, but it is one connected piece of passage
    const mine = new Set(h.cells.map(([x, y]) => `${x},${y}`));
    const seenCells = new Set([`${h.cells[0][0]},${h.cells[0][1]}`]);
    const todo = [h.cells[0]];
    while (todo.length) {
      const [x, y] = todo.pop();
      for (let d = 0; d < 4; d++) {
        const key = `${x + DX[d]},${y + DY[d]}`;
        if (mine.has(key) && !seenCells.has(key)) (seenCells.add(key), todo.push([x + DX[d], y + DY[d]]));
      }
    }
    if (seenCells.size !== h.cells.length) fail(ctx, `hall ${h.id} is not one connected piece (${seenCells.size}/${h.cells.length})`);
    // hallways are 1 cell wide: no 2x2 blocks of passage
    for (const [x, y] of h.cells) {
      if (mine.has(`${x + 1},${y}`) && mine.has(`${x},${y + 1}`) && mine.has(`${x + 1},${y + 1}`)) {
        fail(ctx, `hall ${h.id} is wider than one cell at (${x},${y})`);
      }
    }
  }

  // --- connections
  const adj = dun.rooms.map(() => []);
  const linkedPairs = new Set();
  for (const c of dun.connections) {
    // every room served by the same connection can reach every other
    for (const x of c.rooms) for (const y of c.rooms) if (x !== y) adj[x].push(y);
    for (let i = 0; i < c.rooms.length; i++) {
      for (let j = i + 1; j < c.rooms.length; j++) {
        const key = [c.rooms[i], c.rooms[j]].sort((p, q) => p - q).join('-');
        if (linkedPairs.has(key)) fail(ctx, `rooms ${key} are connected more than once`);
        linkedPairs.add(key);
      }
    }
    if (new Set(c.rooms).size !== c.rooms.length) fail(ctx, `connection ${c.id} lists a room twice`);

    if (c.type !== 'door' && c.type !== 'hall') fail(ctx, `connection ${c.id} has type ${c.type}`);
    if (c.type === 'door') {
      if (c.hall !== null) fail(ctx, `door connection ${c.id} has a hallway`);
      // a doorway is through a shared wall, in every spacing
      const [a, b] = c.rooms;
      if (c.rooms.length !== 2) fail(ctx, `door connection ${c.id} should join exactly 2 rooms`);
      if (c.openings.length !== 1) fail(ctx, `door connection ${c.id} should have 1 opening`);
      for (const o of c.openings) {
        const mine = at(o.x, o.y);
        if (mine !== a + 1 && mine !== b + 1) fail(ctx, `door ${c.id}: cell not in a connected room`);
        if (o.room !== mine - 1) fail(ctx, `door ${c.id}: opening.room does not match its cell`);
        const expect = mine === a + 1 ? b + 1 : a + 1;
        if (at(o.x + DX[o.d], o.y + DY[o.d]) !== expect) fail(ctx, `door ${c.id}: does not join rooms ${a} and ${b}`);
        if (o.style !== 'door') fail(ctx, `door connection ${c.id}: style ${o.style}`);
      }
    } else {
      const hall = dun.halls[c.hall];
      if (!hall) {
        fail(ctx, `hall connection ${c.id} has no hall`);
        continue;
      }
      if (c.rooms.length < 2) fail(ctx, `hall connection ${c.id} joins fewer than 2 rooms`);
      if (JSON.stringify(hall.rooms) !== JSON.stringify(c.rooms)) fail(ctx, `hall ${hall.id}: rooms differ from its connection`);
      if (c.openings.length !== c.rooms.length) fail(ctx, `hall connection ${c.id}: ${c.openings.length} openings for ${c.rooms.length} rooms`);
      // every room served by the hallway has exactly one opening into it
      const served = new Set();
      for (const o of c.openings) {
        if (!c.rooms.includes(o.room)) fail(ctx, `hall ${c.id}: opening for room ${o.room}, which the hall does not serve`);
        if (served.has(o.room)) fail(ctx, `hall ${c.id}: room ${o.room} has two openings`);
        served.add(o.room);
        if (at(o.x, o.y) !== o.room + 1) fail(ctx, `hall ${c.id}: opening cell is not in room ${o.room}`);
        if (at(o.x + DX[o.d], o.y + DY[o.d]) !== -(hall.id + 1)) fail(ctx, `hall ${c.id}: opening for room ${o.room} does not lead into the hall`);
        if (o.style !== 'door' && o.style !== 'open') fail(ctx, `hall ${c.id}: bad opening style ${o.style}`);
      }
      // hall cells may only touch themselves and the rooms the hallway serves
      for (const [x, y] of hall.cells) {
        for (let d = 0; d < 4; d++) {
          const v = at(x + DX[d], y + DY[d]);
          if (v === 0 || v === -(hall.id + 1)) continue;
          if (v < 0 || !c.rooms.includes(v - 1)) fail(ctx, `hall ${hall.id} touches a foreign region at (${x},${y})`);
        }
      }
    }
  }

  // --- room spacing: rooms never closer than the least gap unless a door joins them (which overrides it), and rooms a hallway joins are within the greatest
  const gaps = DM.SPACING_GAPS[dun.params.spacing];
  if (!gaps) {
    fail(ctx, `spacing is ${dun.params.spacing}`);
  } else {
    const perim = dun.rooms.map((r) => r.cells.filter(([x, y]) => [0, 1, 2, 3].some((d) => at(x + DX[d], y + DY[d]) !== r.id + 1)));
    // empty squares between two rooms in a straight line (a room at a corner is 0 apart); exact up to `cap`, else cap + 1
    const gapBetween = (i, j, cap) => {
      const a = dun.rooms[i].bbox;
      const b = dun.rooms[j].bbox;
      const lower = Math.max(0, b.x - (a.x + a.w - 1), a.x - (b.x + b.w - 1), b.y - (a.y + a.h - 1), a.y - (b.y + b.h - 1));
      if (lower - 1 > cap) return cap + 1;
      let best = Infinity;
      for (const [x, y] of perim[i]) for (const [p, q] of perim[j]) best = Math.min(best, Math.max(Math.abs(x - p), Math.abs(y - q)));
      return best - 1;
    };
    for (let i = 0; i < dun.rooms.length; i++) {
      for (let j = i + 1; j < dun.rooms.length; j++) {
        const g = gapBetween(i, j, gaps.min);
        const byDoor = dun.connections.some((c) => c.type === 'door' && c.rooms.includes(i) && c.rooms.includes(j));
        if (g < gaps.min && !byDoor) fail(ctx, `rooms ${i} and ${j} are ${g} apart; ${dun.params.spacing} rooms keep ${gaps.min} unless a door joins them`);
      }
    }
    for (const c of dun.connections) {
      if (c.type !== 'hall') continue;
      for (const r of c.rooms) {
        // every room a hallway serves has another one it serves within the greatest gap
        if (!c.rooms.some((q) => q !== r && gapBetween(r, q, gaps.max) <= gaps.max)) fail(ctx, `connection ${c.id}: room ${r} is more than ${gaps.max} from every room it is joined to (${dun.params.spacing})`);
      }
    }
  }

  // reachability
  const seen = new Set([0]);
  const stack = [0];
  while (stack.length) {
    for (const n of adj[stack.pop()]) if (!seen.has(n)) (seen.add(n), stack.push(n));
  }
  if (seen.size !== dun.rooms.length) fail(ctx, `only ${seen.size}/${dun.rooms.length} rooms are reachable`);

  // --- entrances
  const outside = new Uint8Array(W * H);
  const q = [0];
  outside[0] = 1;
  while (q.length) {
    const k = q.pop();
    const x = k % W;
    const y = (k - x) / W;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (!outside[j] && owner[j] === 0) (outside[j] = 1, q.push(j));
    }
  }
  const want = dun.params.entrances;
  if (dun.entrances.length !== want && dun.warnings.length === 0) fail(ctx, `entrances ${dun.entrances.length}/${want} without a warning`);
  if (dun.entrances.length === 0) fail(ctx, 'no entrances');
  const seenEdges = new Set();
  const stairCells = new Set();
  const doorCells = new Set(); // both cells of every doorway / hallway opening
  for (const c of dun.connections) {
    for (const o of c.openings) {
      doorCells.add(`${o.x},${o.y}`);
      doorCells.add(`${o.x + DX[o.d]},${o.y + DY[o.d]}`);
    }
  }
  const labelsSeen = new Set();
  for (const e of dun.entrances) {
    if (labelsSeen.has(e.label)) fail(ctx, `entrance label ${e.label} used twice`);
    labelsSeen.add(e.label);
    if (e.kind !== 'door' && e.kind !== 'stairs') fail(ctx, `entrance ${e.label} has kind ${e.kind}`);
    if (e.d < 0 || e.d > 3) fail(ctx, `entrance ${e.label} has direction ${e.d}`);
    if (e.kind === 'stairs') {
      // a floor marker inside a room: only allowed when entrances are not limited to the outer edge
      if (dun.params.edgeEntrancesOnly) fail(ctx, `stairs entrance ${e.label} although entrances are edge-only`);
      if (at(e.x, e.y) !== e.room + 1) fail(ctx, `stairs ${e.label} is not on a floor cell of its room`);
      const key = `${e.x},${e.y}`;
      if (stairCells.has(key)) fail(ctx, `stairs ${e.label} shares a cell with another stairs entrance`);
      stairCells.add(key);
      if (dun.rooms[e.room].area >= 6 && doorCells.has(key)) fail(ctx, `stairs ${e.label} blocks a doorway`);
      continue;
    }
    if (at(e.x, e.y) !== e.room + 1) fail(ctx, `entrance ${e.label} is not on a room cell`);
    const nx = e.x + DX[e.d];
    const ny = e.y + DY[e.d];
    if (at(nx, ny) !== 0 || !outside[(ny + 1) * W + nx + 1]) fail(ctx, `entrance ${e.label} does not open to the outside`);
    // a straight line out from the door must not meet any room or hallway
    for (let x = nx, y = ny; x >= 0 && y >= 0 && x < dun.width && y < dun.height; x += DX[e.d], y += DY[e.d]) {
      if (at(x, y) !== 0) {
        fail(ctx, `entrance ${e.label} is shut in: a line out from it hits ${at(x, y) > 0 ? `room ${at(x, y)}` : `hall ${-at(x, y) - 1}`} at (${x},${y})`);
        break;
      }
    }
    const key = `${e.x},${e.y},${e.d}`;
    if (seenEdges.has(key)) fail(ctx, `entrance ${e.label} duplicated`);
    seenEdges.add(key);
  }
  if (dun.entrances[0] && dun.rooms[dun.entrances[0].room].label !== 1) fail(ctx, 'room 1 should be the first entrance room');

  // --- hallway types: nothing that is switched off was used
  const hallTypesOn = new Set(dun.params.hallTypes);
  const hallCounts = dun.stats.hallTypeCounts;
  for (const t of DM.HALL_TYPES) {
    if (typeof hallCounts[t] !== 'number') fail(ctx, `stats.hallTypeCounts has no count for ${t}`);
    else if (!hallTypesOn.has(t) && hallCounts[t] > 0) fail(ctx, `${t} hallways are switched off but ${hallCounts[t]} were built`);
  }
  // --- hallway doors: 'none' means every hallway opening is an open archway, 'all' that every one has a door
  const hallOpenings = dun.connections.filter((c) => c.type === 'hall').flatMap((c) => c.openings);
  if (dun.params.hallDoors === 'none' && hallOpenings.some((o) => o.style !== 'open')) fail(ctx, 'hallway doors are off but a hallway opening has a door');
  if (dun.params.hallDoors === 'all' && hallOpenings.some((o) => o.style !== 'door')) fail(ctx, 'hallway doors are on for all but a hallway opening is open');
  const multiRoom = dun.connections.filter((c) => c.type === 'hall' && c.rooms.length > 2).length;
  // every hallway says how it started, and that is one of the ways that are on
  for (const h of dun.halls) {
    if (!DM.HALL_KINDS.includes(h.kind)) fail(ctx, `hallway ${h.id} has kind ${h.kind}`);
    else if (!hallTypesOn.has(h.kind)) fail(ctx, `hallway ${h.id} is a ${h.kind} hallway but that type is switched off`);
    // a spine always has rooms lined up along it: it joins at least 3 rooms, whatever else is on
    if (h.kind === 'spine' && h.rooms.length < 3) fail(ctx, `spine hallway ${h.id} serves only ${h.rooms.length} rooms`);
    // a spine takes rooms along its sides whatever else is on; without Branching nothing else does
    if (!hallTypesOn.has('branching') && h.kind !== 'spine' && h.rooms.length > 2) fail(ctx, `branching is off but a ${h.kind} hallway serves ${h.rooms.length} rooms`);
  }
  if (hallTypesOn.has('branching') && multiRoom > 0 && hallCounts.branching === 0) fail(ctx, 'a hallway serves 3+ rooms but no branching was counted');
}


function randomParams(rng) {
  return {
    roomCount: rng.int(1, 99),
    avgRoomSize: rng.pick([1, 2, 3, 5, 9, 16, 25, 40, 64, 100, 200, 400, 999, rng.int(1, 999)]),
    minRoomWidth: rng.pick([undefined, 1, 1, 2, 3, 5, 8, 12, rng.int(1, 30)]),
    minRoomLength: rng.pick([undefined, 1, 1, 2, 3, 5, 8, 12, rng.int(1, 30)]),
    sizeVariance: rng.pick([0, 10, 30, 50, 75, 100, rng.int(0, 100)]),
    entrances: rng.pick([1, 2, 3, 5, 10, rng.int(1, 10)]),
    connectionType: rng.pick(['door', 'hall']),
    connectionRandomness: rng.pick([0, 14, 14, 50, 100, rng.int(0, 100)]),
    edgeEntrancesOnly: rng.pick([true, false]),
    // all shapes (omitted) half of the time, otherwise a random non-empty subset
    roomShapes: rng.chance(0.5) ? undefined : randomSubset(rng, DM.SHAPE_KINDS),
    hallTypes: randomHallTypes(rng),
    hallDoors: rng.pick([undefined, 'none', 'less', 'more', 'all']),
    spacing: rng.pick([undefined, ...DM.SPACINGS]),
  };
}

function randomSubset(rng, items) {
  const picked = items.filter(() => rng.chance(0.4));
  return picked.length > 0 ? picked : [rng.pick(items)];
}

/** All hallway types (omitted) half of the time, otherwise a random subset that can still start a hallway. */
function randomHallTypes(rng) {
  if (rng.chance(0.5)) return undefined;
  const picked = randomSubset(rng, DM.HALL_TYPES);
  if (!picked.some((k) => DM.HALL_KINDS.includes(k))) picked.push(rng.pick(DM.HALL_KINDS));
  return picked;
}

// ---------------------------------------------------------------------------

console.log('== parameter validation');
{
  const bad = [
    { roomCount: 0 }, { roomCount: 100 }, { roomCount: 1.5 }, { roomCount: '' },
    { avgRoomSize: 0 }, { avgRoomSize: 1000 }, { entrances: 0 }, { entrances: 11 }, { sizeVariance: 101 }, { sizeVariance: -1 },
    { connectionType: 'cave' },
    { connectionRandomness: -1 }, { connectionRandomness: 101 }, { connectionRandomness: 14.5 }, { connectionRandomness: '' }, { connectionRandomness: 'abc' },
    { edgeEntrancesOnly: 'yes' }, { edgeEntrancesOnly: 1 }, { edgeEntrancesOnly: 'false' },
    { roomShapes: [] }, { roomShapes: ['hexagon'] }, { roomShapes: ['L', 'bogus'] }, { roomShapes: 'L' }, { roomShapes: [1] }, { roomShapes: {} },
    { minRoomWidth: 0 }, { minRoomWidth: 31 }, { minRoomWidth: -2 }, { minRoomWidth: 2.5 }, { minRoomWidth: '' }, { minRoomWidth: 'big' },
    { minRoomLength: 0 }, { minRoomLength: 31 }, { minRoomLength: -2 }, { minRoomLength: 2.5 }, { minRoomLength: '' }, { minRoomLength: 'long' },
    { spacing: 'roomy' }, { spacing: '' }, { spacing: 1 }, { spacing: ['normal'] }, { spacing: 'Normal' }, { spacing: true },
  ];
  const good = { roomCount: 10, avgRoomSize: 25, sizeVariance: 30, entrances: 2, connectionType: 'door', connectionRandomness: 14, edgeEntrancesOnly: true };
  for (const patch of bad) {
    const v = DM.validateParams({ ...good, ...patch });
    if (v.ok) fail('validate', `accepted ${JSON.stringify(patch)}`);
  }
  if (!DM.validateParams(good).ok) fail('validate', 'rejected valid params');
  for (const edge of [{ roomCount: 1 }, { roomCount: 99 }, { avgRoomSize: 1 }, { avgRoomSize: 999 }, { entrances: 1 }, { entrances: 10 }, { sizeVariance: 0 }, { sizeVariance: 100 }, { connectionRandomness: 0 }, { connectionRandomness: 100 }, { connectionRandomness: '37' }]) {
    if (!DM.validateParams({ ...good, ...edge }).ok) fail('validate', `rejected boundary ${JSON.stringify(edge)}`);
  }
  if (!DM.validateParams({ ...good, edgeEntrancesOnly: false }).ok) fail('validate', 'rejected edgeEntrancesOnly=false');
  const { edgeEntrancesOnly: _omitEdge, ...withoutEdge } = good;
  const edgeDefault = DM.validateParams(withoutEdge);
  if (!edgeDefault.ok || edgeDefault.params.edgeEntrancesOnly !== true) fail('validate', 'edgeEntrancesOnly should default to true');
  // omitted -> default of 14 (about 1 in 7)
  const { connectionRandomness: _omit, ...withoutRandomness } = good;
  const defaulted = DM.validateParams(withoutRandomness);
  if (!defaulted.ok || defaulted.params.connectionRandomness !== 14) fail('validate', 'connectionRandomness should default to 14');
  if (DM.generateDungeon({ ...withoutRandomness, seed: 'd' }).params.connectionRandomness !== 14) fail('validate', 'dungeon params should record the default randomness');

  // room spacing: omitted -> compact; the three spacings are accepted, and recorded in the dungeon's params
  if (DM.validateParams(good).params.spacing !== 'compact' || DM.DEFAULT_SPACING !== 'compact') fail('validate', 'room spacing should default to compact');
  if (JSON.stringify(DM.SPACINGS) !== JSON.stringify(['compact', 'normal', 'spaced'])) fail('validate', `the spacings are ${DM.SPACINGS}`);
  for (const [name, min, max] of [['compact', 0, 4], ['normal', 1, 6], ['spaced', 2, 12]]) {
    const v = DM.validateParams({ ...good, spacing: name });
    if (!v.ok || v.params.spacing !== name) fail('validate', `rejected spacing ${name}`);
    if (DM.SPACING_GAPS[name].min !== min || DM.SPACING_GAPS[name].max !== max) fail('validate', `${name} rooms should be ${min} to ${max} apart, not ${JSON.stringify(DM.SPACING_GAPS[name])}`);
    if (DM.generateDungeon({ ...good, spacing: name, seed: 'sp' }).params.spacing !== name) fail('validate', `the dungeon does not record spacing ${name}`);
  }

  // minimum room width and length: omitted -> 1 (no minimum); 1 to 30 accepted, numeric strings too, each on its own
  const noMin = DM.validateParams(good);
  if (!noMin.ok || noMin.params.minRoomWidth !== 1 || noMin.params.minRoomLength !== 1) fail('validate', 'the minimum room width and length should default to 1');
  for (const min of [1, 2, 30, '7']) {
    for (const key of ['minRoomWidth', 'minRoomLength']) {
      const v = DM.validateParams({ ...good, [key]: min });
      if (!v.ok || v.params[key] !== Number(min)) fail('validate', `rejected ${key}=${min}`);
    }
  }
  const both = DM.validateParams({ ...good, minRoomWidth: 3, minRoomLength: 8 });
  if (!both.ok || both.params.minRoomWidth !== 3 || both.params.minRoomLength !== 8) fail('validate', 'width and length are not kept apart');
  if (DM.validateParams({ ...good, minRoomSize: 5 }).params.minRoomSize !== undefined) fail('validate', 'the old single minRoomSize should not be carried through');

  // room shapes: omitted -> all; any non-empty list of known shapes is fine; stored in a fixed order, no repeats
  const allShapes = DM.SHAPE_KINDS;
  const shapesDefault = DM.validateParams(good);
  if (!shapesDefault.ok || JSON.stringify(shapesDefault.params.roomShapes) !== JSON.stringify(allShapes)) fail('validate', 'roomShapes should default to every shape');
  for (const kind of allShapes) {
    const one = DM.validateParams({ ...good, roomShapes: [kind] });
    if (!one.ok || JSON.stringify(one.params.roomShapes) !== JSON.stringify([kind])) fail('validate', `rejected roomShapes=[${kind}]`);
  }
  const tidy = DM.validateParams({ ...good, roomShapes: ['U', 'L', 'U'] });
  if (!tidy.ok || JSON.stringify(tidy.params.roomShapes) !== JSON.stringify(allShapes.filter((k) => k === 'L' || k === 'U'))) fail('validate', 'roomShapes should be de-duplicated and kept in the standard order');
  for (const name of ['rect', 'chamfer', 'L', 'T', 'U', 'H', 'Z', 'plus']) {
    if (!allShapes.includes(name)) fail('validate', `shape "${name}" is missing from DM.SHAPE_KINDS`);
  }

  // hallway types: omitted -> all; unknown names are refused; stored in a fixed order, no repeats
  const allHalls = DM.HALL_TYPES;
  for (const name of ['short', 'spine', 'curly', 'branching']) {
    if (!allHalls.includes(name)) fail('validate', `hallway type "${name}" is missing from DM.HALL_TYPES`);
  }
  // hallways never loop, so there is no loop type to switch on (and asking for one is an error)
  if (allHalls.length !== 4 || allHalls.includes('loop')) fail('validate', `DM.HALL_TYPES is ${JSON.stringify(allHalls)}`);
  if (DM.validateParams({ ...good, connectionType: 'hall', hallTypes: ['short', 'loop'] }).ok) fail('validate', 'accepted the removed hallway type "loop"');
  const hallsDefault = DM.validateParams({ ...good, connectionType: 'hall' });
  if (!hallsDefault.ok || JSON.stringify(hallsDefault.params.hallTypes) !== JSON.stringify(allHalls)) fail('validate', 'hallTypes should default to every type');
  for (const bad of [['bogus'], ['short', 'long'], 'short', [1], {}]) {
    if (DM.validateParams({ ...good, hallTypes: bad }).ok) fail('validate', `accepted hallTypes=${JSON.stringify(bad)}`);
  }
  const hallTidy = DM.validateParams({ ...good, connectionType: 'hall', hallTypes: ['branching', 'short', 'branching'] });
  if (!hallTidy.ok || JSON.stringify(hallTidy.params.hallTypes) !== JSON.stringify(['short', 'branching'])) fail('validate', 'hallTypes should be de-duplicated and kept in the standard order');
  // a hallway has to start as a short, spine or curly one: branching alone is not enough ...
  for (const hallTypes of [[], ['branching']]) {
    for (const patch of [{ connectionType: 'hall', connectionRandomness: 0 }, { connectionType: 'hall', connectionRandomness: 99 }, { connectionType: 'door', connectionRandomness: 1 }, { connectionType: 'door', connectionRandomness: 100 }]) {
      const v = DM.validateParams({ ...good, ...patch, hallTypes });
      if (v.ok || !v.errors.hallTypes) fail('validate', `accepted hallTypes=${JSON.stringify(hallTypes)} with ${JSON.stringify(patch)}`);
    }
    // ... but only where hallways can occur at all
    for (const patch of [{ connectionType: 'door', connectionRandomness: 0 }, { connectionType: 'hall', connectionRandomness: 100 }]) {
      const v = DM.validateParams({ ...good, ...patch, hallTypes });
      if (!v.ok) fail('validate', `refused hallTypes=${JSON.stringify(hallTypes)} although there are no hallways with ${JSON.stringify(patch)}`);
    }
  }
  for (const kind of DM.HALL_KINDS) {
    const v = DM.validateParams({ ...good, connectionType: 'hall', hallTypes: [kind] });
    if (!v.ok || JSON.stringify(v.params.hallTypes) !== JSON.stringify([kind])) fail('validate', `rejected hallTypes=[${kind}]`);
  }

  // hallway doors: omitted -> 'less'; none / less / more / all are accepted; anything else is refused
  if (JSON.stringify(DM.HALL_DOORS) !== JSON.stringify(['none', 'less', 'more', 'all'])) fail('validate', `DM.HALL_DOORS is ${JSON.stringify(DM.HALL_DOORS)}`);
  const doorsDefault = DM.validateParams(good);
  if (!doorsDefault.ok || doorsDefault.params.hallDoors !== 'less') fail('validate', 'hallDoors should default to "less"');
  for (const choice of DM.HALL_DOORS) {
    const v = DM.validateParams({ ...good, hallDoors: choice });
    if (!v.ok || v.params.hallDoors !== choice) fail('validate', `rejected hallDoors=${choice}`);
  }
  for (const bad of ['some', '', 'ALL', 'none ', 1, true, ['all'], {}]) {
    const v = DM.validateParams({ ...good, hallDoors: bad });
    if (v.ok || !v.errors.hallDoors) fail('validate', `accepted hallDoors=${JSON.stringify(bad)}`);
  }
  console.log('  done');
}

console.log('== room shape toggles');
{
  // the page offers exactly the shapes the generator knows
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const inPage = [...html.matchAll(/name="roomShape"\s+value="([^"]+)"/g)].map((m) => m[1]).sort();
  if (JSON.stringify(inPage) !== JSON.stringify(DM.SHAPE_KINDS.slice().sort())) fail('shapes', `index.html offers [${inPage}] but the generator has [${DM.SHAPE_KINDS}]`);

  const base = { roomCount: 30, avgRoomSize: 40, sizeVariance: 0, entrances: 2, connectionType: 'door' };

  // one shape on: every room is that shape (rooms are big enough for all of them)
  for (const kind of DM.SHAPE_KINDS) {
    let n = 0;
    let area = 0;
    for (let s = 0; s < 6; s++) {
      const dun = DM.generateDungeon({ ...base, roomShapes: [kind], seed: `only${kind}${s}` });
      checkDungeon(dun, `only ${kind} #${s}`);
      for (const r of dun.rooms) {
        n++;
        area += r.area;
        if (r.kind !== kind) fail('shapes', `only ${kind} is on but a room is a ${r.kind}`);
      }
      if (dun.warnings.some((w) => /plain rectangle/.test(w))) fail('shapes', `only ${kind}: unexpected fallback warning`);
    }
    const mean = area / n;
    console.log(`  only ${kind.padEnd(7)} -> ${n} rooms, mean area ${mean.toFixed(1)} (target 40)`);
    if (Math.abs(mean - 40) > 6) fail('shapes', `only ${kind}: mean room area ${mean.toFixed(1)} is far from 40`);
  }

  // everything except rectangles: no rectangles at all
  const noRect = DM.SHAPE_KINDS.filter((k) => k !== 'rect');
  const seen = {};
  for (let s = 0; s < 6; s++) {
    const dun = DM.generateDungeon({ ...base, roomShapes: noRect, seed: `norect${s}` });
    for (const r of dun.rooms) seen[r.kind] = (seen[r.kind] || 0) + 1;
  }
  if (seen.rect) fail('shapes', `rectangles are off but ${seen.rect} rooms are rectangles`);
  for (const kind of noRect) if (!seen[kind]) fail('shapes', `${kind} is on but never appeared in 180 rooms`);
  console.log('  all but rect ->', JSON.stringify(seen));

  // too small for any shape that is on: plain rectangles, with a warning
  const tiny = DM.generateDungeon({ ...base, avgRoomSize: 3, roomShapes: ['plus', 'chamfer'], seed: 'tiny' });
  checkDungeon(tiny, 'tiny rooms, plus/chamfer only');
  if (tiny.rooms.some((r) => r.kind !== 'rect')) fail('shapes', 'rooms of ~3 squares cannot be a plus or chamfer');
  if (!tiny.warnings.some((w) => /plain rectangle/.test(w))) fail('shapes', 'no warning when rooms fall back to rectangles');
  const roomy = DM.generateDungeon({ ...base, roomShapes: ['plus', 'chamfer'], seed: 'roomy' });
  if (roomy.warnings.some((w) => /plain rectangle/.test(w))) fail('shapes', 'fallback warning although every room fits a shape');

  // shapes are recorded in the model, and the order they were switched on in makes no difference
  const a = JSON.stringify(DM.generateDungeon({ ...base, roomShapes: ['U', 'H'], seed: 'order' }));
  const b = JSON.stringify(DM.generateDungeon({ ...base, roomShapes: ['H', 'U'], seed: 'order' }));
  if (a !== b) fail('shapes', 'the order the shapes are listed in changed the dungeon');
  console.log('  done');
}

console.log('== hallway types');
{
  // the page offers exactly the hallway types the generator knows
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const inPage = [...html.matchAll(/name="hallType"\s+value="([^"]+)"/g)].map((m) => m[1]).sort();
  if (JSON.stringify(inPage) !== JSON.stringify(DM.HALL_TYPES.slice().sort())) fail('hall types', `index.html offers [${inPage}] but the generator has [${DM.HALL_TYPES}]`);

  const base = { roomCount: 20, avgRoomSize: 30, sizeVariance: 30, entrances: 2, connectionType: 'hall', connectionRandomness: 0 };
  // (Spaced Out lets hallways run as long as they are meant to: the tighter spacings cut them short, see room spacing below)
  const roomy = { ...base, spacing: 'spaced' };
  const N = 25;
  // bends along a hallway that is a single path (its cells are stored in order)
  const bends = (cells) => {
    let n = 0;
    for (let i = 2; i < cells.length; i++) {
      if (cells[i][0] - cells[i - 1][0] !== cells[i - 1][0] - cells[i - 2][0] || cells[i][1] - cells[i - 1][1] !== cells[i - 1][1] - cells[i - 2][1]) n++;
    }
    return n;
  };

  // each way of starting a hallway on its own: only that kind is built, and it looks like it
  const look = {};
  let spineRooms = 0; // rooms served, over all spines when only spines are on
  let spineMulti = 0; // spines serving 3+ rooms
  let spineDoorRooms = 0; // rooms in spine-only dungeons that had to be reached by a doorway
  for (const kind of DM.HALL_KINDS) {
    let halls = 0;
    let cells = 0;
    let bendSum = 0;
    let fewest = Infinity;
    for (let s = 0; s < N; s++) {
      const dun = DM.generateDungeon({ ...roomy, hallTypes: [kind], seed: `only-${kind}-${s}` });
      checkDungeon(dun, `only ${kind} #${s}`);
      const counts = dun.stats.hallTypeCounts;
      for (const t of DM.HALL_TYPES) if (t !== kind && counts[t] !== 0) fail('hall types', `only ${kind} is on but ${counts[t]} ${t} hallways were built`);
      if (counts[kind] !== dun.halls.length) fail('hall types', `only ${kind} is on: ${counts[kind]} counted for ${dun.halls.length} hallways`);
      // short and curly hallways join two rooms each; a spine is the one that serves several
      if (kind !== 'spine' && dun.stats.maxRoomsPerHall > 2) fail('hall types', `only ${kind} is on but a hallway serves ${dun.stats.maxRoomsPerHall} rooms`);
      // every room is reached by a hallway (a spine needs room to spare, so now and then the very last room can only be reached by a doorway)
      const short = dun.rooms.length - 1 - dun.stats.hallLinks;
      if (kind === 'spine' && short > 0) spineDoorRooms += short;
      else if (short !== 0) fail('hall types', `only ${kind} is on: ${dun.stats.hallLinks} hallway links for ${dun.rooms.length} rooms`);
      if (kind === 'spine' && short > 1) fail('hall types', `only spine is on: ${short} rooms are reached by a doorway instead of a hallway`);
      for (const h of dun.halls) {
        if (h.kind !== kind) fail('hall types', `only ${kind} is on but hallway ${h.id} is a ${h.kind} hallway`);
        if (kind === 'spine') {
          spineRooms += h.rooms.length;
          if (h.rooms.length >= 3) spineMulti++;
        }
        const b = bends(h.cells);
        halls++;
        cells += h.cells.length;
        bendSum += b;
        fewest = Math.min(fewest, b);
      }
    }
    look[kind] = { halls, length: cells / halls, bends: bendSum / halls, fewest };
    console.log(`  only ${kind.padEnd(5)} -> ${halls} hallways, ${look[kind].length.toFixed(1)} squares long, ${look[kind].bends.toFixed(2)} bends each (fewest ${fewest})`);
  }
  // a true spine has rooms lined up along it, even with Branching off: every one serves 3 or more rooms
  console.log(`  only spine -> ${(spineRooms / look.spine.halls).toFixed(2)} rooms per spine, ${((100 * spineMulti) / look.spine.halls).toFixed(0)}% serve 3+ rooms, ${spineDoorRooms} of ${N} dungeons had a room reached by a doorway`);
  if (spineMulti !== look.spine.halls) fail('hall types', `only ${spineMulti} of ${look.spine.halls} spines serve 3+ rooms`);
  // (at most one a dungeon, checked above: the very last room, which cannot start a spine and often has no room left beside one,
  // is reached by a doorway instead)
  if (spineDoorRooms > N) fail('hall types', `${spineDoorRooms} rooms in ${N} spine-only dungeons were reached by a doorway`);
  if (spineRooms < 3 * look.spine.halls) fail('hall types', `spines serve ${(spineRooms / look.spine.halls).toFixed(2)} rooms each on average`);
  if (look.curly.fewest < 4) fail('hall types', `a curly hallway has only ${look.curly.fewest} bends`);
  if (look.curly.bends < look.spine.bends + 3) fail('hall types', 'curly hallways are not noticeably more winding than spines');
  if (look.spine.length < 1.5 * look.short.length) fail('hall types', 'spines are not clearly longer than short hallways');

  // a spine never serves fewer than 3 rooms, however the dungeon is set up (checkDungeon also checks this on every dungeon here)
  {
    let spines = 0;
    let dungeons = 0;
    const sets = [['spine'], ['spine', 'short'], ['spine', 'curly'], ['spine', 'branching'], ['short', 'spine', 'curly', 'branching']];
    for (const hallTypes of sets) {
      for (const roomCount of [2, 3, 4, 5, 8, 20, 60]) {
        for (let s = 0; s < 6; s++) {
          const dun = DM.generateDungeon({ ...base, roomCount, hallTypes, connectionRandomness: s % 3 === 0 ? 30 : 0, seed: `three-${hallTypes}-${roomCount}-${s}` });
          dungeons++;
          if (dun.rooms.length !== roomCount) fail('spine', `${roomCount} rooms asked for, ${dun.rooms.length} built with ${hallTypes}: ${dun.warnings.join(' ')}`);
          for (const h of dun.halls) {
            if (h.kind !== 'spine') continue;
            spines++;
            if (h.rooms.length < 3) fail('spine', `${hallTypes}, ${roomCount} rooms: spine ${h.id} serves ${h.rooms.length} rooms`);
            // the rooms really are lined up along it: each one touches the spine
            const own = new Set(h.cells.map(([x, y]) => `${x},${y}`));
            const conn = dun.connections.find((c) => c.hall === h.id);
            for (const o of conn.openings) if (!own.has(`${o.x + DM.DIRS.DX[o.d]},${o.y + DM.DIRS.DY[o.d]}`)) fail('spine', `spine ${h.id}: an opening at ${o.x},${o.y} does not lead onto the spine`);
          }
        }
      }
    }
    console.log(`  ${spines} spines in ${dungeons} dungeons, every one serving 3+ rooms`);
    if (spines < dungeons) fail('spine', `only ${spines} spines in ${dungeons} dungeons: spines are hardly ever built`);
  }

  // a hallway never wraps round the dungeon to reach a room that is close: a routed (not curly) hallway joining two rooms
  // is at most 1.5 times the direct gap plus 4 cells
  {
    if (DM.hallPathLimit(10, 60) !== 19 || DM.hallPathLimit(1, 60) !== 6 || DM.hallPathLimit(100, 60) !== 60 || DM.hallPathLimit(17, 20) !== 20) fail('detour', 'hallPathLimit gives the wrong limits');
    let checked = 0;
    let worst = 0;
    const rngD = new DM.Rng('detour');
    for (let i = 0; i < 120; i++) {
      const p = { ...base, roomCount: rngD.int(4, 40), avgRoomSize: rngD.pick([9, 16, 30, 60, 150]), connectionRandomness: rngD.pick([0, 14]), seed: i === 0 ? '637555669' : `detour${i}` };
      if (i === 0) Object.assign(p, { roomCount: 12, avgRoomSize: 30, entrances: 1, hallDoors: 'all', connectionRandomness: 14 }); // the dungeon where room 8 sat at the end of a 56-square hallway
      const dun = DM.generateDungeon(p);
      for (const h of dun.halls) {
        if (h.kind === 'curly' || h.rooms.length > 2) continue; // (a hallway that has grown rooms or branches is longer than the one gap)
        const a = h.cells[0];
        const b = h.cells[h.cells.length - 1];
        const direct = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + 1;
        checked++;
        worst = Math.max(worst, h.cells.length / direct);
        if (h.cells.length > Math.ceil(direct * 1.5) + 4) fail('detour', `${h.kind} hallway of ${h.cells.length} cells for a gap of ${direct} (${JSON.stringify(p)})`);
      }
      const spine = dun.halls.filter((h) => h.kind === 'spine');
      if (i === 0 && spine.some((h) => h.cells.length > 40)) fail('detour', `the dungeon with the very long hallway still has one of ${Math.max(...spine.map((h) => h.cells.length))} cells`);
    }
    console.log(`  ${checked} hallways held to the detour limit (worst ${worst.toFixed(2)}x the direct gap)`);
    if (checked < 100) fail('detour', `only ${checked} hallways were checked`);
  }

  // branching: without it only spines take more than two rooms (so with no spine every hallway joins exactly two);
  // with it, short and curly hallways serve 3+ rooms too
  let multi = 0;
  let multiAll = 0;
  let shortMulti = 0;
  for (let s = 0; s < N; s++) {
    const others = DM.HALL_TYPES.filter((t) => t !== 'branching');
    const off = DM.generateDungeon({ ...base, hallTypes: others, seed: `nobranch${s}` });
    checkDungeon(off, `branching off #${s}`);
    const flat = DM.generateDungeon({ ...base, hallTypes: ['short', 'curly'], seed: `nospine${s}` });
    checkDungeon(flat, `no spine, branching off #${s}`);
    if (flat.stats.maxRoomsPerHall > 2 || flat.stats.multiRoomHalls > 0) fail('hall types', 'neither spine nor branching is on but a hallway serves 3+ rooms');
    const on = DM.generateDungeon({ ...base, seed: `branch${s}` });
    checkDungeon(on, `all types #${s}`);
    multi += on.stats.multiRoomHalls;
    multiAll += on.halls.length;
    const viaBranching = DM.generateDungeon({ ...base, hallTypes: ['short', 'curly', 'branching'], seed: `shortbranch${s}` });
    checkDungeon(viaBranching, `short, curly and branching #${s}`);
    shortMulti += viaBranching.stats.multiRoomHalls;
  }
  console.log(`  branching on: ${(multi / N).toFixed(1)} of ${(multiAll / N).toFixed(1)} hallways serve 3+ rooms`);
  if (multi === 0) fail('hall types', 'branching is on but no hallway ever served 3+ rooms');
  if (shortMulti === 0) fail('hall types', 'branching is on but short and curly hallways never served 3+ rooms');

  // hallways never loop: whatever types are on, the hallways alone join the rooms as a tree
  // (one route between any two rooms), and the model never reports a loop type
  for (let s = 0; s < N; s++) {
    for (const hallTypes of [undefined, ['short', 'spine', 'curly', 'branching'], ['curly']]) {
      const dun = DM.generateDungeon({ ...base, hallTypes, seed: `noloop${s}` });
      checkDungeon(dun, `no loops #${s}`);
      if (dun.stats.hallLinks !== dun.rooms.length - 1) fail('hall types', `${dun.stats.hallLinks} hallway links for ${dun.rooms.length} rooms: hallways made a loop`);
      if ('loop' in dun.stats.hallTypeCounts) fail('hall types', 'the model still counts a loop type');
    }
  }
  // a dungeon of doorways and hallways (never hallway-only) can still have extra doorways between rooms that share a wall
  let extraDoors = 0;
  for (let s = 0; s < N; s++) {
    const dun = DM.generateDungeon({ ...base, connectionType: 'door', connectionRandomness: 30, seed: `doorloop${s}` });
    checkDungeon(dun, `doors #${s}`);
    if (dun.stats.hallLinks + dun.stats.doorConnections > dun.rooms.length - 1) extraDoors++;
  }
  console.log(`  ${extraDoors} of ${N} doorway dungeons have an extra doorway that closes a circuit`);
  if (extraDoors === 0) fail('hall types', 'extra doorways between neighbouring rooms never appear');

  // doorways only, with every hallway type off: no hallway anywhere
  for (let s = 0; s < 6; s++) {
    const dun = DM.generateDungeon({ ...base, connectionType: 'door', connectionRandomness: 0, hallTypes: [], seed: `nohalls${s}` });
    checkDungeon(dun, `no hallways #${s}`);
    if (dun.halls.length > 0) fail('hall types', 'doorways only with every hallway type off still built hallways');
  }

  // each type is reported in the model, and the order they are listed in makes no difference
  const x = JSON.stringify(DM.generateDungeon({ ...base, hallTypes: ['branching', 'curly', 'short'], seed: 'order' }));
  const y = JSON.stringify(DM.generateDungeon({ ...base, hallTypes: ['short', 'curly', 'branching'], seed: 'order' }));
  if (x !== y) fail('hall types', 'the order the hallway types are listed in changed the dungeon');
  const model = DM.generateDungeon({ ...base, hallTypes: ['spine'], seed: 'model' });
  if (JSON.stringify(model.params.hallTypes) !== JSON.stringify(['spine'])) fail('hall types', 'the dungeon does not record which hallway types were on');

  // hard cases: every single type still fits all the rooms, in crowded and in tiny dungeons
  const hard = [
    { roomCount: 60, avgRoomSize: 30 }, { roomCount: 60, avgRoomSize: 2 }, { roomCount: 30, avgRoomSize: 200 }, { roomCount: 25, avgRoomSize: 5, minRoomWidth: 4, minRoomLength: 9 },
  ];
  for (const kind of DM.HALL_KINDS) {
    for (const [i, h] of hard.entries()) {
      for (const seed of ['h1', 'h2']) {
        const dun = DM.generateDungeon({ ...base, ...h, sizeVariance: 30, hallTypes: [kind], seed });
        checkDungeon(dun, `only ${kind}, hard case ${i} ${seed}`);
      }
    }
  }
  console.log('  done');
}

console.log('== hallway doors');
{
  // the page offers exactly the choices the generator knows, in the same order
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const inPage = [...html.matchAll(/name="hallDoors"\s+value="([^"]+)"/g)].map((m) => m[1]);
  if (JSON.stringify(inPage) !== JSON.stringify(DM.HALL_DOORS)) fail('hall doors', `index.html offers [${inPage}] but the generator has [${DM.HALL_DOORS}]`);

  const base = { roomCount: 20, avgRoomSize: 30, sizeVariance: 30, entrances: 2, connectionType: 'hall', connectionRandomness: 0 };
  const expected = { none: [0, 0], less: [0.28, 0.42], more: [0.62, 0.78], all: [1, 1] }; // acceptable share of openings with a door
  for (const choice of DM.HALL_DOORS) {
    let openings = 0;
    let doors = 0;
    for (let s = 0; s < 25; s++) {
      const dun = DM.generateDungeon({ ...base, hallDoors: choice, seed: `doors-${choice}-${s}` });
      checkDungeon(dun, `hallway doors ${choice} #${s}`);
      for (const c of dun.connections) {
        if (c.type !== 'hall') continue;
        for (const o of c.openings) {
          openings++;
          if (o.style === 'door') doors++;
        }
      }
    }
    const share = doors / openings;
    console.log(`  doors ${choice.padEnd(4)} -> ${doors}/${openings} hallway openings have a door (${(share * 100).toFixed(0)}%)`);
    if (share < expected[choice][0] || share > expected[choice][1]) fail('hall doors', `"${choice}": ${(share * 100).toFixed(0)}% of hallway openings have a door`);
  }

  // doorway connections always have their door, whatever the hallway setting
  for (const choice of DM.HALL_DOORS) {
    const dun = DM.generateDungeon({ ...base, connectionType: 'door', connectionRandomness: 30, hallDoors: choice, seed: `doorway-${choice}` });
    checkDungeon(dun, `doorways with hallway doors ${choice}`);
    for (const c of dun.connections) if (c.type === 'door' && c.openings.some((o) => o.style !== 'door')) fail('hall doors', `a doorway connection has no door with hallDoors=${choice}`);
  }

  // doors only change how the openings look: with the same seed the rooms and hallways are the same
  // whatever the setting, so switching it just adds or removes doors on the same map
  for (const seed of ['same-layout-1', 'same-layout-2', 'same-layout-3']) {
    const layouts = DM.HALL_DOORS.map((choice) => {
      const d = DM.generateDungeon({ ...base, hallDoors: choice, seed });
      return JSON.stringify({ rooms: d.rooms.map((r) => r.cells), halls: d.halls.map((h) => h.cells), entrances: d.entrances });
    });
    if (new Set(layouts).size !== 1) fail('hall doors', `seed ${seed}: the layout changed with the hallway doors setting`);
  }
  console.log('  done');
}

console.log('== room labels');
{
  // the page offers exactly the label positions the code knows, and loads labels.js before the renderer that uses it
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const inPage = [...html.matchAll(/name="labelPosition"\s+value="([^"]+)"/g)].map((m) => m[1]);
  if (JSON.stringify(inPage) !== JSON.stringify(DM.LABEL_POSITIONS)) fail('labels', `index.html offers [${inPage}] but the code has [${DM.LABEL_POSITIONS}]`);
  if (!(html.indexOf('src/labels.js') > 0 && html.indexOf('src/labels.js') < html.indexOf('src/render.js'))) fail('labels', 'labels.js must be loaded before render.js');

  // a stand-in for measuring text in the browser: about 0.6 of the height per character
  const measure = (text, size) => text.length * 0.6 * size;
  const gap = (box, cell) => Math.hypot(Math.max(0, cell[0] - box.x1, box.x0 - (cell[0] + 1)), Math.max(0, cell[1] - box.y1, box.y0 - (cell[1] + 1)));

  const cases = [
    { roomCount: 12, avgRoomSize: 30, connectionType: 'hall' },
    { roomCount: 40, avgRoomSize: 30, connectionType: 'hall' },
    { roomCount: 15, avgRoomSize: 3, connectionType: 'hall' },
    { roomCount: 12, avgRoomSize: 30, connectionType: 'door' },
    { roomCount: 40, avgRoomSize: 30, connectionType: 'door' },
    { roomCount: 99, avgRoomSize: 100, connectionType: 'door' },
    { roomCount: 60, avgRoomSize: 400, connectionType: 'hall' },
    { roomCount: 1, avgRoomSize: 1, connectionType: 'door' },
    { roomCount: 30, avgRoomSize: 20, minRoomWidth: 3, minRoomLength: 9, connectionType: 'hall' },
  ];
  let rooms = 0;
  let none = 0;
  let away = 0; // placed with a line back to the wall
  let overlapping = 0;
  for (const [ci, p] of cases.entries()) {
    for (let s = 0; s < 12; s++) {
      const dun = DM.generateDungeon({ sizeVariance: 30, entrances: 3, connectionRandomness: 14, ...p, seed: `lab${ci}-${s}` });
      const out = DM.placeOutsideLabels(dun, measure);
      if (JSON.stringify(out) !== JSON.stringify(DM.placeOutsideLabels(dun, measure))) fail('labels', 'the same dungeon gave different label places');
      if (out.length !== dun.rooms.length) fail('labels', `${out.length} places for ${dun.rooms.length} rooms`);
      const floor = new Set(dun.rooms.flatMap((r) => r.cells.map(([x, y]) => `${x},${y}`)));
      const boxes = [];
      dun.rooms.forEach((room, i) => {
        rooms++;
        const o = out[i];
        if (!o) {
          none++;
          return;
        }
        const box = { x0: o.x - o.w / 2, x1: o.x + o.w / 2, y0: o.y - o.h / 2, y1: o.y + o.h / 2 };
        // never on top of any room
        for (let cy = Math.floor(box.y0); cy < Math.ceil(box.y1); cy++) {
          for (let cx = Math.floor(box.x0); cx < Math.ceil(box.x1); cx++) {
            if (floor.has(`${cx},${cy}`)) fail('labels', `room ${room.label}: the number overlaps a room at (${cx},${cy}) (${JSON.stringify(p)} #${s})`);
          }
        }
        // beside its own room: within reach of one of its walls, and not touching it
        const near = Math.min(...room.cells.map((c) => gap(box, c)));
        if (near > 2.65 || near < 0.09) fail('labels', `room ${room.label}: the number is ${near.toFixed(2)} cells from its room`);
        // and clear of every other room too
        for (const other of dun.rooms) {
          if (other === room) continue;
          for (const c of other.cells) {
            if (gap(box, c) < 0.09) fail('labels', `room ${room.label}: the number touches room ${other.label}`);
          }
        }
        // the size follows the room, within the limits
        if (Math.abs(o.h - DM.labelSize(room)) > 1e-9 || o.h < 0.6 || o.h > 1.4) fail('labels', `room ${room.label}: label height ${o.h}`);
        // the line back to the wall is there exactly when the number is set off from it
        const lineLength = Math.hypot(o.lx - o.ax, o.ly - o.ay);
        if (o.leader !== lineLength > 0.45) fail('labels', `room ${room.label}: line back to the wall is ${o.leader ? 'on' : 'off'} at ${lineLength.toFixed(2)} cells`);
        if (o.leader) away++;
        for (const q of boxes) if (box.x0 < q.x1 && q.x0 < box.x1 && box.y0 < q.y1 && q.y0 < box.y1) overlapping++;
        boxes.push(box);
      });
    }
  }
  const share = (n) => `${((100 * n) / rooms).toFixed(1)}%`;
  console.log(`  ${rooms} rooms: ${share(none)} with no free place (number stays inside), ${share(away)} set off from the wall, ${overlapping} pairs of numbers overlap`);
  if (none > 0.06 * rooms) fail('labels', `${share(none)} of rooms found no place outside`);
  if (away > 0.15 * rooms) fail('labels', `${share(away)} of numbers are set off from their wall`);
  if (overlapping > 0.006 * rooms) fail('labels', `${overlapping} pairs of numbers overlap`);
  console.log('  done');
}

console.log('== colors');
{
  const fs = require('fs');
  const path = require('path');
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  const cats = DM.COLOR_CATEGORIES;
  const rgbaOf = (c) => (c.startsWith('#') ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).concat(1) : c.match(/[\d.]+/g).map(Number));
  const same = (a, b) => JSON.stringify(rgbaOf(a)) === JSON.stringify(rgbaOf(b));
  const isColor = (c) => typeof c === 'string' && (DM.isHexColor(c) || /^rgba\(\d+, \d+, \d+, [\d.]+\)$/.test(c));
  const base = DM.themeFrom(DM.defaultColors());

  // the colors the map was drawn in before there were pickers are the defaults, except hallways, which now start as Clay (Straw, the old one, is still the last ready-made choice)
  const original = {
    background: '#e6dbc0', gridFaint: 'rgba(120, 98, 62, 0.10)', gridFloor: 'rgba(120, 98, 62, 0.38)', roomFloor: '#fbf7ec', hallFloor: '#e2c9a8',
    wall: '#2a2018', doorFill: '#d9a45a', doorStroke: '#4a3018', entranceFill: '#e4573d', entranceStroke: '#4a1a10', arrow: '#c0392b',
    stairsTint: 'rgba(192, 57, 43, 0.10)', label: '#2a2018', labelHalo: 'rgba(251, 247, 236, 0.85)',
  };
  for (const [key, want] of Object.entries(original)) if (!base[key] || !same(base[key], want)) fail('colors', `default ${key} is ${base[key]}, the map has always used ${want}`);
  for (const key of Object.keys(base)) if (!(key in original)) fail('colors', `theme has ${key}, which the renderer did not have before`);

  // the categories the page asks for, each with 3 or 4 ready-made colors and the original first
  const ids = cats.map((c) => c.id);
  for (const want of ['background', 'rooms', 'hallways', 'lines', 'doors', 'entrances']) if (!ids.includes(want)) fail('colors', `no ${want} category`);
  if (new Set(ids).size !== ids.length) fail('colors', 'two categories share an id');
  for (const cat of cats) {
    if (!cat.title) fail('colors', `${cat.id} has no title`);
    if (cat.presets.length < 3 || cat.presets.length > 4) fail('colors', `${cat.id} has ${cat.presets.length} ready-made colors, not 3 or 4`);
    const hexes = cat.presets.map((p) => p.hex);
    if (new Set(hexes).size !== hexes.length) fail('colors', `${cat.id} repeats a color`);
    if (new Set(cat.presets.map((p) => p.name)).size !== cat.presets.length || cat.presets.some((p) => !p.name)) fail('colors', `${cat.id} has missing or repeated color names`);
    for (const p of cat.presets) if (!DM.isHexColor(p.hex) || p.hex !== p.hex.toLowerCase()) fail('colors', `${cat.id}/${p.name}: ${p.hex} is not a lower-case #rrggbb`);
    if (DM.defaultColors()[cat.id] !== cat.presets[0].hex) fail('colors', `${cat.id}: the default is not the first ready-made color`);
  }

  // each theme entry belongs to one category (so the order of the categories never matters),
  // every entry is a real color, and a category changes only its own entries
  const owner = {};
  for (const cat of cats) {
    for (const p of cat.presets) {
      const own = new Set([...Object.keys(cat.derive(p.hex)), ...Object.keys(p.extra || {})]);
      for (const key of own) {
        if (owner[key] && owner[key] !== cat.id) fail('colors', `${key} is set by both ${owner[key]} and ${cat.id}`);
        owner[key] = cat.id;
      }
      const theme = DM.themeFrom({ ...DM.defaultColors(), [cat.id]: p.hex });
      for (const [key, value] of Object.entries(theme)) {
        if (!isColor(value)) fail('colors', `${cat.id}/${p.name}: ${key} is "${value}"`);
        if (owner[key] !== cat.id && !same(value, base[key])) fail('colors', `${cat.id}/${p.name} changed ${key}, which belongs to ${owner[key]}`);
      }
      if (p.hex !== cat.presets[0].hex && [...own].every((key) => same(theme[key], base[key]))) fail('colors', `${cat.id}/${p.name} looks just like the default`);
    }
  }
  for (const key of Object.keys(base)) if (!owner[key]) fail('colors', `no category sets ${key}`);

  // anything the picker returns works; nonsense falls back to the default
  const custom = DM.themeFrom({ ...DM.defaultColors(), doors: '#336699', entrances: '#AA00CC', rooms: '#102030' });
  if (custom.doorFill !== '#336699') fail('colors', `a picked door color gave ${custom.doorFill}`);
  const dark = (c) => rgbaOf(c).slice(0, 3).reduce((a, b) => a + b, 0);
  if (!(dark(custom.doorStroke) < dark(custom.doorFill))) fail('colors', 'a door outline should be darker than its fill');
  if (custom.arrow !== '#aa00cc' || !same(custom.stairsTint, 'rgba(170, 0, 204, 0.1)')) fail('colors', `a picked entrance color gave ${custom.arrow} / ${custom.stairsTint}`);
  if (!(dark(custom.entranceStroke) < dark(custom.entranceFill))) fail('colors', 'an entrance outline should be darker than its fill');
  if (!same(custom.labelHalo, 'rgba(16, 32, 48, 0.85)') || custom.roomFloor !== '#102030') fail('colors', 'the room number halo should follow the room color');
  for (const bad of [undefined, null, {}, { background: 'red' }, { background: '#fff' }, { background: 12 }, { background: '#gggggg' }]) {
    if (JSON.stringify(DM.themeFrom(bad)) !== JSON.stringify(base)) fail('colors', `${JSON.stringify(bad)} should fall back to the defaults`);
  }
  for (const [value, ok] of [['#a1B2c3', true], ['#abc', false], ['abcdef', false], ['#abcdeg', false], ['', false], [null, false], [255, false]]) {
    if (DM.isHexColor(value) !== ok) fail('colors', `isHexColor(${JSON.stringify(value)}) should be ${ok}`);
  }

  // the legend and the page behind the map follow the colors through CSS variables
  const vars = DM.themeCssVars(base);
  const css = read('styles.css');
  for (const [name, value] of Object.entries(vars)) {
    if (!DM.isHexColor(value)) fail('colors', `${name} is ${value}`);
    if (name !== '--map-bg' && !css.includes(`var(${name},`)) fail('colors', `styles.css never uses ${name}`);
  }

  // the page: palette.js before the renderer; the renderer draws only in theme colors
  const html = read('index.html');
  const at = (s) => html.indexOf(`src/${s}.js`);
  if (!(at('palette') > 0 && at('palette') < at('render'))) fail('colors', 'palette.js must be loaded before render.js');
  const render = read('src', 'render.js');
  const literal = render.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || [];
  if (literal.filter((c) => c.toLowerCase() !== '#fff').length > 0 || literal.length > 1) fail('colors', `render.js draws in colors that are not from the theme: ${literal}`);
  const app = read('src', 'app.js');
  if (!app.includes('DM.COLOR_CATEGORIES') || !app.includes('renderer.setTheme')) fail('colors', 'app.js does not build the pickers from the categories');
  console.log(`  ${cats.length} categories, ${cats.reduce((n, c) => n + c.presets.length, 0)} ready-made colors`);
  console.log('  done');
}

console.log('== share and export');
{
  const fs = require('fs');
  const path = require('path');
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  const usual = { labelPosition: 'inside', showGrid: true, showLabels: true, colors: DM.defaultColors() };
  // a look that differs from the usual in every way a link can carry
  const odd = { labelPosition: 'outside', showGrid: false, showLabels: false, colors: Object.fromEntries(DM.COLOR_CATEGORIES.map((c) => [c.id, c.presets[1].hex])) };

  // a link brings back the very same dungeon: from the inputs the dungeon was really built with (a blank seed box included)
  const samples = [
    { roomCount: 12, avgRoomSize: 30, sizeVariance: 30, entrances: 2, connectionType: 'hall', seed: 'abc' },
    { roomCount: 12, avgRoomSize: 30, sizeVariance: 30, entrances: 2, connectionType: 'hall', spacing: 'normal', seed: '' }, // random seed
    { roomCount: 40, avgRoomSize: 9, minRoomWidth: 2, minRoomLength: 3, sizeVariance: 80, entrances: 5, connectionType: 'door', connectionRandomness: 37, roomShapes: ['rect', 'L'], hallTypes: ['spine'], hallDoors: 'all', spacing: 'spaced', edgeEntrancesOnly: false, seed: 'a b/c#d&e=f%g é 日本' },
    { roomCount: 1, avgRoomSize: 1, sizeVariance: 0, entrances: 10, connectionType: 'door', edgeEntrancesOnly: false, seed: '0' },
    { roomCount: 99, avgRoomSize: 999, sizeVariance: 100, entrances: 10, connectionType: 'door', connectionRandomness: 0, hallTypes: [], seed: 'big' },
  ];
  let longest = 0;
  for (const [i, p] of samples.entries()) {
    const dun = DM.generateDungeon(p);
    for (const look of [usual, odd]) {
      const text = DM.encodeShare({ params: dun.params, display: look });
      longest = Math.max(longest, text.length);
      for (const withHash of [text, `#${text}`]) {
        const link = DM.decodeShare(withHash);
        if (!link.hasSettings) fail('share', `sample ${i}: the link was not recognised`);
        const again = DM.generateDungeon(link.form);
        if (JSON.stringify(again) !== JSON.stringify(dun)) fail('share', `sample ${i}: the link did not bring back the same dungeon`);
        const want = { ...dun.params };
        if (JSON.stringify(Object.entries(link.form).sort()) !== JSON.stringify(Object.entries(want).sort())) fail('share', `sample ${i}: the link gave back other inputs: ${JSON.stringify(link.form)}`);
        const gotLook = { labelPosition: link.display.labelPosition || 'inside', showGrid: link.display.showGrid !== false, showLabels: link.display.showLabels !== false, colors: { ...DM.defaultColors(), ...link.display.colors } };
        if (JSON.stringify(gotLook) !== JSON.stringify(look)) fail('share', `sample ${i}: the look did not survive: ${JSON.stringify(gotLook)}`);
      }
    }
  }
  if (longest > 700) fail('share', `a link can be ${longest} characters long: too long to paste around`);

  // a link holds only what differs from the usual look
  const plain = DM.encodeShare({ params: DM.generateDungeon(samples[0]).params, display: usual });
  if (/label=|grid=|nums=|color\./.test(plain)) fail('share', `the usual look should add nothing to a link: ${plain}`);
  const fancy = DM.encodeShare({ params: DM.generateDungeon(samples[0]).params, display: odd });
  for (const want of ['label=outside', 'grid=0', 'nums=0', ...DM.COLOR_CATEGORIES.map((c) => `color.${c.id}=${odd.colors[c.id].slice(1)}`)]) if (!fancy.includes(want)) fail('share', `the link lacks ${want}`);
  if (DM.encodeShare({ params: samples[0], display: { colors: { rooms: 'red', nonsense: '#ffffff', doors: '#FFAA00' } } }).match(/color\.[a-z]+=[^&]*/g).join() !== 'color.doors=ffaa00') fail('share', 'only real colors of real categories belong in a link');

  // the format is a promise to everyone holding an old link: this one must keep opening
  const pinned = DM.decodeShare('#v=1&rooms=7&size=25&minw=2&minl=3&var=10&ent=3&rand=50&conn=door&edge=0&shapes=rect,L&halls=spine,curly&doors=more&seed=castle&label=outside&grid=0&nums=0&color.rooms=aabbcc');
  const pinnedWant = { roomCount: 7, avgRoomSize: 25, minRoomWidth: 2, minRoomLength: 3, sizeVariance: 10, entrances: 3, connectionRandomness: 50, connectionType: 'door', edgeEntrancesOnly: false, roomShapes: ['rect', 'L'], hallTypes: ['spine', 'curly'], hallDoors: 'more', seed: 'castle' };
  for (const [k, v] of Object.entries(pinnedWant)) if (JSON.stringify(pinned.form[k]) !== JSON.stringify(v)) fail('share', `an old link now gives ${k} = ${JSON.stringify(pinned.form[k])}, not ${JSON.stringify(v)}`);
  if (Object.keys(pinned.form).length !== Object.keys(pinnedWant).length) fail('share', 'an old link gives extra inputs');
  if (JSON.stringify(pinned.display) !== JSON.stringify({ colors: { rooms: '#aabbcc' }, labelPosition: 'outside', showGrid: false, showLabels: false })) fail('share', `an old link gives the look ${JSON.stringify(pinned.display)}`);
  // a link from before room spacing leaves it out (the page keeps its usual choice); one that names it brings it back
  if ('spacing' in pinned.form) fail('share', 'a link from before room spacing should not set it');
  for (const name of DM.SPACINGS) {
    const withSpacing = DM.decodeShare(`#v=1&rooms=7&spacing=${name}&seed=castle`);
    if (withSpacing.form.spacing !== name || Object.keys(withSpacing.form).length !== 3) fail('share', `a link with spacing=${name} gave ${JSON.stringify(withSpacing.form)}`);
    if (!DM.encodeShare({ params: { ...DM.generateDungeon({ ...samples[0], spacing: name }).params } }).includes(`&spacing=${name}&seed=`)) fail('share', `a link for ${name} spacing should say so, just before the seed`);
  }

  // nonsense is dropped, key by key, and never throws
  const dropped = [
    'rooms=abc', 'rooms=0', 'rooms=100', 'rooms=-1', 'rooms=12.5', 'rooms=1e1', 'rooms=', 'rooms=%20', 'rooms=0x10', 'rooms=99999', 'rooms=+5',
    'size=0', 'size=1000', 'minw=31', 'minl=0', 'var=101', 'ent=0', 'ent=11', 'rand=101',
    'conn=teleport', 'conn=', 'doors=sometimes', 'spacing=roomy', 'spacing=', 'spacing=Normal', 'spacing=normal,spaced', 'spacing=0', 'halls=loop', 'halls=short,loop', 'shapes=hexagon', 'shapes=rect,hexagon', 'shapes=', 'shapes=,,',
    'edge=2', 'edge=true', 'seed=', 'seed=%20%20', `seed=${'x'.repeat(101)}`,
    'label=sideways', 'label=', 'grid=2', 'grid=off', 'nums=yes', 'color.rooms=red', 'color.rooms=fff', 'color.rooms=%23ffffff', 'color.rooms=gggggg', 'color.rooms=ffffffff', 'color.nonsense=ffffff', 'color.=ffffff',
    'v=1', 'v=99', 'x=1', '__proto__=1', 'constructor=1', 'rooms[]=5', '<script>alert(1)</script>', '%E0%A4%A', '&&&', '===', '', '#', '?', 'rooms=5%', '%00', 'seed',
  ];
  for (const text of dropped) {
    let link;
    try {
      link = DM.decodeShare(text);
    } catch (err) {
      fail('share', `"${text}" made decodeShare throw: ${err.message}`);
      continue;
    }
    // (a lone version number or an unknown key says nothing about the dungeon)
    if (link.hasSettings || Object.keys(link.form).length > 0 || Object.keys(link.display).some((k) => k !== 'colors') || Object.keys(link.display.colors).length > 0) fail('share', `"${text}" should give nothing, it gave ${JSON.stringify(link)}`);
  }
  for (const junk of [undefined, null, 0, 7, {}, [], true, () => 1, { toString() { throw new Error('boom'); } }]) {
    try {
      if (DM.decodeShare(junk).hasSettings) fail('share', `a ${typeof junk} should not make a link`);
    } catch (err) {
      fail('share', `decodeShare(${typeof junk}) threw: ${err.message}`);
    }
  }
  // a good key survives a bad one next to it, and the dungeon it describes can be built
  const mixed = DM.decodeShare('rooms=7&size=abc&seed=xyz&halls=zigzag&conn=door&label=up&grid=0');
  if (JSON.stringify(mixed.form) !== JSON.stringify({ roomCount: 7, connectionType: 'door', seed: 'xyz' })) fail('share', `a half-good link gave ${JSON.stringify(mixed.form)}`);
  if (JSON.stringify(mixed.display) !== JSON.stringify({ colors: {}, showGrid: false })) fail('share', `a half-good link gave the look ${JSON.stringify(mixed.display)}`);
  const built = DM.validateParams({ roomCount: 12, avgRoomSize: 30, sizeVariance: 30, entrances: 2, connectionType: 'hall', seed: '', ...mixed.form });
  if (!built.ok) fail('share', `the good parts of a half-good link do not build: ${JSON.stringify(built.errors)}`);
  // a link cannot reach past the keys it is allowed to set
  const sneaky = DM.decodeShare('rooms=7&__proto__=x&constructor=y&toString=z&seed=ok');
  if (({}).x !== undefined || Object.keys(sneaky.form).sort().join() !== 'roomCount,seed') fail('share', `an odd link set ${Object.keys(sneaky.form)}`);

  // file names are safe to save, whatever the seed
  const named = (seed, ext = 'png') => DM.exportFileName({ seed }, ext);
  const names = [
    ['482910337', 'dungeon-482910337.png'], ['my castle', 'dungeon-my-castle.png'], ['../../etc/passwd', 'dungeon-etc-passwd.png'], ['a:b*c?d"e<f>g|h\\i/j', 'dungeon-a-b-c-d-e-f-g-h-i-j.png'],
    ['', 'dungeon-map.png'], ['///', 'dungeon-map.png'], ['日本語', 'dungeon-map.png'], ['x'.repeat(200), `dungeon-${'x'.repeat(40)}.png`], ['Ünï', 'dungeon-n.png'],
  ];
  for (const [seed, want] of names) if (named(seed) !== want) fail('share', `file name for seed "${seed}" is ${named(seed)}, not ${want}`);
  if (DM.exportFileName({}, 'json') !== 'dungeon-map.json' || DM.exportFileName(null, 'json') !== 'dungeon-map.json') fail('share', 'a missing dungeon should still give a file name');

  // the data file is the dungeon, whole, one part to a line
  for (const p of samples.slice(0, 3)) {
    const dun = DM.generateDungeon(p);
    const text = DM.dungeonJson(dun);
    if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(dun)) fail('share', 'the JSON file does not hold the whole dungeon');
    if (text.split('\n').length !== Object.keys(dun).length + 3) fail('share', `the JSON file has ${text.split('\n').length} lines for ${Object.keys(dun).length} parts`);
    if (!text.endsWith('}\n')) fail('share', 'the JSON file should end with a closing brace and a newline');
  }

  // the line under a picture
  const one = DM.generateDungeon({ roomCount: 1, avgRoomSize: 9, sizeVariance: 0, entrances: 1, connectionType: 'door', seed: 'solo' });
  const many = DM.generateDungeon(samples[0]);
  const capOne = DM.exportCaption(one);
  const capMany = DM.exportCaption(many);
  if (!capOne.startsWith('Seed solo · 1 room · ') || capOne.includes('1 rooms')) fail('share', `caption "${capOne}"`);
  if (!capMany.startsWith('Seed abc · 12 rooms · ') || !capMany.endsWith(`${many.width}×${many.height} squares (${many.width * 5}×${many.height * 5} ft)`)) fail('share', `caption "${capMany}"`);

  // the page: buttons in the generate column, the script loaded in order, a print layout, and nothing sent anywhere
  const html = read('index.html');
  const css = read('styles.css');
  const appJs = read('src', 'app.js');
  const at = (s) => html.indexOf(`src/${s}.js`);
  if (!(at('palette') > 0 && at('palette') < at('share') && at('share') < at('app'))) fail('share', 'share.js must be loaded after palette.js and before app.js');
  const blade = (name) => html.slice(html.indexOf(`data-blade="${name}"`), html.indexOf('<main class="stage">'));
  const generateColumn = html.slice(html.indexOf('data-blade="generate"'), html.indexOf('data-blade="display"'));
  for (const id of ['copyLink', 'downloadPng', 'downloadJson', 'printMap', 'exportLegend', 'exportStatus', 'shareUrl']) {
    if (!generateColumn.includes(`id="${id}"`)) fail('share', `#${id} should be in the generate column`);
  }
  if (!/id="exportLegend"[^>]*\schecked/.test(generateColumn)) fail('share', 'the legend should be on the picture unless it is switched off');
  if (!/<input[^>]*id="shareUrl"[^>]*readonly/.test(generateColumn)) fail('share', 'the link box should be read-only');
  if (!/id="exportStatus"[^>]*aria-live="polite"/.test(generateColumn)) fail('share', 'the export status should be announced to screen readers');
  for (const id of ['copyLink', 'downloadPng', 'downloadJson', 'printMap']) {
    if (!new RegExp(`<button[^>]*type="button"[^>]*id="${id}"`).test(generateColumn)) fail('share', `#${id} should be a type="button" (the page is one form: a submit button would generate a new dungeon)`);
  }
  if (html.indexOf('id="printImage"') < html.indexOf('<main class="stage">')) fail('share', 'the print picture should be inside the map area');
  if (blade('display').includes('id="copyLink"')) fail('share', 'the share buttons are in the display column');
  const printCss = css.slice(css.indexOf('@media print'));
  if (!printCss.startsWith('@media print')) fail('share', 'styles.css has no print layout');
  for (const hidden of ['.panel', '.toolbar', '.legend', '#map']) if (!printCss.includes(hidden)) fail('share', `the print layout does not hide ${hidden}`);
  if (!/#printImage\[src\]\s*\{[^}]*display:\s*block/.test(printCss) || !/#printImage\s*\{\s*display:\s*none/.test(css.slice(0, css.indexOf('@media print')))) fail('share', 'the print picture should show only when printing');
  if (/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|new Image\(|\.src\s*=\s*['"`]http/.test(appJs + read('src', 'share.js'))) fail('share', 'a dungeon should never be sent anywhere: the page must not make requests');
  if (!appJs.includes('hashchange') || !appJs.includes('fromLink')) fail('share', 'app.js does not open links');
  console.log(`  ${samples.length} dungeons through the link both ways, ${dropped.length} bad links, longest link ${longest} characters`);
  console.log('  done');
}

console.log('== remembered settings');
{
  const fs = require('fs');
  const path = require('path');
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

  // what is kept is the form as typed, in the text of a share link, and never the seed
  const typed = {
    roomCount: '25', avgRoomSize: '14', minRoomWidth: '2', minRoomLength: '3', sizeVariance: '10', entrances: '4', connectionRandomness: '40',
    connectionType: 'door', edgeEntrancesOnly: false, roomShapes: ['rect', 'T'], hallTypes: ['spine', 'curly'], hallDoors: 'all', spacing: 'spaced',
  };
  const look = { labelPosition: 'outside', showGrid: false, showLabels: true, colors: { ...DM.defaultColors(), rooms: DM.COLOR_CATEGORIES[1].presets[2].hex } };
  const back = DM.decodeShare(DM.encodeShare({ params: typed, display: look }));
  const want = { ...typed, roomCount: 25, avgRoomSize: 14, minRoomWidth: 2, minRoomLength: 3, sizeVariance: 10, entrances: 4, connectionRandomness: 40 };
  if (JSON.stringify(Object.entries(back.form).sort()) !== JSON.stringify(Object.entries(want).sort())) fail('settings', `kept inputs came back as ${JSON.stringify(back.form)}`);
  if ('seed' in back.form) fail('settings', 'a kept form should not hold a seed');
  if (back.display.labelPosition !== 'outside' || back.display.showGrid !== false || back.display.colors.rooms !== look.colors.rooms) fail('settings', 'the kept look did not come back');

  // a half-typed form (blank or nonsense fields, no shape on) keeps what is valid and leaves the rest at the usual value
  const messy = { ...typed, roomCount: '', avgRoomSize: 'abc', minRoomWidth: ' 2', sizeVariance: '999', entrances: '4', roomShapes: [], hallTypes: [], connectionType: 'door' };
  let half;
  try {
    half = DM.decodeShare(DM.encodeShare({ params: messy, display: look }));
  } catch (err) {
    fail('settings', `a half-typed form made the kept settings unreadable: ${err.message}`);
  }
  if (half) {
    for (const k of ['roomCount', 'avgRoomSize', 'minRoomWidth', 'sizeVariance', 'roomShapes']) if (k in half.form) fail('settings', `a bad ${k} was kept: ${JSON.stringify(half.form[k])}`);
    if (half.form.entrances !== 4 || half.form.minRoomLength !== 3 || half.form.hallDoors !== 'all') fail('settings', `the good fields of a half-typed form were lost: ${JSON.stringify(half.form)}`);
  }
  // what a damaged store holds never throws and keeps nothing
  for (const junk of [null, '', 'garbage', '{"a":1}', '%%%', 'v=1', 'rooms=abc']) {
    if (DM.decodeShare(junk).hasSettings) fail('settings', `"${junk}" in storage should keep nothing`);
  }

  // the page: what is kept, when, and what wins
  const app = read('src', 'app.js');
  const html = read('index.html');
  if (!app.includes("const SETTINGS_KEY = 'dungeonMaker.settings'") || app.includes("'dungeonMaker.collapsedColumns'") === false || SETTINGS_KEY_CLASH(app)) fail('settings', 'the kept settings need their own storage key, apart from the collapsed columns');
  if (!/function settingsText\(\) \{[^}]*delete params\.seed;/.test(app)) fail('settings', 'the seed must not be kept');
  if (!/function restoreSettings\(\) \{[\s\S]*?delete kept\.form\.seed;/.test(app)) fail('settings', 'a kept seed must never be restored');
  if (!/\$\('params'\)\.addEventListener\('input', saveSettings\);/.test(app) || !/\$\('params'\)\.addEventListener\('change', saveSettings\);/.test(app)) fail('settings', 'changes in the form are not all kept');
  for (const id of ['shapesAll', 'hallTypesAll', 'resetColors']) {
    const at = app.indexOf(`$('${id}').addEventListener('click'`);
    if (at < 0 || !app.slice(at, app.indexOf('\n  });', at)).includes('saveSettings();')) fail('settings', `#${id} changes the form without events, so it must keep the settings itself`);
  }
  const linkFn = app.slice(app.indexOf('function openLink()'), app.indexOf('\n  }\n', app.indexOf('function openLink()')));
  if (!linkFn.includes('generate({ fromLink: true })') || linkFn.includes('saveSettings')) fail('settings', 'opening a link must not overwrite the kept settings');
  const resetAt = app.indexOf("$('resetSettings').addEventListener");
  const resetBody = app.slice(resetAt, app.indexOf('\n  });', resetAt));
  for (const need of ['applyForm(', 'applyDisplay(', 'localStorage.removeItem(SETTINGS_KEY)', 'generate()']) if (!resetBody.includes(need)) fail('settings', `Reset all does not do ${need}`);
  if (!/id="resetSettings"/.test(html.slice(html.indexOf('data-blade="generate"'), html.indexOf('data-blade="display"')))) fail('settings', 'Reset all belongs in the generate column');
  console.log('  done');
}

function SETTINGS_KEY_CLASH(app) {
  const key = (app.match(/const SETTINGS_KEY = '([^']+)'/) || [])[1];
  const other = (app.match(/const BLADES_KEY = '([^']+)'/) || [])[1];
  return !key || key === other;
}

console.log('== minimum room size');
{
  const base = { roomCount: 20, entrances: 2, connectionType: 'hall', connectionRandomness: 14 };
  console.log('  avg  min W x L  var% -> base  mean area  sd   narrowest W x L  (20 rooms x 25 dungeons)');
  // [average, min width, min length, variance %]
  const cases = [
    [30, 1, 1, 30], [5, 5, 5, 0], [5, 5, 5, 30], [5, 5, 5, 100], [25, 5, 5, 30], [30, 5, 5, 30], [30, 5, 5, 60], [100, 8, 8, 50],
    [3, 3, 3, 30], [1, 10, 10, 30], [400, 20, 20, 30], [999, 30, 30, 30], [1, 30, 30, 0],
    // width and length apart
    [5, 3, 8, 30], [5, 8, 3, 30], [40, 4, 12, 30], [40, 12, 4, 30], [100, 2, 20, 40], [10, 1, 15, 30], [10, 15, 1, 30],
  ];
  for (const [avg, minW, minL, variance] of cases) {
    const areas = [];
    let narrowW = Infinity;
    let narrowL = Infinity;
    let model = null;
    for (let s = 0; s < 25; s++) {
      const dun = DM.generateDungeon({ ...base, avgRoomSize: avg, minRoomWidth: minW, minRoomLength: minL, sizeVariance: variance, connectionType: s % 2 ? 'hall' : 'door', seed: `mn${avg}-${minW}x${minL}-${variance}-${s}` });
      if (s < 4) checkDungeon(dun, `min ${minW}x${minL} avg ${avg} #${s}`);
      model = dun;
      for (const r of dun.rooms) {
        areas.push(r.area);
        narrowW = Math.min(narrowW, r.bbox.w);
        narrowL = Math.min(narrowL, r.bbox.h);
      }
    }
    const mean = areas.reduce((a, b) => a + b, 0) / areas.length;
    const sd = Math.sqrt(areas.reduce((a, b) => a + (b - mean) ** 2, 0) / areas.length);
    const expectBase = Math.max(avg, minW * minL);
    console.log(`  ${String(avg).padStart(3)} ${String(minW).padStart(4)} x ${String(minL).padEnd(3)} ${String(variance).padStart(4)} -> ${String(expectBase).padStart(4)} ${mean.toFixed(1).padStart(10)} ${sd.toFixed(1).padStart(5)} ${String(narrowW).padStart(7)} x ${narrowL}`);
    if (narrowW < minW) fail('min size', `avg ${avg}, min ${minW}x${minL}: a room is only ${narrowW} wide`);
    if (narrowL < minL) fail('min size', `avg ${avg}, min ${minW}x${minL}: a room is only ${narrowL} long`);
    if (model.stats.baseRoomArea !== expectBase) fail('min size', `avg ${avg}, min ${minW}x${minL}: base area ${model.stats.baseRoomArea}, expected ${expectBase}`);
    // Above the minimum the average is held; at the minimum rooms can only be bigger, so it sits a little above.
    // (Lopsided minimums leave little choice of room dimensions: a room 1 wide can only be a strip, and
    // any other shape needs a wider box than the area calls for. So allow more slack the more lopsided.)
    const raised = avg <= minW * minL;
    const slack = 1 + Math.abs(Math.log(minW / minL)) * 0.15;
    const lo = expectBase * 0.92 / slack;
    const hi = expectBase * (raised ? 1.2 + variance / 250 : 1.08) * slack;
    if (mean < lo || mean > hi) fail('min size', `avg ${avg}, min ${minW}x${minL}, var ${variance}%: mean room area ${mean.toFixed(1)} is outside ${lo.toFixed(1)}-${hi.toFixed(1)}`);
  }

  // Width and length are separate and rooms are never turned to fit: 2 wide x 9 long is not 9 wide x 2 long.
  for (const [minW, minL] of [[2, 9], [9, 2], [1, 12], [12, 1], [4, 7]]) {
    let tall = 0;
    let wide = 0;
    for (let s = 0; s < 12; s++) {
      const dun = DM.generateDungeon({ ...base, avgRoomSize: 40, minRoomWidth: minW, minRoomLength: minL, sizeVariance: 30, seed: `ax${minW}x${minL}-${s}` });
      for (const r of dun.rooms) {
        if (r.bbox.w < minW || r.bbox.h < minL) fail('min size', `min ${minW} wide x ${minL} long: a room is ${r.bbox.w} wide x ${r.bbox.h} long`);
        if (r.bbox.h > r.bbox.w) tall++;
        else if (r.bbox.w > r.bbox.h) wide++;
      }
    }
    console.log(`  min ${minW} wide x ${minL} long: ${tall} rooms taller than wide, ${wide} wider than tall`);
    if (minL >= 2 * minW && wide > tall) fail('min size', `min ${minW} x ${minL} should favour tall rooms but ${wide} are wide and ${tall} tall`);
    if (minW >= 2 * minL && tall > wide) fail('min size', `min ${minW} x ${minL} should favour wide rooms but ${tall} are tall and ${wide} wide`);
  }

  // minimum 1 x 1 changes nothing; the minimum can only raise the size rooms are built around
  const p = { ...base, avgRoomSize: 20, sizeVariance: 30, seed: 'same' };
  if (JSON.stringify(DM.generateDungeon(p)) !== JSON.stringify(DM.generateDungeon({ ...p, minRoomWidth: 1, minRoomLength: 1 }))) fail('min size', 'a 1 x 1 minimum is not the same as leaving it out');
  const lowAvg = JSON.stringify(DM.generateDungeon({ ...p, avgRoomSize: 5, minRoomWidth: 5, minRoomLength: 5, seed: 'b' }).rooms);
  const atMin = JSON.stringify(DM.generateDungeon({ ...p, avgRoomSize: 25, minRoomWidth: 5, minRoomLength: 5, seed: 'b' }).rooms);
  if (lowAvg !== atMin) fail('min size', 'an average below the minimum should build the same dungeon as an average equal to it');
  const lowAvgWide = JSON.stringify(DM.generateDungeon({ ...p, avgRoomSize: 5, minRoomWidth: 3, minRoomLength: 8, seed: 'c' }).rooms);
  const atMinWide = JSON.stringify(DM.generateDungeon({ ...p, avgRoomSize: 24, minRoomWidth: 3, minRoomLength: 8, seed: 'c' }).rooms);
  if (lowAvgWide !== atMinWide) fail('min size', 'an average below width x length should build the same dungeon as an average equal to it');

  // hallways follow the size rooms are built around, not the (smaller) average
  const hallsPerRoom = (avg, minW, minL) => {
    let sum = 0;
    for (let s = 0; s < 12; s++) {
      const dun = DM.generateDungeon({ ...base, connectionRandomness: 0, avgRoomSize: avg, minRoomWidth: minW, minRoomLength: minL, sizeVariance: 30, seed: `hm${avg}-${minW}x${minL}-${s}` });
      sum += dun.stats.floorCells - dun.rooms.reduce((n, r) => n + r.area, 0);
    }
    return sum / 12 / 20;
  };
  const small = hallsPerRoom(1, 1, 1);
  const bigMin = hallsPerRoom(1, 10, 14);
  console.log(`  hallway squares per room: 1-square rooms -> ${small.toFixed(1)}, rooms of at least 10 x 14 -> ${bigMin.toFixed(1)}`);
  if (bigMin < 2 * small) fail('min size', 'hallways did not lengthen with the minimum room size');
}

console.log('== room spacing');
{
  // Every dungeon here goes through checkDungeon, which holds each spacing to its rules: no two rooms closer than the least
  // gap (a room at a corner counts as touching) unless a door joins them, and every room a hallway serves within the
  // greatest gap of another it serves.
  const base = { roomCount: 16, avgRoomSize: 30, sizeVariance: 30, entrances: 2, connectionRandomness: 14 };
  const roomGap = (a, b) => {
    let best = Infinity;
    for (const [x, y] of a.cells) for (const [p, q] of b.cells) best = Math.min(best, Math.max(Math.abs(x - p), Math.abs(y - q)));
    return best - 1;
  };
  const N = 30;
  const seen = {};
  for (const spacing of DM.SPACINGS) {
    const { min, max } = DM.SPACING_GAPS[spacing];
    for (const connectionType of ['door', 'hall']) {
      const row = { dungeons: 0, touching: 0, doors: 0, strays: 0, tightest: Infinity, widest: 0 };
      for (const avgRoomSize of [3, 12, 30, 90]) {
        for (let s = 0; s < N / 2; s++) {
          const dun = DM.generateDungeon({ ...base, avgRoomSize, spacing, connectionType, seed: `spacing-${spacing}-${connectionType}-${avgRoomSize}-${s}` });
          checkDungeon(dun, `${spacing} ${connectionType} avg ${avgRoomSize} #${s}`);
          row.dungeons++;
          if (dun.warnings.length > 0) fail('spacing', `${spacing} ${connectionType} avg ${avgRoomSize} #${s}: ${dun.warnings.join(' ')}`);
          row.doors += dun.connections.filter((c) => c.type === 'door').length;
          if (dun.halls.some((h) => h.kind !== 'short' && h.kind !== 'spine' && h.kind !== 'curly')) fail('spacing', 'a hallway has a kind of its own that is not one of the types');
          for (let i = 0; i < dun.rooms.length; i++) {
            for (let j = i + 1; j < dun.rooms.length; j++) {
              const g = roomGap(dun.rooms[i], dun.rooms[j]);
              const byDoor = dun.connections.some((c) => c.type === 'door' && c.rooms.includes(i) && c.rooms.includes(j));
              if (g === 0) row.touching++;
              // rooms closer than the spacing allows are there because a door joins them
              if (g < min) byDoor ? row.strays++ : fail('spacing', `${spacing}: rooms ${i} and ${j} are ${g} apart with no door between them`);
              else row.tightest = Math.min(row.tightest, g);
            }
          }
          for (const c of dun.connections) {
            const g = roomGap(dun.rooms[c.rooms[0]], dun.rooms[c.rooms[1]]);
            if (c.type === 'door' && g !== 0) fail('spacing', `${spacing}: a door joins rooms that are ${g} apart`);
            if (c.type === 'hall') row.widest = Math.max(row.widest, g);
          }
        }
      }
      seen[`${spacing}/${connectionType}`] = row;
      console.log(`  ${spacing.padEnd(7)} ${connectionType}: ${row.dungeons} dungeons, ${row.doors} doorways, ${row.strays} pairs closer than ${min} (all joined by a door), other rooms never closer than ${row.tightest}, rooms a hallway joins up to ${row.widest} apart`);
      if (row.widest > max) fail('spacing', `${spacing} ${connectionType}: joined rooms ${row.widest} apart, over ${max}`);
      if (min > 0 && connectionType === 'door' && row.strays === 0) fail('spacing', `${spacing}: a door never overrides the closest gap`);
    }
  }
  // the settings really differ: the wider the spacing the further apart rooms get, and doors still put rooms against each other
  if (seen['compact/door'].touching === 0) fail('spacing', 'compact rooms never touch');
  for (const key of ['normal/door', 'spaced/door']) if (seen[key].doors === 0 || seen[key].touching === 0) fail('spacing', `${key}: doorways should join rooms that touch`);
  if (seen['normal/hall'].widest <= 4 || seen['spaced/hall'].widest <= 6) fail('spacing', `the gaps do not use the room they are allowed: normal up to ${seen['normal/hall'].widest}, spaced up to ${seen['spaced/hall'].widest}`);
  if (seen['normal/door'].tightest !== 1 || seen['spaced/door'].tightest !== 2) fail('spacing', 'rooms never come as close as the spacing allows');

  // hallway kinds in each spacing: spines still serve 3+ rooms, curly hallways keep their bends
  const bends = (cells) => {
    let n = 0;
    for (let i = 2; i < cells.length; i++) {
      if (cells[i][0] - cells[i - 1][0] !== cells[i - 1][0] - cells[i - 2][0] || cells[i][1] - cells[i - 1][1] !== cells[i - 1][1] - cells[i - 2][1]) n++;
    }
    return n;
  };
  for (const spacing of DM.SPACINGS) {
    const { max } = DM.SPACING_GAPS[spacing];
    let spines = 0;
    let curlies = 0;
    let fewest = Infinity;
    let longest = { spine: 0, short: 0 };
    for (let s = 0; s < 12; s++) {
      for (const hallTypes of [['spine'], ['curly'], ['short'], ['short', 'spine', 'curly', 'branching']]) {
        const dun = DM.generateDungeon({ ...base, roomCount: 20, spacing, connectionType: 'hall', connectionRandomness: s % 3 === 0 ? 20 : 0, hallTypes, seed: `kinds-${spacing}-${hallTypes}-${s}` });
        checkDungeon(dun, `${spacing} ${hallTypes} #${s}`);
        if (dun.rooms.length !== 20) fail('spacing', `${spacing} ${hallTypes}: ${dun.rooms.length} of 20 rooms`);
        for (const h of dun.halls) {
          if (h.kind === 'spine') {
            spines++;
            if (h.rooms.length < 3) fail('spacing', `${spacing}: a spine serves ${h.rooms.length} rooms`);
            if (hallTypes.length === 1) longest.spine = Math.max(longest.spine, h.cells.length);
          }
          if (h.kind === 'short' && hallTypes.length === 1) longest.short = Math.max(longest.short, h.cells.length);
          if (h.kind === 'curly') {
            curlies++;
            fewest = Math.min(fewest, bends(h.cells));
          }
        }
        // a spine is a long straight line, but never longer than the spacing lets two rooms be apart
        for (const h of dun.halls) if (h.kind === 'spine' && hallTypes.length === 1 && h.cells.length > max + 0) fail('spacing', `${spacing}: a spine of ${h.cells.length} squares, over ${max}`);
      }
    }
    console.log(`  ${spacing.padEnd(7)} ${spines} spines (longest ${longest.spine}), ${curlies} curly hallways with at least ${fewest} bends, longest short hallway ${longest.short}`);
    if (spines === 0 || curlies === 0) fail('spacing', `${spacing}: spines or curly hallways are never built`);
    if (fewest < 4) fail('spacing', `${spacing}: a curly hallway has only ${fewest} bends`);
  }

  // doorways only, with every hallway type off: no hallway anywhere, and the rooms they join touch, whatever the spacing
  for (const spacing of DM.SPACINGS) {
    const dun = DM.generateDungeon({ ...base, spacing, connectionType: 'door', connectionRandomness: 0, hallTypes: [], seed: `doors-${spacing}` });
    checkDungeon(dun, `${spacing} doorways only`);
    if (dun.halls.length !== 0 || dun.connections.length < dun.rooms.length - 1) fail('spacing', `${spacing}: doorways only should be at least ${dun.rooms.length - 1} doorways and no halls`);
  }

  // the same inputs give the same dungeon, and the spacing is one of the inputs
  const a = JSON.stringify(DM.generateDungeon({ ...base, spacing: 'spaced', connectionType: 'hall', seed: 'again' }));
  const b = JSON.stringify(DM.generateDungeon({ ...base, spacing: 'spaced', connectionType: 'hall', seed: 'again' }));
  const c = JSON.stringify(DM.generateDungeon({ ...base, spacing: 'normal', connectionType: 'hall', seed: 'again' }));
  if (a !== b) fail('spacing', 'the same spacing and seed gave different dungeons');
  if (a === c) fail('spacing', 'the spacing made no difference to the dungeon');
  // leaving the spacing out is the same as asking for compact
  const d = JSON.stringify(DM.generateDungeon({ ...base, connectionType: 'hall', seed: 'again' }).rooms);
  const e = JSON.stringify(DM.generateDungeon({ ...base, spacing: 'compact', connectionType: 'hall', seed: 'again' }).rooms);
  if (d !== e) fail('spacing', 'leaving spacing out should mean compact');

  // the extremes: a pile of tiny rooms, a few huge ones, the most rooms there can be, a lone room
  for (const spacing of DM.SPACINGS) {
    for (const p of [
      { roomCount: 99, avgRoomSize: 1, sizeVariance: 100 },
      { roomCount: 99, avgRoomSize: 9, sizeVariance: 50, entrances: 4 },
      { roomCount: 12, avgRoomSize: 999, sizeVariance: 30 },
      { roomCount: 1, avgRoomSize: 20, sizeVariance: 0 },
      { roomCount: 2, avgRoomSize: 4, sizeVariance: 0 },
    ]) {
      for (const connectionType of ['door', 'hall']) {
        const t0 = Date.now();
        const dun = DM.generateDungeon({ ...base, ...p, spacing, connectionType, seed: `extreme-${spacing}` });
        checkDungeon(dun, `${spacing} ${connectionType} ${JSON.stringify(p)}`);
        if (Date.now() - t0 > 20000) fail('spacing', `${spacing} ${connectionType} ${JSON.stringify(p)} took ${Date.now() - t0} ms`);
      }
    }
  }
  console.log('  done');
}

console.log('== hallway scaling');
{
  const cfg = DM.GENERATOR_CONFIG;
  // at the reference room size the hallway settings are exactly the configured ones
  const ref = DM.hallSettings(cfg.hallScaleSize);
  if (ref.scale !== 1 || JSON.stringify(ref.length) !== JSON.stringify(cfg.hallLength) || JSON.stringify(ref.spine) !== JSON.stringify(cfg.spineLength) || JSON.stringify(ref.curly) !== JSON.stringify(cfg.curlySegment)
      || ref.lateral !== cfg.hallLateral || ref.maxPath !== cfg.maxHallPath || ref.margin !== cfg.pathMargin) {
    fail('hall scale', `settings at the reference size differ from the configured ones: ${JSON.stringify(ref)}`);
  }
  // bigger rooms never get shorter hallways; every range stays usable
  let prev = null;
  for (let avg = 1; avg <= 999; avg++) {
    const h = DM.hallSettings(avg);
    const ok = h.length[0] >= 1 && h.length[0] <= h.length[1] && h.spine[0] >= h.length[1] && h.spine[0] < h.spine[1] && h.curly[0] >= 1 && h.curly[0] < h.curly[1] && h.lateral >= 1 && h.maxPath >= 20 && h.margin >= 5;
    if (!ok) fail('hall scale', `unusable hallway settings for avg ${avg}: ${JSON.stringify(h)}`);
    if (prev && (h.length[1] < prev.length[1] || h.spine[1] < prev.spine[1] || h.maxPath < prev.maxPath)) fail('hall scale', `hallway settings shrink between avg ${avg - 1} and ${avg}`);
    prev = h;
  }
  const tinyRooms = DM.hallSettings(3);
  const bigRooms = DM.hallSettings(400);
  if (tinyRooms.length[1] > 3 || tinyRooms.spine[1] > 8) fail('hall scale', `3-square rooms still get long hallways: ${JSON.stringify(tinyRooms)}`);
  if (bigRooms.length[1] < 2 * cfg.hallLength[1]) fail('hall scale', `400-square rooms get short hallways: ${JSON.stringify(bigRooms)}`);
  if (tinyRooms.curly[1] > 3 || bigRooms.curly[1] < 2 * cfg.curlySegment[1]) fail('hall scale', `curly hallways do not scale with room size: ${JSON.stringify([tinyRooms.curly, bigRooms.curly])}`);

  // the dungeons themselves: hallway length per room grows with room size, and tiny rooms are not drowned in hallway
  const perRoom = {};
  const share = {};
  for (const avg of [3, 30, 400]) {
    let hall = 0;
    let room = 0;
    for (let s = 0; s < 12; s++) {
      const dun = DM.generateDungeon({ roomCount: 12, avgRoomSize: avg, sizeVariance: 30, entrances: 2, connectionType: 'hall', connectionRandomness: 0, seed: `hs${avg}-${s}` });
      const roomCells = dun.rooms.reduce((n, r) => n + r.area, 0);
      room += roomCells;
      hall += dun.stats.floorCells - roomCells;
    }
    perRoom[avg] = hall / 12 / 12;
    share[avg] = hall / (hall + room);
  }
  console.log(`  hallway squares per room: ${[3, 30, 400].map((a) => `avg ${a} -> ${perRoom[a].toFixed(1)}`).join(', ')}`);
  console.log(`  hallway share of the floor: ${[3, 30, 400].map((a) => `avg ${a} -> ${(share[a] * 100).toFixed(0)}%`).join(', ')}`);
  if (!(perRoom[3] < perRoom[30] && perRoom[30] < perRoom[400])) fail('hall scale', 'hallway length per room does not grow with room size');
  if (share[3] > 0.45) fail('hall scale', `hallways are ${(share[3] * 100).toFixed(0)}% of the floor with 3-square rooms`);
}

console.log('== entrance spread');
{
  // In a compact dungeon of tiny rooms there are few mid-wall edges; entrances must not bunch up on them.
  const mid = (e) => [e.x + 0.5 + DX[e.d] * 0.5, e.y + 0.5 + DY[e.d] * 0.5];
  for (const entrances of [2, 3]) {
    let tested = 0;
    let bunched = 0;
    for (let s = 0; s < 60; s++) {
      const dun = DM.generateDungeon({ roomCount: 12, avgRoomSize: 3, sizeVariance: 30, entrances, connectionType: s % 2 ? 'hall' : 'door', seed: `spread${entrances}-${s}` });
      const doors = dun.entrances;
      if (doors.length < 2) continue;
      tested++;
      let closest = Infinity;
      for (let i = 0; i < doors.length; i++) {
        for (let j = i + 1; j < doors.length; j++) {
          const a = mid(doors[i]);
          const b = mid(doors[j]);
          closest = Math.min(closest, Math.hypot(a[0] - b[0], a[1] - b[1]));
        }
      }
      if (closest < 3) bunched++;
    }
    console.log(`  ${entrances} entrances, 3-square rooms: ${bunched} of ${tested} dungeons have two entrances within 3 squares`);
    if (bunched > 0) fail('entrance spread', `${bunched}/${tested} dungeons of tiny rooms put two of ${entrances} entrances within 3 squares of each other`);
  }
}

console.log('== page layout');
{
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  // no id is used twice, and every id the script looks up is on the page
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (dupes.length > 0) fail('layout', `ids used twice: ${dupes}`);
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  const used = new Set([...appJs.matchAll(/\$\('([A-Za-z-]+)'\)/g)].map((m) => m[1]));
  for (const f of ['roomCount', 'avgRoomSize', 'minRoomWidth', 'minRoomLength', 'sizeVariance', 'entrances', 'connectionRandomness']) used.add(`err-${f}`).add(f);
  for (const id of used) if (!ids.includes(id)) fail('layout', `app.js looks up #${id}, which is not on the page`);

  // the inputs are split into four collapsible columns: rooms, hallways (with entrances), seed / generation / results, then display
  const blades = [...html.matchAll(/<section class="blade" id="blade-([a-z]+)" data-blade="([a-z]+)"/g)];
  if (JSON.stringify(blades.map((m) => m[2])) !== JSON.stringify(['rooms', 'hallways', 'generate', 'display'])) fail('layout', `columns are [${blades.map((m) => m[2])}]`);
  for (const [, id, name] of blades) {
    if (id !== name) fail('layout', `column ${name} has id blade-${id}`);
    if (!html.includes(`aria-controls="blade-${name}-body"`) || !html.includes(`id="blade-${name}-body"`)) fail('layout', `the toggle of column ${name} does not control its body`);
  }
  const stageAt = html.indexOf('<main class="stage">');
  const columnOf = (needle) => {
    const at = html.indexOf(needle);
    if (at < 0 || at > stageAt) return null;
    let col = null;
    for (const m of blades) if (m.index < at) col = m[2];
    return col;
  };
  const expected = {
    rooms: ['id="roomCount"', 'id="avgRoomSize"', 'id="minRoomWidth"', 'id="minRoomLength"', 'id="sizeVariance"', 'name="spacing"', 'name="roomShape"'],
    hallways: ['name="connectionType"', 'id="connectionRandomness"', 'name="hallType"', 'name="hallDoors"', 'id="entrances"', 'id="edgeEntrancesOnly"'],
    generate: ['id="seed"', 'id="generate"', 'id="generateRandom"', 'id="summary"'],
    display: ['name="labelPosition"', 'id="showGrid"', 'id="showLabels"', 'id="colorPickers"', 'id="resetColors"'],
  };
  for (const [col, needles] of Object.entries(expected)) {
    for (const needle of needles) if (columnOf(needle) !== col) fail('layout', `${needle} should be in the ${col} column, not ${columnOf(needle)}`);
  }
  // room spacing: a choice of exactly the spacings the generator knows, compact on first, with a hint that gives its real distances
  {
    const radios = [...html.matchAll(/<input type="radio" id="spacing-([a-z]+)" name="spacing" value="([a-z]+)"([^>]*)>/g)];
    if (JSON.stringify(radios.map((m) => m[2])) !== JSON.stringify(DM.SPACINGS)) fail('layout', `the page offers spacings [${radios.map((m) => m[2])}], the generator has [${DM.SPACINGS}]`);
    if (radios.some((m) => m[1] !== m[2])) fail('layout', 'a spacing radio has an id that does not match its value');
    if (radios.filter((m) => /\schecked/.test(m[3])).map((m) => m[2]).join() !== DM.DEFAULT_SPACING) fail('layout', `the page should start on ${DM.DEFAULT_SPACING} spacing`);
    if (!html.includes('<legend>Room spacing</legend>') || !/<label for="spacing-spaced">Spaced Out<\/label>/.test(html) || !/<label for="spacing-compact">Compact<\/label>/.test(html) || !/<label for="spacing-normal">Normal<\/label>/.test(html)) fail('layout', 'the spacing choice should read Compact / Normal / Spaced Out under "Room spacing"');
    if (!html.includes('id="spacingHint"') || !html.includes('id="err-spacing"')) fail('layout', 'the spacing choice needs a hint and an error line');
    const hints = (appJs.match(/const SPACING_HINTS = \{[\s\S]*?\n  \};/) || [''])[0];
    for (const name of DM.SPACINGS) {
      const { min, max } = DM.SPACING_GAPS[name];
      const line = (hints.match(new RegExp(`${name}: '([^']*)'`)) || [])[1] || '';
      if (min === 0 ? !(/can touch/.test(line) && line.includes(`up to ${max} squares`)) : !(line.includes(`${min}–${max} squares`) && /rooms joined by a door, which touch/.test(line))) fail('layout', `the ${name} hint does not give its distances: "${line}"`);
    }
    if (!/params\.spacing = document\.querySelector\('input\[name="spacing"\]:checked'\)\.value/.test(appJs)) fail('layout', 'app.js does not read the spacing');
    if (!/if \(form\.spacing !== undefined\) setRadio\('spacing', form\.spacing\)/.test(appJs)) fail('layout', 'opening a link or restoring settings does not set the spacing');
    if (!/showGroupError\('spacing'/.test(appJs)) fail('layout', 'a spacing error would not be shown');
    if (!/\.seg-three\s*\{[^}]*repeat\(3, 1fr\)/.test(fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8'))) fail('layout', 'styles.css has no three-way segmented control');
  }
  // the legend is on the map, not in a column, so it stays in view when the columns are collapsed
  const legendAt = html.indexOf('id="legend"');
  if (legendAt < stageAt || stageAt < 0) fail('layout', 'the legend should be inside the map area (<main class="stage">), not in a column');
  if (columnOf('id="legend"') !== null) fail('layout', `the legend is in the ${columnOf('id="legend"')} column`);
  const legendHtml = html.slice(legendAt, html.indexOf('</section>', legendAt));
  for (const sw of ['sw-room', 'sw-hall', 'sw-wall', 'sw-door', 'sw-entrance', 'sw-stairs']) {
    if (!legendHtml.includes(sw)) fail('layout', `the legend has no ${sw} swatch`);
  }
  if (!legendHtml.includes('id="legendToggle"') || !legendHtml.includes('aria-controls="legendList"') || !legendHtml.includes('id="legendList"')) fail('layout', 'the legend has no working fold-away toggle');
  // a blank seed box is filled in with the seed used by Re-generate dungeon; the random button always shows its new seed (the page cannot be run here, so this reads the source)
  const submitHandler = (appJs.match(/\$\('params'\)\.addEventListener\('submit',[\s\S]*?\n  \}\);/) || [''])[0];
  if (!/generate\(\{\s*fillSeed:\s*true\s*\}\)/.test(submitHandler)) fail('layout', 'Re-generate dungeon (the form submit) should fill a blank seed box');
  if (!/\$\('generateRandom'\)\.addEventListener\('click', \(\) => generate\(\{ randomSeed: true \}\)\)/.test(appJs)) fail('layout', 'Generate with random seed should ask for a random seed');
  if (!/if \(!openLink\(\)\) \{\s*restoreSettings\(\);\s*generate\(\);\s*\}/.test(appJs)) fail('layout', 'the first dungeon (page opening) should not fill the seed box, and kept settings come after a link');
  if (!/fillSeed && !randomSeed && check\.params\.seed === null/.test(appJs)) fail('layout', 'only a blank seed should be filled in, never one that was typed');
  if (!/if \(randomSeed \|\| \(fillBlankSeed && \$\('seed'\)\.value\.trim\(\) === ''\)\) \$\('seed'\)\.value = dungeon\.seed/.test(appJs)) fail('layout', 'the seed box should get the seed the dungeon was built from (always for the random button, only if blank otherwise)');
  // the name of the app is across the top of the map, not in the columns, and the map sits under it
  const NAME = "Duckweed's Dungeon Drafter";
  const titleAt = html.indexOf('<h1');
  if (html.indexOf('<h1', titleAt + 1) !== -1) fail('layout', 'the page has more than one <h1>');
  if (titleAt < stageAt || stageAt < 0) fail('layout', 'the title should be inside the map area (<main class="stage">), not in a column');
  if (!new RegExp(`<h1 class="map-title">${NAME}</h1>`).test(html)) fail('layout', `the title should read "${NAME}"`);
  if (!(titleAt < html.indexOf('id="map"'))) fail('layout', 'the title should come before the map');
  if (html.includes('<title>') && !html.includes(`<title>${NAME}</title>`)) fail('layout', `the browser tab should read "${NAME}"`);
  if (/Dungeon Maker/.test(html)) fail('layout', 'the old name "Dungeon Maker" is still on the page');
  if (html.includes('class="app-title"') || html.includes('class="sub"')) fail('layout', 'the old header (title and subtitle) is still in the column panel');
  // the map (with its buttons and legend) fills what is left under the title, so the title never covers the dungeon
  const mapAreaAt = html.indexOf('class="map-area"');
  for (const needle of ['id="map"', 'class="toolbar"', 'id="legend"', 'class="canvas-hint"']) {
    if (!(html.indexOf(needle) > mapAreaAt && mapAreaAt > titleAt)) fail('layout', `${needle} should be inside the map area, under the title`);
  }
  const stageCss = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  if (!/\.stage\s*\{[^}]*flex-direction:\s*column/.test(stageCss) || !/\.map-area\s*\{[^}]*position:\s*relative/.test(stageCss)) fail('layout', 'styles.css does not stack the title above the map area');
  if (!/@media print[\s\S]*\.map-title/.test(stageCss)) fail('layout', 'the title is not hidden when printing (the printed page is the picture alone)');
  // one form wraps all four columns, so Enter in any field generates
  const formAt = html.indexOf('<form id="params"');
  if (formAt < 0 || blades.some((m) => m.index < formAt) || html.indexOf('</form>') < blades[blades.length - 1].index) fail('layout', 'the four columns are not all inside the one form');
  console.log('  done');
}

console.log('== determinism');
{
  const p = { roomCount: 20, avgRoomSize: 30, sizeVariance: 40, entrances: 3, connectionType: 'hall', seed: 'abc' };
  const a = JSON.stringify(DM.generateDungeon(p));
  const b = JSON.stringify(DM.generateDungeon(p));
  if (a !== b) fail('determinism', 'same seed gave different dungeons');
  const c = JSON.stringify(DM.generateDungeon({ ...p, seed: 'abd' }));
  if (a === c) fail('determinism', 'different seeds gave the same dungeon');
  console.log('  done');
}

console.log('== extremes');
const extremes = [
  { roomCount: 1, avgRoomSize: 1, sizeVariance: 0, entrances: 10, connectionType: 'door' },
  { roomCount: 1, avgRoomSize: 999, sizeVariance: 100, entrances: 10, connectionType: 'hall' },
  { roomCount: 99, avgRoomSize: 1, sizeVariance: 100, entrances: 10, connectionType: 'hall' },
  { roomCount: 99, avgRoomSize: 999, sizeVariance: 100, entrances: 10, connectionType: 'door' },
  { roomCount: 99, avgRoomSize: 999, sizeVariance: 0, entrances: 1, connectionType: 'hall' },
  { roomCount: 99, avgRoomSize: 50, sizeVariance: 50, entrances: 5, connectionType: 'door' },
  { roomCount: 2, avgRoomSize: 4, sizeVariance: 30, entrances: 4, connectionType: 'hall' },
  // minimum room size
  { roomCount: 99, avgRoomSize: 1, minRoomWidth: 30, minRoomLength: 30, sizeVariance: 100, entrances: 10, connectionType: 'hall' },
  { roomCount: 99, avgRoomSize: 999, minRoomWidth: 30, minRoomLength: 30, sizeVariance: 0, entrances: 3, connectionType: 'door' },
  { roomCount: 20, avgRoomSize: 5, minRoomWidth: 5, minRoomLength: 5, sizeVariance: 30, entrances: 3, connectionType: 'hall' },
  { roomCount: 40, avgRoomSize: 5, minRoomWidth: 3, minRoomLength: 12, sizeVariance: 30, entrances: 4, connectionType: 'hall' },
  { roomCount: 40, avgRoomSize: 5, minRoomWidth: 12, minRoomLength: 3, sizeVariance: 30, entrances: 4, connectionType: 'door' },
  { roomCount: 99, avgRoomSize: 1, minRoomWidth: 1, minRoomLength: 30, sizeVariance: 30, entrances: 5, connectionType: 'hall' },
  { roomCount: 1, avgRoomSize: 1, minRoomWidth: 30, minRoomLength: 1, sizeVariance: 0, entrances: 10, connectionType: 'door' },
  // hallway types
  { roomCount: 99, avgRoomSize: 1, sizeVariance: 100, entrances: 10, connectionType: 'hall', hallTypes: ['curly'] },
  { roomCount: 99, avgRoomSize: 999, sizeVariance: 50, entrances: 4, connectionType: 'hall', hallTypes: ['curly', 'branching'] },
  { roomCount: 99, avgRoomSize: 40, sizeVariance: 50, entrances: 4, connectionType: 'hall', hallTypes: ['spine'] },
  { roomCount: 99, avgRoomSize: 9, sizeVariance: 30, entrances: 4, connectionType: 'hall', hallTypes: ['short', 'branching'] },
  { roomCount: 40, avgRoomSize: 5, minRoomWidth: 3, minRoomLength: 12, sizeVariance: 30, entrances: 4, connectionType: 'hall', hallTypes: ['curly', 'branching'] },
  { roomCount: 30, avgRoomSize: 25, sizeVariance: 30, entrances: 2, connectionType: 'door', connectionRandomness: 0, hallTypes: [] },
  // entrances anywhere (edgeEntrancesOnly off)
  { roomCount: 1, avgRoomSize: 1, sizeVariance: 0, entrances: 10, connectionType: 'door', edgeEntrancesOnly: false },
  { roomCount: 3, avgRoomSize: 60, sizeVariance: 30, entrances: 10, connectionType: 'door', edgeEntrancesOnly: false },
  { roomCount: 5, avgRoomSize: 3, sizeVariance: 30, entrances: 10, connectionType: 'door', edgeEntrancesOnly: false },
  { roomCount: 99, avgRoomSize: 999, sizeVariance: 100, entrances: 10, connectionType: 'door', edgeEntrancesOnly: false },
  { roomCount: 99, avgRoomSize: 1, sizeVariance: 100, entrances: 10, connectionType: 'door', edgeEntrancesOnly: false },
];
for (const p of extremes) {
  for (const seed of ['x1', 'x2']) {
    const t0 = Date.now();
    const dun = DM.generateDungeon({ ...p, seed });
    const ms = Date.now() - t0;
    checkDungeon(dun, `extreme ${JSON.stringify(p)} ${seed}`);
    console.log(
      `  rooms=${p.roomCount} avg=${p.avgRoomSize} var=${p.sizeVariance} ent=${p.entrances}/${dun.entrances.length}${p.edgeEntrancesOnly === false ? ` (${dun.stats.stairsEntrances} stairs)` : ''} ${p.connectionType}: ` +
        `${dun.width}x${dun.height} cells, ${dun.halls.length} halls, ${ms} ms${dun.warnings.length ? '  WARN: ' + dun.warnings.join(' ') : ''}`
    );
  }
}

console.log('== random sweep');
{
  const rng = new DM.Rng('sweep');
  let slowest = 0;
  const N = 150;
  for (let i = 0; i < N; i++) {
    const p = { ...randomParams(rng), seed: `s${i}` };
    const t0 = Date.now();
    const dun = DM.generateDungeon(p);
    slowest = Math.max(slowest, Date.now() - t0);
    checkDungeon(dun, JSON.stringify(p));
  }
  console.log(`  ${N} dungeons checked, slowest ${slowest} ms`);
}

console.log('== statistics');
{
  // mean / spread of room size vs request (many rooms, several seeds)
  console.log('  avg  var%  -> mean area (shape)   stddev  (target sd)');
  for (const [avg, varPct] of [[10, 0], [10, 30], [25, 30], [25, 60], [100, 30], [100, 100], [400, 50], [999, 30], [4, 50], [1, 50]]) {
    const areas = [];
    for (let s = 0; s < 6; s++) {
      const dun = DM.generateDungeon({ roomCount: 99, avgRoomSize: avg, sizeVariance: varPct, entrances: 1, connectionType: 'door', seed: `st${avg}-${varPct}-${s}` });
      for (const r of dun.rooms) areas.push(r.area);
    }
    const mean = areas.reduce((a, b) => a + b, 0) / areas.length;
    const sd = Math.sqrt(areas.reduce((a, b) => a + (b - mean) ** 2, 0) / areas.length);
    console.log(`  ${String(avg).padStart(4)} ${String(varPct).padStart(4)}  -> ${mean.toFixed(1).padStart(8)} (${(mean / avg * 100).toFixed(0)}%)  ${sd.toFixed(1).padStart(8)}  (${(avg * varPct / 100).toFixed(1)})`);
  }

  // how closely does the share of "other type" connections follow the randomization input?
  console.log('  setting  randomization -> connections of the OTHER type');
  const shares = {};
  for (const type of ['door', 'hall']) {
    for (const pct of [0, 14, 30, 50, 100]) {
      let doors = 0;
      let halls = 0;
      for (let s = 0; s < 10; s++) {
        const dun = DM.generateDungeon({ roomCount: 40, avgRoomSize: 30, sizeVariance: 30, entrances: 2, connectionType: type, connectionRandomness: pct, seed: `ct${type}${pct}-${s}` });
        doors += dun.stats.doorConnections;
        halls += dun.stats.hallLinks; // a hallway serving n rooms is n-1 room-to-room links
      }
      const otherShare = ((type === 'door' ? halls : doors) / (doors + halls)) * 100;
      shares[`${type}${pct}`] = otherShare;
      console.log(`  ${type.padEnd(7)} ${String(pct).padStart(4)}%         -> ${otherShare.toFixed(0).padStart(3)}% (${doors} doors, ${halls} halls)`);
    }
  }
  // monotonic, and the ends of the range must behave as promised (small slack for forced fallbacks)
  for (const type of ['door', 'hall']) {
    const seq = [0, 14, 30, 50, 100].map((p) => shares[`${type}${p}`]);
    for (let i = 1; i < seq.length; i++) if (seq[i] < seq[i - 1]) fail('randomization', `${type}: share not increasing with randomization (${seq.map((n) => n.toFixed(0)).join(', ')})`);
    if (seq[0] > 12) fail('randomization', `${type}: 0% randomization still gives ${seq[0].toFixed(0)}% other-type connections`);
    if (Math.abs(seq[1] - 14) > 12) fail('randomization', `${type}: 14% randomization gave ${seq[1].toFixed(0)}%`);
    if (seq[4] < 80) fail('randomization', `${type}: 100% randomization only gives ${seq[4].toFixed(0)}% other-type connections`);
  }

  // entrances: edge-only never uses stairs; "anywhere" does, for rooms buried inside the dungeon
  console.log('  edge-only  connections -> entrances that are stairs');
  for (const edgeOnly of [true, false]) {
    for (const type of ['door', 'hall']) {
      let total = 0;
      let stairs = 0;
      const rooms = new Set();
      for (let s = 0; s < 40; s++) {
        const dun = DM.generateDungeon({ roomCount: 14, avgRoomSize: 30, sizeVariance: 30, entrances: 4, connectionType: type, edgeEntrancesOnly: edgeOnly, seed: `en${edgeOnly}${type}${s}` });
        total += dun.entrances.length;
        stairs += dun.stats.stairsEntrances;
        for (const e of dun.entrances) rooms.add(`${s}:${e.room}`);
      }
      console.log(`  ${String(edgeOnly).padEnd(9)}  ${type.padEnd(11)} -> ${stairs}/${total} (${((stairs / total) * 100).toFixed(0)}%)`);
      if (edgeOnly && stairs !== 0) fail('entrances', `edge-only produced ${stairs} stairs entrances`);
      if (!edgeOnly && stairs === 0) fail('entrances', `"anywhere" mode (${type}) never produced a stairs entrance in 40 dungeons`);
    }
  }

  // hallways that serve several rooms
  console.log('  setting  rand%  -> hallways  serving 3+ rooms  most rooms on one hallway  (per 20-room dungeon, 30 dungeons)');
  for (const [type, pct] of [['hall', 14], ['hall', 0], ['door', 14], ['door', 50], ['door', 0]]) {
    let halls = 0;
    let multi = 0;
    let most = 0;
    for (let s = 0; s < 30; s++) {
      const dun = DM.generateDungeon({ roomCount: 20, avgRoomSize: 30, sizeVariance: 30, entrances: 2, connectionType: type, connectionRandomness: pct, seed: `mh${type}${pct}-${s}` });
      halls += dun.stats.hallConnections;
      multi += dun.stats.multiRoomHalls;
      most = Math.max(most, dun.stats.maxRoomsPerHall);
    }
    console.log(`  ${type.padEnd(7)} ${String(pct).padStart(3)}%   -> ${(halls / 30).toFixed(1).padStart(8)} ${(multi / 30).toFixed(1).padStart(14)} ${String(most).padStart(22)}`);
    if (type === 'hall' && pct <= 14 && multi === 0) fail('multi-room halls', `hall mode (${pct}%) never made a hallway serving 3+ rooms`);
    if (type === 'hall' && pct <= 14 && most < 4) fail('multi-room halls', `hall mode (${pct}%): no hallway ever served 4+ rooms (max ${most})`);
    if (type === 'door' && pct === 0 && halls !== 0) fail('multi-room halls', `door mode at 0% randomization made ${halls} hallways`);
  }

  // shape variety
  const kinds = {};
  for (let s = 0; s < 5; s++) {
    const dun = DM.generateDungeon({ roomCount: 99, avgRoomSize: 40, sizeVariance: 30, entrances: 1, connectionType: 'door', seed: `k${s}` });
    for (const r of dun.rooms) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
  }
  console.log('  shape kinds:', JSON.stringify(kinds));
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
