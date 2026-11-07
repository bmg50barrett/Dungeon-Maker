/*
 * Where room numbers go. Inside, a label sits on the room's centre cell. Outside, it is
 * moved to just beyond one of the room's walls, in the gap between the rooms.
 *
 * Everything here is in grid cells, and the size of a number in cells does not change
 * with zoom (the renderer scales it with the map), so the places only need working out
 * once per dungeon. This file does no drawing, so it can be tested without a browser.
 */
(function () {
  const DM = (globalThis.DM = globalThis.DM || {});
  const { DX, DY } = DM.DIRS;

  /** Height of every room's number, in cells (the text's size, not the height of the digits, which is a little less). */
  const LABEL_SIZE = 1.25;

  /** What is written on a room: its number, with its level in front on a dungeon of several levels ("2-5"). */
  function roomTag(room) {
    return room.level ? `${room.level}-${room.label}` : String(room.label);
  }

  /**
   * Height of a room's number, in cells. The same for every room, whatever its size or shape, except that a longer tag
   * ("12-5", with its level) is written smaller, so that it still fits a small room.
   */
  function labelSize(room) {
    const len = room && room.label !== undefined ? roomTag(room).length : 1;
    return len <= 2 ? LABEL_SIZE : LABEL_SIZE * Math.max(0.6, 2.2 / len);
  }

  /*
   * How far from the wall a label may sit, nearest first. The first is right against it;
   * the others reach across a gap, and are joined to the wall by a thin line.
   */
  const GAPS = [0.2, 1.0, 1.8, 2.6];
  /** A label keeps at least this far from every room, its own included (cells). */
  const CLEARANCE = 0.1;
  /** Gaps wider than this get a line back to the wall. */
  const LEADER_GAP = 0.45;
  /** Preference for the side a label goes on, by direction (N, E, S, W): above reads best. */
  const SIDE_COST = [0, 0.5, 0.9, 0.5];
  /** How far out from an entrance door its arrow and "E1" label reach, and how wide the area is. */
  const ENTRANCE_REACH = 4.8;
  const ENTRANCE_HALF_WIDTH = 1.0;

  /**
   * Choose a place outside its own walls for every room's number.
   *
   * A label never overlaps any room. Beyond that it keeps clear of hallways, other labels
   * and the arrows of entrances where it can, stays close to its room, and prefers the
   * side facing away from the middle of the dungeon. A room with no free place within reach
   * gets null: the caller draws its number inside, as usual.
   *
   * @param {object} dungeon the dungeon model
   * @param {(text: string, size: number) => number} [textWidth] width in cells of `text` drawn
   *        `size` cells high (the renderer passes real measurements; the default is an estimate)
   * @returns {Array<null|{x, y, w, h, ax, ay, lx, ly, leader}>} per room (by id): the middle of
   *        the label box (x, y) and its size (w, h); the point on the wall it belongs to (ax, ay)
   *        and the point of the box nearest it (lx, ly); `leader` says whether to join them
   */
  function placeOutsideLabels(dungeon, textWidth) {
    const measure = textWidth || ((text, size) => text.length * 0.62 * size);
    const W = dungeon.width;
    const H = dungeon.height;
    const region = new Int32Array(W * H); // +room+1, -(hall+1), 0 for empty
    for (const r of dungeon.rooms) for (const [x, y] of r.cells) region[y * W + x] = r.id + 1;
    for (const h of dungeon.halls) for (const [x, y] of h.cells) region[y * W + x] = -(h.id + 1);
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : region[y * W + x]);

    // the stretch of ground in front of each entrance door where its arrow and label are drawn
    const zones = [];
    for (const e of dungeon.entrances) {
      if (e.kind === 'stairs') continue;
      const wx = e.x + 0.5 + DX[e.d] * 0.5;
      const wy = e.y + 0.5 + DY[e.d] * 0.5;
      const far = ENTRANCE_REACH;
      const half = ENTRANCE_HALF_WIDTH;
      const xs = [wx - DY[e.d] * half, wx + DY[e.d] * half, wx + DX[e.d] * far];
      const ys = [wy + DX[e.d] * half, wy - DX[e.d] * half, wy + DY[e.d] * far];
      zones.push({ x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
    }

    const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    const centreX = W / 2;
    const centreY = H / 2;
    const placed = [];
    const result = new Array(dungeon.rooms.length).fill(null);

    for (const room of dungeon.rooms) {
      const size = labelSize(room);
      const bh = size;
      const bw = measure(roomTag(room), size) + 0.15 * size;
      let rx = 0;
      let ry = 0;
      for (const [x, y] of room.cells) {
        rx += x + 0.5;
        ry += y + 0.5;
      }
      rx /= room.cells.length;
      ry /= room.cells.length;
      const toCentre = Math.hypot(centreX - rx, centreY - ry) || 1;

      let best = null;
      for (const [x, y] of room.cells) {
        for (let d = 0; d < 4; d++) {
          if (at(x + DX[d], y + DY[d]) === room.id + 1) continue; // not a wall of this room
          const ax = x + 0.5 + DX[d] * 0.5; // the middle of this stretch of wall
          const ay = y + 0.5 + DY[d] * 0.5;
          // how far the label sits along the wall from the room's middle, and whether it faces the dungeon's middle
          const along = d % 2 === 0 ? Math.abs(ax - rx) : Math.abs(ay - ry);
          const inward = Math.max(0, (DX[d] * (centreX - rx) + DY[d] * (centreY - ry)) / toCentre);
          const base = 0.15 * along + SIDE_COST[d] + 1.2 * inward;

          for (let gi = 0; gi < GAPS.length; gi++) {
            const g = GAPS[gi];
            const box =
              d === 0 ? { x0: ax - bw / 2, x1: ax + bw / 2, y0: ay - g - bh, y1: ay - g }
              : d === 2 ? { x0: ax - bw / 2, x1: ax + bw / 2, y0: ay + g, y1: ay + g + bh }
              : d === 3 ? { x0: ax - g - bw, x1: ax - g, y0: ay - bh / 2, y1: ay + bh / 2 }
              : { x0: ax + g, x1: ax + g + bw, y0: ay - bh / 2, y1: ay + bh / 2 };

            // never on top of a room, nor right up against one (CLEARANCE); hallways are avoided but not forbidden
            let cost = base + 3 * gi;
            let blocked = false;
            let halls = 0;
            const cx0 = Math.floor(box.x0);
            const cx1 = Math.ceil(box.x1);
            const cy0 = Math.floor(box.y0);
            const cy1 = Math.ceil(box.y1);
            for (let cy = Math.floor(box.y0 - CLEARANCE); cy < Math.ceil(box.y1 + CLEARANCE) && !blocked; cy++) {
              for (let cx = Math.floor(box.x0 - CLEARANCE); cx < Math.ceil(box.x1 + CLEARANCE); cx++) {
                const v = at(cx, cy);
                if (v > 0) {
                  blocked = true;
                  break;
                }
                if (v < 0 && cx >= cx0 && cx < cx1 && cy >= cy0 && cy < cy1) halls++;
              }
            }
            if (blocked) continue;
            cost += 12 * halls;
            for (const p of placed) if (overlaps(box, p)) cost += 60;
            for (const z of zones) if (overlaps(box, z)) cost += 25;

            if (!best || cost < best.cost) best = { cost, box, ax, ay, g, d };
          }
        }
      }

      if (!best) continue;
      const { box, ax, ay, g, d } = best;
      placed.push(box);
      result[room.id] = {
        x: (box.x0 + box.x1) / 2,
        y: (box.y0 + box.y1) / 2,
        w: bw,
        h: bh,
        ax,
        ay,
        lx: ax + DX[d] * g,
        ly: ay + DY[d] * g,
        leader: g > LEADER_GAP,
      };
    }
    return result;
  }

  /** The places a room's number can be drawn. */
  DM.LABEL_POSITIONS = ['inside', 'outside'];
  DM.LABEL_SIZE = LABEL_SIZE;
  DM.labelSize = labelSize;
  DM.roomTag = roomTag;
  DM.placeOutsideLabels = placeOutsideLabels;
})();
