/*
 * The overall layout of a dungeon: the footprint its rooms are drawn towards. Random has none, so rooms
 * grow outward however they like; the others lean the whole dungeon towards a familiar shape.
 *
 * A layout is only a lean, never a rule: the generator prefers places inside the shape, and gives
 * ground a little at a time when it cannot find room (so a layout never costs a dungeon its rooms).
 *
 * Everything here is in grid cells, measured from the middle of the map (the origin), with x across
 * and y down. This file draws nothing and knows nothing of the generator, so it can be tested alone.
 */
(function () {
  const DM = (globalThis.DM = globalThis.DM || {});

  /** The layouts, in the order the page lists them. */
  const LAYOUTS = ['random', 'cathedral', 'ring', 'cavern', 'radial', 'square', 'long', 'wide'];
  const DEFAULT_LAYOUT = 'random';

  /*
   * How many squares of footprint there are for each square of room, for each Room spacing: the gaps
   * and hallways take up room too. (Roughly what a dungeon with no layout measures across its
   * bounding box.)
   */
  const FILL = { compact: 2.6, normal: 2.9, spaced: 3.7 };

  /** How much longer a "long" or "wide" dungeon is than it is broad. */
  const ASPECT = 3;

  /** The cost of being outside the footprint, per square cell of distance beyond it. */
  const OUTSIDE = 4;

  /** Distance of (x, y) beyond a rectangle of half-sizes (hw, hh) centred on the origin, 0 inside it. */
  const beyondRect = (x, y, hw, hh) => Math.hypot(Math.max(0, Math.abs(x) - hw), Math.max(0, Math.abs(y) - hh));

  /** Distance of (x, y) to the nearest point of a rectangle with corners (x0, y0) and (x1, y1), 0 inside it. */
  const beyondBox = (x, y, x0, y0, x1, y1) => Math.hypot(Math.max(0, x0 - x, x - x1), Math.max(0, y0 - y, y - y1));

  /** Distance from (x, y) to the segment between (x0, y0) and (x1, y1). */
  function toSegment(x, y, x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
    return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy));
  }

  /** An angle brought into (-PI, PI]. */
  function wrap(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a <= -Math.PI) a += 2 * Math.PI;
    return a;
  }

  /**
   * Build the layout called `name` for a dungeon, or null for random (no shape).
   *
   * @param {string} name   one of LAYOUTS
   * @param {object} info
   * @param {number} info.rooms     how many rooms
   * @param {number} info.area      squares of room floor in all (the sum of the rooms' areas)
   * @param {number} info.side      about how wide a room is, in squares
   * @param {number} info.gap       about how far apart room centres are beyond their size (the spacing's usual gap)
   * @param {string} info.spacing   'compact', 'normal' or 'spaced'
   * @param {() => number} info.random  a source of numbers in [0, 1) for the odd one out (a cavern's outline)
   * @returns {null|{
   *   name: string,
   *   start: {x: number, y: number},
   *   outside: (x: number, y: number, index?: number) => number,
   *   score: (x: number, y: number, last: null|{x: number, y: number}, index?: number) => number,
   *   tolerance: (attempt: number) => number,
   *   closes: boolean,
   *   winding: number
   * }}
   *   start     where the middle of the first room goes, from the origin
   *   outside   how far a point is beyond the shape (0 inside it); `index` is the number of the room going there (0 for the first)
   *   score     how well room `index` centred at (x, y) fits (lower is better); `last` is the room placed before it
   *   tolerance how far beyond the shape a room may be on the given attempt (rising to anything) to find one
   *   closes    whether the shape is a loop that should be joined up at the ends
   *   winding   how much more often winding hallways are chosen than usual (1 = as usual)
   */
  function makeLayout(name, info) {
    if (name === 'random' || !LAYOUTS.includes(name)) return null;
    const { rooms, area, side, gap } = info;
    const spacing = FILL[info.spacing] !== undefined ? info.spacing : 'compact';
    const footprint = Math.max(area * FILL[spacing], 4 * side * side);
    // The shape is the outline of the whole dungeon; the rooms' middles keep to a smaller one (a room is a side wide)
    const inner = (length) => Math.max(length - side, 0.4 * side);
    // how far beyond the shape a room's middle may be to begin with, and how that opens up as attempts run out
    const slack = Math.max(1, (name === 'ring' ? 0.25 : 0.4) * side);
    const tolerance = (attempt) => (attempt < 20 ? slack : attempt < 45 ? slack * (1 + (attempt - 19) * 0.4) : Infinity);
    const layout = { name, start: { x: 0, y: 0 }, tolerance, closes: false, winding: 1 };

    if (name === 'square' || name === 'long' || name === 'wide') {
      // a rectangle of the footprint's area: its sides are in the ratio 1 : ASPECT for long and wide
      const ratio = name === 'square' ? 1 : ASPECT;
      const short = Math.sqrt(footprint / ratio);
      const longer = short * ratio;
      const hw = inner(name === 'wide' ? longer : short) / 2;
      const hh = inner(name === 'long' ? longer : short) / 2;
      layout.outside = (x, y) => beyondRect(x, y, hw, hh);
      // drawn towards the middle in a way that is round-cornered for nothing: concentric rectangles of the same shape
      layout.score = (x, y) => footprint * Math.pow(Math.max(Math.abs(x) / (2 * hw), Math.abs(y) / (2 * hh)), 2) * 4 + OUTSIDE * Math.pow(layout.outside(x, y), 2);
      return layout;
    }

    if (name === 'cathedral') {
      // a Latin cross: a long nave up and down the map, crossed by a shorter transept nearer the top (the apse
      // end). Both arms are about a room and a half wide, and between them they have room for the rooms in a line
      const pitch = side + gap;
      const L = Math.max((rooms * pitch * 0.9) / 1.6, 3 * pitch); // length of the nave
      const T = 0.6 * L; // span of the transept
      const c = 1.2 * side; // how far the middles of the rooms may stray from an arm's backbone, twice over
      const top = -0.25 * L; // the nave runs from y = top to y = top + L, and the transept crosses it at y = 0
      const bottom = top + L;
      layout.outside = (x, y) =>
        Math.min(
          beyondBox(x, y, -c / 2, top, c / 2, bottom), // the nave
          beyondBox(x, y, -T / 2, -c / 2, T / 2, c / 2) // the transept
        );
      // drawn in towards the backbone of the cross, so the arms fill out along their length
      layout.score = (x, y) => {
        const along = Math.min(toSegment(x, y, 0, top, 0, bottom), toSegment(x, y, -T / 2, 0, T / 2, 0));
        return along * along + OUTSIDE * Math.pow(layout.outside(x, y), 2);
      };
      return layout;
    }

    if (name === 'ring') {
      // a circle with an empty middle. The rooms are put in order round it, the first at the start and the
      // others spaced evenly on from it, so the last comes back round beside the first
      const pitch = side + gap; // about how far apart the centres of neighbouring rooms are
      const R = Math.max((rooms * pitch) / (2 * Math.PI), 1.6 * side + gap);
      const half = 0.5 * side + 0.5 * gap; // (a room's middle keeps to about one room's width of the circle)
      const turn = (2 * Math.PI) / Math.max(rooms, 1);
      const target = (index) => ({ x: R * Math.cos(index * turn), y: R * Math.sin(index * turn) });
      layout.start = target(0);
      layout.closes = true;
      layout.outside = (x, y, index = 0) => {
        const aim = target(index);
        return Math.max(0, Math.abs(Math.hypot(x, y) - R) - half, Math.hypot(x - aim.x, y - aim.y) - 1.2 * pitch);
      };
      layout.score = (x, y, last, index = 0) => {
        const aim = target(index);
        return Math.pow(Math.hypot(x - aim.x, y - aim.y), 2) + OUTSIDE * Math.pow(layout.outside(x, y, index), 2);
      };
      return layout;
    }

    if (name === 'radial') {
      // a hub: the biggest room, in the middle, with every hallway running out from it like the spokes of a wheel and
      // the other rooms along them. The generator builds this one by its own rules (see Builder.placeNextRadial); the
      // shape here is only a round footprint that keeps the arms from straying far
      const R = Math.sqrt(footprint / Math.PI) * 1.1;
      layout.radial = true;
      layout.outside = (x, y) => Math.max(0, Math.hypot(x, y) - R);
      layout.score = (x, y) => x * x + y * y + OUTSIDE * Math.pow(layout.outside(x, y), 2);
      return layout;
    }

    // cavern: a few round chambers of different sizes around a middle one, each reaching into the next through a
    // narrow neck, like the outline of a cave. The rooms fill the chambers and are drawn in towards their middles
    const chambers = Math.max(2, Math.min(5, Math.round(rooms / 4)));
    const unit = Math.sqrt((footprint * 1.1) / (Math.PI * (chambers + 1)));
    const round = [{ x: 0, y: 0, r: unit }];
    const turn = info.random() * 2 * Math.PI;
    for (let i = 0; i < chambers; i++) {
      const angle = turn + ((i + (info.random() - 0.5) * 0.5) * 2 * Math.PI) / chambers;
      const r = unit * (0.8 + 0.5 * info.random());
      const reach = unit + r * 0.8; // (a little short of touching, so the chambers meet in a neck)
      round.push({ x: reach * Math.cos(angle), y: reach * Math.sin(angle), r });
    }
    layout.outside = (x, y) => Math.min(...round.map((c) => Math.max(0, Math.hypot(x - c.x, y - c.y) - c.r)));
    layout.score = (x, y) => Math.min(...round.map((c) => 0.5 * ((x - c.x) * (x - c.x) + (y - c.y) * (y - c.y)))) + OUTSIDE * Math.pow(layout.outside(x, y), 2);
    layout.winding = 2;
    return layout;
  }

  DM.LAYOUTS = LAYOUTS;
  DM.DEFAULT_LAYOUT = DEFAULT_LAYOUT;
  DM.makeLayout = makeLayout;
})();
