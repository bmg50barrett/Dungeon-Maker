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
require('../src/layout.js');
require('../src/generator.js');
require('../src/edit.js');
require('../src/history.js');
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
    // the number goes on a cell with floor on all eight sides whenever the room has one (in an L or T the middle can fall
    // beside a notch), so the number is never drawn over a wall; a very narrow room has none, and its number spills over the walls
    {
      const floor = new Set(r.cells.map((c) => `${c[0]},${c[1]}`));
      const surrounded = ([x, y]) => [-1, 0, 1].every((dy) => [-1, 0, 1].every((dx) => floor.has(`${x + dx},${y + dy}`)));
      if (r.cells.some((c) => surrounded(c) && !DM.labelHitsStair(r, c, dun.stairs || [])) && !surrounded(r.labelCell)) fail(ctx, `room ${r.id} (${r.kind}): the number is beside a wall although the room has a cell with floor all round`);
    }
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
    // hallways are as wide as asked (1 cell unless a width was set): no 2x2 blocks of passage in a 1-wide one
    for (const [x, y] of h.cells) {
      if (dun.params.hallWidth === 1 && mine.has(`${x + 1},${y}`) && mine.has(`${x},${y + 1}`) && mine.has(`${x + 1},${y + 1}`)) {
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
      // a spine is not held to the spacing's greatest gap: its own length is how far apart its rooms may be
      const hall = dun.halls[c.hall];
      const most = hall.kind === 'spine' ? Math.max(gaps.max, hall.cells.length) : gaps.max;
      for (const r of c.rooms) {
        // every room a hallway serves has another one it serves within that distance
        if (!c.rooms.some((q) => q !== r && gapBetween(r, q, most) <= most)) fail(ctx, `connection ${c.id}: room ${r} is more than ${most} from every room it is joined to (${dun.params.spacing})`);
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
  if (dun.entrances.length === 0 && !(dun.level > 1)) fail(ctx, 'no entrances'); // (a floor below the first has none: its stairs are the way in)
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
  // (a gauntlet has no spines, so with only spines (and Branching) on it builds short hallways: the one allowed exception)
  if (dun.params.layout === 'gauntlet' && !dun.params.hallTypes.some((k) => k === 'short' || k === 'curly')) hallTypesOn.add('short');
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
  // (Spread lets hallways run as long as they are meant to: the tighter spacings cut them short, see room spacing below)
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
  const doorsSelect = (html.match(/<select id="hallDoorsSelect" name="hallDoors"[^>]*>([\s\S]*?)<\/select>/) || [])[1];
  if (!doorsSelect) fail('hall doors', 'the hallway doors choice should be a select');
  const inPage = [...(doorsSelect || '').matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
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
  // every number is 1.25 squares high, whatever the room (the page and the pictures both draw it that size)
  if (DM.LABEL_SIZE !== 1.25) fail('labels', `the label size is ${DM.LABEL_SIZE}, not 1.25`);
  for (const [w, h] of [[1, 1], [1, 9], [3, 3], [6, 6], [20, 20]]) {
    const cells = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push([x, y]);
    if (DM.labelSize({ bbox: { x: 0, y: 0, w, h }, cells, labelCell: [0, 0] }) !== 1.25) fail('labels', `a ${w} x ${h} room does not get a 1.25 number`);
  }
  for (let s = 0; s < 20; s++) {
    for (const r of DM.generateDungeon({ roomCount: 15, avgRoomSize: 30, sizeVariance: 60, entrances: 1, connectionType: 'hall', roomShapes: ['rect', 'L', 'T', 'plus'], seed: `labsize${s}` }).rooms) {
      if (DM.labelSize(r) !== 1.25) fail('labels', `room ${r.label} has a ${DM.labelSize(r)} number`);
    }
  }
}
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
        // every number is the same size
        if (Math.abs(o.h - 1.25) > 1e-9) fail('labels', `room ${room.label}: label height ${o.h}, not 1.25`);
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

  // the map's default colors are Duckweed's Aeldara's parchment look: cream rooms (#fbf7ec) and clay hallways (#e2d2ae) on a parchment page,
  // gold doors (#b0843a) and wine entrances (#6b1f1a). The PNG and the printout are drawn from the same theme, so they match.
  const original = {
    background: '#f4ecd9', gridFaint: 'rgba(168, 146, 118, 0.10)', gridFloor: 'rgba(168, 146, 118, 0.38)', roomFloor: '#fbf7ec', hallFloor: '#e2d2ae',
    wall: '#2a211b', doorFill: '#b0843a', doorStroke: '#312510', entranceFill: '#864743', entranceStroke: '#1b0807', arrow: '#6b1f1a',
    stairsTint: 'rgba(107, 31, 26, 0.10)', label: '#2a211b', labelHalo: 'rgba(251, 247, 236, 0.85)',
  };
  for (const [key, want] of Object.entries(original)) if (!base[key] || !same(base[key], want)) fail('colors', `default ${key} is ${base[key]}, the brand's parchment map uses ${want}`);
  for (const key of Object.keys(base)) if (!(key in original)) fail('colors', `theme has ${key}, which the renderer did not have before`);
  // the ready-made colors are all the brand's own: paper, ink, wine and gold, and the tints between them
  const brand = new Set(['#f4ecd9', '#ffffff', '#e9dcbf', '#1f1814', '#fbf7ec', '#efe4cb', '#3d2d22', '#e2d2ae', '#d4c3a3', '#30261f', '#2a211b', '#000000', '#5b4a3a', '#a89276', '#7d6a55', '#c2b29a', '#b0843a', '#80602a', '#6b1f1a', '#b5503f', '#d98f80']);
  for (const cat of cats) for (const p of cat.presets) if (!brand.has(p.hex)) fail('colors', `${cat.id}/${p.name} is ${p.hex}, which is not one of the brand's colors`);

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
    { roomCount: 10, avgRoomSize: 20, sizeVariance: 30, entrances: 1, levels: 4, levelStairs: 3, connectionType: 'hall', seed: 'deep' },
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
    if (!DM.encodeShare({ params: { ...DM.generateDungeon({ ...samples[0], spacing: name }).params } }).includes(`&spacing=${name}&layout=random&seed=`)) fail('share', `a link for ${name} spacing should say so, then the layout, just before the seed`);
  }

  // the same for the overall layout: a link from before it leaves it out, every link made now names it, and nonsense is dropped
  if ('layout' in pinned.form) fail('share', 'a link from before the overall layout should not set it');
  for (const name of DM.LAYOUTS) {
    const withLayout = DM.decodeShare(`#v=1&rooms=7&layout=${name}&seed=castle`);
    if (withLayout.form.layout !== name || Object.keys(withLayout.form).length !== 3) fail('share', `a link with layout=${name} gave ${JSON.stringify(withLayout.form)}`);
    if (!DM.encodeShare({ params: { ...DM.generateDungeon({ ...samples[0], layout: name }).params } }).includes(`&layout=${name}&seed=`)) fail('share', `a link for the ${name} layout should say so, just before the seed`);
  }
  for (const bad of ['roomy', 'Ring', '', 'ring,long', '0']) {
    if ('layout' in DM.decodeShare(`#v=1&rooms=7&layout=${bad}&seed=castle`).form) fail('share', `layout=${bad} should be dropped`);
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

  // the page: buttons in the export column, the script loaded in order, a print layout, and nothing sent anywhere
  const html = read('index.html');
  const css = read('styles.css');
  const appJs = read('src', 'app.js');
  const at = (s) => html.indexOf(`src/${s}.js`);
  if (!(at('palette') > 0 && at('palette') < at('share') && at('share') < at('app'))) fail('share', 'share.js must be loaded after palette.js and before app.js');
  const blade = (name) => html.slice(html.indexOf(`data-blade="${name}"`), html.indexOf('<main class="stage">'));
  const generateColumn = html.slice(html.indexOf('data-blade="export"'), html.indexOf('data-blade="display"'));
  for (const id of ['copyLink', 'downloadPng', 'downloadJson', 'printMap', 'exportLegend', 'exportStatus', 'shareUrl']) {
    if (!generateColumn.includes(`id="${id}"`)) fail('share', `#${id} should be in the export column`);
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
  if (!/id="resetSettings"/.test(html.slice(html.indexOf('data-blade="export"'), html.indexOf('data-blade="display"')))) fail('settings', 'Reset all belongs in the export column');
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
            // (a spine is not held to the spacing's greatest gap, so only the other hallways count here)
            if (c.type === 'hall' && dun.halls[c.hall].kind !== 'spine') row.widest = Math.max(row.widest, g);
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
    const { min } = DM.SPACING_GAPS[spacing];
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
        // a spine is a long straight line that ignores the spacing's greatest gap: 8 to 20 squares for rooms of 30
        // squares (up to half as long again when the dungeon is crowded), and never under the spacing's least gap
        if (hallTypes.length === 1 && hallTypes[0] === 'spine') {
          for (const h of dun.halls) {
            if (h.kind === 'spine' && (h.cells.length > 30 || h.cells.length < Math.max(8, min))) fail('spacing', `${spacing}: a spine of ${h.cells.length} squares, outside 8 to 30`);
          }
        }
      }
    }
    console.log(`  ${spacing.padEnd(7)} ${spines} spines (longest ${longest.spine}), ${curlies} curly hallways with at least ${fewest} bends, longest short hallway ${longest.short}`);
    if (spines === 0 || curlies === 0) fail('spacing', `${spacing}: spines or curly hallways are never built`);
    if (fewest < 4) fail('spacing', `${spacing}: a curly hallway has only ${fewest} bends`);
  }

  // spines and branching only, hallways always: a doorway is the very last resort, and spines are long enough that it is
  // almost never needed, whatever the spacing (spines used to be cut down to the spacing's greatest gap, which sent most
  // Normal dungeons to the doorway fallback)
  for (const spacing of DM.SPACINGS) {
    let withDoors = 0;
    const N2 = 60;
    for (let s = 0; s < N2; s++) {
      const dun = DM.generateDungeon({ ...base, roomCount: 12, spacing, connectionType: 'hall', connectionRandomness: 0, hallTypes: ['spine', 'branching'], seed: `spine-only-${spacing}-${s}` });
      if (dun.connections.some((c) => c.type === 'door')) withDoors++;
    }
    console.log(`  ${spacing.padEnd(7)} spines and branching only, 0% doorways: ${withDoors} of ${N2} dungeons have a doorway`);
    if (withDoors > N2 * 0.1) fail('spacing', `${spacing}: ${withDoors} of ${N2} spine-only dungeons fell back to a doorway`);
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

console.log('== overall layout');
{
  // The layout is a lean towards a shape, so it is judged on how a batch of dungeons come out, and every one of them
  // still has to be a good dungeon (checkDungeon holds each to all the rules: rooms, hallways, spacing).
  const base = { roomCount: 12, avgRoomSize: 30, sizeVariance: 30, entrances: 2, connectionType: 'hall', connectionRandomness: 14 };
  const LAYOUT_NAMES = ['random', 'cathedral', 'ring', 'spiral', 'gauntlet', 'radial', 'mainst', 'square', 'long', 'wide'];
  if (JSON.stringify(DM.LAYOUTS) !== JSON.stringify(LAYOUT_NAMES)) fail('layout', `the layouts are ${DM.LAYOUTS}`);
  if (DM.DEFAULT_LAYOUT !== 'random') fail('layout', 'the default layout is not random');

  // settings: random when left out, and anything else is refused
  if (DM.validateParams({ ...base }).params.layout !== 'random') fail('layout', 'leaving the layout out should mean random');
  for (const name of LAYOUT_NAMES) if (DM.validateParams({ ...base, layout: name }).params.layout !== name) fail('layout', `${name} was not accepted`);
  for (const bad of ['roomy', 'Ring', '', 0, 'ring,long', [], true]) {
    if (DM.validateParams({ ...base, layout: bad }).errors.layout === undefined) fail('layout', `layout ${JSON.stringify(bad)} should be refused`);
  }
  if (DM.validateParams({ ...base, layout: null }).params.layout !== 'random') fail('layout', 'a null layout should mean random');

  // random is no layout at all: the same dungeon as with the setting left out; and every layout repeats and makes a difference
  const same = (a, b) => JSON.stringify([a.rooms, a.halls, a.connections]) === JSON.stringify([b.rooms, b.halls, b.connections]);
  for (let s = 0; s < 6; s++) {
    if (!same(DM.generateDungeon({ ...base, seed: `lay${s}` }), DM.generateDungeon({ ...base, layout: 'random', seed: `lay${s}` }))) fail('layout', 'random is not the same as no layout');
  }
  for (const name of LAYOUT_NAMES.slice(1)) {
    const a = JSON.stringify(DM.generateDungeon({ ...base, layout: name, seed: 'lay-det' }).rooms);
    if (a !== JSON.stringify(DM.generateDungeon({ ...base, layout: name, seed: 'lay-det' }).rooms)) fail('layout', `${name} is not repeatable`);
    if (a === JSON.stringify(DM.generateDungeon({ ...base, layout: 'random', seed: 'lay-det' }).rooms)) fail('layout', `${name} made no difference to the dungeon`);
  }

  // every layout, every spacing, from one room up to a big dungeon: all the rooms placed, and every rule kept
  for (const name of LAYOUT_NAMES) {
    for (const spacing of DM.SPACINGS) {
      for (const [roomCount, avgRoomSize] of [[1, 30], [2, 30], [3, 30], [5, 4], [12, 30], [25, 60], [60, 12]]) {
        for (let s = 0; s < 6; s++) {
          const dun = DM.generateDungeon({ ...base, roomCount, avgRoomSize, spacing, layout: name, seed: `lay-${name}${s}` });
          checkDungeon(dun, `${name} ${spacing} ${roomCount} rooms #${s}`);
          if (dun.params.layout !== name) fail('layout', 'the dungeon does not record its layout');
          if (dun.warnings.length > 0) fail('layout', `${name} ${spacing} ${roomCount} rooms: ${dun.warnings.join(' ')}`);
        }
      }
    }
    // doorways only, spines only, and the others on their own: the settings with the fewest ways to place a room
    for (const extra of [{ connectionType: 'door', connectionRandomness: 0 }, { hallTypes: ['spine'], connectionRandomness: 0 }, { hallTypes: ['curly'] }, { hallTypes: ['short'] }]) {
      for (let s = 0; s < 4; s++) checkDungeon(DM.generateDungeon({ ...base, roomCount: 16, ...extra, layout: name, seed: `lay-x-${name}${s}` }), `${name} ${JSON.stringify(extra)} #${s}`);
    }
  }

  // the shapes: measured over a batch for each spacing
  const N = 30;
  const centre = (r) => [r.bbox.x + r.bbox.w / 2, r.bbox.y + r.bbox.h / 2];
  const batch = (layout, spacing, count = 12) => Array.from({ length: N }, (_, s) => DM.generateDungeon({ ...base, roomCount: count, spacing, layout, seed: `shape-${layout}${s}` }));
  const share = (list, test) => list.filter(test).length / list.length;
  const aspect = (d) => d.height / d.width;
  // how far from round the ring of rooms is: the spread of their distances from the middle of them all, over the average
  const raggedness = (d) => {
    const mids = d.rooms.map(centre);
    const cx = mids.reduce((n, p) => n + p[0], 0) / mids.length;
    const cy = mids.reduce((n, p) => n + p[1], 0) / mids.length;
    const rs = mids.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
    const mean = rs.reduce((n, v) => n + v, 0) / rs.length;
    return Math.sqrt(rs.reduce((n, v) => n + (v - mean) * (v - mean), 0) / rs.length) / mean;
  };
  // the share of rooms on the cross through the first room (a column or a row of its width)
  const onCross = (d) => {
    const [x0, y0] = centre(d.rooms[0]);
    const side = Math.sqrt(d.rooms.reduce((n, r) => n + r.area, 0) / d.rooms.length);
    return d.rooms.filter((r) => Math.abs(centre(r)[0] - x0) < 0.9 * side || Math.abs(centre(r)[1] - y0) < 0.9 * side).length / d.rooms.length;
  };
  // whether the connections go round in a circle somewhere
  const hasLoop = (d) => {
    const root = d.rooms.map((_, i) => i);
    const find = (x) => (root[x] === x ? x : (root[x] = find(root[x])));
    for (const c of d.connections) {
      for (let i = 1; i < c.rooms.length; i++) {
        const a = find(c.rooms[0]);
        const b = find(c.rooms[i]);
        if (a === b) return true;
        root[a] = b;
      }
    }
    return false;
  };
  const rows = [];
  for (const spacing of DM.SPACINGS) {
    const random = batch('random', spacing);
    const randomRound = share(random, (d) => raggedness(d) < 0.3);
    const randomCross = random.reduce((n, d) => n + onCross(d), 0) / N;
    const randomLong = share(random, (d) => aspect(d) >= 1.6);
    const found = { long: batch('long', spacing), wide: batch('wide', spacing), ring: batch('ring', spacing), cathedral: batch('cathedral', spacing) };
    // long and wide: a good deal more of one than the other, the right way round
    const longShare = share(found.long, (d) => aspect(d) >= 1.6);
    const wideShare = share(found.wide, (d) => aspect(d) <= 0.625);
    const ringShare = share(found.ring, (d) => raggedness(d) < 0.3);
    const ringLoops = share(found.ring, hasLoop);
    const crossShare = found.cathedral.reduce((n, d) => n + onCross(d), 0) / N;
    const crossTall = found.cathedral.reduce((n, d) => n + aspect(d), 0) / N;
    rows.push(`${spacing}: long ${longShare.toFixed(2)}, wide ${wideShare.toFixed(2)}, ring round ${ringShare.toFixed(2)} closed ${ringLoops.toFixed(2)} (random round ${randomRound.toFixed(2)}), cathedral on the cross ${crossShare.toFixed(2)} (random ${randomCross.toFixed(2)}) tall ${crossTall.toFixed(2)}`);
    if (longShare < 0.9) fail('layout', `${spacing}: only ${longShare} of long dungeons are long`);
    if (wideShare < 0.9) fail('layout', `${spacing}: only ${wideShare} of wide dungeons are wide`);
    if (randomLong > 0.3) fail('layout', `${spacing}: random dungeons are long as often as ${randomLong}`);
    if (ringShare < 0.9 || randomRound > 0.1) fail('layout', `${spacing}: ring dungeons are round ${ringShare} of the time, random ones ${randomRound}`);
    if (ringLoops < 0.6) fail('layout', `${spacing}: only ${ringLoops} of rings close into a loop`);
    if (crossShare < 0.8 || crossShare - randomCross < 0.2) fail('layout', `${spacing}: cathedral rooms are on the cross ${crossShare} of the time, random ones ${randomCross}`);
    if (crossTall < 1.25) fail('layout', `${spacing}: cathedrals are only ${crossTall} times as long as they are broad`);
  }
  console.log(`  ${rows.join('\n  ')}`);

  // square: nearer to as broad as it is long than random is (random dungeons are rounded blobs and often nearly square too, so this
  // takes a bigger batch), and packed more tightly into its box
  for (const spacing of DM.SPACINGS) {
    const measure = (layout) => {
      let off = 0;
      let fill = 0;
      for (let s = 0; s < 80; s++) {
        const d = DM.generateDungeon({ ...base, spacing, layout, seed: `sq-${layout}${s}` });
        off += Math.abs(Math.log(aspect(d))) / 80;
        fill += d.rooms.reduce((n, r) => n + r.area, 0) / (d.width * d.height) / 80;
      }
      return { off, fill };
    };
    const sq = measure('square');
    const rnd = measure('random');
    console.log(`  ${spacing}: square is ${sq.off.toFixed(3)} off square and ${sq.fill.toFixed(2)} full, random ${rnd.off.toFixed(3)} and ${rnd.fill.toFixed(2)}`);
    if (sq.off > 0.8 * rnd.off) fail('layout', `${spacing}: square dungeons are ${sq.off} off square, random ones ${rnd.off}`);
    if (sq.fill < rnd.fill + 0.02) fail('layout', `${spacing}: square dungeons are ${sq.fill} full, random ones ${rnd.fill}`);
  }

  // radial: the biggest room is the hub, every room is on a hallway, every hallway starts at the hub, and there are no other doorways
  for (const spacing of DM.SPACINGS) {
    for (const count of [5, 12, 25]) {
      let rooted = 0;
      const tries = 30;
      for (let s = 0; s < tries; s++) {
        const dun = DM.generateDungeon({ ...base, roomCount: count, spacing, layout: 'radial', seed: `radial-${spacing}${count}-${s}` });
        const hub = dun.rooms[0];
        if (dun.rooms.some((r) => r.area > hub.area)) fail('layout', `radial ${spacing} ${count}: room ${hub.label} is the hub but is not the biggest`);
        if (dun.connections.some((c) => c.type !== 'hall')) fail('layout', `radial ${spacing} ${count}: a doorway between rooms`);
        const halls = dun.connections.filter((c) => c.type === 'hall');
        const reached = new Set(halls.flatMap((c) => c.rooms));
        if (dun.rooms.some((r) => r.id !== 0 && !reached.has(r.id))) fail('layout', `radial ${spacing} ${count}: a room with no hallway`);
        if (halls.every((c) => c.rooms.includes(0))) rooted++;
      }
      if (rooted / tries < 0.85) fail('layout', `radial ${spacing} ${count}: only ${rooted} of ${tries} dungeons have every hallway starting at the hub`);
    }
  }
  // where the settings allow no hallway at all, a radial dungeon is doorways off the hub; with doorways asked for but hallways possible it is still all hallways
  {
    const doors = DM.generateDungeon({ ...base, roomCount: 8, layout: 'radial', connectionType: 'door', connectionRandomness: 0, hallTypes: [], seed: 'radial-doors' });
    checkDungeon(doors, 'radial, no hallways possible');
    if (doors.halls.length > 0) fail('layout', 'radial built a hallway where none is possible');
    const halls = DM.generateDungeon({ ...base, roomCount: 8, layout: 'radial', connectionType: 'door', connectionRandomness: 30, seed: 'radial-halls' });
    if (halls.connections.some((c) => c.type !== 'hall')) fail('layout', 'radial made a doorway where hallways are possible');
  }

  // Main St.: one long straight hallway with the rooms along its sides and branching off it, running up and down the map
  {
    const run = (d) => {
      let best = 0;
      let vertical = false;
      for (const h of d.halls) {
        const xs = new Map();
        const ys = new Map();
        for (const [x, y] of h.cells) {
          xs.set(x, (xs.get(x) || 0) + 1);
          ys.set(y, (ys.get(y) || 0) + 1);
        }
        const mx = Math.max(...xs.values());
        const my = Math.max(...ys.values());
        if (Math.max(mx, my) > best) {
          best = Math.max(mx, my);
          vertical = mx > my;
        }
      }
      return { best, vertical };
    };
    for (const spacing of DM.SPACINGS) {
      for (const count of [5, 12, 25]) {
        let single = 0;
        let across = 0;
        const tries = 30;
        for (let s = 0; s < tries; s++) {
          const dun = DM.generateDungeon({ ...base, roomCount: count, spacing, layout: 'mainst', seed: `mainst-${spacing}${count}-${s}` });
          if (dun.connections.some((c) => c.type !== 'hall')) fail('layout', `mainst ${spacing} ${count}: a doorway between rooms`);
          const reached = new Set(dun.connections.flatMap((c) => c.rooms));
          if (dun.rooms.some((r) => !reached.has(r.id))) fail('layout', `mainst ${spacing} ${count}: a room with no hallway`);
          const { best, vertical } = run(dun);
          if (best < Math.min(14, 2 * count)) fail('layout', `mainst ${spacing} ${count}: the longest straight hallway is only ${best} squares`);
          if (dun.halls.length === 1) single++;
          if (!vertical) across++;
        }
        if (single / tries < 0.85) fail('layout', `mainst ${spacing} ${count}: only ${single} of ${tries} dungeons are a single hallway`);
        if (across > 0) fail('layout', `mainst ${spacing} ${count}: the street ran across the map in ${across} of ${tries} dungeons`);
      }
    }
    // the street is longer for more rooms
    const len = (count) => run(DM.generateDungeon({ ...base, roomCount: count, layout: 'mainst', spacing: 'normal', seed: 'mainst-len' })).best;
    if (!(len(30) > len(8))) fail('layout', 'a bigger Main St. dungeon should have a longer street');
    // where the settings allow no hallway, the rooms come in a row of doorways
    const rows = DM.generateDungeon({ ...base, roomCount: 8, layout: 'mainst', connectionType: 'door', connectionRandomness: 0, hallTypes: [], seed: 'mainst-doors' });
    checkDungeon(rows, 'mainst, no hallways possible');
    if (rows.halls.length > 0) fail('layout', 'Main St. built a hallway where none is possible');
  }

  // hallway width: wide hallways are real bands, and the whole dungeon still checks out
  {
    for (const width of [2, 3, 5, 10]) {
      for (const layout of ['random', 'radial', 'mainst', 'ring']) {
        if (layout === 'radial' && width === 10) continue; // (ten squares wide, the spokes leave room for fewer rooms: the generator says so)
        for (const count of [4, 12]) {
          for (let s = 0; s < 6; s++) {
            const dun = DM.generateDungeon({ ...base, roomCount: count, layout, hallWidth: width, connectionType: 'hall', connectionRandomness: 0, seed: `wide-${width}-${layout}-${count}-${s}` });
            checkDungeon(dun, `hall width ${width}, ${layout}, ${count} rooms`);
            if (dun.params.hallWidth !== width) fail('width', 'the width is not kept in the dungeon\'s inputs');
            // some stretch of passage is a full width across: a line of that many squares (a 1-wide hallway has none)
            const cells = new Set(dun.halls.flatMap((h) => h.cells.map(([x, y]) => `${x},${y}`)));
            let block = false;
            for (const key of cells) {
              const [x, y] = key.split(',').map(Number);
              for (const [dx, dy] of [[1, 0], [0, 1]]) {
                let n = 0;
                while (n < width && cells.has(`${x + dx * n},${y + dy * n}`)) n++;
                if (n === width) block = true;
              }
              if (block) break;
            }
            if (cells.size > 0 && !block) fail('width', `${layout} ${count} rooms, width ${width}: no hallway is ${width} squares across`);
          }
        }
      }
    }
    // width 1 is what was always built; anything not a whole number from 1 to 10 is refused
    const plain = DM.generateDungeon({ ...base, seed: 'wide-same' });
    const one = DM.generateDungeon({ ...base, hallWidth: 1, seed: 'wide-same' });
    if (JSON.stringify(plain.halls) !== JSON.stringify(one.halls)) fail('width', 'width 1 changed the dungeon');
    for (const bad of [0, 11, 2.5, 'x', -1]) {
      if (DM.validateParams({ ...base, hallWidth: bad }).ok) fail('width', `hall width ${bad} was accepted`);
    }
    // a wider hallway means more passage, and so a bigger dungeon
    const area = (w) => {
      let total = 0;
      for (let s = 0; s < 10; s++) total += DM.generateDungeon({ ...base, hallWidth: w, connectionType: 'hall', connectionRandomness: 0, seed: `wide-area-${s}` }).halls.reduce((n, h) => n + h.cells.length, 0);
      return total;
    };
    if (!(area(4) > 2 * area(1))) fail('width', 'a width of 4 should give far more hallway than a width of 1');
  }

  // a spiral puts its first two entrances at its two ends: the tip (the last room) and where it began (the first room)
  {
    for (const count of [6, 14, 25]) {
      let tip = 0;
      let both = 0;
      const tries = 20;
      for (let s = 0; s < tries; s++) {
        const dun = DM.generateDungeon({ ...base, roomCount: count, layout: 'spiral', entrances: 3, edgeEntrancesOnly: false, seed: `spiral-${count}-${s}` });
        checkDungeon(dun, `spiral ${count}`);
        const rooms = dun.entrances.map((e) => e.room);
        if (rooms.includes(count - 1)) tip++;
        if (rooms.slice(0, 2).sort().join() === [0, count - 1].sort().join()) both++;
      }
      if (both < tries) fail('layout', `spiral ${count}: entrances anywhere, but only ${both} of ${tries} have the first two at the two ends`);
      let edgeTip = 0;
      for (let s = 0; s < tries; s++) {
        const dun = DM.generateDungeon({ ...base, roomCount: count, layout: 'spiral', entrances: 2, edgeEntrancesOnly: true, seed: `spiral-edge-${count}-${s}` });
        checkDungeon(dun, `spiral edge ${count}`);
        if (dun.entrances.some((e) => e.room === count - 1)) edgeTip++;
      }
      if (edgeTip / tries < 0.85) fail('layout', `spiral ${count}: only ${edgeTip} of ${tries} have an entrance at the tip`);
    }
  }

  // a ring is the one place hallways run in a circle, and its closing hallway is a short one: with Short switched off it closes by doorway or not at all
  for (let s = 0; s < 20; s++) {
    const dun = DM.generateDungeon({ ...base, roomCount: 14, layout: 'ring', hallTypes: ['spine'], connectionRandomness: 0, seed: `ring-nohall${s}` });
    checkDungeon(dun, `ring, spines only #${s}`);
    for (const h of dun.halls) if (h.kind !== 'spine') fail('layout', 'a closing hallway of a kind that is switched off');
  }
  // only a ring runs its hallways in a circle: with every other layout the hallways alone join the rooms as a tree
  for (const name of ['cathedral', 'spiral', 'gauntlet', 'radial', 'mainst', 'square', 'long', 'wide']) {
    for (let s = 0; s < 10; s++) {
      const dun = DM.generateDungeon({ ...base, layout: name, seed: `noloop-${name}${s}` });
      if (dun.stats.hallLinks > dun.rooms.length - 1) fail('layout', `${name}: hallways made a loop`);
    }
  }
  // a gauntlet is a single chain: every room joined to the next, no hallway serving three rooms, no room with more than two links
  // (with Branching off: it is Branching that lets a hallway fork to a side room, see below)
  for (const count of [3, 8, 20]) {
    for (let s = 0; s < 15; s++) {
      const dun = DM.generateDungeon({ ...base, roomCount: count, layout: 'gauntlet', hallTypes: ['short', 'curly'], seed: `gauntlet-${count}-${s}` });
      checkDungeon(dun, `gauntlet ${count}`);
      if (dun.connections.length !== count - 1) fail('layout', `gauntlet ${count}: ${dun.connections.length} connections`);
      if (dun.connections.some((c) => c.rooms.length !== 2)) fail('layout', `gauntlet ${count}: a connection serves more than two rooms`);
      // the first two entrances are in the first and the last room
      const gEnds = dun.entrances.slice(0, 2).map((e) => e.room).sort();
      if (count > 3 && dun.entrances.length >= 2 && dun.warnings.length === 0) {
        const anywhere = DM.generateDungeon({ ...base, roomCount: count, layout: 'gauntlet', hallTypes: ['short', 'curly'], edgeEntrancesOnly: false, seed: `gauntlet-${count}-${s}` });
        if (anywhere.entrances.slice(0, 2).map((e) => e.room).sort().join() !== [0, count - 1].join()) fail('layout', `gauntlet ${count}: with entrances anywhere, the first two are not in the first and last rooms`);
      }
      if (gEnds.length !== new Set(gEnds).size) fail('layout', 'gauntlet: two entrances in one room at the ends');
      const degree = new Map();
      for (const c of dun.connections) for (const r of c.rooms) degree.set(r, (degree.get(r) || 0) + 1);
      if ([...degree.values()].some((n) => n > 2)) fail('layout', `gauntlet ${count}: a room has more than two links`);
    }
  }
  // a gauntlet with Branching on: a hallway can fork to a side room that is a dead end (one room, no more) while the path goes on,
  // and the last room is still the end of the path
  let forks = 0;
  for (const count of [4, 8, 20]) {
    for (let s = 0; s < 15; s++) {
      const dun = DM.generateDungeon({ ...base, roomCount: count, layout: 'gauntlet', hallTypes: ['short', 'curly', 'branching'], seed: `gauntlet-branch-${count}-${s}` });
      checkDungeon(dun, `gauntlet with branches ${count}`);
      const links = new Map();
      for (const c of dun.connections) for (const r of c.rooms) links.set(r, (links.get(r) || 0) + 1);
      for (const c of dun.connections) {
        if (c.rooms.length > 3) fail('layout', `gauntlet ${count}: a hallway serves ${c.rooms.length} rooms`);
        if (c.rooms.length === 3) {
          forks++;
          const side = c.rooms[2];
          if (links.get(side) !== 1) fail('layout', `gauntlet ${count}: a side room is not a dead end`);
          if (side === count - 1) fail('layout', `gauntlet ${count}: the last room is a side room`);
        }
      }
      if (dun.connections.length < count - 1 - dun.connections.filter((c) => c.rooms.length === 3).length) fail('layout', `gauntlet ${count}: rooms are left out of the chain`);
    }
  }
  if (forks === 0) fail('layout', 'gauntlet: Branching on never made a side room');

  // whatever is switched on turns up: every room shape that is on has a room, and every hallway type that is on has a hallway (with
  // rooms and hallways enough for that, and for a gauntlet without spines, which it has none of)
  {
    const lay = ['random', 'cathedral', 'ring', 'spiral', 'gauntlet', 'square', 'long', 'wide'];
    let runs = 0;
    let gaps = 0;
    for (const layout of lay) {
      for (let s = 0; s < 25; s++) {
        const r = new DM.Rng(`turns-up-${layout}${s}`);
        const pick = (all) => {
          const chosen = all.filter(() => r.next() < 0.5);
          return chosen.length > 0 ? chosen : [r.pick(all)];
        };
        const p = { ...base, roomCount: r.int(15, 30), avgRoomSize: 30, layout, connectionType: r.pick(['hall', 'door']), connectionRandomness: r.pick([0, 25]), roomShapes: pick(DM.SHAPE_KINDS), hallTypes: pick(DM.HALL_TYPES).concat(r.pick(DM.HALL_KINDS)).filter((k, i, all) => all.indexOf(k) === i), seed: `turns-up-${layout}${s}` };
        const dun = DM.generateDungeon(p);
        if (dun.warnings.some((w) => /Could only fit/.test(w))) continue;
        runs++;
        for (const k of p.roomShapes) if (!dun.stats.shapeCounts[k]) { gaps++; fail('layout', `${layout}: room shape ${k} is on but no room has it (${p.roomShapes})`); }
        for (const k of p.hallTypes) {
          if (!DM.hallwaysPossible(p) || (layout === 'gauntlet' && k === 'spine')) continue;
          if (!dun.stats.hallTypeCounts[k]) { gaps++; fail('layout', `${layout}: hallway type ${k} is on but none was used (${p.hallTypes}, ${p.connectionType} ${p.connectionRandomness}%)`); }
        }
      }
    }
    console.log(`  every shape and hallway type that is on turns up: ${runs} dungeons, ${gaps} missing`);
  }
  // (a gauntlet with Branching on and mostly doorways: still a hallway forks to a side room)
  for (let s = 0; s < 30; s++) {
    const dun = DM.generateDungeon({ ...base, roomCount: 20, layout: 'gauntlet', hallTypes: ['short', 'branching'], connectionType: 'door', connectionRandomness: 25, roomShapes: ['rect', 'chamfer'], seed: `gauntlet-forks-${s}` });
    if (!dun.connections.some((c) => c.rooms.length === 3)) fail('layout', 'gauntlet with Branching on has no fork');
    if (!dun.stats.shapeCounts.chamfer) fail('layout', 'gauntlet with Chamfered on has no chamfered room');
  }

  // several levels: floors in one box, joined by stairs that are in the same square (a room square, away from doors) on both floors
  {
    const lvBase = { ...base, roomCount: 10 };
    let made = 0;
    for (const [levels, stairs] of [[2, 1], [3, 1], [4, 3], [6, 2], [3, 10]]) {
      for (const layout of ['random', 'gauntlet', 'ring', 'radial', 'cathedral']) {
        for (let s = 0; s < 3; s++) {
          const ctx = `levels ${levels}x${stairs} ${layout} ${s}`;
          const seedText = `lv-${levels}-${stairs}-${layout}-${s}`;
          const dun = DM.generateDungeon({ ...lvBase, layout, levels, levelStairs: stairs, seed: seedText });
          made++;
          if (DM.levelCount(dun) !== levels || dun.floors.length !== levels - 1) fail('levels', `${ctx}: the floors are not all there`);
          const views = [];
          for (let n = 1; n <= levels; n++) views.push(DM.floorView(dun, n));
          // each floor on its own is a dungeon: rooms, hallways, doors; only the first has entrances
          views.forEach((v, n) => {
            if (v.width !== dun.width || v.height !== dun.height) fail('levels', `${ctx}: level ${n + 1} is not in the one box`);
            if (v.rooms.length !== lvBase.roomCount) fail('levels', `${ctx}: level ${n + 1} has ${v.rooms.length} rooms`);
            if ((n === 0) !== (v.entrances.length > 0)) fail('levels', `${ctx}: level ${n + 1} has ${v.entrances.length} entrances`);
            if (v.rooms.some((r) => r.level !== n + 1)) fail('levels', `${ctx}: a room on level ${n + 1} is not marked with its level`);
            checkDungeon({ ...v, params: { ...v.params, entrances: v.entrances.length } }, `${ctx} level ${n + 1}`);
          });
          // every stair: a room square on both floors, at the same place, clear of doors, hallway openings and entrances
          const owner = views.map((v) => {
            const m = new Map();
            for (const r of v.rooms) for (const [x, y] of r.cells) m.set(`${x},${y}`, r.id);
            return m;
          });
          const near = views.map((v) => {
            const set = new Set();
            const add = (x, y) => {
              for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) set.add(`${x + i},${y + j}`);
            };
            for (const c of v.connections) {
              for (const o of c.openings) {
                add(o.x, o.y);
                add(o.x + DX[o.d], o.y + DY[o.d]);
              }
            }
            for (const e of v.entrances) {
              add(e.x, e.y);
              add(e.x + DX[e.d], e.y + DY[e.d]);
            }
            return set;
          });
          const seen = new Set();
          const perPair = {};
          for (const st of dun.stairs) {
            const key = `${st.x},${st.y}`;
            if (st.lower !== st.upper + 1 || st.upper < 1 || st.lower > levels) fail('levels', `${ctx}: stair ${st.letter} joins levels ${st.upper} and ${st.lower}`);
            if (owner[st.upper - 1].get(key) !== st.upperRoom) fail('levels', `${ctx}: stair ${st.letter} is not in room ${st.upperRoom} of level ${st.upper}`);
            if (owner[st.lower - 1].get(key) !== st.lowerRoom) fail('levels', `${ctx}: stair ${st.letter} is not in room ${st.lowerRoom} of level ${st.lower}`);
            if (near[st.upper - 1].has(key) || near[st.lower - 1].has(key)) fail('levels', `${ctx}: stair ${st.letter} is by a door or an entrance`);
            if (seen.has(`${st.upper}:${key}`) || seen.has(`${st.lower}:${key}`)) fail('levels', `${ctx}: two stairs share a square on a level`);
            seen.add(`${st.upper}:${key}`);
            seen.add(`${st.lower}:${key}`);
            perPair[st.upper] = (perPair[st.upper] || 0) + 1;
          }
          if (new Set(dun.stairs.map((st) => st.letter)).size !== dun.stairs.length) fail('levels', `${ctx}: stair letters repeat`);
          for (let n = 1; n < levels; n++) {
            if (!perPair[n]) fail('levels', `${ctx}: no stair between level ${n} and level ${n + 1}`);
            else if (perPair[n] < stairs && !dun.warnings.some((w) => w.includes(`Levels ${n} and ${n + 1} could only get`))) fail('levels', `${ctx}: ${perPair[n]} of ${stairs} stairs between level ${n} and level ${n + 1}, with no warning`);
          }
          // a floor's stairs as the page will draw them
          for (let n = 1; n <= levels; n++) {
            const list = DM.floorStairs(dun, n);
            const down = list.filter((x) => x.dir === 'down').length;
            const up = list.filter((x) => x.dir === 'up').length;
            if (down !== (perPair[n] || 0) || up !== (perPair[n - 1] || 0)) fail('levels', `${ctx}: level ${n} lists ${down} down and ${up} up stairs`);
          }
          // the same seed, the same dungeon; the first floor is the dungeon a single level would be (but in the box)
          if (s === 0) {
            const again = DM.generateDungeon({ ...lvBase, layout, levels, levelStairs: stairs, seed: seedText });
            if (JSON.stringify(again) !== JSON.stringify(dun)) fail('levels', `${ctx}: the same seed gave another dungeon`);
            const alone = DM.generateDungeon({ ...lvBase, layout, seed: seedText });
            const strip = (rooms) => JSON.stringify(rooms.map((r) => ({ ...r, level: undefined, labelCell: undefined })));
            if (strip(alone.rooms) !== strip(dun.rooms)) fail('levels', `${ctx}: level 1 is not the dungeon of one level`);
          }
        }
      }
    }
    console.log(`  levels: ${made} dungeons of 2-6 levels made`);
    // one level is the dungeon as it always was
    const single = DM.generateDungeon({ ...base, seed: 'one-level' });
    if (single.levels !== undefined || single.floors !== undefined || single.stairs !== undefined || DM.levelCount(single) !== 1 || DM.floorView(single, 1) !== single) fail('levels', 'a dungeon of one level has level fields');
    for (const bad of [0, 21, 1.5, 'x']) if (DM.validateParams({ ...base, levels: bad }).ok) fail('levels', `${bad} levels was accepted`);
    for (const bad of [0, 11, 2.5]) if (DM.validateParams({ ...base, levelStairs: bad }).ok) fail('levels', `${bad} stairs was accepted`);
    if (DM.stairLetter(0) !== 'A' || DM.stairLetter(25) !== 'Z' || DM.stairLetter(26) !== 'AA' || DM.stairLetter(27) !== 'AB' || DM.stairLetter(701) !== 'ZZ' || DM.stairLetter(702) !== 'AAA') fail('levels', 'stair letters are not A..Z, AA, ..');
    // twenty floors
    const deep = DM.generateDungeon({ ...base, roomCount: 8, levels: 20, levelStairs: 2, seed: 'deep' });
    if (DM.levelCount(deep) !== 20 || deep.stairs.length < 19) fail('levels', 'twenty levels did not all get stairs');
  }

  // the shapes themselves (layout.js on its own): the start is inside, far away is not, and each is the shape it says
  let n = 0.3;
  const info = { rooms: 12, area: 360, side: 5.5, gap: 2, spacing: 'compact', random: () => (n = (n * 9301 + 0.49297) % 1) };
  if (DM.makeLayout('random', info) !== null) fail('layout', 'random should have no shape');
  for (const name of LAYOUT_NAMES.slice(1)) {
    const lay = DM.makeLayout(name, info);
    if (!lay) {
      fail('layout', `${name} has no shape`);
      continue;
    }
    if (lay.outside(lay.start.x, lay.start.y, 0) !== 0) fail('layout', `${name}: the first room starts outside the shape`);
    if (!(lay.outside(5000, 5000, 3) > 1000)) fail('layout', `${name}: far away is not outside the shape`);
    if (!(lay.tolerance(0) > 0 && lay.tolerance(10) <= lay.tolerance(30) && lay.tolerance(60) === Infinity)) fail('layout', `${name}: tolerance does not open up to anything`);
    if (!(lay.score(lay.start.x, lay.start.y, null, 0) < lay.score(lay.start.x + 400, lay.start.y, null, 0))) fail('layout', `${name}: a far-off place scores better than the start`);
  }
  const ring = DM.makeLayout('ring', info);
  if (!ring.closes || !(ring.outside(0, 0, 0) > 5)) fail('layout', 'a ring should close and have an empty middle');
  const cross = DM.makeLayout('cathedral', info);
  if (cross.outside(0, 0) !== 0 || cross.outside(30, 30) === 0) fail('layout', 'the cross should include its crossing and not its corners');
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

  // the inputs are split into five collapsible columns: layout (with room spacing), rooms, hallways (with entrances), seed / generation / results, then display
  const blades = [...html.matchAll(/<section class="blade" id="blade-([a-z]+)" data-blade="([a-z]+)"/g)];
  if (JSON.stringify(blades.map((m) => m[2])) !== JSON.stringify(['layout', 'rooms', 'hallways', 'export', 'display'])) fail('layout', `columns are [${blades.map((m) => m[2])}]`);
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
    layout: ['name="layout"', 'name="spacing"', 'id="levels"', 'id="levelStairs"', 'id="entrances"', 'id="edgeEntrancesOnly"'],
    rooms: ['id="roomCount"', 'id="avgRoomSize"', 'id="minRoomWidth"', 'id="minRoomLength"', 'id="sizeVariance"', 'name="roomShape"'],
    hallways: ['name="connectionType"', 'id="connectionRandomness"', 'name="hallType"', 'id="hallWidth"', 'name="hallDoors"'],
    export: ['id="seed"', 'id="summary"'],
    display: ['name="labelPosition"', 'id="showGrid"', 'id="showLabels"', 'id="colorPickers"', 'id="resetColors"'],
  };
  for (const [col, needles] of Object.entries(expected)) {
    for (const needle of needles) if (columnOf(needle) !== col) fail('layout', `${needle} should be in the ${col} column, not ${columnOf(needle)}`);
  }
  // the buttons that build a dungeon sit above the map, beside the level tabs, with Regenerate level; Re-generate still submits the form
  {
    const bar = html.slice(html.indexOf('<div class="map-bar">'), html.indexOf('<div class="map-frame">'));
    if (bar.length < 20 || html.indexOf('<div class="map-bar">') < stageAt) fail('layout', 'the build buttons are not in the bar above the map');
    const order = ['id="levelTabs"', 'id="regenLevel"', 'id="generate"', 'id="generateRandom"'].map((x) => bar.indexOf(x));
    if (order.some((x, i) => x < 0 || (i > 0 && x < order[i - 1]))) fail('layout', 'the bar above the map should hold the level tabs, then Regenerate level, Re-generate dungeon and, last, Generate with random seed');
    if (!/<button type="submit" form="params" id="generate"/.test(bar)) fail('layout', 'Re-generate dungeon must submit the form from outside it');
    if (!/id="regenLevel"[^>]*hidden/.test(bar)) fail('layout', 'Regenerate level should start hidden (a single level has nothing to regenerate)');
  }
  // room spacing: a choice of exactly the spacings the generator knows, compact on first, with a hint that gives its real distances
  {
    const spacingSelect = (html.match(/<select id="spacingSelect" name="spacing"[^>]*>([\s\S]*?)<\/select>/) || [])[1];
    if (!spacingSelect) fail('layout', 'room spacing should be a select');
    const radios = [...(spacingSelect || '').matchAll(/<option value="([a-z]+)"([^>]*)>([^<]*)<\/option>/g)];
    if (JSON.stringify(radios.map((m) => m[1])) !== JSON.stringify(DM.SPACINGS)) fail('layout', `the page offers spacings [${radios.map((m) => m[1])}], the generator has [${DM.SPACINGS}]`);
    if (radios.filter((m) => /\sselected/.test(m[2])).map((m) => m[1]).join() !== DM.DEFAULT_SPACING) fail('layout', `the page should start on ${DM.DEFAULT_SPACING} spacing`);
    if (radios.map((m) => m[3]).join() !== 'Compact,Normal,Spread' || !html.includes('<label for="spacingSelect">Room spacing</label>')) fail('layout', 'the spacing choice should read Compact / Normal / Spread under "Room spacing"');
    if (!html.includes('<label for="hallDoorsSelect">Hallway doors</label>') || [...(html.match(/<select id="hallDoorsSelect"[\s\S]*?<\/select>/) || [''])[0].matchAll(/<option value="[a-z]+"[^>]*>([^<]*)<\/option>/g)].map((m) => m[1]).join() !== 'None,Less,More,All') fail('layout', 'the hallway doors choice should read None / Less / More / All');
    if (/type="radio" id="(spacing|doors)-/.test(html)) fail('layout', 'room spacing and hallway doors are still rows of segments');
    if (!html.includes('id="spacingHint"') || !html.includes('id="err-spacing"')) fail('layout', 'the spacing choice needs a hint and an error line');
    const hints = (appJs.match(/const SPACING_HINTS = \{[\s\S]*?\n  \};/) || [''])[0];
    for (const name of DM.SPACINGS) {
      const { min, max } = DM.SPACING_GAPS[name];
      const line = (hints.match(new RegExp(`${name}: '([^']*)'`)) || [])[1] || '';
      if (min === 0 ? !(/can touch/.test(line) && line.includes(`up to ${max} squares`)) : !(line.includes(`${min}–${max} squares`) && /rooms joined by a door, which touch/.test(line))) fail('layout', `the ${name} hint does not give its distances: "${line}"`);
    }
    // the other two-way choices that are dropdowns too: how rooms join, and what the picture holds on a dungeon of several levels
    for (const [name, id, wanted] of [['connectionType', 'connectionTypeSelect', 'Hallways,Doorways'], ['exportScope', 'exportScopeSelect', 'All levels,This level']]) {
      const sel = (html.match(new RegExp(`<select id="${id}" name="${name}"[^>]*>([\\s\\S]*?)<\\/select>`)) || [])[1];
      if (!sel || [...sel.matchAll(/<option value="[a-z]+"[^>]*>([^<]*)<\/option>/g)].map((m) => m[1]).join() !== wanted) fail('layout', `${name} should be a dropdown of ${wanted}`);
      if (new RegExp(`type="radio"[^>]*name="${name}"`).test(html)) fail('layout', `${name} is still a row of segments`);
      if (!appJs.includes(`$('${id}')`)) fail('layout', `app.js does not use the ${name} dropdown`);
    }
    if (!/id="exportScope" hidden/.test(html)) fail('layout', 'the picture choice should start hidden, for a dungeon of one level');
    if (!/params\.spacing = \$\('spacingSelect'\)\.value/.test(appJs) || !/params\.hallDoors = \$\('hallDoorsSelect'\)\.value/.test(appJs)) fail('layout', 'app.js does not read the spacing and the hallway doors');
    if (!/if \(form\.spacing !== undefined\) setSelect\('spacingSelect', form\.spacing\)/.test(appJs) || !/if \(form\.hallDoors !== undefined\) setSelect\('hallDoorsSelect', form\.hallDoors\)/.test(appJs)) fail('layout', 'opening a link or restoring settings does not set the spacing and the hallway doors');
    if (!/\$\('spacingSelect'\)\.addEventListener\('change', updateSpacingHint\)/.test(appJs) || !/\$\('hallDoorsSelect'\)\.addEventListener\('change', updateDoorsHint\)/.test(appJs)) fail('layout', 'choosing a spacing or hallway doors does not update its hint');
    if (!/showGroupError\('spacing'/.test(appJs)) fail('layout', 'a spacing error would not be shown');
  }
  // overall layout: a choice of exactly the layouts the generator knows, random on first, each with a hint, in the Layout column ahead of Rooms
  {
    // a dropdown (a select), not a row of chips
    const select = (html.match(/<select id="layoutSelect" name="layout"[^>]*>([\s\S]*?)<\/select>/) || [])[1];
    if (!select) fail('layout', 'the overall layout should be a select');
    const radios = [...(select || '').matchAll(/<option value="([a-z]+)"([^>]*)>([^<]*)<\/option>/g)];
    if (JSON.stringify(radios.map((m) => m[1])) !== JSON.stringify(DM.LAYOUTS)) fail('layout', `the page offers layouts [${radios.map((m) => m[1])}], the generator has [${DM.LAYOUTS}]`);
    if (radios.filter((m) => /\sselected/.test(m[2])).map((m) => m[1]).join() !== DM.DEFAULT_LAYOUT) fail('layout', `the page should start on the ${DM.DEFAULT_LAYOUT} layout`);
    for (const m of radios) {
      const name = m[1];
      if (m[3] !== (name === 'mainst' ? 'Main St.' : name[0].toUpperCase() + name.slice(1))) fail('layout', `the ${name} layout is called "${m[3]}"`);
    }
    if (/name="layout" value=|class="chip"[^>]*><input type="radio" name="layout"/.test(html)) fail('layout', 'the overall layout is still a row of chips');
    if (!html.includes('<label for="layoutSelect">Overall layout</label>') || !html.includes('id="layoutHint"') || !html.includes('id="err-layout"')) fail('layout', 'the layout choice needs a label, a hint and an error line');
    const hints = (appJs.match(/const LAYOUT_HINTS = \{[\s\S]*?\n  \};/) || [''])[0];
    for (const name of DM.LAYOUTS) if (!new RegExp(`${name}: '[^']{10,}'`).test(hints)) fail('layout', `the ${name} layout has no hint`);
    if (html.indexOf('name="layout"') > html.indexOf('name="spacing"')) fail('layout', 'the layout choice should come before room spacing');
    if (!/params\.layout = \$\('layoutSelect'\)\.value/.test(appJs)) fail('layout', 'app.js does not read the layout');
    if (!/if \(form\.layout !== undefined\) setSelect\('layoutSelect', form\.layout\)/.test(appJs)) fail('layout', 'opening a link or restoring settings does not set the layout');
    if (!/\$\('layoutSelect'\)\.addEventListener\('change', updateLayoutHint\)/.test(appJs)) fail('layout', 'choosing a layout does not update its hint');
    if (!/showGroupError\('layout'/.test(appJs)) fail('layout', 'a layout error would not be shown');
    if (!/updateLayoutHint\(\);/.test(appJs)) fail('layout', 'the layout hint is never updated');
    // src/layout.js is loaded before the generator, which uses it
    if (!(html.indexOf('src/layout.js') > 0 && html.indexOf('src/layout.js') < html.indexOf('src/generator.js'))) fail('layout', 'the page does not load layout.js before generator.js');
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
  if (!/\$\('generateRandom'\)\.addEventListener\('click', \(\) => ifEditsDiscarded\(\(\) => generate\(\{ randomSeed: true \}\)\)\)/.test(appJs)) fail('layout', 'Generate with random seed should ask for a random seed (after the edits warning)');
  if (!/if \(!openLink\(\)\) \{\s*restoreSettings\(\);\s*generate\(\);\s*\}/.test(appJs)) fail('layout', 'the first dungeon (page opening) should not fill the seed box, and kept settings come after a link');
  if (!/fillSeed && !randomSeed && check\.params\.seed === null/.test(appJs)) fail('layout', 'only a blank seed should be filled in, never one that was typed');
  if (!/if \(randomSeed \|\| \(fillBlankSeed && \$\('seed'\)\.value\.trim\(\) === ''\)\) \$\('seed'\)\.value = dungeon\.seed/.test(appJs)) fail('layout', 'the seed box should get the seed the dungeon was built from (always for the random button, only if blank otherwise)');
  // the name of the app is across the top of the map, not in the columns, and the map sits under it
  const NAME = 'Duckweed’s Dungeon Drafter'; // with the curly apostrophe the brand uses in print
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
  if (formAt < 0 || blades.some((m) => m.index < formAt) || html.indexOf('</form>') < blades[blades.length - 1].index) fail('layout', 'the five columns are not all inside the one form');
  console.log('  done');
}

console.log('== brand style (Duckweed’s Aeldara)');
{
  const fs = require('fs');
  const path = require('path');
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  const css = read('styles.css');
  const html = read('index.html');
  const appJs = read('src', 'app.js');
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // two themes of custom properties: Parchment on :root (the default), Dark under [data-theme="dark"]
  const parchmentBlock = noComments.match(/:root,\s*\[data-theme='parchment'\]\s*\{[^}]*\}/);
  const darkBlock = noComments.match(/\[data-theme='dark'\]\s*\{[^}]*\}/);
  if (!parchmentBlock || !darkBlock) fail('brand', 'styles.css needs a Parchment block on :root and a [data-theme="dark"] block');
  const prop = (block, name) => ((block[0].match(new RegExp(`--${name}:\\s*([^;]+);`)) || [])[1] || '').trim().toLowerCase();
  const PARCHMENT = { paper: '#f4ecd9', ink: '#2a211b', wine: '#6b1f1a', gold: '#b0843a', tint: '#e9dcbf', tint2: '#efe4cb', muted: '#5b4a3a', 'write-in': '#a89276', heading: '#6b1f1a', fill: '#6b1f1a', 'on-fill': '#f4ecd9' };
  const DARK = { paper: '#1f1814', stock: '#1a1410', ink: '#efe4cb', wine: '#b5503f', gold: '#b0843a', tint: '#30261f', tint2: '#3d2d22', muted: '#c2b29a', heading: '#d98f80', 'write-in': '#7d6a55', fill: '#d98f80', 'on-fill': '#1f1814' };
  for (const [name, want] of Object.entries(PARCHMENT)) if (parchmentBlock && prop(parchmentBlock, name) !== want) fail('brand', `Parchment --${name} is "${prop(parchmentBlock, name)}", the brand has ${want}`);
  for (const [name, want] of Object.entries(DARK)) if (darkBlock && prop(darkBlock, name) !== want) fail('brand', `Dark --${name} is "${prop(darkBlock, name)}", the brand has ${want}`);
  if (parchmentBlock && prop(parchmentBlock, 'stock') !== PARCHMENT.paper) fail('brand', 'the Parchment page ground should be paper');
  // every color is a custom property: none is written out anywhere else (the map's own swatches take --c-* from the map, and only fall back to custom properties)
  const outside = noComments.replace(parchmentBlock ? parchmentBlock[0] : '', '').replace(darkBlock ? darkBlock[0] : '', '');
  const literal = outside.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) || [];
  if (literal.length > 0) fail('brand', `styles.css writes colors outside the two themes: ${literal}`);
  // the page starts in Parchment, and the sheet and the ground are two different colors in Dark only
  if (!/\[data-theme='dark'\][\s\S]*color-scheme:\s*dark/.test(noComments)) fail('brand', 'the Dark theme should switch the browser controls to dark too');

  // rules of the house: square corners, no all caps, no drop shadows
  for (const m of noComments.matchAll(/border-radius:\s*([^;]+);/g)) if (m[1].trim() !== '0') fail('brand', `a corner is rounded: border-radius ${m[1].trim()}`);
  if (!/\*,\s*\*::before,\s*\*::after\s*\{\s*border-radius:\s*0;/.test(noComments)) fail('brand', 'every corner should be square, whatever is added later: styles.css needs a rule that sets border-radius: 0 on everything');
  if (/text-transform:\s*uppercase/.test(noComments) || /font-variant(-caps)?:\s*all-/.test(noComments)) fail('brand', 'nothing is set in all caps: use small caps');
  for (const m of noComments.matchAll(/box-shadow:\s*([^;]+);/g)) if (!/^inset\b/.test(m[1].trim())) fail('brand', `a drop shadow: box-shadow ${m[1].trim()}`);
  if (/drop-shadow\(/.test(noComments)) fail('brand', 'no drop shadows');

  // the type: Google Fonts, engraved small caps for the title, headings and the main buttons, Fell italic for hints, Crimson for the rest
  const fontsLink = (html.match(/<link rel="stylesheet" href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"/) || [])[1] || '';
  for (const family of ['Crimson+Pro', 'IM+Fell+English:ital@0;1', 'IM+Fell+English+SC']) if (!fontsLink.includes(`family=${family}`)) fail('brand', `the Google Fonts link has no ${family}`);
  if (!/display=swap/.test(fontsLink)) fail('brand', 'the fonts should swap in, so the page is readable before they arrive');
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = (selector) => ((noComments.match(new RegExp(`(?:^|\\})\\s*${escapeRe(selector)}\\s*\\{([^}]*)\\}`)) || [])[1] || '').replace(/\s+/g, ' ');
  for (const [name, want] of [['--font-display', "'IM Fell English SC'"], ['--font-fell', "'IM Fell English'"], ['--font-text', "'Crimson Pro'"]]) {
    if (!new RegExp(`${name}:\\s*${escapeRe(want)},\\s*Georgia, serif`).test(noComments)) fail('brand', `${name} should be ${want} with Georgia and serif behind it`);
  }
  for (const sel of ['.map-title', '.blade-toggle', '.colors h3, .export h3, .settings h3', '#generate, #generateRandom', '.toolbar button', '.dialog-buttons button', '.map-mark']) {
    if (!/font-family:\s*var\(--font-display\)/.test(rule(sel))) fail('brand', `${sel} should be set in the display face (IM Fell English SC)`);
  }
  for (const sel of ['.canvas-hint']) if (!/font-family:\s*var\(--font-fell\)/.test(rule(sel)) || !/font-style:\s*italic/.test(rule(sel))) fail('brand', `${sel} should be IM Fell English italic`);
  if (!/font-family:\s*var\(--font-text\)/.test(noComments.match(/html,\s*body\s*\{[^}]*\}/)[0])) fail('brand', 'everything else should be Crimson Pro');

  // rules and frames: a 2pt gold rule under the title, a 1pt one under headings, a double gold frame (1.5pt, 0.5pt, 5pt apart) round the map
  const token = (name) => ((noComments.match(new RegExp(`--${name}:\\s*([^;]+);`)) || [])[1] || '').trim();
  for (const [name, want] of [['stroke-chapter', '2pt'], ['stroke-section', '1pt'], ['stroke-frame-outer', '1.5pt'], ['stroke-frame-inner', '0.5pt'], ['space-frame-inset', '5pt'], ['tap', '44px']]) {
    if (token(name) !== want) fail('brand', `--${name} is "${token(name)}", the brand has ${want}`);
  }
  if (!/border-bottom:\s*var\(--stroke-chapter\) solid var\(--gold\)/.test(rule('.map-head'))) fail('brand', 'the title needs a 2pt gold rule under it');
  if (!/border-bottom:\s*var\(--stroke-section\) solid var\(--gold\)/.test(rule('.panel .blade-head'))) fail('brand', 'a panel heading needs a 1pt gold rule under it');
  if (!/border-bottom:\s*var\(--stroke-section\) solid var\(--gold\)/.test(rule('.colors h3, .export h3, .settings h3'))) fail('brand', 'a section heading needs a 1pt gold rule under it');
  if (!/border:\s*var\(--stroke-frame-outer\) solid var\(--gold\)/.test(rule('.map-frame')) || !/padding:\s*var\(--space-frame-inset\)/.test(rule('.map-frame'))) fail('brand', 'the map needs a 1.5pt gold outer frame, with the inner one 5pt in');
  if (!/border:\s*var\(--stroke-frame-inner\) solid var\(--gold\)/.test(rule('.map-frame-inner'))) fail('brand', 'the map needs a 0.5pt gold inner frame');
  if (!/<div class="map-frame"><div class="map-frame-inner">\s*<div class="map-area">\s*<canvas id="map"/.test(html)) fail('brand', 'the map canvas should sit inside the double frame');
  if (!/<header class="map-head">\s*<div class="map-head-name">\s*<h1 class="map-title">/.test(html)) fail('brand', 'the title should sit in the header that carries the 2pt rule');

  // selections are wine: the segment chosen and Generate with random seed are filled, Re-generate is an outline, chips on show a gold diamond, swatches are square with a gold outline on the one chosen
  if (!/background:\s*var\(--fill\)/.test(rule('.seg-options input:checked + label'))) fail('brand', 'the segment chosen should be filled wine');
  if (!/background:\s*var\(--fill\)/.test(rule('#generateRandom')) || !/color:\s*var\(--on-fill\)/.test(rule('#generateRandom'))) fail('brand', 'Generate with random seed should be filled wine (rose-wine with dark text in Dark)');
  if (!/background:\s*transparent/.test(rule('#generate')) || !/border:\s*1px solid var\(--wine\)/.test(rule('#generate'))) fail('brand', 'Re-generate dungeon should be a wine outline');
  if (!/content:\s*'\\25C6'/.test(rule('.chip-body::before'))) fail('brand', 'a chip should carry a diamond');
  if (!/color:\s*var\(--gold\)/.test(rule('.chip input:checked + .chip-body::before'))) fail('brand', 'the diamond on a chip that is on should be gold');
  if (!/outline:\s*var\(--stroke-frame-outer\) solid var\(--gold\)|outline:\s*1\.5pt solid var\(--gold\)/.test(noComments.match(/\.swatch input:checked \+ \.dot,\s*\.swatch\.custom\.active \.dot\s*\{[^}]*\}/)[0])) fail('brand', 'the swatch chosen should have a gold outline');
  if (/\.swatch[^{]*\.dot\s*\{[^}]*border-radius:\s*(?!0)/.test(noComments)) fail('brand', 'swatches should be square');
  if (/conic-gradient/.test(noComments)) fail('brand', 'wine and gold are the only accents: no rainbow picker swatch');

  // everything pressed or typed in is at least 44px tall
  if (!/height:\s*var\(--tap\)/.test(rule("input[type='number'], input[type='text']"))) fail('brand', 'inputs should be at least 44px tall');
  // the dropdown is an input's box, square, with a wine arrow and no shadow
  if (!/height:\s*var\(--tap\)/.test(rule('select')) || !/border:\s*1px solid var\(--write-in\)/.test(rule('select')) || !/border-radius:\s*0/.test(rule('select'))) fail('brand', 'a dropdown should be 44px tall with an input\'s square outline');
  if (!/appearance:\s*none/.test(rule('select')) || !/var\(--wine\)/.test(rule('select')) || /box-shadow:\s*(?!inset)/.test(rule('select'))) fail('brand', 'a dropdown should draw its own wine arrow, with no shadow');
  for (const sel of ['.seg-options label', '.chip-body', '.link-btn', '.check', '#generate, #generateRandom', '.export-buttons button', '.legend-toggle', '.dialog-buttons button', '.color-field .swatch', '.toggle-field label.switch']) {
    if (!/(min-)?height:\s*var\(--tap\)/.test(rule(sel))) fail('brand', `${sel} should be at least 44px tall`);
  }
  if (!/min-height:\s*var\(--tap\)/.test(rule('.blade-toggle')) && !/min-height:\s*(5\d|[6-9]\d)px/.test(rule('.blade-toggle'))) fail('brand', 'a column heading should be at least 44px tall');
  if (!/height:\s*var\(--tap\)/.test(rule('.toolbar button'))) fail('brand', 'the buttons on the map should be at least 44px tall');

  // print: the picture alone, and its page is light whatever the page theme is
  const printCss = css.slice(css.indexOf('@media print'));
  for (const hidden of ['.map-head', '.map-frame']) if (!printCss.includes(hidden)) fail('brand', `the print layout does not hide ${hidden}`);
  if (!/:root\s*\{\s*color-scheme:\s*light/.test(printCss)) fail('brand', 'the printout should be light even when the page is Dark');

  // the theme: a choice in the Display column, set before the page is drawn, kept apart from the other settings
  const headHtml = html.slice(0, html.indexOf('</head>'));
  if (!headHtml.includes('src/theme.js') || headHtml.indexOf('src/theme.js') < headHtml.indexOf('styles.css')) fail('brand', 'theme.js should be in the <head>, after the stylesheet, so the page never flashes the wrong theme');
  const displayColumn = html.slice(html.indexOf('data-blade="display"'), html.indexOf('<main class="stage">'));
  const themeRadios = [...displayColumn.matchAll(/<input type="radio" id="theme-(\w+)" name="theme" value="(\w+)"([^>]*)>/g)];
  if (JSON.stringify(themeRadios.map((m) => m[2])) !== JSON.stringify(['parchment', 'dark'])) fail('brand', `the Display column offers themes [${themeRadios.map((m) => m[2])}], not Parchment and Dark`);
  if (themeRadios.filter((m) => /\schecked/.test(m[3])).map((m) => m[2]).join() !== 'parchment') fail('brand', 'the page should start in Parchment');
  if (themeRadios.some((m) => m[1] !== m[2])) fail('brand', 'a theme radio has an id that does not match its value');
  if (!/DM\.saveTheme\(DM\.applyTheme\(radio\.value\)\)/.test(appJs)) fail('brand', 'app.js does not apply and keep the theme chosen');
  const resetAt = appJs.indexOf("$('resetSettings').addEventListener");
  if (/theme/i.test(appJs.slice(resetAt, appJs.indexOf('\n  });', resetAt)))) fail('brand', 'Reset all should leave the theme alone, like the collapsed columns');
  const settingsFn = (appJs.match(/function settingsText\(\) \{[\s\S]*?\n  \}/) || [''])[0];
  if (!settingsFn || /theme/i.test(settingsFn) || /theme/i.test(read('src', 'share.js'))) fail('brand', 'the theme belongs to the viewer: it must not be in the kept settings or a share link');
  if (read('mcp', 'lib', 'dm.js').includes("'theme'")) fail('brand', 'theme.js is for the page; the MCP server should not load it');

  // theme.js itself (a stand-in for the page's document and storage)
  {
    const had = { document: globalThis.document, localStorage: globalThis.localStorage };
    delete globalThis.document;
    delete globalThis.localStorage;
    require('../src/theme.js'); // with no page, loading it changes nothing
    const store = new Map();
    const attrs = {};
    globalThis.document = { documentElement: { setAttribute: (k, v) => (attrs[k] = v) } };
    globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
    if (JSON.stringify(DM.THEMES) !== JSON.stringify(['parchment', 'dark']) || DM.DEFAULT_THEME !== 'parchment') fail('brand', `themes are [${DM.THEMES}], default ${DM.DEFAULT_THEME}`);
    if (DM.savedTheme() !== 'parchment') fail('brand', 'with nothing kept, the page should be Parchment');
    if (DM.applyTheme('dark') !== 'dark' || attrs['data-theme'] !== 'dark') fail('brand', 'applying Dark should set data-theme="dark" on <html>');
    if (DM.applyTheme('sepia') !== 'parchment' || attrs['data-theme'] !== 'parchment') fail('brand', 'an unknown theme should fall back to Parchment');
    DM.saveTheme('dark');
    if (store.get(DM.THEME_KEY) !== 'dark' || DM.savedTheme() !== 'dark') fail('brand', 'the theme chosen should be kept and come back');
    DM.saveTheme('sepia');
    if (store.get(DM.THEME_KEY) !== 'dark') fail('brand', 'an unknown theme should not be kept');
    for (const junk of ['', 'DARK', '{"a":1}', 'null']) {
      store.set(DM.THEME_KEY, junk);
      if (DM.savedTheme() !== 'parchment') fail('brand', `"${junk}" kept as the theme should mean Parchment`);
    }
    globalThis.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    if (DM.savedTheme() !== 'parchment') fail('brand', 'blocked storage should mean Parchment');
    DM.saveTheme('dark'); // must not throw
    if (DM.THEME_KEY === 'dungeonMaker.settings' || DM.THEME_KEY === 'dungeonMaker.collapsedColumns') fail('brand', 'the theme needs a storage key of its own');
    for (const k of ['document', 'localStorage']) {
      if (had[k] === undefined) delete globalThis[k];
      else globalThis[k] = had[k];
    }
  }
  console.log('  done');
}

/** Two 3 x 3 rooms with `gap` empty squares between them, and an entrance in the west wall of the first. */
function hallFixture(gap = 3, hallDoors = 'all') {
  const sq = (x0, y0, w, h) => {
    const c = [];
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) c.push([x, y]);
    return c;
  };
  const room = (id, x, y, w, h) => ({ id, label: id + 1, kind: 'rect', area: w * h, bbox: { x, y, w, h }, labelCell: [x + 1, y + 1], cells: sq(x, y, w, h) });
  return {
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

/** The things that must hold for a dungeon whose hallways were drawn and deleted (and for one just generated). */
function checkEdited(dun, ctx) {
  const at = new Map(); // "x,y" -> 'r<id>' or 'h<id>'
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const put = (x, y, v) => {
    const k = `${x},${y}`;
    if (at.has(k)) fail(ctx, `(${x},${y}) is both ${at.get(k)} and ${v}`);
    at.set(k, v);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const r of dun.rooms) for (const [x, y] of r.cells) put(x, y, `r${r.id}`);
  dun.halls.forEach((h, i) => {
    if (h.id !== i) fail(ctx, `hall at index ${i} has id ${h.id}`);
    for (const [x, y] of h.cells) put(x, y, `h${i}`);
  });
  if (minX !== 0 || minY !== 0 || maxX !== dun.width - 1 || maxY !== dun.height - 1) fail(ctx, `the map is ${dun.width} x ${dun.height} but its squares reach ${minX},${minY} to ${maxX},${maxY}`);
  // each hallway is one piece, and none touches another
  dun.halls.forEach((h, i) => {
    if (h.cells.length === 0) fail(ctx, `hall ${i} has no squares`);
    const seen = new Set([`${h.cells[0][0]},${h.cells[0][1]}`]);
    const stack = [h.cells[0]];
    while (stack.length) {
      const [x, y] = stack.pop();
      for (let d = 0; d < 4; d++) {
        const k = `${x + DX[d]},${y + DY[d]}`;
        const v = at.get(k);
        if (v === `h${i}` && !seen.has(k)) {
          seen.add(k);
          stack.push(k.split(',').map(Number));
        } else if (v && v[0] === 'h' && v !== `h${i}`) {
          fail(ctx, `hall ${i} touches hall ${v.slice(1)} at ${k}`);
        }
      }
    }
    if (seen.size !== h.cells.length) fail(ctx, `hall ${i} is not in one piece`);
  });
  // connections: ids, hallways, what each serves
  const edges = new Set();
  let hallConns = 0;
  dun.connections.forEach((c, i) => {
    if (c.id !== i) fail(ctx, `connection at index ${i} has id ${c.id}`);
    for (const o of c.openings) {
      const k = `${o.x},${o.y},${o.d}`;
      if (edges.has(k)) fail(ctx, `two openings at ${k}`);
      edges.add(k);
    }
    if (c.type === 'door') {
      if (c.hall !== null) fail(ctx, `door connection ${i} has a hall`);
      return;
    }
    hallConns++;
    const h = dun.halls[c.hall];
    if (!h || h.connection !== i) {
      fail(ctx, `hall connection ${i} and its hall do not point at each other`);
      return;
    }
    const served = [...new Set(c.openings.map((o) => o.room))].sort((a, b) => a - b);
    if (JSON.stringify(served) !== JSON.stringify(c.rooms.slice().sort((a, b) => a - b)) || JSON.stringify(h.rooms) !== JSON.stringify(c.rooms)) {
      fail(ctx, `hall ${c.hall} says it serves [${h.rooms}] / [${c.rooms}] but its openings are into [${served}]`);
    }
    for (const o of c.openings) {
      if (at.get(`${o.x},${o.y}`) !== `r${o.room}`) fail(ctx, `hall ${c.hall}: opening ${o.x},${o.y} is not a square of room ${o.room}`);
      if (at.get(`${o.x + DX[o.d]},${o.y + DY[o.d]}`) !== `h${c.hall}`) fail(ctx, `hall ${c.hall}: opening ${o.x},${o.y},${o.d} does not lead into the hall`);
      if (o.style !== 'door' && o.style !== 'open') fail(ctx, `hall ${c.hall}: opening style ${o.style}`);
      if (dun.params.hallDoors === 'none' && o.style !== 'open') fail(ctx, 'an opening has a door although hallway doors are off');
      if (dun.params.hallDoors === 'all' && o.style !== 'door') fail(ctx, 'an opening is open although every hallway opening has a door');
    }
  });
  if (hallConns !== dun.halls.length) fail(ctx, `${dun.halls.length} halls but ${hallConns} hall connections`);
  // entrances stay on rooms and are not built in front of
  for (const e of dun.entrances) {
    if (at.get(`${e.x},${e.y}`) !== `r${e.room}`) fail(ctx, `entrance ${e.label} is not on a square of its room`);
    if (e.kind === 'door' && at.has(`${e.x + DX[e.d]},${e.y + DY[e.d]}`)) fail(ctx, `entrance ${e.label} has something built in front of its door`);
  }
  const s = dun.stats;
  if (s.hallConnections !== dun.halls.length || s.floorCells !== at.size || s.doorConnections !== dun.connections.length - hallConns) {
    fail(ctx, `stats say ${s.hallConnections} halls, ${s.floorCells} squares, ${s.doorConnections} doorways`);
  }
  if (JSON.stringify(JSON.parse(JSON.stringify(dun))) !== JSON.stringify(dun)) fail(ctx, 'the dungeon does not survive being saved as JSON');
}

console.log('== hallway editing');
{
  const ok = (cond, msg) => cond || fail('halls', msg);
  const sorted = (cells) => cells.map(([x, y]) => `${x},${y}`).sort().join(' ');
  const hallCells = (d) => sorted(d.halls.flatMap((h) => h.cells));
  const between = [[3, 1], [4, 1], [5, 1]]; // a hallway across the gap of the fixture

  // a hallway between two rooms
  {
    const d = hallFixture();
    checkEdited(d, 'fixture');
    const plan = DM.planHallway(d, between);
    ok(sorted(plan.floor) === '3,1 4,1 5,1', `the plan has squares ${sorted(plan.floor)}`);
    ok(JSON.stringify(plan.openings.map((o) => [o.x, o.y, o.d, o.room, o.style])) === JSON.stringify([[2, 1, 1, 0, 'door'], [6, 1, 3, 1, 'door']]), `a hallway between rooms opens ${JSON.stringify(plan.openings)}`);
    ok(d.halls.length === 0 && d.connections.length === 0, 'planning changed the dungeon');
    const before = DM.editState(d);
    const r = DM.addHallway(d, between);
    ok(r.ok && r.dx === 0 && r.dy === 0, `adding failed: ${JSON.stringify(r)}`);
    ok(d.halls.length === 1 && d.halls[0].kind === 'drawn' && JSON.stringify(d.halls[0].rooms) === '[0,1]' && d.connections[0].openings.length === 2, 'a hallway joining two rooms is one hall that serves both');
    ok(d.stats.hallConnections === 1 && d.stats.hallLinks === 1 && d.stats.floorCells === 21, `stats after drawing: ${JSON.stringify(d.stats)}`);
    checkEdited(d, 'hall between rooms');
    ok(DM.editState(d) !== before, 'drawing a hallway did not change the edit state');
    ok(!DM.addHallway(d, between).ok, 'a hallway drawn twice was added twice');
    // with doors off the openings are archways
    const none = hallFixture(3, 'none');
    DM.addHallway(none, between);
    ok(none.connections[0].openings.every((o) => o.style === 'open'), 'with Hallway doors on None a new opening has a door');
    // the same stroke from inside the rooms, through their walls: the same hallway
    const through = hallFixture();
    DM.addHallway(through, [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1]]);
    ok(hallCells(through) === hallCells(d) && DM.editState(through) === DM.editState(d), 'a stroke through the rooms should make the same hallway as one between them');
    // running along a wall opens nothing; heading into one does
    const along = hallFixture();
    DM.addHallway(along, [[3, 0], [3, 1], [3, 2]]);
    ok(along.halls.length === 1 && along.connections[0].openings.length === 0 && along.halls[0].rooms.length === 0, 'a hallway running along a wall opened it');
    DM.addHallway(along, [[3, 1], [2, 1]]); // (2,1) is a square of room 0: heading into its wall from the hallway
    ok(along.connections[0].openings.length === 1 && along.connections[0].openings[0].d === 1 && JSON.stringify(along.halls[0].rooms) === '[0]', 'heading into a wall from a hallway should open it');
    // a side door in the middle of a straight run is a junction: it splits the run into stretches
    ok(sorted(DM.hallStretchAt(along, 3, 0)) === '3,0' && sorted(DM.hallStretchAt(along, 3, 1)) === '3,1' && sorted(DM.hallStretchAt(along, 3, 2)) === '3,2', `a side door should split a straight run: ${sorted(DM.hallStretchAt(along, 3, 0))}`);
    const sideGone = DM.deleteHallStretch(along, 3, 0);
    ok(sideGone.ok && hallCells(along) === '3,1 3,2' && along.connections[0].openings.length === 1, 'deleting the stretch before a side door should leave the door and the rest of the run');
    checkEdited(along, 'side door');
    // a single square between two rooms joins both
    const tight = hallFixture(1);
    DM.addHallway(tight, [[3, 1]]);
    ok(tight.halls.length === 1 && JSON.stringify(tight.halls[0].rooms) === '[0,1]', 'one square between two rooms should open into both');
    checkEdited(tight, 'single square');
  }

  // branching, a dead end, and what cannot be drawn on
  {
    const d = hallFixture();
    DM.addHallway(d, between);
    const built = DM.editState(d);
    const r = DM.addHallway(d, [[4, 1], [4, 0], [4, -1], [4, -2]]); // from the middle of the hallway, up past the top of the map
    ok(r.ok && r.dx === 0 && r.dy === 2, `a branch past the top of the map: ${JSON.stringify(r)}`);
    ok(d.height === 5 && d.halls.length === 1 && d.halls[0].cells.length === 6 && JSON.stringify(d.halls[0].rooms) === '[0,1]', 'a branch should be part of the hallway it starts from');
    ok(d.rooms[0].cells[0][1] === 2 && d.rooms[0].bbox.y === 2 && d.entrances[0].y === 3 && d.rooms[0].labelCell[1] === 3, 'the map grew upwards but the rooms and entrance did not move with it');
    checkEdited(d, 'branch');
    // stretches: from a junction to the next, or to a dead end
    ok(sorted(DM.hallStretchAt(d, 4, 1)) === '4,0 4,1 4,2', `the stretch of the branch is ${sorted(DM.hallStretchAt(d, 4, 1))}`);
    ok(sorted(DM.hallStretchAt(d, 4, 3)) === '4,3', 'a junction is a stretch of its own');
    ok(sorted(DM.hallStretchAt(d, 3, 3)) === '3,3', 'the stretch beside a junction stops at it');
    ok(DM.hallStretchAt(d, 0, 0) === null && DM.hallStretchAt(d, 4, -5) === null, 'a square that is not hallway has a stretch');
    // deleting the branch takes the map back to what it was
    const gone = DM.deleteHallStretch(d, 4, 1);
    ok(gone.ok && gone.dy === -2 && d.height === 3 && DM.editState(d) === built, 'deleting the branch should leave the dungeon as it was before it');
    checkEdited(d, 'branch deleted');
    // deleting a junction splits the hallway into pieces, each keeping its own rooms
    DM.addHallway(d, [[4, 1], [4, 0], [4, -1], [4, -2]]);
    const split = DM.deleteHallStretch(d, 4, 3);
    ok(split.ok && d.halls.length === 3, `deleting the junction left ${d.halls.length} pieces`);
    ok(JSON.stringify(d.halls.map((h) => h.rooms).sort()) === JSON.stringify([[], [0], [1]]), `the pieces serve ${JSON.stringify(d.halls.map((h) => h.rooms))}`);
    ok(d.stats.hallConnections === 3 && d.stats.hallLinks === 0, `stats after the split: ${JSON.stringify(d.stats)}`);
    checkEdited(d, 'split');
    // a stretch that holds both doors takes them with it
    const plain = hallFixture();
    DM.addHallway(plain, between);
    ok(DM.deleteHallStretch(plain, 4, 1).ok && plain.halls.length === 0 && plain.connections.length === 0 && DM.editState(plain) === DM.editState(hallFixture()), 'deleting a whole hallway should leave no doors behind');
    ok(!DM.deleteHallStretch(plain, 4, 1).ok, 'deleted a hallway that was not there');
    // squares only touching a hallway join it
    const touch = hallFixture();
    DM.addHallway(touch, between);
    DM.addHallway(touch, [[4, 0], [4, -1]]);
    ok(touch.halls.length === 1, 'squares next to a hallway should be part of it');
    // a hallway that goes nowhere is allowed: it serves no rooms
    const dead = hallFixture();
    const lone = DM.addHallway(dead, [[4, 0], [4, 1]]);
    ok(lone.ok && dead.halls.length === 1 && dead.halls[0].rooms.length === 0 && dead.connections[0].openings.length === 0, 'a dead-end hallway touching nothing should be kept');
    checkEdited(dead, 'dead end');
    // nowhere to draw: on rooms, or just outside an entrance door
    const shut = hallFixture();
    ok(!DM.addHallway(shut, [[1, 1], [2, 1]]).ok, 'a hallway was drawn on a room');
    ok(!DM.addHallway(shut, [[-1, 1]]).ok, 'a hallway was drawn in front of an entrance door');
    const skip = DM.planHallway(shut, [[-1, 0], [-1, 1], [-1, 2]]);
    ok(sorted(skip.floor) === '-1,0 -1,2', 'the square in front of an entrance door should be left out of a stroke');
    ok(DM.editState(shut) === DM.editState(hallFixture()), 'a refused stroke changed the dungeon');
    // the map has a limit
    const huge = hallFixture();
    const stroke = [];
    for (let x = 9; x < 9 + DM.MAX_SIDE + 5; x++) stroke.push([x, 1]);
    const refused = DM.addHallway(huge, stroke);
    ok(!refused.ok && DM.editState(huge) === DM.editState(hallFixture()), 'a hallway that makes the map too big should be refused and leave it alone');
  }

  // the doors a stroke opens do not depend on the stroke, only on where the wall is
  {
    const a = DM.planHallway(hallFixture(3, 'less'), between).openings.map((o) => o.style).join();
    const b = DM.planHallway(hallFixture(3, 'less'), [[3, 1], [4, 1], [4, 0], [4, 1], [5, 1]]).openings.map((o) => o.style).join();
    ok(a === b, 'the same wall got different doors for different strokes');
    const styles = new Set();
    const tall = hallFixture(3, 'less');
    tall.rooms[0].cells = [];
    for (let y = 0; y < 60; y++) tall.rooms[0].cells.push([0, y]); // a long wall, for the chance to show both
    tall.entrances = [];
    for (let y = 0; y < 60; y++) styles.add(DM.planHallway(tall, [[1, y]]).openings.map((o) => o.style).join());
    ok(styles.has('door') && styles.has('open'), `Hallway doors "less" should give both doors and archways, got ${[...styles]}`);
  }

  // many random strokes and deletions, on dungeons of every kind: everything stays consistent
  {
    const rng = new DM.Rng('hall-edit-fuzz');
    let strokes = 0;
    let deletes = 0;
    let removed = 0;
    for (let n = 0; n < 24; n++) {
      const dun = DM.generateDungeon({
        roomCount: rng.int(2, 18),
        avgRoomSize: rng.pick([9, 16, 30, 50]),
        sizeVariance: 30,
        entrances: rng.int(1, 4),
        connectionType: rng.pick(['hall', 'door']),
        connectionRandomness: rng.pick([0, 14, 50]),
        edgeEntrancesOnly: rng.pick([true, false]),
        hallDoors: rng.pick(['none', 'less', 'more', 'all']),
        spacing: rng.pick(DM.SPACINGS),
        seed: `hall-fuzz-${n}`,
      });
      const ctx = `edit fuzz ${n}`;
      checkEdited(dun, `${ctx} as built`);
      let doors = dun.connections.filter((c) => c.type === 'door').length;
      const count = () => dun.halls.reduce((t, h) => t + h.cells.length, 0);
      for (let op = 0; op < 14; op++) {
        const cells = dun.halls.flatMap((h) => h.cells);
        const openings = dun.connections.flatMap((c) => c.openings);
        if (openings.length > 0 && rng.chance(0.2)) {
          // a door (of any kind) taken out: its opening goes, the squares of the hallways stay, and so do the rooms and the other doors
          const o = rng.pick(openings);
          const squares = count();
          const total = openings.length;
          const before = DM.editState(dun);
          const res = DM.removeOpening(dun, o);
          removed++;
          if (!res.ok || res.dx !== 0 || res.dy !== 0 || count() !== squares || dun.connections.flatMap((c) => c.openings).length !== total - 1 || dun.connections.some((c) => c.openings.includes(o)) || DM.editState(dun) === before) fail(ctx, 'a removed door did not leave exactly the other openings');
          doors = dun.connections.filter((c) => c.type === 'door').length;
        } else if (cells.length > 0 && rng.chance(0.3)) {
          const [x, y] = rng.pick(cells);
          const before = count();
          const res = DM.deleteHallStretch(dun, x, y);
          deletes++;
          if (!res.ok || count() !== before - res.removed.length) fail(ctx, 'a deleted stretch did not leave exactly the other squares');
        } else {
          let x = rng.int(-3, dun.width + 2);
          let y = rng.int(-3, dun.height + 2);
          let dir = rng.int(0, 3);
          const stroke = [[x, y]];
          for (let i = rng.int(0, 30); i > 0; i--) {
            if (rng.chance(0.3)) dir = rng.int(0, 3);
            x += DX[dir];
            y += DY[dir];
            stroke.push([x, y]);
          }
          const before = count();
          const plan = DM.planHallway(dun, stroke);
          const res = DM.addHallway(dun, stroke);
          strokes++;
          if (res.ok) {
            if (count() !== before + plan.floor.length) fail(ctx, `a stroke planned ${plan.floor.length} new squares and made ${count() - before}`);
            const have = new Set(dun.connections.flatMap((c) => c.openings.map((o) => `${o.x},${o.y},${o.d},${o.style}`)));
            for (const o of plan.openings) if (!have.has(`${o.x + res.dx},${o.y + res.dy},${o.d},${o.style}`)) fail(ctx, `a planned opening ${o.x},${o.y},${o.d} was not made`);
          }
        }
        checkEdited(dun, `${ctx} op ${op}`);
        if (dun.connections.filter((c) => c.type === 'door').length !== doors) fail(ctx, 'editing hallways changed the doorways');
        if (DM.removeOpening(dun, { x: -9, y: -9, d: 0, style: 'door' }).ok) fail(ctx, 'an opening that is not there was removed');
      }
    }
    console.log(`  ${strokes} strokes, ${deletes} deletions and ${removed} removed doors on 24 dungeons`);
  }
  console.log('  done');
}

console.log('== editing several levels');
{
  const ok = (cond, msg) => cond || fail('lvedit', msg);
  const base = { roomCount: 8, avgRoomSize: 20, sizeVariance: 30, entrances: 2, connectionType: 'hall', levels: 3, levelStairs: 2 };
  const key = (x, y) => `${x},${y}`;
  // everything that has to hold for a dungeon of several levels, edited or not
  const check = (dun, ctx) => {
    const floors = [dun, ...dun.floors];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (x, y) => {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    };
    floors.forEach((f, n) => {
      const used = new Set();
      const use = (x, y) => {
        if (used.has(key(x, y))) fail(ctx, `level ${n + 1}: (${x},${y}) is used twice`);
        used.add(key(x, y));
        grow(x, y);
      };
      for (const r of f.rooms) for (const [x, y] of r.cells) use(x, y);
      f.halls.forEach((h, i) => {
        ok(h.id === i, `${ctx}: level ${n + 1} hall ${i} has id ${h.id}`);
        for (const [x, y] of h.cells) use(x, y);
      });
      ok(f.width === dun.width && f.height === dun.height, `${ctx}: level ${n + 1} is not in the one box`);
      f.connections.forEach((c, i) => ok(c.id === i, `${ctx}: level ${n + 1} connection ${i} has id ${c.id}`));
      ok((n === 0) === (f.entrances.length > 0), `${ctx}: level ${n + 1} has ${f.entrances.length} entrances`);
    });
    ok(x0 === 0 && y0 === 0 && x1 === dun.width - 1 && y1 === dun.height - 1, `${ctx}: the map is ${dun.width} x ${dun.height} but the squares reach ${x0},${y0} to ${x1},${y1}`);
    for (const st of dun.stairs) {
      for (const [level, room] of [[st.upper, st.upperRoom], [st.lower, st.lowerRoom]]) {
        const f = DM.floorView(dun, level);
        ok(f.rooms[room].cells.some(([x, y]) => x === st.x && y === st.y), `${ctx}: stair ${st.letter} is not in room ${room} of level ${level}`);
        for (const c of f.connections) for (const o of c.openings) if (o.x === st.x && o.y === st.y) fail(ctx, `stair ${st.letter} has a door into it on level ${level}`);
      }
    }
    // a room's number is not under the badge of a stair, unless nothing in the room is clear of it
    for (let level = 1; level <= dun.levels; level++) {
      const f = DM.floorView(dun, level);
      for (const r of f.rooms) {
        if (DM.labelHitsStair(r, r.labelCell, f.stairs) && DM.labelCandidates(r.cells).some((c) => !DM.labelHitsStair(r, c, f.stairs))) fail(ctx, `the number of room ${level}-${r.label} is under a stair`);
      }
    }
  };
  const firstCells = (dun) => JSON.stringify([dun, ...dun.floors].map((f) => f.rooms.map((r) => r.cells[0])));

  let strokes = 0;
  let moved = 0;
  for (let i = 0; i < 20; i++) {
    const dun = DM.generateDungeon({ ...base, layout: ['random', 'gauntlet', 'wide'][i % 3], seed: `lvedit-${i}` });
    const ctx = `lvedit ${i}`;
    check(dun, ctx);
    const was = DM.editState(dun);
    const peek = DM.floorView(dun, 2);
    ok(peek._model === dun && !Object.keys(peek).includes('_model') && !JSON.stringify(peek).includes('_model'), 'a floor view should know its dungeon without showing it');
    for (let op = 0; op < 8; op++) {
      const level = 1 + ((i + op) % 3);
      const view = DM.floorView(dun, level);
      const before = firstCells(dun);
      const stairsBefore = dun.stairs.map((st) => [st.x, st.y]);
      let res;
      if (op % 4 === 3 && view.halls.length > 0) {
        res = DM.deleteHall(view, view.halls[0].id);
      } else {
        // a stroke from a room out past the top left of the map, so that the map has to grow, or one across the middle
        const from = view.rooms[op % view.rooms.length].cells[0];
        const to = op % 2 === 0 ? [-3 - op, -2] : [from[0] + 4, from[1] + 2];
        res = DM.addHallway(view, [from, ...DM.walkCells(from, to)]);
        strokes++;
      }
      if (!res.ok) continue;
      if (res.dx || res.dy) {
        moved++;
        // every room on every level, and every stair, moved the same way
        const want = JSON.stringify(JSON.parse(before).map((lv) => lv.map(([x, y]) => [x + res.dx, y + res.dy])));
        ok(firstCells(dun) === want, `${ctx} op ${op}: the floors did not all move by (${res.dx},${res.dy})`);
        dun.stairs.forEach((st, k) => ok(st.x === stairsBefore[k][0] + res.dx && st.y === stairsBefore[k][1] + res.dy, `${ctx}: stair ${st.letter} did not move with the map`));
      }
      check(dun, `${ctx} op ${op}`);
      // the new hallways are the floor's own
      ok(DM.floorView(dun, level).halls === (level > 1 ? dun.floors[level - 2].halls : dun.halls), `${ctx}: the new hallways are not in the dungeon`);
    }
    ok(DM.editState(dun) !== was, `${ctx}: edits did not show in the edit state`);
    // written as data it is the edited dungeon
    ok(JSON.stringify(JSON.parse(DM.dungeonJson(dun))) === JSON.stringify(dun), `${ctx}: the data does not hold the edited dungeon`);
  }
  console.log(`  ${strokes} strokes on 20 dungeons of 3 levels (and deletions), the map moved ${moved} times`);

  // a door changed on level 2 shows in the dungeon, and is an edit; a room name too
  {
    const dun = DM.generateDungeon({ ...base, seed: 'lvedit-door' });
    const was = DM.editState(dun);
    const floor = DM.floorView(dun, 2);
    const op = floor.connections.flatMap((c) => c.openings)[0];
    op.style = op.style === 'locked' ? 'door' : 'locked';
    ok(DM.editState(dun) !== was, 'a changed door on level 2 is not an edit');
    const again = DM.editState(dun);
    DM.floorView(dun, 3).rooms[0].name = 'Vault';
    ok(DM.editState(dun) !== again, 'a name on level 3 is not an edit');
  }

  // entrances are on level 1 only, and nothing is put on a stair square
  {
    const dun = DM.generateDungeon({ ...base, seed: 'lvedit-ent' });
    const room = DM.floorView(dun, 2).rooms[0];
    const r = DM.addEntrance(DM.floorView(dun, 2), 'stairs', room.cells[0][0], room.cells[0][1], 0);
    ok(!r.ok && /level 1/.test(r.reason), `an entrance on level 2: ${JSON.stringify(r)}`);
    const st = dun.stairs.find((x) => x.upper === 1);
    const r2 = DM.addEntrance(DM.floorView(dun, 1), 'stairs', st.x, st.y, 0);
    ok(!r2.ok && /another level/.test(r2.reason), `an entrance on a stair: ${JSON.stringify(r2)}`);
    // a hallway square beside a stair's room square makes no door into the stair square
    const f1 = DM.floorView(dun, 1);
    const stairRoom = f1.rooms[st.upperRoom];
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const x = st.x + dx;
      const y = st.y + dy;
      if (stairRoom.cells.some(([cx, cy]) => cx === x && cy === y)) continue;
      const plan = DM.planHallway(f1, [[x, y]]);
      ok(!plan.openings.some((o) => o.x === st.x && o.y === st.y), 'a hallway planned a door into a stair square');
    }
  }
  // a room's number keeps clear of the badge of a stair, and goes back to the middle when the stair is gone
  {
    let tried = 0, moved = 0;
    for (let i = 0; i < 20; i++) {
      const dun = DM.generateDungeon({ ...base, levelStairs: 2, roomCount: 6, avgRoomSize: 40, seed: `lvlabel-${i}` });
      const ctx = `lvlabel ${i}`;
      const f1 = DM.floorView(dun, 1);
      for (const r of f1.rooms) {
        const [lx, ly] = r.labelCell;
        const middle = r.labelCell.slice();
        // a stair square beside the number (the next square across, or the one above)
        const spot = [[lx + 1, ly], [lx - 1, ly], [lx, ly + 1], [lx, ly - 1]].find(([x, y]) => DM.stairProblem(dun, 1, x, y).ok);
        if (!spot) continue;
        tried++;
        const added = DM.addStair(DM.floorView(dun, 1), 1, spot[0], spot[1]);
        ok(added.ok, `${ctx}: a stair beside a number was refused`);
        if (!added.ok) continue;
        const now = DM.floorView(dun, 1);
        const room = now.rooms[r.id];
        const free = DM.labelCandidates(room.cells).some((c) => !DM.labelHitsStair(room, c, now.stairs));
        ok(!free || !DM.labelHitsStair(room, room.labelCell, now.stairs), `${ctx}: the number of room ${r.label} is still under the stair badge`);
        if (room.labelCell[0] !== middle[0] || room.labelCell[1] !== middle[1]) moved++;
        check(dun, `${ctx} stair beside a number`);
        const gone = DM.removeStair(DM.floorView(dun, 1), added.stair.letter);
        ok(gone.ok, `${ctx}: the stair beside a number could not be removed`);
        if (gone.ok) ok(DM.floorView(dun, 1).rooms[r.id].labelCell.join() === middle.join(), `${ctx}: the number of room ${r.label} did not go back to the middle`);
        break;
      }
    }
    ok(tried > 0 && moved > 0, `no number was ever moved for a stair (${tried} tried, ${moved} moved)`);
    console.log(`  numbers and stairs: ${tried} stairs put beside a number, ${moved} numbers moved`);
  }

  // editing the stairs themselves
  {
    let added = 0, moves = 0, removed = 0, refused = 0;
    for (let i = 0; i < 20; i++) {
      const dun = DM.generateDungeon({ ...base, levelStairs: 1 + (i % 3), layout: ['random', 'gauntlet', 'wide'][i % 3], seed: `lvstair-${i}` });
      const ctx = `lvstair ${i}`;
      const was = DM.editState(dun);
      const spots = (upper, except) => {
        const out = [];
        for (let y = 0; y < dun.height; y++) for (let x = 0; x < dun.width; x++) if (DM.stairProblem(dun, upper, x, y, except).ok) out.push([x, y]);
        return out;
      };
      // a stair between each pair of levels, on a square that works
      for (const upper of [1, 2]) {
        const where = spots(upper);
        if (where.length === 0) continue;
        const [x, y] = where[Math.floor(where.length / 2)];
        const view = DM.floorView(dun, upper);
        const res = DM.addStair(view, upper, x, y);
        ok(res.ok, `${ctx}: a square that works was refused: ${JSON.stringify(res)}`);
        if (!res.ok) continue;
        added++;
        ok(dun.stairs.some((s) => s.letter === res.stair.letter && s.x === x && s.y === y && s.upper === upper && s.lower === upper + 1), `${ctx}: the new stair is not in the dungeon`);
        ok(new Set(dun.stairs.map((s) => s.letter)).size === dun.stairs.length, `${ctx}: stair letters repeat`);
        ok(dun.stairs.every((s, k) => s.id === k) && dun.stats.stairs === dun.stairs.length, `${ctx}: stair ids or the count are wrong`);
        ok(view.stairs.some((s) => s.letter === res.stair.letter), `${ctx}: the floor view does not list the new stair`);
        check(dun, `${ctx} added`);
        // the same square is taken now, on this pair of levels and the next one that shares a floor
        ok(!DM.stairProblem(dun, upper, x, y).ok, `${ctx}: two stairs on one square`);
        // move it somewhere else
        const elsewhere = spots(upper, res.stair).find(([sx, sy]) => sx !== x || sy !== y);
        if (elsewhere) {
          const mv = DM.moveStair(view, res.stair.letter, elsewhere[0], elsewhere[1]);
          ok(mv.ok && mv.stair.x === elsewhere[0] && mv.stair.upper === upper, `${ctx}: moving a stair failed: ${JSON.stringify(mv)}`);
          moves++;
          check(dun, `${ctx} moved`);
        }
      }
      // a square that is not a room square on both floors is refused, with a reason; so is anything out of range
      const bad = DM.stairProblem(dun, 1, -1, -1);
      ok(!bad.ok && /not a room square/.test(bad.reason), `${ctx}: a square outside the map: ${JSON.stringify(bad)}`);
      ok(!DM.stairProblem(dun, 3, 0, 0).ok && !DM.stairProblem(dun, 0, 0, 0).ok, `${ctx}: levels out of range`);
      ok(!DM.addStair(DM.floorView(dun, 1), 1, -1, -1).ok, `${ctx}: stairs were added outside the rooms`);
      // a door or an entrance square is refused
      const f1 = DM.floorView(dun, 1);
      const entrance = f1.entrances[0];
      ok(!DM.stairProblem(dun, 1, entrance.x, entrance.y).ok, `${ctx}: stairs on an entrance`);
      const doorway = f1.connections.flatMap((c) => c.openings)[0];
      if (doorway) ok(!DM.stairProblem(dun, 1, doorway.x, doorway.y).ok, `${ctx}: stairs on a doorway`);
      // remove: down to one on a pair, then refused
      for (const upper of [1, 2]) {
        for (;;) {
          const on = dun.stairs.filter((s) => s.upper === upper);
          const res = DM.removeStair(DM.floorView(dun, upper), on[0].letter);
          if (on.length > 1) {
            ok(res.ok, `${ctx}: a stair that can go was refused: ${JSON.stringify(res)}`);
            removed++;
          } else {
            ok(!res.ok && /only stairs/.test(res.reason), `${ctx}: the last stair of a pair was removed: ${JSON.stringify(res)}`);
            refused++;
            break;
          }
        }
        check(dun, `${ctx} removed`);
      }
      ok(!DM.removeStair(dun, 'ZZZ').ok && !DM.moveStair(dun, 'ZZZ', 0, 0).ok, `${ctx}: stairs that do not exist were found`);
      ok(DM.editState(dun) !== was, `${ctx}: stair edits did not show in the edit state`);
      ok(JSON.stringify(JSON.parse(DM.dungeonJson(dun))) === JSON.stringify(dun), `${ctx}: the data does not hold the edited stairs`);
    }
    const flat = DM.generateDungeon({ ...base, levels: 1, seed: 'flat' });
    ok(!DM.addStair(flat, 1, 0, 0).ok, 'stairs were added to a dungeon of one level');
    console.log(`  stairs: ${added} added, ${moves} moved, ${removed} removed, ${refused} last ones kept, on 20 dungeons`);
  }
  // building one level again
  {
    let made = 0, kept = 0, grew = 0, refused = 0;
    for (let i = 0; i < 20; i++) {
      const levels = [3, 4, 2][i % 3];
      const dun = DM.generateDungeon({ ...base, levels, levelStairs: 1 + (i % 3), layout: ['random', 'gauntlet', 'wide'][i % 3], seed: `lvregen-${i}` });
      const ctx = `lvregen ${i}`;
      for (let n = 1; n <= levels; n++) {
        const before = JSON.parse(JSON.stringify(dun));
        const twin = JSON.parse(JSON.stringify(dun));
        const was = DM.editState(dun);
        const res = DM.regenerateLevel(dun, n, { seed: `again-${i}-${n}` });
        if (!res.ok) {
          refused++;
          ok(JSON.stringify(dun) === JSON.stringify(before), `${ctx} level ${n}: a refused rebuild changed the dungeon`);
          continue;
        }
        made++;
        kept += res.kept;
        check(dun, `${ctx} level ${n}`);
        if (dun.width > before.width || dun.height > before.height) grew++;
        // the same numbers give the same level
        DM.regenerateLevel(twin, n, { seed: `again-${i}-${n}` });
        ok(JSON.stringify(twin) === JSON.stringify(dun), `${ctx} level ${n}: the same seed gave another level`);
        // every other level is as it was (all moved together)
        const cellsOf = (m, lv) => JSON.stringify(DM.floorView(m, lv).rooms.map((r) => [r.label, r.kind, r.cells.map(([x, y]) => [x - (m === dun ? res.dx : 0), y - (m === dun ? res.dy : 0)])]));
        for (let lv = 1; lv <= levels; lv++) {
          if (lv === n) continue;
          ok(cellsOf(dun, lv) === cellsOf(before, lv), `${ctx} level ${n}: level ${lv} changed`);
          ok(JSON.stringify(DM.floorView(dun, lv).halls.map((h) => h.cells.map(([x, y]) => [x - res.dx, y - res.dy]))) === JSON.stringify(DM.floorView(before, lv).halls.map((h) => h.cells)), `${ctx} level ${n}: the hallways of level ${lv} changed`);
        }
        // the new level: its rooms are marked with it, it has the entrances only if it is the first, and it is joined to its neighbours
        ok(dun.levels === levels && DM.floorView(dun, n).rooms.length === base.roomCount && DM.floorView(dun, n).rooms.every((r) => r.level === n), `${ctx} level ${n}: the new level is not whole`);
        ok(DM.floorView(dun, n).rooms.some((r) => r.name) === false, `${ctx} level ${n}: a new level has room names`);
        for (let up = 1; up < levels; up++) ok(dun.stairs.some((s) => s.upper === up), `${ctx} level ${n}: no stair between level ${up} and level ${up + 1}`);
        // stairs between other levels did not move (but for the shift of the map)
        for (const s of before.stairs.filter((x) => x.upper !== n - 1 && x.upper !== n)) {
          ok(dun.stairs.some((t) => t.letter === s.letter && t.x === s.x + res.dx && t.y === s.y + res.dy && t.upper === s.upper), `${ctx} level ${n}: stair ${s.letter} between other levels changed`);
        }
        ok(new Set(dun.stairs.map((s) => s.letter)).size === dun.stairs.length, `${ctx} level ${n}: stair letters repeat`);
        ok(dun.stats.stairs === dun.stairs.length && dun.stairs.every((s, k) => s.id === k), `${ctx} level ${n}: stair ids or count`);
        ok(DM.editState(dun) !== was, `${ctx} level ${n}: a new level is not an edit`);
        ok(JSON.stringify(JSON.parse(DM.dungeonJson(dun))) === JSON.stringify(dun), `${ctx} level ${n}: the data does not hold the new level`);
        // (the edit tools work on the new level)
        const view = DM.floorView(dun, n);
        const from = view.rooms[0].cells[0];
        ok(DM.addHallway(view, [from, ...DM.walkCells(from, [from[0] + 3, from[1]])]).ok !== undefined, 'edit after a rebuild');
        check(dun, `${ctx} level ${n} then edited`);
      }
    }
    const flat = DM.generateDungeon({ ...base, levels: 1, seed: 'flat-regen' });
    ok(!DM.regenerateLevel(flat, 1).ok, 'a level of a dungeon of one level was rebuilt');
    const deep = DM.generateDungeon({ ...base, seed: 'deep-regen' });
    ok(!DM.regenerateLevel(deep, 0).ok && !DM.regenerateLevel(deep, 4).ok && !DM.regenerateLevel(deep, 1.5).ok, 'a level that does not exist was rebuilt');
    ok(kept > 0, 'no stair was ever kept when a level was built again');
    console.log(`  rebuilt levels: ${made} (${refused} refused), ${kept} stairs kept, the map grew ${grew} times`);
  }
  console.log('  done');
}

console.log('== adding doors');
{
  const ok = (cond, msg) => cond || fail('doors', msg);
  // the fixture: two 3 x 3 rooms, (0,0) and (6,0), with the entrance E1 in the west wall of the first
  {
    const d = hallFixture();
    ok(JSON.stringify(DM.wallNear(d, 1.5, 0.1)) === '{"x":1,"y":0,"d":0}', 'a point just inside the top wall is not by it');
    ok(JSON.stringify(DM.wallNear(d, 1.5, -0.1)) === '{"x":1,"y":0,"d":0}', 'a point just outside the top wall gives another wall');
    ok(DM.wallNear(d, 1.5, 1.5) === null && DM.wallNear(d, 2.02, 1.5) === null && DM.wallNear(d, 4.5, 1.5) === null, 'a wall is near the middle of a room, inside it, or out in the open');
    let p = DM.planDoor(d, 1, 0, 0);
    ok(p.ok && p.kind === 'entrance', `a wall with nothing beside it: ${JSON.stringify(p)}`);
    p = DM.planDoor(d, 2, 1, 1);
    ok(!p.ok && /shut in/.test(p.reason), `a wall facing the other room across the gap: ${JSON.stringify(p)}`);
    p = DM.planDoor(d, 0, 1, 3);
    ok(!p.ok && p.entrance === d.entrances[0] && /entrance/.test(p.reason), 'the wall of an entrance is not an entrance that can be added');
    ok(/not a wall/.test(DM.planDoor(d, 1, 1, 0).reason) && /not a room square/.test(DM.planDoor(d, 4, 4, 0).reason), 'the inside of a room, or a square that is not a room');
    const before = DM.editState(d);
    const r = DM.addDoor(d, 1, 0, 0);
    ok(r.ok && r.kind === 'entrance' && d.entrances.length === 2 && d.entrances[1].label === 'E2' && d.stats.entrances === 2 && r.dx === 0, `adding an entrance: ${JSON.stringify(r)}`);
    checkEdited(d, 'a door that is an entrance');
    ok(DM.editState(d) !== before && !DM.addDoor(d, 1, 0, 0).ok, 'the same wall took a second entrance');
    ok(DM.removeEntrance(d, 1).ok && DM.editState(d) === before, 'removing the entrance did not give back the dungeon');
  }
  // a hallway beside the wall (one that only runs along it opens nothing): the door opens into it
  {
    const d = hallFixture();
    const hr = DM.addHallway(d, [[0, -1], [1, -1], [2, -1]]);
    ok(hr.ok && d.connections[0].openings.length === 0, 'a hallway along a wall opened it');
    const p = DM.planDoor(d, 1, hr.dy, 0);
    ok(p.ok && p.kind === 'hall', `the wall beside a hallway: ${JSON.stringify(p)}`);
    const res = DM.addDoor(d, 1, hr.dy, 0);
    ok(res.ok && res.kind === 'hall' && res.opening.style === 'door' && d.halls[0].rooms.join() === '0' && d.connections[0].openings.length === 1, `a door into a hallway: ${JSON.stringify(res)}`);
    checkEdited(d, 'a door into a hallway');
    ok(DM.planDoor(d, 1, hr.dy, 0).opening === res.opening && !DM.addDoor(d, 1, hr.dy, 0).ok, 'the same wall took a second door');
    ok(DM.removeOpening(d, res.opening).ok && d.connections[0].openings.length === 0 && d.halls[0].rooms.length === 0, 'taking the door out did not leave the wall solid');
    checkEdited(d, 'the door taken out again');
  }
  // another room beside the wall: a doorway between them, named from either room
  {
    const d = hallFixture();
    ok(DM.addRoom(d, [3, 0], [5, 2]).ok, 'a room beside the first did not go in');
    const p = DM.planDoor(d, 2, 1, 1);
    ok(p.ok && p.kind === 'doorway' && p.room === 0 && p.other === 2, `the wall between two rooms: ${JSON.stringify(p)}`);
    ok(JSON.stringify(DM.wallNear(d, 3.1, 1.5)) === '{"x":3,"y":1,"d":3}', 'the wall between two rooms is not found from the second room');
    const res = DM.addDoor(d, 2, 1, 1);
    ok(res.ok && res.kind === 'doorway' && d.connections.length === 1 && d.connections[0].type === 'door' && d.connections[0].rooms.join() === '0,2' && d.stats.doorConnections === 1, `a doorway: ${JSON.stringify(res)}`);
    checkEdited(d, 'a doorway made by the door tool');
    ok(DM.planDoor(d, 3, 1, 3).opening === res.opening, 'the doorway is not seen from the second room');
    ok(DM.removeOpening(d, res.opening).ok && d.connections.length === 0 && d.stats.doorConnections === 0, 'taking the doorway out left a connection behind');
    checkEdited(d, 'the doorway taken out again');
  }
  // only level 1 has entrances
  {
    const d = DM.generateDungeon({ roomCount: 8, avgRoomSize: 20, sizeVariance: 30, entrances: 2, connectionType: 'hall', levels: 2, levelStairs: 1, seed: 'door-levels' });
    const upper = DM.floorView(d, 2);
    let tried = 0;
    for (const r of upper.rooms) for (const [x, y] of r.cells) for (let k = 0; k < 4; k++) {
      const p = DM.planDoor(upper, x, y, k);
      tried++;
      if (p.ok && p.kind === 'entrance') fail('doors', 'level 2 would take an entrance');
    }
    ok(tried > 0, 'no wall was tried on level 2');
  }
  // many random doors on dungeons of every kind: each plan agrees with what is made, and everything stays consistent
  {
    const rng = new DM.Rng('door-add-fuzz');
    const made = { entrance: 0, hall: 0, doorway: 0 };
    for (let n = 0; n < 20; n++) {
      const dun = DM.generateDungeon({
        roomCount: rng.int(3, 16),
        avgRoomSize: rng.pick([9, 16, 30]),
        sizeVariance: 30,
        entrances: rng.int(1, 3),
        connectionType: rng.pick(['hall', 'door']),
        connectionRandomness: rng.pick([0, 14, 50]),
        edgeEntrancesOnly: rng.pick([true, false]),
        hallDoors: rng.pick(['less', 'more', 'all']),
        seed: `door-add-${n}`,
      });
      const ctx = `door fuzz ${n}`;
      for (let op = 0; op < 20; op++) {
        const r = rng.pick(dun.rooms);
        const [x, y] = rng.pick(r.cells);
        const k = rng.int(0, 3);
        const plan = DM.planDoor(dun, x, y, k);
        const res = DM.addDoor(dun, x, y, k);
        if (plan.ok !== res.ok) fail(ctx, `the plan said ${plan.ok} and the door ${res.ok}`);
        if (res.ok) {
          made[res.kind]++;
          checkEdited(dun, `${ctx} op ${op}`);
        }
        if (rng.chance(0.25) && dun.entrances.filter((e) => e.kind === 'door').length > 1) {
          DM.removeEntrance(dun, dun.entrances.findIndex((e) => e.kind === 'door'));
          checkEdited(dun, `${ctx} entrance gone ${op}`);
        }
      }
    }
    console.log(`  ${made.entrance} entrances, ${made.hall} hallway doors and ${made.doorway} doorways added at random`);
    if (!made.entrance || !made.hall || !made.doorway) fail('doors', 'the random doors did not try every kind');
  }
  console.log('  done');
}

console.log('== editing rooms');
{
  const ok = (cond, msg) => cond || fail('rooms', msg);
  const key = (x, y) => `${x},${y}`;
  const base = { roomCount: 9, avgRoomSize: 20, sizeVariance: 30, entrances: 2, connectionType: 'hall', connectionRandomness: 20 };
  const floorsOf = (dun) => (DM.levelCount(dun) > 1 ? Array.from({ length: dun.levels }, (_, i) => DM.floorView(dun, i + 1)) : [dun]);

  /** Everything that has to hold after rooms were drawn, moved or deleted (on every level). */
  const checkRooms = (dun, ctx) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    floorsOf(dun).forEach((f, n) => {
      const c = `${ctx} level ${n + 1}`;
      const N = f.rooms.length;
      ok(N >= 1, `${c}: no rooms left`);
      const at = new Map();
      const put = (x, y, v) => {
        ok(!at.has(key(x, y)), `${c}: (${x},${y}) is used twice`);
        at.set(key(x, y), v);
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      };
      f.rooms.forEach((r, i) => {
        ok(r.id === i, `${c}: room at index ${i} has id ${r.id}`);
        ok(r.area === r.cells.length, `${c}: room ${r.label} says area ${r.area} but has ${r.cells.length} squares`);
        const xs = r.cells.map((q) => q[0]);
        const ys = r.cells.map((q) => q[1]);
        ok(r.bbox.x === Math.min(...xs) && r.bbox.y === Math.min(...ys) && r.bbox.w === Math.max(...xs) - Math.min(...xs) + 1 && r.bbox.h === Math.max(...ys) - Math.min(...ys) + 1, `${c}: room ${r.label} has a box that is not its squares`);
        ok(r.cells.some(([x, y]) => x === r.labelCell[0] && y === r.labelCell[1]), `${c}: the number of room ${r.label} is not on one of its squares`);
        if (DM.levelCount(dun) > 1) ok(r.level === n + 1, `${c}: room ${r.label} says level ${r.level}`);
        for (const [x, y] of r.cells) put(x, y, i);
      });
      ok(f.rooms.map((r) => r.label).sort((a, b) => a - b).join() === Array.from({ length: N }, (_, i) => i + 1).join(), `${c}: the numbers are not 1 to ${N}: ${f.rooms.map((r) => r.label)}`);
      f.halls.forEach((h, i) => {
        ok(h.id === i, `${c}: hall ${i} has id ${h.id}`);
        for (const [x, y] of h.cells) put(x, y, -1 - i);
      });
      f.connections.forEach((cn, i) => {
        ok(cn.id === i, `${c}: connection ${i} has id ${cn.id}`);
        for (const r of cn.rooms) ok(r >= 0 && r < N, `${c}: connection ${i} names room ${r}`);
        for (const o of cn.openings) {
          ok(o.room >= 0 && o.room < N && at.get(key(o.x, o.y)) === o.room, `${c}: opening ${o.x},${o.y} is not a square of room ${o.room}`);
          ok(cn.rooms.includes(o.room), `${c}: connection ${i} does not list room ${o.room}`);
          const across = at.get(key(o.x + DX[o.d], o.y + DY[o.d]));
          if (cn.type === 'door') ok(across !== undefined && across >= 0 && across !== o.room && cn.rooms.includes(across), `${c}: the doorway at ${o.x},${o.y} does not lead into the other room`);
          else ok(across === -1 - cn.hall, `${c}: the opening at ${o.x},${o.y} does not lead into its hallway`);
        }
      });
      for (const e of f.entrances) ok(e.room >= 0 && e.room < N && at.get(key(e.x, e.y)) === e.room, `${c}: entrance ${e.label} is not on a square of room ${e.room}`);
      ok(f.stats.rooms === N && Object.values(f.stats.shapeCounts).reduce((a, b) => a + b, 0) === N, `${c}: stats say ${f.stats.rooms} rooms`);
      ok(f.stats.floorCells === at.size, `${c}: stats say ${f.stats.floorCells} squares, there are ${at.size}`);
      ok(Math.abs(f.stats.meanRoomArea - f.rooms.reduce((a, r) => a + r.cells.length, 0) / N) < 1e-9, `${c}: the mean room size is out of date`);
      ok((n === 0) === (f.entrances.length > 0), `${c}: ${f.entrances.length} entrances`);
    });
    ok(x0 === 0 && y0 === 0 && x1 === dun.width - 1 && y1 === dun.height - 1, `${ctx}: the map is ${dun.width} x ${dun.height} but the squares reach ${x0},${y0} to ${x1},${y1}`);
    for (const st of dun.stairs || []) {
      for (const [level, room] of [[st.upper, st.upperRoom], [st.lower, st.lowerRoom]]) {
        const f = DM.floorView(dun, level);
        ok(f.rooms[room] && f.rooms[room].cells.some(([x, y]) => x === st.x && y === st.y), `${ctx}: stair ${st.letter} is not in room ${room} of level ${level}`);
      }
      ok(dun.stairs.map((s) => s.id).join() === dun.stairs.map((_, i) => i).join(), `${ctx}: stairs are out of order`);
    }
    for (let p = 1; p < (dun.levels || 1); p++) ok(dun.stairs.some((s) => s.upper === p), `${ctx}: no stairs between level ${p} and level ${p + 1}`);
    ok(JSON.stringify(JSON.parse(JSON.stringify(dun))) === JSON.stringify(dun), `${ctx}: the dungeon does not survive being saved as JSON`);
    if (DM.levelCount(dun) === 1) checkEdited(dun, ctx);
  };

  let deleted = 0, refused = 0, added = 0, addRefused = 0, moves = 0, moveRefused = 0, droppedOpenings = 0, grew = 0;
  for (const levels of [1, 3]) {
    for (let i = 0; i < 10; i++) {
      const params = { ...base, levels, levelStairs: 2, layout: ['random', 'ring', 'wide', 'gauntlet'][i % 4], connectionType: i % 3 === 2 ? 'door' : 'hall', seed: `rooms-${levels}-${i}` };
      const dun = DM.generateDungeon(params);
      const ctx = `rooms ${levels} levels #${i}`;
      checkRooms(dun, ctx);
      const h = new DM.EditHistory();
      const startState = DM.editState(dun);
      const view = (level) => DM.floorView(dun, level);
      const run = (label, fn) => {
        const before = h.snapshot(dun);
        const res = fn();
        if (res && res.ok) {
          checkRooms(dun, `${ctx} ${label}`);
          ok(h.push(dun, label, before, res), `${ctx}: ${label} changed nothing`);
          const after = h.snapshot(dun);
          const undone = h.undo(dun);
          ok(undone.ok && h.snapshot(dun) === before && undone.dx === -(res.dx || 0), `${ctx}: undoing ${label} did not give back the dungeon`);
          checkRooms(dun, `${ctx} undone ${label}`);
          ok(h.redo(dun).ok && h.snapshot(dun) === after, `${ctx}: redoing ${label} did not give the dungeon back`);
        } else {
          ok(h.snapshot(dun) === before, `${ctx}: ${label} was refused and still changed the dungeon (${res && res.reason})`);
          ok(res && typeof res.reason === 'string' && res.reason.length > 5, `${ctx}: ${label} was refused with no reason`);
        }
        return res;
      };

      // moves: slide rooms about (the ones that cannot be moved are refused, and nothing changes)
      for (let k = 0; k < 6; k++) {
        const level = 1 + (k % levels);
        const f = view(level);
        const room = f.rooms[(k * 2 + i) % f.rooms.length];
        const [mx, my] = [[1, 0], [0, -1], [-2, 1], [3, 3], [0, 1], [-1, 0]][k];
        const was = JSON.stringify(room.cells);
        const res = run(`move room ${room.label} by ${mx},${my}`, () => DM.moveRoom(f, room.id, mx, my));
        if (res.ok) {
          moves++;
          droppedOpenings += res.dropped.openings + res.dropped.doorways;
          if (res.dx || res.dy) grew++;
          const now = view(level).rooms.find((r) => r.label === room.label);
          ok(now && JSON.stringify(now.cells.map(([x, y]) => [x - mx - res.dx, y - my - res.dy])) === was, `${ctx}: room ${room.label} did not move by (${mx},${my})`);
        } else {
          moveRefused++;
        }
      }
      ok(DM.planMoveRoom(view(1), 0, 0, 0).ok === false, `${ctx}: moving a room nowhere should be refused`);

      // drawn rooms: one in the open beside the map, one out past the top left (the map grows and everything moves), and ones that cannot be
      for (const level of levels === 1 ? [1] : [1, 2, 3]) {
        const f = view(level);
        const n = f.rooms.length;
        const labels = f.rooms.map((r) => r.label);
        const w = dun.width;
        const res = run(`draw a room on level ${level}`, () => DM.addRoom(f, [w + 2, 1], [w + 5, 3]));
        ok(res.ok, `${ctx}: a room beside the map was refused: ${res.reason}`);
        const f2 = view(level);
        ok(f2.rooms.length === n + 1 && f2.rooms[n].label === n + 1 && f2.rooms[n].id === n && f2.rooms[n].kind === 'rect' && f2.rooms[n].area === 12, `${ctx}: the new room is not number ${n + 1}: ${JSON.stringify(f2.rooms[n])}`);
        ok(labels.every((l) => f2.rooms.find((r) => r.label === l)), `${ctx}: a room lost its number`);
        added++;
        const out = run('draw a room past the top left', () => DM.addRoom(view(level), [-4, -3], [-2, -1]));
        ok(out.ok, `${ctx}: a room past the top left was refused: ${out.reason}`);
        ok(out.dx > 0 && out.dy > 0, `${ctx}: the map did not move for a room past its top left`);
        grew++;
        added++;
        // refused: on a room, on a hallway, in front of an entrance door, too big
        const f3 = view(level);
        const r0 = f3.rooms[0];
        const bad = [
          [DM.addRoom(f3, r0.cells[0], r0.cells[0]), /already part of room/],
          [DM.addRoom(f3, [r0.cells[0][0] - 1, r0.cells[0][1]], [r0.cells[0][0] + 1, r0.cells[0][1]]), /already part of room|hallway|outside the door/],
          [DM.addRoom(f3, [0, 0], [DM.MAX_ROOM_SIDE, 0]), /at most/],
        ];
        if (f3.halls.length) bad.push([DM.addRoom(f3, f3.halls[0].cells[0], f3.halls[0].cells[0]), /hallway/]);
        if (level === 1) {
          const e = f3.entrances.find((q) => q.kind === 'door');
          if (e) bad.push([DM.addRoom(f3, [e.x + DX[e.d], e.y + DY[e.d]], [e.x + DX[e.d], e.y + DY[e.d]]), /outside the door/]);
        }
        for (const [res2, re] of bad) {
          addRefused++;
          ok(!res2.ok && re.test(res2.reason), `${ctx}: drawing on top of something said ${JSON.stringify(res2).slice(0, 120)}`);
        }
        checkRooms(dun, `${ctx} after refusals`);
      }

      // deletes, until there is nothing more that can go
      let guard = 0;
      for (let level = 1; level <= levels; level++) {
        while (guard++ < 200) {
          const f = view(level);
          const labels = f.rooms.map((r) => r.label).sort((a, b) => a - b);
          const room = f.rooms.find((r) => !DM.deleteRoomProblem(f, r.id));
          if (!room) break;
          const stairsHere = (dun.stairs || []).filter((s) => (s.upper === level && f.rooms[s.upperRoom] === room) || (s.lower === level && f.rooms[s.lowerRoom] === room)).length;
          const stairsBefore = (dun.stairs || []).length;
          const names = f.rooms.map((r) => `${r.label}`);
          const res = run(`delete room ${room.label}`, () => DM.deleteRoom(f, room.id));
          ok(res.ok, `${ctx}: delete room ${room.label} was refused: ${res.reason}`);
          const g = view(level);
          ok(g.rooms.length === labels.length - 1 && !g.rooms.some((r) => r === room), `${ctx}: the room is still there`);
          ok(((dun.stairs || []).length === stairsBefore - stairsHere), `${ctx}: ${stairsHere} stairs should have gone with the room`);
          ok(names.length === g.rooms.length + 1, `${ctx}: not one room fewer`);
          deleted++;
        }
        // what is left is only what must stay
        for (const r of view(level).rooms) {
          const why = DM.deleteRoomProblem(view(level), r.id);
          ok(why === '' || view(level).rooms.length === 1 || /only|at least|first/.test(why), `${ctx}: room ${r.label} cannot go because: ${why}`);
          if (why) refused++;
        }
      }
      ok(DM.editState(dun) !== startState, `${ctx}: all the edits made left the dungeon looking unedited`);
      // every step can be taken back, one at a time, to the dungeon as it was built
      let back = 0;
      while (h.canUndo && back++ < 1000) h.undo(dun);
      ok(DM.editState(dun) === startState, `${ctx}: taking back every step did not give the dungeon as built`);
      checkRooms(dun, `${ctx} all undone`);
    }
  }
  ok(deleted > 40 && added > 30 && moves > 30 && addRefused > 30 && refused > 0, `too little was tried: ${deleted} deleted, ${added} drawn, ${moves} moved, ${addRefused} drawn on top of things, ${refused} rooms that had to stay`);
  ok(grew > 20, `the map hardly ever grew (${grew})`);
  ok(droppedOpenings > 0 && moveRefused >= 0, 'moving rooms never took a door away');
  console.log(`  ${deleted} rooms deleted, ${added} drawn (${addRefused} refused), ${moves} moved (${moveRefused} refused, ${droppedOpenings} doors dropped), ${grew} times the map moved`);

  // what moving does to doors: a doorway slides with the room along the wall, and a room moved off a hallway loses its door into it
  {
    const dun = DM.generateDungeon({ ...base, connectionType: 'hall', connectionRandomness: 0, seed: 'rooms-move-doors' });
    const o = dun.connections.find((c) => c.type === 'hall').openings[0];
    const room = dun.rooms[o.room];
    const far = DM.moveRoom(dun, room.id, dun.width + 4, 0);
    ok(far.ok && far.dropped.openings >= 1 && !dun.connections.some((c) => c.openings.some((p) => p.room === room.id && c.type === 'hall')), 'a room moved away from its hallway keeps its door into it');
    checkRooms(dun, 'rooms moved off a hallway');
    // sliding a room along a wall it shares keeps the doorway, and one moved along a hallway's side keeps its door into it
    let slid = 0, slidHall = 0;
    for (let i = 0; i < 30 && (slid < 3 || slidHall < 3); i++) {
      const d2 = DM.generateDungeon({ ...base, connectionType: i % 2 ? 'door' : 'hall', seed: `rooms-slide-${i}` });
      for (const r of d2.rooms) {
        for (const [mx, my] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const plan = DM.planMoveRoom(d2, r.id, mx, my);
          if (!plan.ok || (plan.keepDoors.size === 0 && plan.keepHall.size === 0)) continue;
          const doorsBefore = d2.connections.filter((c) => c.type === 'door').length - plan.dropDoors.size;
          const res = DM.moveRoom(d2, r.id, mx, my);
          ok(res.ok && d2.connections.filter((c) => c.type === 'door').length === doorsBefore, 'a doorway that should have stayed was lost');
          checkRooms(d2, `rooms slid ${i}`);
          if (plan.keepDoors.size) slid++;
          if (plan.keepHall.size) slidHall++;
          i = 99;
          break;
        }
        if (i === 99) break;
      }
    }
    ok(slid + slidHall > 0, 'moving a room never kept a door');
  }

  // stairs: a room with stairs cannot be moved; deleting one takes its stairs, unless they are the only ones
  {
    const dun = DM.generateDungeon({ ...base, levels: 3, levelStairs: 1, seed: 'rooms-stairs' });
    const st = dun.stairs[0];
    const upperView = DM.floorView(dun, st.upper);
    const moved = DM.moveRoom(upperView, st.upperRoom, 1, 0);
    ok(!moved.ok && /stairs/.test(moved.reason), `a room with stairs was moved: ${JSON.stringify(moved).slice(0, 100)}`);
    const gone = DM.deleteRoom(upperView, st.upperRoom);
    ok(!gone.ok && /only ones/.test(gone.reason), `a room with the only stairs was deleted: ${JSON.stringify(gone).slice(0, 120)}`);
    const other = DM.addStair(dun, st.upper, ...(() => {
      for (let y = 0; y < dun.height; y++) for (let x = 0; x < dun.width; x++) if (DM.stairProblem(dun, st.upper, x, y).ok) return [x, y];
      return [0, 0];
    })());
    if (other.ok) {
      const now = dun.stairs.find((s) => s.upper === st.upper && s.letter === st.letter);
      const res = DM.deleteRoom(DM.floorView(dun, st.upper), now.upperRoom);
      if (res.ok) {
        ok(res.removed.stairs.includes(st.letter) && !dun.stairs.some((s) => s.letter === st.letter), `deleting the room of stairs ${st.letter}: they should have gone with it`);
        checkRooms(dun, 'rooms: stairs went with their room');
      } else {
        ok(/only ones/.test(res.reason), `deleting the room of stairs ${st.letter} (with others to use): ${res.reason}`);
      }
    }
  }

  // the only room, and the only entrance
  {
    const one = DM.generateDungeon({ ...base, roomCount: 1, entrances: 1, seed: 'rooms-one' });
    const res = DM.deleteRoom(one, 0);
    ok(!res.ok && /at least one room/.test(res.reason), 'the last room was deleted');
    const two = DM.generateDungeon({ ...base, roomCount: 2, entrances: 1, seed: 'rooms-two' });
    const withEntrance = two.rooms[two.entrances[0].room];
    const res2 = DM.deleteRoom(two, withEntrance.id);
    ok(!res2.ok && /only entrance/.test(res2.reason), `the room with the only entrance was deleted: ${JSON.stringify(res2).slice(0, 100)}`);
  }
  console.log('  done');
}

console.log('== undo and redo');
{
  const ok = (cond, msg) => cond || fail('history', msg);
  const base = { roomCount: 8, avgRoomSize: 20, sizeVariance: 30, entrances: 2, connectionType: 'hall' };
  let steps = 0;
  let shifted = 0;

  // a run of different edits to a dungeon, each recorded: undoing them one by one gives back every state, and redoing them gives back every state again
  for (const levels of [1, 3]) {
    for (let i = 0; i < 8; i++) {
      const dun = DM.generateDungeon({ ...base, levels, levelStairs: 2, seed: `hist-${levels}-${i}` });
      const ctx = `history ${levels} levels, ${i}`;
      const h = new DM.EditHistory();
      const alias = dun; // the dungeon object stays the same one throughout
      const states = [h.snapshot(dun)]; // states[k]: after k edits
      const shifts = [];
      const level = () => 1 + (i % levels);
      const edit = (label, fn) => {
        const before = h.snapshot(dun);
        const res = fn();
        if (!res || res.ok === false) return;
        if (h.push(dun, label, before, res)) {
          states.push(h.snapshot(dun));
          shifts.push({ dx: res.dx || 0, dy: res.dy || 0 });
          steps++;
          if (res.dx || res.dy) shifted++;
        }
      };
      const view = () => DM.floorView(dun, level());
      edit('Change a door', () => {
        const o = view().connections.flatMap((c) => c.openings)[0];
        if (!o) return null;
        o.style = DM.nextDoorStyle(o.style);
        return {};
      });
      edit('Draw a hallway out past the top left', () => {
        const v = view();
        const from = v.rooms[0].cells[0];
        return DM.addHallway(v, [from, ...DM.walkCells(from, [-4, -3])]);
      });
      edit('Name a room', () => {
        view().rooms[1].name = 'Vault';
        return {};
      });
      edit('Delete a hallway', () => (view().halls.length ? DM.deleteHall(view(), view().halls[0].id) : null));
      if (levels > 1) {
        edit('Add stairs', () => {
          for (let y = 0; y < dun.height; y++) for (let x = 0; x < dun.width; x++) if (DM.stairProblem(dun, 1, x, y).ok) return DM.addStair(DM.floorView(dun, 1), 1, x, y);
          return null;
        });
        edit('Regenerate a level', () => DM.regenerateLevel(dun, 2, { seed: `hist-regen-${i}` }));
      }
      ok(h.canUndo && !h.canRedo && h.undoLabel !== '', `${ctx}: the history is not as it should be after the edits`);
      const total = states.length - 1;
      ok(total >= 3, `${ctx}: only ${total} edits were made`);

      // all the way back
      for (let k = total; k >= 1; k--) {
        const res = h.undo(dun);
        ok(res.ok && res.dx === -shifts[k - 1].dx && res.dy === -shifts[k - 1].dy, `${ctx}: undoing step ${k} says ${JSON.stringify(res)}`);
        ok(h.snapshot(dun) === states[k - 1], `${ctx}: undoing step ${k} did not give back the dungeon as it was`);
        ok(dun === alias, `${ctx}: undo made another dungeon object`);
      }
      ok(!h.canUndo && h.canRedo && !h.undo(dun).ok, `${ctx}: at the start there is still something to undo`);
      ok(DM.editState(dun) === DM.editState(DM.generateDungeon({ ...base, levels, levelStairs: 2, seed: `hist-${levels}-${i}` })), `${ctx}: all undone is not the dungeon as it was built`);
      // and forward again
      for (let k = 1; k <= total; k++) {
        const res = h.redo(dun);
        ok(res.ok && res.dx === shifts[k - 1].dx && res.dy === shifts[k - 1].dy, `${ctx}: redoing step ${k} says ${JSON.stringify(res)}`);
        ok(h.snapshot(dun) === states[k], `${ctx}: redoing step ${k} did not give back the dungeon as it was`);
      }
      ok(!h.canRedo && !h.redo(dun).ok, `${ctx}: at the end there is still something to redo`);
      // a new change after undoing drops what could have been redone
      h.undo(dun);
      h.undo(dun);
      ok(h.canRedo, `${ctx}: nothing to redo after undoing`);
      const before = h.snapshot(dun);
      DM.floorView(dun, 1).rooms[0].name = 'New';
      ok(h.push(dun, 'Name a room', before) && !h.canRedo, `${ctx}: a new change did not drop the redo steps`);
      // something that changed nothing is not a step
      ok(!h.push(dun, 'Nothing', h.snapshot(dun)) && !h.push(dun, 'Nothing', undefined), `${ctx}: a change that changed nothing was kept`);
      h.clear();
      ok(!h.canUndo && !h.canRedo && h.undoLabel === '' && h.redoLabel === '', `${ctx}: clear left something`);
    }
  }

  // the history is kept to its limits
  {
    const dun = DM.generateDungeon({ ...base, seed: 'hist-limit' });
    const h = new DM.EditHistory({ limit: 3 });
    for (let k = 0; k < 6; k++) {
      const before = h.snapshot(dun);
      dun.rooms[0].name = `n${k}`;
      h.push(dun, `step ${k}`, before);
    }
    ok(h.undos.length === 3 && h.undoLabel === 'step 5', `a history with a limit of 3 holds ${h.undos.length}, the last being ${h.undoLabel}`);
    const small = new DM.EditHistory({ maxChars: 10 });
    for (let k = 0; k < 4; k++) {
      const before = small.snapshot(dun);
      dun.rooms[0].name = `m${k}`;
      small.push(dun, `step ${k}`, before);
    }
    ok(small.undos.length === 1 && small.undoLabel === 'step 3', 'a history that is too big keeps only the newest step');
  }
  console.log(`  ${steps} edits undone and redone on 16 dungeons, ${shifted} of them moved the map`);
  console.log('  done');
}

console.log('== edit mode');
{
  const fs = require('fs');
  const path = require('path');
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

  // the cycle of states
  if (DM.DOOR_STYLES.join() !== 'door,locked,secret,open') fail('edit', `the door states are [${DM.DOOR_STYLES}], not door / locked / secret / none in that order`);
  for (const s of DM.DOOR_STYLES) {
    let at = s;
    const seen = [];
    for (let i = 0; i < DM.DOOR_STYLES.length; i++) {
      at = DM.nextDoorStyle(at);
      seen.push(at);
    }
    if (at !== s || new Set(seen).size !== DM.DOOR_STYLES.length) fail('edit', `cycling from ${s} does not visit every state once and come back: ${seen}`);
    if (!DM.DOOR_LABELS[s]) fail('edit', `door state ${s} has no name`);
  }
  if (DM.nextDoorStyle('door') !== 'locked' || DM.nextDoorStyle('locked') !== 'secret' || DM.nextDoorStyle('secret') !== 'open' || DM.nextDoorStyle('open') !== 'door') fail('edit', 'the cycle is not door → locked → secret → none → door');
  if (DM.nextDoorStyle('nonsense') !== 'door' || DM.nextDoorStyle(undefined) !== 'door') fail('edit', 'a state nobody knows should go to a plain door');
  // whatever the generator makes can be edited: every opening starts in a state the cycle knows
  const editBase = { avgRoomSize: 30, sizeVariance: 30, entrances: 2, connectionType: 'hall', connectionRandomness: 14 };
  const made = DM.generateDungeon({ ...editBase, roomCount: 14, seed: 'edit-mode', hallDoors: 'less' });
  for (const c of made.connections) for (const o of c.openings) if (!DM.DOOR_STYLES.includes(o.style)) fail('edit', `the generator made an opening in state ${o.style}`);
  // "was anything changed?" is the same text unless a door really differs, and a full cycle changes nothing
  const before = DM.editState(made);
  const first = made.connections.find((c) => c.openings.length > 0).openings[0];
  const startStyle = first.style;
  first.style = DM.nextDoorStyle(first.style);
  if (DM.editState(made) === before) fail('edit', 'a door was changed but the dungeon looks unedited');
  for (let i = 1; i < DM.DOOR_STYLES.length; i++) first.style = DM.nextDoorStyle(first.style);
  if (first.style !== startStyle || DM.editState(made) !== before) fail('edit', 'cycling a door all the way round should leave the dungeon unedited');

  // the renderer, on a stand-in for the canvas: real clicks, drags and hover go through its own handlers
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: (t, k, v) => ((t[k] = v), true) });
  class FakePath {
    constructor() {
      this.ops = [];
    }
    moveTo(x, y) {
      this.ops.push(['m', x, y]);
    }
    lineTo(x, y) {
      this.ops.push(['l', x, y]);
    }
    rect() {}
  }
  globalThis.Path2D = FakePath;
  globalThis.window = { devicePixelRatio: 1, addEventListener() {} };
  globalThis.requestAnimationFrame = (cb) => (cb(), 0); // draw at once, so drawing code is run too
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  require('../src/render.js');

  const handlers = {};
  const classes = new Set();
  const canvas = {
    width: 900,
    height: 700,
    clientWidth: 900,
    clientHeight: 700,
    getContext: () => ctx,
    addEventListener: (type, fn) => (handlers[type] = fn),
    setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
  };
  const renderer = new DM.DungeonRenderer(canvas);
  const dungeon = DM.generateDungeon({ ...editBase, roomCount: 16, seed: 'edit-click', hallDoors: 'less', entrances: 3 });
  renderer.setDungeon(dungeon);
  const changes = [];
  renderer.onDoorChange = (c) => changes.push(c);

  const openings = dungeon.connections.flatMap((c) => c.openings);
  if (renderer.model.edits.length !== openings.length) fail('edit', `${renderer.model.edits.length} doors can be edited, the dungeon has ${openings.length} openings between rooms`);
  for (const e of dungeon.entrances) if (renderer.model.edits.some((t) => t.x === e.x && t.y === e.y && t.d === e.d)) fail('edit', 'an entrance can be edited');
  const sum = (o) => o.door + o.locked + o.secret + o.open;
  if (sum(renderer.doorCounts()) !== openings.length) fail('edit', 'doorCounts does not count every opening');

  const where = (t) => ({ clientX: t.cx * renderer.view.scale + renderer.view.tx, clientY: t.cy * renderer.view.scale + renderer.view.ty });
  const press = (pos, ...moves) => {
    handlers.pointerdown({ pointerId: 1, ...pos });
    for (const m of moves) handlers.pointermove({ pointerId: 1, ...m });
    handlers.pointerup({ pointerId: 1, ...(moves.length ? moves[moves.length - 1] : pos) });
  };
  // is there wall on this door's edge?
  const hasWall = (t, rr = renderer) => {
    const horizontal = t.d === 0 || t.d === 2;
    const ops = rr.model.wallPath.ops;
    for (let i = 0; i + 1 < ops.length; i += 2) {
      const [, ax, ay] = ops[i];
      const [, bx, by] = ops[i + 1];
      if (horizontal ? ay === t.cy && by === t.cy && ax <= t.cx - 0.5 && bx >= t.cx + 0.5 : ax === t.cx && bx === t.cx && ay <= t.cy - 0.5 && by >= t.cy + 0.5) return true;
    }
    return false;
  };
  const target = renderer.model.edits[0];
  const opening = target.opening;
  const start = opening.style;

  // not in edit mode: a click is only a click
  press(where(target));
  if (opening.style !== start || changes.length) fail('edit', 'a click changed a door while edit mode was off');
  renderer.setEditMode(true);
  if (!classes.has('editing')) fail('edit', 'the map does not show that edit mode is on');
  // a click on bare ground changes nothing
  press({ clientX: 2, clientY: 2 });
  if (opening.style !== start || changes.length) fail('edit', 'a click away from every door changed a door');
  // a drag that starts on a door pans the map and leaves the door alone
  const view0 = { ...renderer.view };
  const here = where(target);
  press(here, { clientX: here.clientX + 40, clientY: here.clientY + 15 });
  if (opening.style !== start || changes.length) fail('edit', 'dragging across a door changed it');
  if (renderer.view.tx !== view0.tx + 40 || renderer.view.ty !== view0.ty + 15) fail('edit', 'dragging in edit mode does not pan');
  renderer.view = { ...view0 }; // back where it was
  // a click that wobbles a little is still a click, and does not slide the map
  press(where(target), { clientX: where(target).clientX + 2, clientY: where(target).clientY + 1 });
  if (changes.length !== 1 || changes[0].opening !== opening) fail('edit', 'a click with a little wobble was not taken as a click');
  if (renderer.view.tx !== view0.tx || renderer.view.ty !== view0.ty) fail('edit', 'a click moved the map');
  opening.style = start; // (put it back, and carry on from the first state)
  changes.length = 0;
  renderer.refreshDoors();

  // clicks go round the four states: what is drawn changes with each
  const builtText = DM.editState(dungeon);
  const stylesBefore = openings.map((o) => o.style);
  const states = [];
  for (let i = 0; i < 4; i++) {
    press(where(target));
    const door = renderer.model.doors.some((d) => d.x === target.x && d.y === target.y && d.d === target.d);
    const locked = renderer.model.doors.some((d) => d.x === target.x && d.y === target.y && d.d === target.d && d.locked);
    const secret = renderer.model.secrets.some((s) => s.x === target.x && s.y === target.y && s.d === target.d);
    states.push({ style: opening.style, door, locked, secret, wall: hasWall(target) });
  }
  const expectAt = (i, want) => {
    const got = states[i];
    for (const k of Object.keys(want)) if (got[k] !== want[k]) fail('edit', `after click ${i + 1} (${got.style}): ${k} is ${got[k]}, should be ${want[k]}`);
  };
  const order = [];
  for (let s = start, i = 0; i < 4; i++) order.push((s = DM.nextDoorStyle(s)));
  if (states.map((s) => s.style).join() !== order.join()) fail('edit', `clicks gave ${states.map((s) => s.style)}, not ${order}`);
  order.forEach((style, i) => {
    if (style === 'door') expectAt(i, { door: true, locked: false, secret: false, wall: false });
    if (style === 'locked') expectAt(i, { door: true, locked: true, secret: false, wall: false });
    if (style === 'secret') expectAt(i, { door: false, locked: false, secret: true, wall: true }); // looks like a wall, with an S on it
    if (style === 'open') expectAt(i, { door: false, locked: false, secret: false, wall: false }); // a gap, nothing in it
  });
  if (changes.length !== 4 || changes.some((c, i) => c.to !== order[i] || c.from !== (i ? order[i - 1] : start))) fail('edit', 'the change notices are not one per click, with the state it left and the one it went to');
  if (opening.style !== start || DM.editState(dungeon) !== builtText) fail('edit', 'four clicks should come back to the state the door started in, and so to a dungeon with no edits');
  // the counts follow the doors, and the other doors are untouched
  press(where(target)); // one more click: now in the state after `start`
  const counts = renderer.doorCounts();
  if (sum(counts) !== openings.length || counts[opening.style] < 1) fail('edit', 'doorCounts did not follow a click');
  if (opening.style !== DM.nextDoorStyle(start)) fail('edit', 'a fifth click should give the state after the first');
  if (openings.some((o, i) => o !== opening && o.style !== stylesBefore[i])) fail('edit', 'a click changed another door');

  // a right click takes the door out for good (the wall is solid again); it does not click, pan or bring up the browser's menu
  {
    const saved = changes.splice(0);
    const viewKeep = { ...renderer.view };
    const copy = JSON.parse(JSON.stringify(dungeon));
    renderer.setDungeon(copy);
    renderer.view = { ...viewKeep };
    let prevented = 0;
    const rightClick = (pos) => {
      handlers.pointerdown({ pointerId: 1, button: 2, ...pos });
      handlers.pointerup({ pointerId: 1, button: 2, ...pos });
      handlers.contextmenu({ button: 2, ...pos, preventDefault: () => prevented++ });
    };
    // one of each: a secret door, a plain door and an archway, in turn
    const picks = [];
    for (const style of ['secret', 'door', 'open']) {
      const t = renderer.model.edits.find((e) => e.opening.style === style) || renderer.model.edits.find((e) => !picks.includes(e.opening));
      picks.push(t.opening);
      const n = renderer.model.edits.length;
      const sum0 = sum(renderer.doorCounts());
      const open = t.opening;
      const at = { x: t.x, y: t.y, d: t.d, cx: t.cx, cy: t.cy };
      const was = open.style;
      const viewR = { ...renderer.view };
      rightClick(where(at));
      if (renderer.model.edits.length !== n - 1 || copy.connections.some((c) => c.openings.includes(open)) || renderer.model.edits.some((e) => e.opening === open)) fail('edit', `a right click on a ${was} door did not take the opening out`);
      if (changes.length < 1 || changes[changes.length - 1].removed !== true || changes[changes.length - 1].from !== was || changes[changes.length - 1].to !== null || changes[changes.length - 1].opening !== open) fail('edit', `the change notice for a removed door is ${JSON.stringify(changes[changes.length - 1])}`);
      if (sum(renderer.doorCounts()) !== sum0 - 1) fail('edit', 'the door counts did not follow a removed door');
      if (renderer.model.doors.some((d) => !d.entrance && d.x === at.x && d.y === at.y && d.d === at.d) || renderer.model.secrets.some((e) => e.x === at.x && e.y === at.y && e.d === at.d)) fail('edit', 'a door taken out is still drawn');
      if (!hasWall(at, renderer)) fail('edit', `there is no wall where a ${was} door was taken out`);
      if (JSON.stringify(renderer.view) !== JSON.stringify(viewR)) fail('edit', 'a right click moved the map');
      checkEdited(copy, `after taking out a ${was} door`);
    }
    if (prevented !== 3) fail('edit', `the browser's menu came up ${3 - prevented} times`);
    const left = changes.length;
    rightClick(where({ cx: -5, cy: -5 })); // where there is no door: nothing, and still no menu
    if (changes.length !== left || prevented !== 4) fail('edit', 'a right click away from every door changed something, or let the menu through');
    renderer.setDungeon(dungeon);
    renderer.view = { ...viewKeep };
    changes.length = 0;
    changes.push(...saved);
  }

  // hovering shows which door a click would change
  renderer._hover = null;
  handlers.pointermove({ ...where(target) });
  if (!renderer._hover || renderer._hover.opening !== opening || !classes.has('over-door')) fail('edit', 'the door under the pointer is not picked out');
  handlers.pointermove({ clientX: 2, clientY: 2 });
  if (renderer._hover || classes.has('over-door')) fail('edit', 'the pointer left the door but it is still picked out');

  // a picture never shows the rings of edit mode, and its key names locked and secret doors only if there are some
  const swatches = [];
  const drawSwatch = renderer._drawSwatch.bind(renderer);
  renderer._drawSwatch = (c, kind, ...rest) => (swatches.push(kind), drawSwatch(c, kind, ...rest));
  let rings = 0;
  const drawMarks = renderer._drawEditMarks.bind(renderer);
  renderer._drawEditMarks = (...a) => (rings++, drawMarks(...a));
  const keyOf = () => {
    swatches.length = 0;
    rings = 0; // (the screen was drawn again by the changes, with rings; only the picture is looked at)
    if (!renderer.exportImage({ legend: true, caption: 'x' })) fail('edit', 'no picture was made');
    return swatches.slice();
  };
  for (const o of openings) o.style = 'door';
  renderer.refreshDoors();
  let key = keyOf();
  if (key.includes('locked') || key.includes('secret') || !key.includes('door')) fail('edit', `the key of a map with only plain doors is [${key}]`);
  if (rings) fail('edit', 'a picture of the map was drawn with the rings of edit mode on it');
  openings[0].style = 'locked';
  openings[1].style = 'secret';
  renderer.refreshDoors();
  key = keyOf();
  if (!key.includes('locked') || !key.includes('secret')) fail('edit', `the key of a map with a locked and a secret door is [${key}]`);
  if (rings) fail('edit', 'a picture of the map was drawn with the rings of edit mode on it');
  rings = 0;
  renderer.draw(); // (and the screen does show them)
  if (!rings) fail('edit', 'edit mode draws no rings round the doors');
  renderer.setEditMode(false);
  if (classes.has('editing')) fail('edit', 'leaving edit mode left the map marked as editing');
  const ringsBefore = rings;
  renderer.draw();
  if (rings !== ringsBefore) fail('edit', 'the rings are still drawn after leaving edit mode');
  // a new dungeon starts clean, with nothing of the old doors hovered
  renderer.setDungeon(DM.generateDungeon({ ...editBase, roomCount: 6, seed: 'edit-new' }));
  if (renderer._hover) fail('edit', 'a new dungeon kept the old hovered door');

  // the hallway tools, on a small dungeon whose squares are easy to point at
  {
    const stub = () => {
      const h = {};
      const cl = new Set();
      return {
        handlers: h,
        classes: cl,
        canvas: {
          width: 900,
          height: 700,
          clientWidth: 900,
          clientHeight: 700,
          getContext: () => ctx,
          addEventListener: (type, fn) => (h[type] = fn),
          setPointerCapture() {},
          getBoundingClientRect: () => ({ left: 0, top: 0 }),
          classList: { add: (c) => cl.add(c), remove: (c) => cl.delete(c), toggle: (c, on) => (on ? cl.add(c) : cl.delete(c)) },
        },
      };
    };
    const hc = stub();
    const r = new DM.DungeonRenderer(hc.canvas);
    const fx = hallFixture();
    r.setDungeon(fx);
    const notices = [];
    r.onLayoutChange = (n) => notices.push(n);
    r.view = { scale: 40, tx: 200, ty: 200 };
    // where square (x, y) is on the screen, and a pointer event there
    const at = (x, y) => ({ clientX: r.view.tx + (x + 0.5) * r.view.scale, clientY: r.view.ty + (y + 0.5) * r.view.scale });
    const ev = (pos, extra) => ({ pointerId: 1, button: 0, ...pos, ...extra });
    const drag = (cells, extra) => {
      hc.handlers.pointerdown(ev(at(...cells[0]), extra));
      for (const c of cells.slice(1)) hc.handlers.pointermove(ev(at(...c), extra));
      hc.handlers.pointerup(ev(at(...cells[cells.length - 1]), extra));
    };
    const roomScreen = () => [fx.rooms[0].cells[0][0] * r.view.scale + r.view.tx, fx.rooms[0].cells[0][1] * r.view.scale + r.view.ty];
    const ok = (cond, msg) => cond || fail('edit', msg);
    const spy = (name) => {
      const orig = r[name].bind(r);
      const s = { calls: 0 };
      r[name] = (...a) => (s.calls++, orig(...a));
      return s;
    };
    const marks = spy('_drawEditMarks');
    const hallDraw = spy('_drawHallEditing');
    const fitted = spy('fit');

    // not in edit mode, and with the door tool, a drag only pans
    drag([[3, 1], [5, 1]]);
    ok(fx.halls.length === 0 && !r._stroke, 'a drag drew a hallway outside edit mode');
    r.setEditMode(true);
    drag([[3, 1], [5, 1]]);
    ok(fx.halls.length === 0, 'a drag drew a hallway with the door tool');
    r.view = { scale: 40, tx: 200, ty: 200 };

    // the draw tool: a drag over squares makes a hallway, shown as it will be while it is dragged
    r.setEditTool('draw');
    marks.calls = 0;
    ok(hc.classes.has('tool-draw'), 'the draw tool has no cross-hair cursor');
    hc.handlers.pointerdown(ev(at(3, 1)));
    ok(r._stroke && r._stroke.plan.floor.length === 1, 'pressing with the draw tool did not start a hallway');
    hc.handlers.pointermove(ev(at(5, 1)));
    ok(r._stroke.plan.floor.length === 3 && r._stroke.plan.openings.length === 2, `the hallway being drawn shows ${r._stroke.plan.floor.length} squares and ${r._stroke.plan.openings.length} doors`);
    const hallDrawsBefore = hallDraw.calls;
    r.draw();
    ok(hallDraw.calls > hallDrawsBefore, 'the hallway being drawn is not drawn');
    // a picture made now has neither the hallway being drawn nor the tool marks
    hallDraw.calls = 0;
    r.exportImage({ legend: true, caption: 'x' });
    ok(hallDraw.calls === 0 && r._stroke, 'a picture of the map showed the hallway being drawn, or ended it');
    hc.handlers.pointerup(ev(at(5, 1)));
    ok(fx.halls.length === 1 && JSON.stringify(fx.halls[0].rooms) === '[0,1]' && !r._stroke, 'releasing did not make the hallway');
    ok(notices.length === 1 && notices[0].kind === 'draw' && notices[0].dx === 0 && notices[0].dy === 0, `the change notice for drawing is ${JSON.stringify(notices)}`);
    ok(r.model.edits.length === 2 && r.model.doors.length === 3, 'the new doors are not drawn and editable'); // (3 = the entrance and two new doors)
    // the walls are open where the new doors are
    ok(!hasWall(r.model.edits[0], r) && !hasWall(r.model.edits[1], r), 'a wall is still there where a hallway door was made');
    ok(marks.calls === 0, 'the door rings were drawn while the draw tool was picked');

    // Escape drops a hallway being drawn; Space held, or the middle button, pans instead of drawing
    hc.handlers.pointerdown(ev(at(4, 0)));
    r._key({ code: 'Escape' }, true);
    hc.handlers.pointerup(ev(at(4, 0)));
    ok(fx.halls[0].cells.length === 3, 'Escape did not drop the hallway being drawn');
    hc.handlers.pointerenter({});
    r._key({ code: 'Space', target: {}, preventDefault() {} }, true);
    ok(!hc.classes.has('tool-draw'), 'the cross-hair stays while Space is held');
    const view1 = { ...r.view };
    hc.handlers.pointerdown(ev(at(4, 0)));
    ok(!r._stroke, 'a hallway was started with Space held');
    hc.handlers.pointermove(ev({ clientX: at(4, 0).clientX + 30, clientY: at(4, 0).clientY + 10 }));
    hc.handlers.pointerup(ev({ clientX: at(4, 0).clientX + 30, clientY: at(4, 0).clientY + 10 }));
    ok(r.view.tx === view1.tx + 30 && r.view.ty === view1.ty + 10 && fx.halls[0].cells.length === 3, 'dragging with Space held did not pan');
    r._key({ code: 'Space', target: {}, preventDefault() {} }, false);
    ok(hc.classes.has('tool-draw'), 'the cross-hair did not come back when Space was let go');
    r.view = { ...view1 };
    hc.handlers.pointerdown(ev(at(4, 0), { button: 1 }));
    ok(!r._stroke, 'a hallway was started with the middle button');
    hc.handlers.pointerup(ev(at(4, 0), { button: 1 }));
    // quick clicks are not for fitting the map
    hc.handlers.dblclick({ clientX: at(4, 0).clientX, clientY: at(4, 0).clientY });
    ok(fitted.calls === 0, 'a double-click fitted the map while drawing');

    // a branch that goes past the top of the map: it grows, and the picture stays where it was
    const screen1 = roomScreen();
    drag([[4, 1], [4, 0], [4, -1], [4, -2]]);
    ok(fx.height === 5 && fx.halls.length === 1 && notices[1].dy === 2, `the branch gave ${fx.width} x ${fx.height}, ${fx.halls.length} halls, ${JSON.stringify(notices[1])}`);
    const screen2 = roomScreen();
    ok(Math.abs(screen2[0] - screen1[0]) < 1e-9 && Math.abs(screen2[1] - screen1[1]) < 1e-9, `the picture moved when the map grew: ${screen1} -> ${screen2}`);

    // right-click with the same tool: the hallway under the pointer is picked out (the cross-hair stays), and a right click deletes its stretch
    let prevented = 0;
    const rightClick = (x, y) => {
      hc.handlers.pointerdown(ev(at(x, y), { button: 2 }));
      hc.handlers.pointerup(ev(at(x, y), { button: 2 }));
      hc.handlers.contextmenu({ ...ev(at(x, y), { button: 2 }), preventDefault: () => prevented++ });
    };
    ok(hc.classes.has('tool-draw'), 'the cross-hair went from the draw tool');
    hc.handlers.pointermove(ev(at(4, 1)));
    ok(r._hoverStretch && r._hoverStretch.length === 3 && hc.classes.has('tool-draw'), 'the stretch under the pointer is not picked out');
    hc.handlers.pointermove(ev(at(0, 0)));
    ok(!r._hoverStretch, 'a stretch is picked out where there is no hallway');
    hc.handlers.pointermove(ev(at(4, 1)));
    // the right button neither draws nor pans, and a stroke has no stretch picked out
    const view2 = { ...r.view };
    hc.handlers.pointerdown(ev(at(4, 1), { button: 2 }));
    ok(!r._stroke && !r._drag, 'the right button started a stroke or a pan');
    hc.handlers.pointerup(ev(at(4, 1), { button: 2 }));
    ok(fx.halls[0].cells.length === 6 && JSON.stringify(r.view) === JSON.stringify(view2) && notices.length === 2, 'the right button on its own changed something');
    rightClick(4, 1);
    ok(prevented === 1 && fx.halls.length === 1 && fx.halls[0].cells.length === 3 && fx.height === 3 && notices[2].kind === 'erase' && notices[2].dy === -2, `a right click deleted the wrong thing: ${fx.halls[0].cells.length} squares, height ${fx.height}, ${JSON.stringify(notices[2])}`);
    const screen3 = roomScreen();
    ok(Math.abs(screen3[1] - screen2[1]) < 1e-9, 'the picture moved when the map shrank back');
    rightClick(0, 0); // where there is nothing: no change, and still no menu
    ok(notices.length === 3 && prevented === 2, 'a right click on nothing deleted something, or let the menu through');
    hc.handlers.dblclick({ clientX: 1, clientY: 1 });
    ok(fitted.calls === 0, 'a double-click fitted the map with the hallway tool');
    r.setEditTool('door');
    hc.handlers.dblclick({ clientX: 1, clientY: 1 });
    ok(fitted.calls === 1, 'a double-click on bare ground no longer fits the map with the door tool');
    // the door rings are back with the door tool, the tools are gone when edit mode is
    marks.calls = 0;
    r.draw();
    ok(marks.calls === 1, 'the door rings are not drawn with the door tool');
    r.setEditMode(false);
    r.setEditTool('draw');
    ok(!hc.classes.has('tool-draw') && !hc.classes.has('over-hall'), 'a tool cursor is shown outside edit mode');
    // a changed dungeon still draws (the model was rebuilt from it)
    r.setEditMode(true);
    r.setEditTool('draw');
    drag([[4, 0], [4, -1]]);
    r.setDungeon(fx);
    r.draw();
    checkEdited(fx, 'after the tool tests');
    r.setEditMode(false);

    // the room tools: draw a rectangle, move a room, delete a room
    {
      const g = hallFixture(); // two 3 x 3 rooms, (0,0) and (6,0), with the entrance E1 in the west wall of the first
      r.setDungeon(g);
      r.view = { scale: 40, tx: 200, ty: 200 };
      r.setEditMode(true);
      const changes = [];
      const notes = [];
      r.onRoomChange = (n) => changes.push(n);
      r.onNote = (t) => notes.push(t);
      r.beforeEdit = () => 'token';
      const hint = hallDraw.calls;

      // draw: a drag from corner to corner shows the room as it will be, and letting go makes it (below the map, so the map grows)
      r.setEditTool('room');
      ok(hc.classes.has('tool-draw'), 'the room tool has no cross-hair cursor');
      hc.handlers.pointerdown(ev(at(1, 4)));
      hc.handlers.pointermove(ev(at(3, 5)));
      ok(r._roomDrag && r._roomDrag.plan.ok && r._roomDrag.plan.cells.length === 6 && /New room 3×2 \(15×10 ft\)/.test(r._roomTip().text), 'the room being drawn is not shown with its size');
      r.draw();
      ok(hallDraw.calls > hint, 'the room being drawn is not drawn');
      hallDraw.calls = 0;
      r.exportImage({ legend: true, caption: 'x' });
      ok(r._roomDrag, 'a picture of the map ended the room being drawn');
      hc.handlers.pointerup(ev(at(3, 5)));
      ok(g.rooms.length === 3 && g.rooms[2].label === 3 && g.rooms[2].id === 2 && g.height === 6 && !r._roomDrag, 'releasing did not make the room');
      ok(changes.length === 1 && changes[0].kind === 'add' && changes[0].token === 'token' && changes[0].dx === 0 && changes[0].room === g.rooms[2], `the change notice for a room is ${JSON.stringify(changes[0])}`);
      // a rectangle that runs into a room: nothing is made, and the page is told why
      drag([[4, 1], [7, 1]]);
      ok(g.rooms.length === 3 && notes.length === 1 && /already part of room 2/.test(notes[0]), `drawing over a room said ${JSON.stringify(notes)}`);
      // a click on bare ground makes nothing
      drag([[4, 1]]);
      ok(g.rooms.length === 3 && changes.length === 1, 'a click on bare ground made a room');
      // Escape drops it
      hc.handlers.pointerdown(ev(at(5, 4)));
      hc.handlers.pointermove(ev(at(5, 5)));
      r._key({ code: 'Escape' }, true);
      hc.handlers.pointerup(ev(at(5, 5)));
      ok(g.rooms.length === 3 && !r._roomDrag, 'Escape did not drop the room being drawn');
      // Space held pans instead
      hc.handlers.pointerenter({});
      r._key({ code: 'Space', target: {}, preventDefault() {} }, true);
      hc.handlers.pointerdown(ev(at(5, 4)));
      ok(!r._roomDrag, 'a room was started with Space held');
      hc.handlers.pointerup(ev(at(5, 4)));
      r._key({ code: 'Space', target: {}, preventDefault() {} }, false);

      // move: the room under the pointer is picked out (and the cross-hair goes), and a drag that starts on it carries it
      hc.handlers.pointermove(ev(at(7, 1)));
      ok(r._hoverRoom === g.rooms[1] && hc.classes.has('over-hall') && !hc.classes.has('tool-draw') && /Drag to move room 2/.test(r._roomTip().text), 'the room under the pointer is not picked out');
      hc.handlers.pointermove(ev(at(4, 1)));
      ok(!r._hoverRoom && !hc.classes.has('over-hall') && hc.classes.has('tool-draw'), 'a room is picked out where there is none, or the cross-hair is missing');
      hc.handlers.pointerdown(ev(at(7, 1)));
      hc.handlers.pointermove(ev(at(7, 4)));
      ok(r._moveDrag && r._moveDrag.plan.ok && /Move room 2/.test(r._roomTip().text), 'the room being moved is not shown');
      r.draw();
      hc.handlers.pointerup(ev(at(7, 4)));
      ok(g.rooms[1].bbox.y === 3 && g.rooms[1].cells[0][1] === 3 && changes.length === 2 && changes[1].kind === 'move' && !r._moveDrag, `moving room 2 gave ${JSON.stringify(g.rooms[1].bbox)}`);
      // onto another room: refused, with the reason, and nothing changes
      const before = JSON.stringify(g.rooms);
      drag([[7, 4], [1, 4]]);
      ok(JSON.stringify(g.rooms) === before && changes.length === 2 && /in the way/.test(notes[notes.length - 1]), `moving onto a room said ${JSON.stringify(notes[notes.length - 1])}`);
      // a click moves nothing
      drag([[7, 4]]);
      ok(changes.length === 2, 'a click moved a room');

      // delete: with the room tool a right click on a room takes it away (the rest are renumbered); the room with the only entrance stays
      let prevented = 0;
      const rightClick = (x, y) => {
        hc.handlers.pointerdown(ev(at(x, y), { button: 2 }));
        hc.handlers.pointerup(ev(at(x, y), { button: 2 }));
        hc.handlers.contextmenu({ ...ev(at(x, y), { button: 2 }), preventDefault: () => prevented++ });
      };
      hc.handlers.pointermove(ev(at(7, 4)));
      ok(r._hoverRoom === g.rooms[1] && /Drag to move room 2 · right-click to delete/.test(r._roomTip().text), 'the room to delete is not picked out');
      hc.handlers.pointermove(ev(at(4, 1)));
      ok(!r._hoverRoom && !r._roomTip(), 'a room is picked out where there is none');
      hc.handlers.pointermove(ev(at(1, 1)));
      ok(/Drag to move room 1 · it stays: it has the only entrance/.test(r._roomTip().text), `the tag over the room with the only entrance says ${r._roomTip().text}`);
      r.draw();
      // the right button neither draws nor pans
      const view4 = { ...r.view };
      hc.handlers.pointerdown(ev(at(4, 1), { button: 2 }));
      ok(!r._roomDrag && !r._drag, 'the right button started a drag');
      hc.handlers.pointerup(ev(at(4, 1), { button: 2 }));
      ok(JSON.stringify(r.view) === JSON.stringify(view4) && g.rooms.length === 3, 'the right button changed the view');
      // left clicks do not delete
      drag([[2, 4]]);
      ok(g.rooms.length === 3, 'a left click deleted a room');
      rightClick(1, 1);
      ok(g.rooms.length === 3 && prevented === 1 && /Room 1 stays/.test(notes[notes.length - 1]), 'the room with the only entrance was deleted');
      rightClick(4, 1); // bare ground: nothing, and still no menu
      ok(g.rooms.length === 3 && prevented === 2 && changes.length === 2, 'a right click on bare ground did something, or let the menu through');
      rightClick(2, 4); // the room drawn first (number 3)
      ok(g.rooms.length === 2 && changes.length === 3 && changes[2].kind === 'delete' && g.rooms.map((q) => q.label).join() === '1,2' && g.rooms.every((q, i) => q.id === i), `deleting a room gave ${g.rooms.map((q) => q.label)}`);
      rightClick(7, 4); // number 2, which is not the last
      ok(g.rooms.length === 1 && g.rooms[0].label === 1 && changes[3].kind === 'delete' && g.height === 3 && g.width === 3, `deleting the second room gave ${g.width} x ${g.height}`);
      rightClick(1, 1);
      ok(g.rooms.length === 1 && /at least one room/.test(notes[notes.length - 1]), 'the only room was deleted');
      // the other tools leave the menu alone
      r.setEditTool('stairs');
      hc.handlers.contextmenu({ ...ev(at(1, 1), { button: 2 }), preventDefault: () => prevented++ });
      ok(prevented === 5, 'the menu was held back with the stairs tool');
      checkEdited(g, 'after the room tools');
      r.beforeEdit = null;
      r.onRoomChange = null;
      r.onNote = null;
      r.setEditMode(false);
    }

    // the door tool: a click on a wall adds a door (an entrance if nothing is beside it), a right click takes one out
    {
      const g = hallFixture();
      r.setDungeon(g);
      r.view = { scale: 40, tx: 200, ty: 200 };
      r.setEditMode(true);
      r.setEditTool('door');
      const doorChanges = [];
      const notes = [];
      r.onDoorChange = (n) => doorChanges.push(n);
      r.onNote = (t) => notes.push(t);
      r.beforeEdit = () => 'token';
      let prevented = 0;
      // a point 3 px inside square (x, y), by its wall on side d
      const edge = (x, y, d) => {
        const c = at(x, y);
        return { clientX: c.clientX + DX[d] * 17, clientY: c.clientY + DY[d] * 17 };
      };
      const click = (pos) => {
        hc.handlers.pointerdown(ev(pos));
        hc.handlers.pointerup(ev(pos));
      };
      const rightClick = (pos) => {
        hc.handlers.pointerdown(ev(pos, { button: 2 }));
        hc.handlers.pointerup(ev(pos, { button: 2 }));
        hc.handlers.contextmenu({ ...ev(pos, { button: 2 }), preventDefault: () => prevented++ });
      };

      // hovering a wall: picked out, and the tag says what a click will do (or why not)
      hc.handlers.pointermove(ev(edge(1, 0, 0)));
      ok(r._hoverWall && r._hoverWall.plan.ok && r._hoverWall.plan.kind === 'entrance' && /Click to add an entrance/.test(r._wallTip(r._hoverWall)) && hc.classes.has('over-door'), 'a wall that can take an entrance is not picked out');
      r.draw();
      hc.handlers.pointermove(ev(edge(2, 1, 1)));
      ok(r._hoverWall && !r._hoverWall.plan.ok && /Shut in|shut in/.test(r._wallTip(r._hoverWall)) && !hc.classes.has('over-door'), 'a wall that is shut in is offered a door');
      r.draw();
      hc.handlers.pointermove(ev(at(1, 1)));
      ok(!r._hoverWall, 'the middle of a room has a wall picked out');

      // a click on a wall with nothing beside it adds an entrance; on one that is shut in it says why
      click(edge(1, 0, 0));
      ok(g.entrances.length === 2 && g.entrances[1].d === 0 && doorChanges.length === 1 && doorChanges[0].added && doorChanges[0].kind === 'entrance' && doorChanges[0].token === 'token', `a click on an outer wall gave ${JSON.stringify(doorChanges)}`);
      checkEdited(g, 'an entrance added by clicking');
      click(edge(2, 1, 1));
      ok(g.entrances.length === 2 && doorChanges.length === 1 && /shut in/.test(notes[notes.length - 1]), `a click on a wall that is shut in said ${JSON.stringify(notes)}`);
      // the entrance: left click leaves it, hovering says how to remove it, right click removes it (never the last one)
      hc.handlers.pointermove(ev(edge(1, 0, 0)));
      ok(/Entrance E2 · right-click to remove/.test(r._wallTip(r._hoverWall)), 'the tag over an entrance does not say how to remove it');
      click(edge(1, 0, 0));
      ok(g.entrances.length === 2 && doorChanges.length === 1, 'a left click changed an entrance');
      rightClick(edge(1, 0, 0));
      ok(prevented === 1 && g.entrances.length === 1 && doorChanges.length === 2 && doorChanges[1].removed && doorChanges[1].kind === 'entrance', 'a right click did not remove the entrance');
      rightClick(edge(0, 1, 3));
      ok(prevented === 2 && g.entrances.length === 1 && /stays/.test(notes[notes.length - 1]), 'the last entrance was removed');
      checkEdited(g, 'an entrance removed by right-clicking');

      // a hallway beside a wall: a click opens a door into it, and a right click closes it again
      const hr = DM.addHallway(g, [[0, -1], [1, -1], [2, -1]]);
      r.view.ty -= hr.dy * 40;
      r.refreshModel({ moved: true });
      hc.handlers.pointermove(ev(edge(1, hr.dy, 0)));
      ok(r._hoverWall && r._hoverWall.plan.kind === 'hall' && /Click to add a door/.test(r._wallTip(r._hoverWall)), 'the wall beside a hallway is not offered a door');
      click(edge(1, hr.dy, 0));
      ok(g.connections[0].openings.length === 1 && doorChanges[2].added && doorChanges[2].kind === 'hall' && r.model.edits.length === 1, `a click beside a hallway gave ${JSON.stringify(doorChanges[2])}`);
      checkEdited(g, 'a door into a hallway by clicking');
      // now that there is a door, a click on it changes it (as before) and does not add another
      click(edge(1, hr.dy, 0));
      ok(g.connections[0].openings.length === 1 && g.connections[0].openings[0].style === 'locked' && !doorChanges[3].added, 'a click on a new door did not change it');
      rightClick(edge(1, hr.dy, 0));
      ok(g.connections[0].openings.length === 0 && doorChanges[4].removed && doorChanges[4].kind === 'door', 'a right click did not take the door out');
      // the middle button still pans
      const view5 = { ...r.view };
      hc.handlers.pointerdown(ev(edge(1, 0, 0), { button: 1 }));
      hc.handlers.pointermove(ev({ clientX: edge(1, 0, 0).clientX + 30, clientY: edge(1, 0, 0).clientY }, { button: 1 }));
      hc.handlers.pointerup(ev({ clientX: edge(1, 0, 0).clientX + 30, clientY: edge(1, 0, 0).clientY }, { button: 1 }));
      ok(r.view.tx === view5.tx + 30 && doorChanges.length === 5, 'the middle button did not pan, or changed a door');
      r.beforeEdit = null;
      r.onDoorChange = null;
      r.onNote = null;
      r.setEditMode(false);
    }
  }


  // the page: the tools, the script that does the work, and the keys
  {
    const html = read('index.html');
    const app = read('src', 'app.js');
    const css = read('styles.css');
    const render = read('src', 'render.js');
    const tools = html.slice(html.indexOf('<div class="edit-tools"'), html.indexOf('</div>', html.indexOf('<div class="edit-tools"')));
    const buttons = [...tools.matchAll(/<button type="button" data-tool="(\w+)" aria-pressed="(\w+)"[^>]*>(.*?)<\/button>/g)].map((m) => [m[1], m[2], m[3].replace(/<[^>]*>/g, '')].join('|'));
    // each button underlines the letter of its key (E for Edit, D H R S for the tools)
    for (const [m, k] of [...tools.matchAll(/data-tool="(\w+)"[^>]*aria-keyshortcuts="(\w)"[^>]*><u>(\w)<\/u>/g)].map((x) => [x[1], x[2]])) if (!m) fail('edit', `no tool for key ${k}`);
    if ([...tools.matchAll(/aria-keyshortcuts="(\w)"[^>]*><u>(\w)<\/u>/g)].some((x) => x[1] !== x[2]) || [...tools.matchAll(/aria-keyshortcuts="\w"/g)].length !== [...tools.matchAll(/<u>\w<\/u>/g)].length) fail('edit', 'the underlined letter of a tool button is not its key');
    if (buttons.join() !== 'door|true|Doors,draw|false|Hallway,room|false|Room') fail('edit', `the edit tools are [${buttons}]`);
    if (!/id="editTools"[^>]*\shidden/.test(tools)) fail('edit', 'the edit tools should be hidden until Edit is on');
    if (!/id="editControls"[^>]*\shidden/.test(html) || html.indexOf('id="editControls"') < html.indexOf('id="editTools"')) fail('edit', 'the controls list should be under the tools, hidden until Edit is on');
    for (const tool of ['door', 'draw', 'room', 'stairs']) {
      const rows = (app.match(new RegExp(`\\n    ${tool}: \\[(.*)\\],\\n`)) || [])[1] || '';
      if (!/Right click|Left click|Left drag|Shift/.test(rows) || !/Pan/.test(rows)) fail('edit', `the ${tool} tool has no list of controls with panning in it`);
    }
    if (!/\$\('editControls'\)\.hidden = !on/.test(app)) fail('edit', 'the controls list is not shown and hidden with Edit mode');
    // the keys: E for Edit mode, D H R S for the tools (not while typing, not with Ctrl, Cmd or Alt, and the tools only in Edit mode)
    if (!/TOOL_KEYS = \{ d: 'door', h: 'draw', r: 'room', s: 'stairs' \}/.test(app) || !/key === 'e'[^]{0,40}setEditMode\(!on\)/.test(app) || !/on && TOOL_KEYS\[key\][^]{0,300}setEditTool\(TOOL_KEYS\[key\]\)/.test(app)) fail('edit', 'the tool keys are not wired up in app.js');
    const keyHandler = app.slice(app.indexOf('const TOOL_KEYS'), app.indexOf('renderer.onDoorChange = '));
    if (!/e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey/.test(keyHandler) || !/'INPUT'/.test(keyHandler) || !/discardDialog/.test(keyHandler)) fail('edit', 'the tool keys must leave typing, Ctrl/Cmd/Alt chords and open boxes alone');
    for (const [tool, k] of [['door', 'D'], ['draw', 'H'], ['room', 'R'], ['stairs', 'S']]) {
      if (!new RegExp(`data-tool="${tool}"[^>]*aria-keyshortcuts="${k}"`).test(html)) fail('edit', `the ${tool} button does not say its key is ${k}`);
    }
    const toolbarAt = html.indexOf('<div class="toolbar">');
    if (!(toolbarAt > 0 && html.indexOf('id="editMode"') > toolbarAt && html.indexOf('<div class="edit-tools"') > html.indexOf('id="fit"') && html.indexOf('<div class="edit-tools"') < html.indexOf('id="legend"'))) fail('edit', 'the edit tools belong in the toolbar, under the buttons');
    const at = (s) => html.indexOf(`src/${s}.js`);
    if (!(at('generator') > 0 && at('generator') < at('edit') && at('edit') < at('render'))) fail('edit', 'edit.js must be loaded after generator.js and before render.js');
    if (!/doors and hallways/.test(html.slice(html.indexOf('<dialog')))) fail('edit', 'the warning should say that hallway edits are lost too');
    if (!/renderer\.onLayoutChange = /.test(app) || !/renderer\.onRoomChange = /.test(app) || !/setEditTool\(/.test(app) || !/\$\('editTools'\)\.hidden = !on/.test(app)) fail('edit', 'the edit tools are not wired up in app.js');
    if (!/showSummary\(DM\.current, builtMs\)/.test(app)) fail('edit', 'the summary does not follow hallway edits');
    // a touch screen has no Space key: its hint for drawing says how else to pan, and the page copes with no matchMedia
    if (!/drawTouch: '[^']*Doors[^']*'/.test(app) || /drawTouch: '[^']*Space/.test(app)) fail('edit', 'the touch hint for drawing should say to pick Doors to pan, not to hold Space');
    if (!/typeof window\.matchMedia === 'function' && window\.matchMedia\('\(pointer: coarse\)'\)\.matches/.test(app) || !/\$\('canvasHint'\)\.textContent = toolHint\(renderer\.editTool\)/.test(app)) fail('edit', 'the hint for the tools does not switch to the touch wording on a touch screen');
    if (!/window\.addEventListener\('keydown'/.test(render) || !/window\.addEventListener\('keyup'/.test(render)) fail('edit', 'Space is not listened for');
    for (const sel of ['\\.edit-tools\\[hidden\\]', "\\.edit-tools button\\[aria-pressed='true'\\]", '#map\\.tool-draw', '#map\\.over-hall', '\\.toolbar-row']) if (!new RegExp(sel).test(css)) fail('edit', `styles.css has no ${sel}`);
  }

  // the page: the button on the map, the warning, the legend, and what asks before throwing edits away
  const html = read('index.html');
  const app = read('src', 'app.js');
  const css = read('styles.css');
  const toolbar = html.slice(html.indexOf('<div class="toolbar">'), html.indexOf('</div>', html.indexOf('<div class="toolbar">')));
  if (!/<button type="button" id="editMode"[^>]*aria-pressed="false"[^>]*><u>E<\/u>dit<\/button>/.test(toolbar) || !/id="editMode"[^>]*aria-keyshortcuts="E"/.test(toolbar)) fail('edit', 'the toolbar on the map has no Edit button, with its E underlined, that shows whether it is on');
  const dialog = html.slice(html.indexOf('<dialog id="discardDialog"'), html.indexOf('</dialog>'));
  if (!dialog || !/lose all edits/.test(dialog) || !/value="discard"/.test(dialog) || !/value="cancel"[^>]*autofocus|autofocus[^>]*value="cancel"/.test(dialog)) fail('edit', 'the warning should say re-generating will lose all edits, and Keep editing should be the button already chosen');
  if (html.indexOf('<dialog') < html.indexOf('</form>')) fail('edit', 'the warning is inside the main form (a form cannot hold a form)');
  for (const id of ['legendHall', 'legendDoor', 'legendLocked', 'legendSecret', 'legendEntrance', 'legendStairsEntrance', 'legendLevelStairs']) if (!new RegExp(`<li id="${id}" hidden>`).test(html)) fail('edit', `the legend line ${id} is missing, or shown for maps with none`);
  for (const sel of ["\\.edit-toggle\\[aria-pressed='true'\\]", '\\.sw-locked', '\\.sw-secret', '#discardDialog', '#map\\.over-door', '\\.legend li\\[hidden\\]']) if (!new RegExp(sel).test(css)) fail('edit', `styles.css has no ${sel}`);
  if (!/\.toolbar\s*\{[^}]*z-index:\s*2/.test(css)) fail('edit', 'the toolbar must sit above the legend card, or the card can cover the Edit button');
  if (!/@media \(max-width: 760px\)[^]*?\.toolbar-row,\s*\.edit-tools\s*\{\s*flex-direction:\s*column/.test(css)) fail('edit', 'on a narrow screen the toolbar should stack, so the Edit button does not run under the legend');
  // every way of building a new dungeon asks first (the first one, at page load, has nothing to lose)
  if (!/\$\('params'\)\.addEventListener\('submit',[^]*?ifEditsDiscarded\(\(\) => generate\(\{ fillSeed: true \}\)\)/.test(app)) fail('edit', 'Re-generate dungeon does not ask before losing edits');
  if (!/\$\('generateRandom'\)\.addEventListener\('click', \(\) => ifEditsDiscarded\(/.test(app)) fail('edit', 'Generate with random seed does not ask before losing edits');
  if (!/\$\('resetSettings'\)\.addEventListener\('click', \(\) =>\s*ifEditsDiscarded\(/.test(app)) fail('edit', 'Reset all does not ask before losing edits');
  if (!/addEventListener\('hashchange', \(\) => ifEditsDiscarded\(openLink, dropLinkFromAddress\)\)/.test(app)) fail('edit', 'opening a link does not ask before losing edits');
  const calls = (app.match(/\bgenerate\(/g) || []).length;
  const guarded = (app.match(/ifEditsDiscarded\([^;]*generate\(/g) || []).length + (app.match(/ifEditsDiscarded\(openLink/g) || []).length;
  if (calls !== 6 || guarded < 3) fail('edit', `generate() is called ${calls} times; the buttons that call it should all ask first (found ${guarded} that do)`);
  if (!/editsAsBuilt = DM\.editState\(dungeon\)/.test(app) || !/DM\.editState\(DM\.current\) !== editsAsBuilt/.test(app)) fail('edit', 'app.js does not tell whether a door or hallway was changed since the dungeon was built');
  if (!/renderer\.onDoorChange = \([^)]*\) => \{\s*updateDoorLegend\(\);/.test(app) || !/\$\('editMode'\)\.addEventListener\('click'/.test(app) || !/renderer\.setEditMode\(on\)/.test(app)) fail('edit', 'the Edit button is not wired to the renderer');
  if (!/editsMade\(\) \? '[^']*without your edits/.test(app)) fail('edit', 'Copy link should say a link does not carry edits');
  for (const k of ['Path2D', 'window', 'requestAnimationFrame', 'document']) delete globalThis[k]; // (the stand-ins are only for this section)
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
