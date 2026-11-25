/*
 * Tile list (bill of materials): which printed Dungeon Tiles a dungeon needs, and what to print to get them.
 *
 * The tiles are described by the Dungeon Tiles catalog (catalog/tiles.json in github.com/bmg50barrett/Dungeon-Tiles): every
 * tile design ("face") with its size and the gaps in its walls, and every printed file ("edition") with the pieces on it. A
 * double-sided piece carries two faces and shows one at a time.
 *
 *   rooms     each room is matched to the face with the same size and the same doorways, in any of 4 turns
 *   hallways  each hallway square is a dead end, corner, T or crossroads piece by how many ways it opens, and the straight
 *             stretches between them are filled with the straight pieces (longest first)
 *   problems  anything no tile can make (a room of another size or shape, a straight stretch no straight pieces add up to,
 *             a hallway wider than 5 ft) is listed, never dropped
 *
 * A dungeon of several levels is laid out one level at a time, so the tiles needed are the most any one level needs.
 * Works in the page and in Node (the MCP server); it only reads the dungeon model. The catalog it is given is the copy kept
 * in the app (src/tiles-catalog.js): nothing is fetched.
 */
(function () {
  const DM = (globalThis.DM = globalThis.DM || {});
  const DX = [0, 1, 0, -1];
  const DY = [-1, 0, 1, 0];
  const OPP = [2, 3, 0, 1];
  const SIDES = ['N', 'E', 'S', 'W'];


  const cellKey = (x, y) => `${x},${y}`;

  // ---- faces --------------------------------------------------------------------------------------------------------

  /** The faces as a signature -> id map, each in all 4 turns. Openings are [offset, width], offsets clockwise (see the catalog). */
  function faceIndex(catalog) {
    const sig = (w, h, sides) => `${w}x${h}|` + sides.map((s) => s.map((o) => o.join(':')).sort().join(',')).join('|');
    const index = new Map();
    for (const [id, f] of Object.entries(catalog.faces)) {
      let [w, h] = f.size;
      let sides = SIDES.map((k) => f.openings[k] || []);
      for (let t = 0; t < 4; t++) {
        const k = sig(w, h, sides);
        if (!index.has(k)) index.set(k, id);
        sides = [sides[3], sides[0], sides[1], sides[2]]; // a quarter turn clockwise
        [w, h] = [h, w];
      }
    }
    return { index, sig };
  }

  // ---- rooms --------------------------------------------------------------------------------------------------------

  /** Every room's doorways as [x, y, d]: d is the wall (0 N, 1 E, 2 S, 3 W) and (x, y) the square inside the room. */
  function roomDoorways(floor) {
    const byRoom = new Map(floor.rooms.map((r) => [r.id, []]));
    const add = (id, x, y, d) => {
      const list = byRoom.get(id);
      if (list && !list.some((o) => o[0] === x && o[1] === y && o[2] === d)) list.push([x, y, d]);
    };
    for (const c of floor.connections) {
      for (const o of c.openings) {
        add(o.room, o.x, o.y, o.d);
        if (c.type === 'door') {
          // a doorway between two rooms is an opening in both
          const other = c.rooms.find((id) => id !== o.room);
          add(other, o.x + DX[o.d], o.y + DY[o.d], OPP[o.d]);
        }
      }
    }
    for (const e of floor.entrances || []) if (e.kind === 'door') add(e.room, e.x, e.y, e.d);
    return byRoom;
  }

  function matchRoom(room, doorways, faces) {
    const b = room.bbox;
    const square = room.area === b.w * b.h;
    if (!square) return { problem: `${b.w * 5}x${b.h * 5} ft ${room.kind === 'rect' ? 'room' : `${room.kind} room`}: no tile has that shape` };
    if (doorways.length === 0) return { problem: `${b.w * 5}x${b.h * 5} ft room with no doorways (reached by stairs only): no tile without doors` };
    const sides = [[], [], [], []];
    for (const [x, y, d] of doorways) {
      const off = [x - b.x, y - b.y, b.x + b.w - 1 - x, b.y + b.h - 1 - y][d];
      sides[d].push([off, 1]);
    }
    const id = faces.index.get(faces.sig(b.w, b.h, sides));
    if (id) return { face: id };
    return { problem: `${b.w * 5}x${b.h * 5} ft room: no tile has doorways in those places` };
  }

  // ---- hallways -----------------------------------------------------------------------------------------------------

  /** Straight pieces in the catalog for 5 ft hallways, longest first: [{ id, length }]. */
  function straightPieces(catalog) {
    return Object.entries(catalog.faces)
      .filter(([, f]) => f.kind === 'hall' && f.hall_width_ft === 5 && f.size[0] === 1 && f.size[1] > 1)
      .map(([id, f]) => ({ id, length: f.size[1] }))
      .sort((a, b) => b.length - a.length);
  }

  /** The fewest straight pieces that add up to `length` exactly: { id: count }, or null if none do. */
  function fillStraight(length, straights) {
    let best = null;
    const walk = (i, left, used, count) => {
      if (left === 0) {
        if (!best || count < best.count) best = { used: { ...used }, count };
        return;
      }
      if (i >= straights.length || (best && count >= best.count)) return;
      const { id, length: L } = straights[i];
      for (let n = Math.floor(left / L); n >= 0; n--) {
        if (n > 0) used[id] = n;
        else delete used[id];
        walk(i + 1, left - n * L, used, count + n);
      }
      delete used[id];
    };
    walk(0, length, {}, 0);
    return best ? best.used : null;
  }

  /** One square's piece by the ways it opens: 1 a dead end, 2 a corner (a straight is handled with its stretch), 3 a T, 4 crossroads. */
  const JUNCTION = { 1: 'H5-D', 2: 'H5-L', 3: 'H5-T', 4: 'H5-X' };

  function hallPieces(floor, hall, catalog, hallName) {
    const pieces = {};
    const problems = [];
    const cells = new Set(hall.cells.map(([x, y]) => cellKey(x, y)));
    for (const [x, y] of hall.cells) {
      if (cells.has(cellKey(x + 1, y)) && cells.has(cellKey(x, y + 1)) && cells.has(cellKey(x + 1, y + 1))) {
        return { pieces: {}, problems: [`${hallName}: wider than 5 ft, and the hallway tiles are 5 ft wide`] };
      }
    }
    // which ways each square opens: into the hallway's own squares, or through a doorway into a room
    const links = new Set();
    for (const c of floor.connections) {
      if (c.type !== 'hall' || c.hall !== hall.id) continue;
      for (const o of c.openings) links.add(`${cellKey(o.x + DX[o.d], o.y + DY[o.d])},${OPP[o.d]}`);
    }
    const ways = new Map();
    for (const [x, y] of hall.cells) {
      const dirs = [];
      for (let d = 0; d < 4; d++) if (cells.has(cellKey(x + DX[d], y + DY[d])) || links.has(`${cellKey(x, y)},${d}`)) dirs.push(d);
      ways.set(cellKey(x, y), dirs);
    }
    const isStraight = (dirs) => dirs.length === 2 && OPP[dirs[0]] === dirs[1];
    const add = (id, n = 1) => (pieces[id] = (pieces[id] || 0) + n);
    for (const [x, y] of hall.cells) {
      const dirs = ways.get(cellKey(x, y));
      if (!isStraight(dirs)) add(JUNCTION[dirs.length] || 'H5-D');
    }
    // straight stretches: runs of straight squares along one line
    const straights = straightPieces(catalog);
    const seen = new Set();
    for (const [x, y] of hall.cells) {
      const k = cellKey(x, y);
      const dirs = ways.get(k);
      if (seen.has(k) || !isStraight(dirs)) continue;
      const d = dirs[0] % 2 === 0 ? 0 : 1; // up and down the map, or across it
      // back up to the start of the stretch, then walk it
      let sx = x;
      let sy = y;
      while (true) {
        const px = sx - DX[d];
        const py = sy - DY[d];
        const pd = ways.get(cellKey(px, py));
        if (!pd || !isStraight(pd) || pd[0] % 2 !== d % 2) break;
        sx = px;
        sy = py;
      }
      let length = 0;
      for (let cx = sx, cy = sy; ; cx += DX[d], cy += DY[d]) {
        const cd = ways.get(cellKey(cx, cy));
        if (!cd || !isStraight(cd) || cd[0] % 2 !== d % 2) break;
        seen.add(cellKey(cx, cy));
        length++;
      }
      const fill = fillStraight(length, straights);
      if (fill) for (const [id, n] of Object.entries(fill)) add(id, n);
      else problems.push(`${hallName}: a straight stretch ${length} square${length === 1 ? '' : 's'} (${length * 5} ft) long, which the straight hallway tiles (${straights.map((s) => s.length).join(' and ')} squares) cannot add up to`);
    }
    return { pieces, problems };
  }

  // ---- the whole dungeon --------------------------------------------------------------------------------------------

  function floorsOf(dungeon) {
    return [dungeon, ...(dungeon.floors || [])].map((fl, i) => ({ ...fl, level: fl.level || i + 1 }));
  }

  /**
   * The tiles a dungeon needs.
   * @returns {{ levels: Array<{ level, rooms: Array<{ label, face?, problem? }>, needs: object, problems: string[], doors: number }>,
   *             needs: object, problems: string[], doors: number, stairs: number, catalogVersion: number }}
   *   needs: { faceId: count } the most any one level needs (levels are laid out one at a time)
   */
  function tileList(dungeon, catalog) {
    const faces = faceIndex(catalog);
    const many = (dungeon.levels || 1) > 1;
    const levels = floorsOf(dungeon).map((fl) => {
      const tag = (label) => (many ? `${fl.level}-${label}` : `${label}`);
      const needs = {};
      const problems = [];
      const doorways = roomDoorways(fl);
      const rooms = fl.rooms.map((r) => {
        const m = matchRoom(r, doorways.get(r.id) || [], faces);
        if (m.face) needs[m.face] = (needs[m.face] || 0) + 1;
        else problems.push(`Room ${tag(r.label)}: ${m.problem}`);
        return { label: tag(r.label), ...m };
      });
      fl.halls.forEach((h, i) => {
        const name = `Hallway ${many ? `${fl.level}-` : ''}${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}`;
        const got = hallPieces(fl, h, catalog, name);
        for (const [id, n] of Object.entries(got.pieces)) needs[id] = (needs[id] || 0) + n;
        problems.push(...got.problems);
      });
      // doorways with a door in them (not open archways), which the tiles show only as an opening
      let doors = 0;
      for (const c of fl.connections) for (const o of c.openings) if (c.type === 'door' || o.style === 'door') doors++;
      return { level: fl.level, rooms, needs, problems, doors };
    });
    const needs = {};
    for (const l of levels) for (const [id, n] of Object.entries(l.needs)) needs[id] = Math.max(needs[id] || 0, n);
    return {
      levels,
      needs: Object.fromEntries(Object.entries(needs).sort()),
      problems: levels.flatMap((l) => l.problems),
      doors: Math.max(0, ...levels.map((l) => l.doors)),
      stairs: (dungeon.stairs || []).length + (dungeon.entrances || []).filter((e) => e.kind === 'stairs').length,
      catalogVersion: catalog.catalog_version,
    };
  }

  // ---- what to print ------------------------------------------------------------------------------------------------

  /**
   * How many of `needs` the pieces can cover at once, each piece showing one of its faces. Pieces are pooled by the faces
   * they carry ({ key, faces, count }), and the answer is a maximum flow: needs -> faces -> piece pools (small and quick).
   */
  function covered(needs, pools) {
    const faceIds = Object.keys(needs);
    const F = faceIds.length;
    const P = pools.length;
    const S = 0;
    const T = 1 + F + P;
    const cap = Array.from({ length: T + 1 }, () => new Array(T + 1).fill(0));
    faceIds.forEach((id, i) => {
      cap[S][1 + i] = needs[id];
      pools.forEach((pool, j) => {
        if (pool.faces.includes(id)) cap[1 + i][1 + F + j] = Infinity;
      });
    });
    pools.forEach((pool, j) => (cap[1 + F + j][T] = pool.count));
    let flow = 0;
    for (;;) {
      const prev = new Array(T + 1).fill(-1);
      prev[S] = S;
      const queue = [S];
      while (queue.length && prev[T] < 0) {
        const u = queue.shift();
        for (let v = 0; v <= T; v++) if (prev[v] < 0 && cap[u][v] > 0) { prev[v] = u; queue.push(v); }
      }
      if (prev[T] < 0) break;
      let push = Infinity;
      for (let v = T; v !== S; v = prev[v]) push = Math.min(push, cap[prev[v]][v]);
      for (let v = T; v !== S; v = prev[v]) { cap[prev[v]][v] -= push; cap[v][prev[v]] += push; }
      flow += push;
    }
    return { count: flow, of: Object.values(needs).reduce((a, n) => a + n, 0) };
  }

  /**
   * The fewest sheets of the single-sided (or double-sided) editions that hold every tile in `needs`.
   * @returns {{ editions: Array<{ id, name, file, copies, sheets }>, sheets: number, complete: boolean, missing: object }}
   *   missing: { faceId: count } still short when no number of copies can cover it (a face no such edition has)
   */
  function printPlan(needs, catalog, doubleSided = false) {
    const editions = catalog.editions.filter((e) => !!e.double_sided === !!doubleSided);
    const copies = editions.map(() => 0);
    // the pieces of `cs` printings of each edition, pooled by the faces they carry
    const piecesFor = (cs) => {
      const pools = new Map();
      editions.forEach((e, i) => {
        if (!cs[i]) return;
        for (const p of e.pieces) {
          const faces = [...new Set(p.faces)].sort();
          const key = faces.join('/');
          if (!pools.has(key)) pools.set(key, { key, faces, count: 0 });
          pools.get(key).count += cs[i];
        }
      });
      return [...pools.values()];
    };
    const total = Object.values(needs).reduce((a, n) => a + n, 0);
    // add a printing of whichever edition covers most per sheet, until everything is covered or nothing more helps
    let now = covered(needs, piecesFor(copies)).count;
    for (let guard = 0; now < total && guard < 1000; guard++) {
      let best = -1;
      let bestGain = 0;
      editions.forEach((e, i) => {
        const trial = copies.slice();
        trial[i]++;
        const gain = (covered(needs, piecesFor(trial)).count - now) / e.sheets;
        if (gain > bestGain) {
          bestGain = gain;
          best = i;
        }
      });
      if (best < 0) break;
      copies[best]++;
      now = covered(needs, piecesFor(copies)).count;
    }
    // then drop any printing that is not needed after all
    for (let i = 0; i < editions.length; i++) {
      while (copies[i] > 0) {
        const trial = copies.slice();
        trial[i]--;
        if (covered(needs, piecesFor(trial)).count < now) break;
        copies[i]--;
      }
    }
    // what is still short, face by face (a face none of these editions has)
    const missing = {};
    const have = piecesFor(copies);
    for (const [id, n] of Object.entries(needs)) {
      const can = have.filter((pool) => pool.faces.includes(id)).reduce((a, pool) => a + pool.count, 0);
      if (can < n) missing[id] = n - can;
    }
    const used = editions.map((e, i) => ({ id: e.id, name: e.name, file: e.file, cutGuide: e.cut_guide, copies: copies[i], sheets: copies[i] * e.sheets })).filter((e) => e.copies > 0);
    return { editions: used, sheets: used.reduce((a, e) => a + e.sheets, 0), complete: now === total, missing };
  }

  // ---- as text ------------------------------------------------------------------------------------------------------

  /** The tile list as plain text, for copying and for Claude. */
  function tileListText(list, catalog, plans) {
    const name = (id) => (catalog.faces[id] ? catalog.faces[id].name : id);
    const lines = [];
    const n = Object.values(list.needs).reduce((a, b) => a + b, 0);
    lines.push(`Tiles needed: ${n}${list.levels.length > 1 ? ' (the most any one level needs; lay out one level at a time)' : ''}`);
    for (const [id, count] of Object.entries(list.needs)) lines.push(`  ${String(count).padStart(3)} x ${id.padEnd(7)} ${name(id)}`);
    for (const plan of plans) {
      lines.push('');
      lines.push(`To print (${plan.doubleSided ? 'double-sided' : 'single-sided'}): ${plan.sheets} sheet${plan.sheets === 1 ? '' : 's'}${plan.complete ? '' : ', still short of some tiles'}`);
      for (const e of plan.editions) lines.push(`  ${e.copies} x ${e.name} (${e.sheets} sheet${e.sheets === 1 ? '' : 's'}): ${e.file}`);
      for (const [id, k] of Object.entries(plan.missing)) lines.push(`  short ${k} x ${id} ${name(id)}: not in these files`);
    }
    lines.push('');
    lines.push('Rooms:');
    const byNumber = (a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true });
    for (const l of list.levels) for (const r of l.rooms.slice().sort(byNumber)) lines.push(`  Room ${r.label}: ${r.face ? `${r.face} (${name(r.face)})` : `no tile (${r.problem})`}`);
    if (list.problems.length > 0) {
      lines.push('');
      lines.push(`Not buildable with the tiles (${list.problems.length}):`);
      for (const p of list.problems) lines.push(`  ${p}`);
    }
    const notes = [];
    if (list.doors > 0) notes.push(`${list.doors} doorway${list.doors === 1 ? ' has a door' : 's have doors'} on the map; the tiles show every doorway as an opening, so mark doors on the table if you want them`);
    if (list.stairs > 0) notes.push(`${list.stairs} stair${list.stairs === 1 ? '' : 's'} on the map; the room tiles have none, so mark them on the table`);
    if (notes.length) {
      lines.push('');
      for (const t of notes) lines.push(`Note: ${t}.`);
    }
    lines.push('');
    lines.push(`(Dungeon Tiles catalog version ${list.catalogVersion})`);
    return lines.join('\n');
  }

  DM.tileList = tileList;
  DM.tilePrintPlan = printPlan;
  DM.tileListText = tileListText;
  DM.fillStraight = fillStraight; // exposed for tests
})();
