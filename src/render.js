/*
 * Canvas renderer for a dungeon model (see generator.js for the model format).
 *
 * World units are grid cells: (x, y) is the top-left corner of cell (x, y) and
 * every wall is drawn along a grid line. The heavy geometry (floor runs, merged
 * wall segments) is built once per dungeon, so panning and zooming stay cheap
 * even for 99-room dungeons.
 */
(function () {
  const DM = (globalThis.DM = globalThis.DM || {});
  const { DX, DY } = DM.DIRS;

  // the colours come from a theme (see palette.js), which the page can change with setTheme()

  const MIN_SCALE = 0.5;
  const MAX_SCALE = 80;
  const CLICK_SLOP = 4; // px a pointer may travel and still count as a click (not a drag) in edit mode
  const MAX_STROKE = 5000; // squares one hallway stroke may cover

  // fills in the squares between two the pointer reported, for a hallway stroke (in edit.js)
  const walkCells = DM.walkCells;

  /** Size multiplier for entrance arrows: they never shrink below ~11 px per cell-unit. */
  function entranceUnit(scale) {
    return Math.max(1, 11 / scale);
  }

  /** World position (cells) where the "E1" label of an entrance is drawn. */
  function entranceLabelPos(e, u) {
    return {
      x: e.x + 0.5 + DX[e.d] * (0.5 + 3.3 * u),
      y: e.y + 0.5 + DY[e.d] * (0.5 + 3.3 * u),
    };
  }

  class DungeonRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.dungeon = null;
      this.model = null;
      this.view = { scale: 10, tx: 0, ty: 0 };
      // labelPosition: 'inside' puts each room's number on the room, 'outside' just beyond one of its walls
      this.options = { showGrid: true, showLabels: true, labelPosition: 'inside' };
      this.theme = DM.themeFrom(DM.defaultColors()); // what each thing is drawn in
      this._fitted = false; // is the view still the one fit() chose (not panned or zoomed since)?
      this.dpr = 1;
      this._drag = null;
      this._raf = 0;
      // edit mode, with a tool: 'door' (a click on a door between rooms changes it to its next state, see
      // DM.DOOR_STYLES), 'draw' (drag to draw a hallway) or 'erase' (click a stretch of hallway to delete it)
      this.editMode = false;
      this.editTool = 'door';
      this.onDoorChange = null; // called with { opening, from, to } after a click changed a door
      this.onLayoutChange = null; // called with { kind: 'draw'|'erase', dx, dy, ... } after the hallways changed
      this._hover = null; // the door under the pointer (door tool; one of model.edits)
      this._hoverCell = null; // the square under the pointer (draw and erase tools)
      this._hoverStretch = null; // the stretch of hallway a click would delete (erase tool)
      this._stroke = null; // a hallway being drawn: { cells: [[x, y], ...], plan }
      this._space = false; // Space is held: dragging pans even while drawing
      this._inside = false; // is the pointer over the map?

      this._bindEvents();
      this.resize();
    }

    // ---- public API ---------------------------------------------------------

    setDungeon(dungeon) {
      this.dungeon = dungeon;
      this.model = dungeon ? this._buildModel(dungeon) : null;
      this.fit();
    }

    /** Turn edit mode on or off. What a click or a drag does while it is on depends on the tool (setEditTool). */
    setEditMode(on) {
      this.editMode = !!on;
      this._stroke = null;
      this._clearHover();
      this.canvas.classList.toggle('editing', this.editMode);
      this.requestDraw();
    }

    /** The tool of edit mode: 'door' (the first one), 'draw' or 'erase'. */
    setEditTool(tool) {
      this.editTool = ['door', 'draw', 'erase'].includes(tool) ? tool : 'door';
      this._stroke = null;
      this._clearHover();
      this.requestDraw();
    }

    _clearHover() {
      this._hover = null;
      this._hoverCell = null;
      this._hoverStretch = null;
      this._cursor();
    }

    /** The shape of the pointer: a hand over what a click would change, a cross for drawing. */
    _cursor() {
      const cl = this.canvas.classList;
      const tool = this.editMode ? this.editTool : '';
      cl.toggle('over-door', tool === 'door' && !!this._hover);
      cl.toggle('tool-draw', tool === 'draw' && !this._space);
      cl.toggle('over-hall', tool === 'erase' && !!this._hoverStretch);
    }

    /**
     * Show the dungeon again after it was changed from outside (the view stays where it is).
     * A door changing leaves the floors and room numbers where they were, so only the walls and doors
     * are worked out again; with `moved` the squares changed too (hallways were drawn or deleted).
     */
    refreshModel({ moved = false } = {}) {
      if (!this.dungeon || !this.model) return;
      const outside = moved ? null : this.model.outside;
      const hovered = this._hover && this._hover.opening;
      this.model = this._buildModel(this.dungeon);
      if (outside) this.model.outside = outside;
      this._hover = (hovered && this.model.edits.find((t) => t.opening === hovered)) || null;
      this.requestDraw();
    }

    /** Show the dungeon again after one of its openings was changed. */
    refreshDoors() {
      this.refreshModel();
    }

    /** How many openings between rooms (and hallways) are in each state: { door, locked, secret, open }. */
    doorCounts() {
      const counts = { door: 0, locked: 0, secret: 0, open: 0 };
      if (this.model) for (const t of this.model.edits) counts[DM.DOOR_STYLES.includes(t.opening.style) ? t.opening.style : 'open']++;
      return counts;
    }

    setOption(name, value) {
      this.options[name] = value;
      // numbers outside the rooms can stick out past the map, so a view that was fitted is fitted again
      if ((name === 'labelPosition' || name === 'showLabels') && this._fitted) this.fit();
      else this.requestDraw();
    }

    /** Draw in these colours (a theme from DM.themeFrom); the view stays where it is. */
    setTheme(theme) {
      this.theme = theme;
      this.requestDraw();
    }

    /** Zoom/pan so the whole dungeon is visible. */
    fit() {
      const d = this.dungeon;
      const cw = this.canvas.clientWidth;
      const ch = this.canvas.clientHeight;
      if (!d || cw === 0 || ch === 0) {
        this.requestDraw();
        return;
      }
      // Entrance arrows and labels stick out past the outer walls, and are drawn
      // larger (in cells) the further out we zoom, so the bounds depend on the
      // scale. A few fixed-point iterations settle on a scale where it all fits.
      const margin = 30; // px of breathing room on every side
      let scale = 1;
      let bounds = null;
      for (let i = 0; i < 6; i++) {
        bounds = this._bounds(scale);
        scale = Math.min(
          (cw - margin * 2) / (bounds.x1 - bounds.x0),
          (ch - margin * 2) / (bounds.y1 - bounds.y0),
          48
        );
      }
      this.view.scale = Math.max(MIN_SCALE, scale);
      this.view.tx = cw / 2 - ((bounds.x0 + bounds.x1) / 2) * this.view.scale;
      this.view.ty = ch / 2 - ((bounds.y0 + bounds.y1) / 2) * this.view.scale;
      this._fitted = true;
      this.requestDraw();
    }

    /**
     * The area, in cells, that has to be in view at this scale (px per cell): the dungeon plus
     * what sticks out past it (entrance arrows and labels, room numbers placed outside).
     */
    _bounds(scale) {
      const d = this.dungeon;
      const u = entranceUnit(scale);
      // room numbers placed outside the rooms may lie beyond the edge of the map
      const labelBoxes = this.options.labelPosition === 'outside' && this.options.showLabels ? this._outsideLabels().filter(Boolean) : [];
      const bounds = { x0: 0, y0: 0, x1: d.width, y1: d.height };
      for (const o of labelBoxes) {
        bounds.x0 = Math.min(bounds.x0, o.x - o.w / 2);
        bounds.y0 = Math.min(bounds.y0, o.y - o.h / 2);
        bounds.x1 = Math.max(bounds.x1, o.x + o.w / 2);
        bounds.y1 = Math.max(bounds.y1, o.y + o.h / 2);
      }
      if (this.options.showCoordinates) {
        // a strip along the top and left edges for the square numbers
        const ui = Math.max(1, scale / 24);
        bounds.x0 = Math.min(bounds.x0, -(34 * ui) / scale);
        bounds.y0 = Math.min(bounds.y0, -(22 * ui) / scale);
      }
      for (const e of d.entrances) {
        if (e.kind === 'stairs') continue; // inside the dungeon: no arrow sticking out
        const { x, y } = entranceLabelPos(e, u);
        bounds.x0 = Math.min(bounds.x0, x);
        bounds.y0 = Math.min(bounds.y0, y);
        bounds.x1 = Math.max(bounds.x1, x);
        bounds.y1 = Math.max(bounds.y1, y);
      }
      return bounds;
    }

    /** Where each room's number goes when it is placed outside its room (cached per dungeon). */
    _outsideLabels() {
      const model = this.model;
      if (!model.outside) {
        const ctx = this.ctx;
        const measure = (text, size) => {
          ctx.font = "600 100px Georgia, 'Times New Roman', serif"; // the font the numbers are drawn in
          return (ctx.measureText(text).width / 100) * size;
        };
        model.outside = DM.placeOutsideLabels(this.dungeon, measure);
      }
      return model.outside;
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      // keep whatever is at the centre of the view at the centre when the canvas grows or shrinks
      // (for instance when a column beside it is collapsed), instead of pinning the top-left corner
      if (this._size && this._size.w > 0 && this._size.h > 0 && w > 0 && h > 0) {
        this.view.tx += (w - this._size.w) / 2;
        this.view.ty += (h - this._size.h) / 2;
      }
      this._size = { w, h };
      this.dpr = dpr;
      this.canvas.width = Math.max(1, Math.round(w * dpr));
      this.canvas.height = Math.max(1, Math.round(h * dpr));
      this.requestDraw();
    }

    requestDraw() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        this.draw();
      });
    }

    // ---- interaction --------------------------------------------------------

    _bindEvents() {
      const c = this.canvas;
      c.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          const rect = c.getBoundingClientRect();
          const factor = Math.exp(-e.deltaY * 0.0015);
          this._zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
        },
        { passive: false }
      );
      c.addEventListener('pointerdown', (e) => {
        c.setPointerCapture(e.pointerId);
        // with the draw tool a drag draws a hallway; the middle button, or Space held, pans as usual
        if (this.editMode && this.editTool === 'draw' && e.button === 0 && !this._space) {
          this._stroke = { cells: [this._cellAt(e)], plan: null };
          this._planStroke();
          this.requestDraw();
          return;
        }
        this._drag = { x: e.clientX, y: e.clientY, tx: this.view.tx, ty: this.view.ty, moved: false };
        c.classList.add('dragging');
      });
      c.addEventListener('pointermove', (e) => {
        if (this._stroke) {
          this._extendStroke(e);
          return;
        }
        if (!this._drag) {
          if (this.editMode) this._hoverAt(e);
          return;
        }
        const drag = this._drag;
        // in edit mode a click that wobbles a little is still a click, so the map does not slide under it
        if (this.editMode && !drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < CLICK_SLOP) return;
        drag.moved = true;
        this._fitted = false;
        this.view.tx = drag.tx + (e.clientX - drag.x);
        this.view.ty = drag.ty + (e.clientY - drag.y);
        this.requestDraw();
      });
      const end = () => {
        this._drag = null;
        c.classList.remove('dragging');
      };
      c.addEventListener('pointerup', (e) => {
        if (this._stroke) {
          this._finishStroke();
          return;
        }
        const drag = this._drag;
        end();
        if (this.editMode && drag && !drag.moved) this._clickAt(e);
      });
      c.addEventListener('pointercancel', () => {
        this._stroke = null;
        end();
        this.requestDraw();
      });
      c.addEventListener('pointerenter', () => (this._inside = true));
      c.addEventListener('pointerleave', () => {
        this._inside = false;
        if (this._hover || this._hoverCell || this._hoverStretch) {
          this._clearHover();
          this.requestDraw();
        }
      });
      c.addEventListener('dblclick', (e) => {
        // in edit mode quick clicks are for the doors and hallways, not for fitting the map (the Fit button is there)
        if (this.editMode) {
          if (this.editTool !== 'door') return;
          const rect = c.getBoundingClientRect();
          if (this._doorAt(e.clientX - rect.left, e.clientY - rect.top)) return;
        }
        this.fit();
      });
      // holding Space pans, even with the draw tool; Escape drops a hallway being drawn
      window.addEventListener('keydown', (e) => this._key(e, true));
      window.addEventListener('keyup', (e) => this._key(e, false));
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => this.resize()).observe(c);
      } else {
        window.addEventListener('resize', () => this.resize());
      }
    }

    /** The editable door nearest a point of the canvas (px), if one is close enough to mean it. */
    _doorAt(px, py) {
      if (!this.model) return null;
      const { scale: s, tx, ty } = this.view;
      const reach = Math.max(0.6 * s, 12); // px
      let best = null;
      let bestDist = reach;
      for (const t of this.model.edits) {
        const dist = Math.hypot(t.cx * s + tx - px, t.cy * s + ty - py);
        if (dist < bestDist) {
          best = t;
          bestDist = dist;
        }
      }
      return best;
    }

    /** The square of the map (its x, y) under a pointer event; it may be outside the dungeon. */
    _cellAt(e) {
      const rect = this.canvas.getBoundingClientRect();
      const { scale: s, tx, ty } = this.view;
      return [Math.floor((e.clientX - rect.left - tx) / s), Math.floor((e.clientY - rect.top - ty) / s)];
    }

    /** Edit mode with no button down: pick out what a click (or, drawing, a press) here would act on. */
    _hoverAt(e) {
      if (this.editTool === 'door') {
        const rect = this.canvas.getBoundingClientRect();
        const hit = this._doorAt(e.clientX - rect.left, e.clientY - rect.top);
        if (hit === this._hover) return;
        this._hover = hit;
      } else {
        const cell = this._cellAt(e);
        if (this._hoverCell && this._hoverCell[0] === cell[0] && this._hoverCell[1] === cell[1]) return;
        this._hoverCell = cell;
        this._hoverStretch = this.editTool === 'erase' ? DM.hallStretchAt(this.dungeon, cell[0], cell[1]) : null;
      }
      this._cursor();
      this.requestDraw();
    }

    /** A click in edit mode: with the door tool the door under it goes to its next state; with the erase tool the stretch of hallway under it goes. */
    _clickAt(e) {
      if (this.editTool === 'erase') {
        const [x, y] = this._cellAt(e);
        const res = DM.deleteHallStretch(this.dungeon, x, y);
        if (res.ok) this._layoutChanged(res, 'erase');
        return;
      }
      if (this.editTool !== 'door') return;
      const rect = this.canvas.getBoundingClientRect();
      const hit = this._doorAt(e.clientX - rect.left, e.clientY - rect.top);
      if (!hit) return;
      const opening = hit.opening;
      const from = opening.style;
      opening.style = DM.nextDoorStyle(from);
      this._hover = hit;
      this.refreshDoors();
      if (this.onDoorChange) this.onDoorChange({ opening, from, to: opening.style });
    }

    // ---- drawing hallways ---------------------------------------------------

    _planStroke() {
      this._stroke.plan = DM.planHallway(this.dungeon, this._stroke.cells);
    }

    /** The pointer moved with the draw tool down: the stroke takes in every square it crossed. */
    _extendStroke(e) {
      const cells = this._stroke.cells;
      const cell = this._cellAt(e);
      const last = cells[cells.length - 1];
      if ((cell[0] === last[0] && cell[1] === last[1]) || cells.length >= MAX_STROKE) return;
      for (const c of walkCells(last, cell)) cells.push(c);
      this._planStroke();
      this.requestDraw();
    }

    _finishStroke() {
      const { cells } = this._stroke;
      this._stroke = null;
      const res = DM.addHallway(this.dungeon, cells);
      if (res.ok) this._layoutChanged(res, 'draw');
      else this.requestDraw();
    }

    /**
     * Hallways were drawn or deleted. The map grows and shrinks to fit them, which can move every square
     * (its top left is always 0, 0), so the view moves the other way and the picture stays where it was.
     */
    _layoutChanged(res, kind) {
      this.view.tx -= res.dx * this.view.scale;
      this.view.ty -= res.dy * this.view.scale;
      this._clearHover();
      this.refreshModel({ moved: true });
      if (this.onLayoutChange) this.onLayoutChange({ kind, ...res });
    }

    _key(e, down) {
      if (e.code === 'Escape' && down && this._stroke) {
        this._stroke = null;
        this.requestDraw();
        return;
      }
      if (e.code !== 'Space') return;
      if (!down) {
        // (the button that was pressed before Space must not be pressed again as Space goes up)
        if (this._space) {
          this._space = false;
          this._cursor();
          if (e.preventDefault) e.preventDefault();
        }
        return;
      }
      const tag = e.target && e.target.tagName;
      if (!this.editMode || this.editTool !== 'draw' || !this._inside || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.preventDefault) e.preventDefault();
      if (!this._space) {
        this._space = true;
        this._cursor();
      }
    }

    zoomBy(factor) {
      this._zoomAt(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2, factor);
    }

    _zoomAt(px, py, factor) {
      const v = this.view;
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      const k = next / v.scale;
      this._fitted = false;
      v.tx = px - (px - v.tx) * k;
      v.ty = py - (py - v.ty) * k;
      v.scale = next;
      this.requestDraw();
    }

    // ---- geometry model -----------------------------------------------------

    _buildModel(d) {
      const w = d.width;
      const h = d.height;
      // region per cell: room.id+1, or -(hall.id+1), or 0
      const region = new Int32Array(w * h);
      for (const r of d.rooms) for (const [x, y] of r.cells) region[y * w + x] = r.id + 1;
      for (const hl of d.halls) for (const [x, y] of hl.cells) region[y * w + x] = -(hl.id + 1);

      // edge indices: horizontal edge (x, y) lies on the line y between x and x+1
      const hIndex = (x, y) => y * w + x;
      const vIndex = (x, y) => y * (w + 1) + x;
      const edgeOf = (x, y, dir) => {
        if (dir === 0) return { h: true, i: hIndex(x, y) };
        if (dir === 2) return { h: true, i: hIndex(x, y + 1) };
        if (dir === 3) return { h: false, i: vIndex(x, y) };
        return { h: false, i: vIndex(x + 1, y) };
      };

      const open = { h: new Uint8Array((h + 1) * w), v: new Uint8Array(h * (w + 1)) };
      const doors = []; // drawn as a door: plain, locked, or an entrance
      const secrets = []; // drawn as an S on a solid wall
      const edits = []; // every opening Edit mode can change (the entrances are not among them)
      const markOpen = (o) => {
        const e = edgeOf(o.x, o.y, o.d);
        (e.h ? open.h : open.v)[e.i] = 1;
        return e;
      };
      for (const c of d.connections) {
        for (const o of c.openings) {
          // the middle of the edge the opening is on
          const at = { x: o.x, y: o.y, d: o.d, cx: o.x + 0.5 + DX[o.d] * 0.5, cy: o.y + 0.5 + DY[o.d] * 0.5 };
          // a secret door looks like a wall; every other state leaves a gap in it (with or without a door in the gap)
          if (o.style === 'secret') secrets.push(at);
          else markOpen(o);
          if (o.style === 'door' || o.style === 'locked') doors.push({ ...at, entrance: false, locked: o.style === 'locked' });
          edits.push({ ...at, opening: o });
        }
      }
      const stairs = [];
      for (const e of d.entrances) {
        if (e.kind === 'stairs') {
          // a marker on the floor, not an opening in a wall
          stairs.push({ x: e.x, y: e.y, d: e.d, label: e.label });
          continue;
        }
        markOpen(e);
        doors.push({ x: e.x, y: e.y, d: e.d, entrance: true });
      }

      // wall edges: any floor edge whose other side is a different region, unless it is open
      const wall = { h: new Uint8Array((h + 1) * w), v: new Uint8Array(h * (w + 1)) };
      const regionAt = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : region[y * w + x]);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const r = region[y * w + x];
          if (r === 0) continue;
          for (let dir = 0; dir < 4; dir++) {
            if (regionAt(x + DX[dir], y + DY[dir]) === r) continue;
            const e = edgeOf(x, y, dir);
            if ((e.h ? open.h : open.v)[e.i]) continue;
            (e.h ? wall.h : wall.v)[e.i] = 1;
          }
        }
      }

      // merge collinear wall edges into long segments
      const wallPath = new Path2D();
      for (let y = 0; y <= h; y++) {
        for (let x = 0; x < w; ) {
          if (!wall.h[hIndex(x, y)]) {
            x++;
            continue;
          }
          let x1 = x;
          while (x1 < w && wall.h[hIndex(x1, y)]) x1++;
          wallPath.moveTo(x, y);
          wallPath.lineTo(x1, y);
          x = x1;
        }
      }
      for (let x = 0; x <= w; x++) {
        for (let y = 0; y < h; ) {
          if (!wall.v[vIndex(x, y)]) {
            y++;
            continue;
          }
          let y1 = y;
          while (y1 < h && wall.v[vIndex(x, y1)]) y1++;
          wallPath.moveTo(x, y);
          wallPath.lineTo(x, y1);
          y = y1;
        }
      }

      // floor as horizontal runs (rooms and hallways get different tints)
      const roomFloor = new Path2D();
      const hallFloor = new Path2D();
      const allFloor = new Path2D();
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; ) {
          const r = region[y * w + x];
          if (r === 0) {
            x++;
            continue;
          }
          const isRoom = r > 0;
          let x1 = x;
          while (x1 < w && region[y * w + x1] !== 0 && region[y * w + x1] > 0 === isRoom) x1++;
          (isRoom ? roomFloor : hallFloor).rect(x, y, x1 - x, 1);
          allFloor.rect(x, y, x1 - x, 1);
          x = x1;
        }
      }

      const labels = d.rooms.map((r) => ({
        text: String(r.label),
        x: r.labelCell[0] + 0.5,
        y: r.labelCell[1] + 0.5,
        size: DM.labelSize(r), // height of the number, in cells
      }));

      return { wallPath, roomFloor, hallFloor, allFloor, doors, secrets, edits, stairs, labels };
    }

    // ---- drawing ------------------------------------------------------------

    draw({ scaleBar = true, edit = this.editMode } = {}) {
      const { ctx, canvas, dpr, view, model, dungeon } = this;
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = this.theme.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (!model) return;

      const s = view.scale;
      const px = 1 / s; // one screen pixel in world units
      ctx.setTransform(s * dpr, 0, 0, s * dpr, view.tx * dpr, view.ty * dpr);

      // visible range in cells
      const vx0 = Math.floor(-view.tx / s) - 1;
      const vy0 = Math.floor(-view.ty / s) - 1;
      const vx1 = Math.ceil((cw - view.tx) / s) + 1;
      const vy1 = Math.ceil((ch - view.ty) / s) + 1;

      // faint graph paper across the whole map area
      if (this.options.showGrid && s >= 8) {
        ctx.strokeStyle = this.theme.gridFaint;
        ctx.lineWidth = px;
        ctx.beginPath();
        for (let x = vx0; x <= vx1; x++) {
          ctx.moveTo(x, vy0);
          ctx.lineTo(x, vy1);
        }
        for (let y = vy0; y <= vy1; y++) {
          ctx.moveTo(vx0, y);
          ctx.lineTo(vx1, y);
        }
        ctx.stroke();
      }

      // floors
      ctx.fillStyle = this.theme.roomFloor;
      ctx.fill(model.roomFloor);
      ctx.fillStyle = this.theme.hallFloor;
      ctx.fill(model.hallFloor);

      // the 5 ft grid on the floors
      if (this.options.showGrid && s >= 5) {
        ctx.save();
        ctx.clip(model.allFloor);
        ctx.strokeStyle = this.theme.gridFloor;
        ctx.lineWidth = px;
        ctx.beginPath();
        const gx0 = Math.max(vx0, 0);
        const gx1 = Math.min(vx1, dungeon.width);
        const gy0 = Math.max(vy0, 0);
        const gy1 = Math.min(vy1, dungeon.height);
        for (let x = gx0; x <= gx1; x++) {
          ctx.moveTo(x, gy0);
          ctx.lineTo(x, gy1);
        }
        for (let y = gy0; y <= gy1; y++) {
          ctx.moveTo(gx0, y);
          ctx.lineTo(gx1, y);
        }
        ctx.stroke();
        ctx.restore();
      }

      // walls
      ctx.strokeStyle = this.theme.wall;
      ctx.lineWidth = Math.min(Math.max(s * 0.13, 1.6), 7) * px;
      ctx.lineCap = 'square';
      ctx.lineJoin = 'miter';
      ctx.stroke(model.wallPath);

      this._drawDoors(model.doors, s);
      this._drawStairs(model.stairs, s);
      this._drawEntrances(
        dungeon.entrances.filter((e) => e.kind !== 'stairs'),
        s
      );

      if (edit) {
        if (this.editTool === 'door') this._drawEditMarks(model.edits, s);
        else this._drawHallEditing(s);
      }

      // screen-space overlays
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (this.options.showLabels) this._drawRoomLabels(model.labels);
      this._drawSecretMarks(model.secrets);
      this._drawEntranceLabels();
      this._drawStairBadges(model.stairs);
      if (this.options.showCoordinates) this._drawCoordinates();
      if (edit && this.editTool === 'door' && this._hover) this._drawDoorTip(this._hover);
      if (edit && this.editTool === 'erase' && this._hoverStretch && this._hoverCell) {
        this._drawTip((this._hoverCell[0] + 0.5) * s + view.tx, this._hoverCell[1] * s + view.ty - 14, 'Click to delete this stretch');
      }
      if (scaleBar) this._drawScaleBar();
    }

    _drawDoors(doors, s) {
      const ctx = this.ctx;
      ctx.lineWidth = Math.max(1, s * 0.05) / s;
      for (const door of doors) {
        const horizontal = door.d === 0 || door.d === 2; // wall runs left-right
        const cx = door.x + 0.5 + (door.d === 1 ? 0.5 : door.d === 3 ? -0.5 : 0);
        const cy = door.y + 0.5 + (door.d === 2 ? 0.5 : door.d === 0 ? -0.5 : 0);
        const len = 0.72;
        const thick = Math.max(0.26, 3 / s);
        const rw = horizontal ? len : thick;
        const rh = horizontal ? thick : len;
        ctx.fillStyle = door.entrance ? this.theme.entranceFill : this.theme.doorFill;
        ctx.strokeStyle = door.entrance ? this.theme.entranceStroke : this.theme.doorStroke;
        ctx.fillRect(cx - rw / 2, cy - rh / 2, rw, rh);
        ctx.strokeRect(cx - rw / 2, cy - rh / 2, rw, rh);
        if (door.locked) this._drawLock(ctx, cx, cy, Math.max(0.34, 6 / s), Math.max(1, s * 0.05) / s);
      }
    }

    /** A small padlock centred on (cx, cy), `w` wide, in the door's outline colour: how a locked door is marked. */
    _drawLock(ctx, cx, cy, w, line) {
      const bodyH = w * 0.72;
      const top = cy - bodyH * 0.25; // the shackle rises above the body, so the body sits a little low
      ctx.fillStyle = this.theme.doorStroke;
      ctx.fillRect(cx - w / 2, top, w, bodyH);
      ctx.strokeStyle = this.theme.doorStroke;
      ctx.lineWidth = line * 1.3;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.arc(cx, top, w * 0.28, Math.PI, 0);
      ctx.stroke();
    }

    /** "S" on the wall where there is a secret door (screen space, so it stays readable when zoomed out). */
    _drawSecretMarks(secrets) {
      if (!secrets.length) return;
      const ctx = this.ctx;
      const { scale: s, tx, ty } = this.view;
      if (s < 4) return; // too small to read, and the walls are too close together
      const ui = this._ui || 1;
      const size = Math.min(Math.max(s * 0.62, 11), 18) * ui;
      ctx.font = `700 ${size}px Georgia, 'Times New Roman', serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.theme.label;
      ctx.strokeStyle = this.theme.labelHalo;
      ctx.lineWidth = Math.max(3, size * 0.3);
      ctx.lineJoin = 'round';
      for (const sec of secrets) {
        const sx = sec.cx * s + tx;
        const sy = sec.cy * s + ty;
        if (sx < -20 || sy < -20 || sx > this.canvas.clientWidth + 20 || sy > this.canvas.clientHeight + 20) continue;
        ctx.strokeText('S', sx, sy + 0.5);
        ctx.fillText('S', sx, sy + 0.5);
      }
      ctx.lineJoin = 'miter';
    }

    /**
     * Edit mode: a ring round every door that can be changed (the one under the pointer is drawn
     * heavier), so a doorway with no door in it can still be seen and clicked.
     */
    _drawEditMarks(edits, s) {
      const ctx = this.ctx;
      const px = 1 / s;
      const r = Math.max(0.55, 9 * px);
      ctx.lineCap = 'butt';
      ctx.strokeStyle = this.theme.arrow;
      ctx.fillStyle = this.theme.arrow;
      for (const t of edits) {
        const hot = t === this._hover;
        ctx.globalAlpha = hot ? 1 : 0.6;
        ctx.lineWidth = (hot ? 2.5 : 1.5) * px;
        ctx.setLineDash(hot ? [] : [4 * px, 3 * px]);
        ctx.beginPath();
        ctx.arc(t.cx, t.cy, r, 0, Math.PI * 2);
        if (hot) {
          ctx.globalAlpha = 0.18;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    /**
     * Edit mode with the draw or erase tool: the hallway being drawn as it will be (floor, and the doors
     * it will open into rooms), the square under the pointer, or the stretch a click would delete.
     */
    _drawHallEditing(s) {
      const ctx = this.ctx;
      const T = this.theme;
      const px = 1 / s;
      const outline = (cells) => {
        for (const [x, y] of cells) ctx.strokeRect(x + 0.05, y + 0.05, 0.9, 0.9);
      };
      ctx.lineCap = 'butt';
      ctx.strokeStyle = T.arrow;
      ctx.fillStyle = T.arrow;
      if (this._stroke && this._stroke.plan) {
        const { floor, openings } = this._stroke.plan;
        ctx.fillStyle = T.hallFloor;
        for (const [x, y] of floor) ctx.fillRect(x, y, 1, 1);
        ctx.strokeStyle = T.arrow;
        ctx.lineWidth = 2 * px;
        ctx.setLineDash([4 * px, 3 * px]);
        outline(floor);
        ctx.setLineDash([]);
        // a ring on every wall it will open, with a door in it where it will have one
        const doors = openings.filter((o) => o.style === 'door').map((o) => ({ x: o.x, y: o.y, d: o.d, entrance: false, locked: false }));
        this._drawDoors(doors, s);
        ctx.strokeStyle = T.arrow;
        ctx.lineWidth = 2 * px;
        for (const o of openings) {
          ctx.beginPath();
          ctx.arc(o.x + 0.5 + DX[o.d] * 0.5, o.y + 0.5 + DY[o.d] * 0.5, Math.max(0.55, 9 * px), 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (this.editTool === 'draw' && this._hoverCell) {
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 2 * px;
        outline([this._hoverCell]);
        ctx.globalAlpha = 1;
      }
      if (this.editTool === 'erase' && this._hoverStretch) {
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = T.arrow;
        for (const [x, y] of this._hoverStretch) ctx.fillRect(x, y, 1, 1);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = T.arrow;
        ctx.lineWidth = 2.5 * px;
        outline(this._hoverStretch);
      }
    }

    /** What the door under the pointer is now, in a small tag just above it (edit mode). */
    _drawDoorTip(t) {
      const { scale: s, tx, ty } = this.view;
      this._drawTip(t.cx * s + tx, t.cy * s + ty - Math.max(0.55 * s, 9) - 14, DM.DOOR_LABELS[t.opening.style] || DM.DOOR_LABELS.open);
    }

    /** A small tag centred at (sx, sy) of the screen. */
    _drawTip(sx, sy, text) {
      const ctx = this.ctx;
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(text).width + 14;
      const h = 22;
      // keep the tag on the map when the door is at its top edge
      const y = Math.max(sy, h / 2 + 4);
      ctx.fillStyle = this.theme.roomFloor;
      ctx.strokeStyle = this.theme.arrow;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(sx - w / 2, y - h / 2, w, h); // square corners, like the rest of the page
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = this.theme.label;
      ctx.fillText(text, sx, y + 0.5);
    }

    /** Stairs to the surface: step lines across a floor cell, climbing towards the wall side `d`. */
    _drawStairs(stairs, s) {
      const ctx = this.ctx;
      const steps = 5;
      const inset = 0.12;
      ctx.lineCap = 'butt';
      for (const st of stairs) {
        ctx.fillStyle = this.theme.stairsTint;
        ctx.fillRect(st.x, st.y, 1, 1);
        ctx.strokeStyle = this.theme.arrow;
        ctx.lineWidth = Math.max(1, s * 0.05) / s;
        ctx.beginPath();
        const horizontalSteps = st.d === 0 || st.d === 2; // steps run left-right when climbing north/south
        for (let i = 1; i <= steps; i++) {
          const t = i / (steps + 1);
          if (horizontalSteps) {
            ctx.moveTo(st.x + inset, st.y + t);
            ctx.lineTo(st.x + 1 - inset, st.y + t);
          } else {
            ctx.moveTo(st.x + t, st.y + inset);
            ctx.lineTo(st.x + t, st.y + 1 - inset);
          }
        }
        ctx.stroke();
        ctx.strokeRect(st.x + inset, st.y + inset, 1 - 2 * inset, 1 - 2 * inset);
      }
    }

    /** "E3" badge on top of each stairs cell (screen space, so it stays readable when zoomed out). */
    _drawStairBadges(stairs) {
      const ctx = this.ctx;
      const { scale: s, tx, ty } = this.view;
      const ui = this._ui || 1; // text grows with the picture when exporting
      const fontPx = Math.min(Math.max(s * 0.55, 10), 15) * ui;
      ctx.font = `700 ${fontPx}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const st of stairs) {
        const sx = (st.x + 0.5) * s + tx;
        const sy = (st.y + 0.5) * s + ty;
        if (sx < -30 || sy < -30 || sx > this.canvas.clientWidth + 30 || sy > this.canvas.clientHeight + 30) continue;
        const w = ctx.measureText(st.label).width + 8 * ui;
        const h = fontPx + 6 * ui;
        ctx.fillStyle = this.theme.arrow;
        ctx.beginPath();
        ctx.rect(sx - w / 2, sy - h / 2, w, h); // square corners, like the rest of the page
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(st.label, sx, sy + 0.5);
      }
    }

    _drawEntrances(entrances, s) {
      const ctx = this.ctx;
      // keep arrows readable when the map is zoomed far out
      const u = entranceUnit(s);
      ctx.fillStyle = this.theme.arrow;
      ctx.strokeStyle = this.theme.arrow;
      ctx.lineWidth = Math.max(2, s * 0.12) / s;
      ctx.lineCap = 'butt';
      for (const e of entrances) {
        const dx = DX[e.d];
        const dy = DY[e.d];
        // point on the wall, middle of the door edge
        const wx = e.x + 0.5 + dx * 0.5;
        const wy = e.y + 0.5 + dy * 0.5;
        const tail = 2.4 * u;
        const head = 0.5 * u;
        const headLen = 0.9 * u;
        const headHalf = 0.5 * u;
        // arrow starts outside and points INTO the dungeon (opposite of the outward direction)
        const sx = wx + dx * tail;
        const sy = wy + dy * tail;
        const hx = wx + dx * head; // tip
        const hy = wy + dy * head;
        const bx = hx + dx * headLen; // base of head
        const by = hy + dy * headLen;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(bx - dy * headHalf, by + dx * headHalf);
        ctx.lineTo(bx + dy * headHalf, by - dx * headHalf);
        ctx.closePath();
        ctx.fill();
      }
      // labels are drawn in screen space (see _drawEntranceLabels)
      this._entranceLabels = entrances.map((e) => ({ text: e.label, ...entranceLabelPos(e, u) }));
    }

    _drawRoomLabels(labels) {
      const ctx = this.ctx;
      const { scale: s, tx, ty } = this.view;
      // outside the rooms, each number goes beside one of its room's walls; a room with no free
      // place for it (null) keeps its number inside
      const outside = this.options.labelPosition === 'outside' ? this._outsideLabels() : null;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.theme.label;
      labels.forEach((l, i) => {
        const size = l.size * s;
        if (size < 8) return;
        const o = outside && outside[i];
        const sx = (o ? o.x : l.x) * s + tx;
        const sy = (o ? o.y : l.y) * s + ty;
        if (sx < -20 || sy < -20 || sx > this.canvas.clientWidth + 20 || sy > this.canvas.clientHeight + 20) return;
        if (o && o.leader) {
          // a number set a little way off is joined to its wall by a thin line
          ctx.strokeStyle = this.theme.wall;
          ctx.globalAlpha = 0.55;
          ctx.lineWidth = this._ui || 1;
          ctx.beginPath();
          ctx.moveTo(o.ax * s + tx, o.ay * s + ty);
          ctx.lineTo(o.lx * s + tx, o.ly * s + ty);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.font = `600 ${size}px Georgia, 'Times New Roman', serif`;
        ctx.lineWidth = Math.max(2, size * 0.18);
        ctx.strokeStyle = this.theme.labelHalo;
        // centred on the square by the ink of the number itself: the middle of the line of text is not the middle of
        // the digits (Georgia's figures hang below the line), so the number would sit low or high in the square
        ctx.textBaseline = 'alphabetic';
        const ink = ctx.measureText(l.text);
        const lift = ink.actualBoundingBoxAscent !== undefined ? (ink.actualBoundingBoxAscent - ink.actualBoundingBoxDescent) / 2 : size * 0.32;
        ctx.strokeText(l.text, sx, sy + lift);
        ctx.fillText(l.text, sx, sy + lift);
        ctx.textBaseline = 'middle';
      });
    }

    _drawEntranceLabels() {
      const ctx = this.ctx;
      const { scale: s, tx, ty } = this.view;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.theme.arrow;
      const ui = this._ui || 1; // text grows with the picture when exporting
      const esize = Math.min(Math.max(s * 0.8, 11), 17) * ui;
      ctx.font = `700 ${esize}px system-ui, sans-serif`;
      for (const l of this._entranceLabels || []) {
        const sx = l.x * s + tx;
        const sy = l.y * s + ty;
        ctx.lineWidth = 3 * ui;
        ctx.strokeStyle = this.theme.background;
        ctx.strokeText(l.text, sx, sy);
        ctx.fillText(l.text, sx, sy);
      }
    }

    /**
     * Square numbers along the top (x) and left (y) edges of the map, the same x and y the editing
     * tools take. Every square when there is room, otherwise every 2nd, 5th or 10th; a longer tick
     * marks each multiple of five.
     */
    _drawCoordinates() {
      const { ctx, view, dungeon } = this;
      const s = view.scale;
      const ui = Math.max(1, s / 24);
      const size = 11 * ui;
      ctx.save();
      ctx.font = `${size}px system-ui, sans-serif`;
      ctx.fillStyle = this.theme.label;
      ctx.strokeStyle = this.theme.label;
      ctx.lineWidth = Math.max(1, ui * 0.8);
      const need = ctx.measureText('000').width * 1.2;
      const step = [1, 2, 5, 10, 20].find((n) => n * s >= need) || 50;
      const left = view.tx;
      const top = view.ty;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'center';
      for (let x = 0; x < dungeon.width; x++) {
        if (x % step !== 0) continue;
        const sx = left + (x + 0.5) * s;
        ctx.fillText(String(x), sx, top - 6 * ui);
        ctx.beginPath();
        ctx.moveTo(sx, top - 3 * ui);
        ctx.lineTo(sx, top);
        ctx.stroke();
      }
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let y = 0; y < dungeon.height; y++) {
        if (y % step !== 0) continue;
        const sy = top + (y + 0.5) * s;
        ctx.fillText(String(y), left - 7 * ui, sy);
        ctx.beginPath();
        ctx.moveTo(left - 3 * ui, sy);
        ctx.lineTo(left, sy);
        ctx.stroke();
      }
      ctx.restore();
    }

    _drawScaleBar() {
      const ctx = this.ctx;
      const s = this.view.scale;
      const nice = [1, 2, 5, 10, 20, 50, 100, 200];
      let cells = nice[0];
      for (const n of nice) {
        cells = n;
        if (n * s >= 70) break;
      }
      const len = cells * s;
      const x = 18;
      const y = this.canvas.clientHeight - 22;
      ctx.fillStyle = this.theme.labelHalo;
      ctx.fillRect(x - 8, y - 20, len + 16 + 50, 32);
      ctx.strokeStyle = this.theme.wall;
      ctx.lineWidth = 2;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x, y);
      ctx.lineTo(x + len, y);
      ctx.lineTo(x + len, y - 6);
      ctx.stroke();
      ctx.fillStyle = this.theme.label;
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${cells * 5} ft`, x + len + 8, y - 4);
    }

    // ---- exporting ----------------------------------------------------------

    /**
     * Draw the whole map, as it looks now (colors, grid, room numbers, label position), on a new
     * canvas made for printing or sharing. With `legend`, a strip under the map gives `caption`,
     * a scale bar and a key to the colors. Returns the canvas, or null if there is no dungeon yet.
     */
    exportImage({ legend = true, caption = '' } = {}) {
      if (!this.dungeon || !this.model) return null;
      const MARGIN = 40; // px of paper round the map
      const MIN_WIDTH = 900; // so the strip under the map always has room for its details
      // as many pixels per cell as keep the longer side near 4000 px, but between 8 and 48
      let s = 24;
      for (let i = 0; i < 3; i++) {
        const b = this._bounds(s);
        s = Math.max(8, Math.min(48, Math.floor(3920 / Math.max(b.x1 - b.x0, b.y1 - b.y0))));
      }
      const b = this._bounds(s);
      const ui = Math.max(1, s / 24); // text and thin lines grow with the picture
      const mapH = Math.ceil((b.y1 - b.y0) * s) + 2 * MARGIN;
      const W = Math.max(legend ? MIN_WIDTH : 0, Math.ceil((b.x1 - b.x0) * s) + 2 * MARGIN);
      const key = legend ? this._legendLayout(W, MARGIN, ui, s, caption) : null;
      const H = mapH + (key ? key.height : 0);

      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = this.theme.background;
      ctx.fillRect(0, 0, W, H);

      // the map is drawn by the same code as on screen, through a stand-in for the screen canvas
      const saved = { canvas: this.canvas, ctx: this.ctx, dpr: this.dpr, view: this.view, ui: this._ui, labels: this._entranceLabels };
      try {
        this.canvas = { width: W, height: mapH, clientWidth: W, clientHeight: mapH };
        this.ctx = ctx;
        this.dpr = 1;
        this.view = { scale: s, tx: (W - (b.x1 - b.x0) * s) / 2 - b.x0 * s, ty: MARGIN - b.y0 * s };
        this._ui = ui;
        this.draw({ scaleBar: false, edit: false }); // a picture never shows the editing rings
      } finally {
        this.canvas = saved.canvas;
        this.ctx = saved.ctx;
        this.dpr = saved.dpr;
        this.view = saved.view;
        this._ui = saved.ui;
        this._entranceLabels = saved.labels;
      }
      if (key) key.draw(ctx, mapH);
      return canvas;
    }

    /**
     * Lay out the strip under an exported map: a line of details with a scale bar at its right,
     * then a key to what the colors mean (only the things this dungeon has).
     * Returns { height, draw(ctx, top) }.
     */
    _legendLayout(W, margin, ui, s, caption) {
      const d = this.dungeon;
      const font = `${13 * ui}px system-ui, sans-serif`;
      const scratch = document.createElement('canvas').getContext('2d');
      scratch.font = font;

      const items = [{ kind: 'room', text: 'Room' }];
      if (d.halls.length > 0) items.push({ kind: 'hall', text: 'Hallway' });
      items.push({ kind: 'wall', text: 'Wall' });
      if (this.model.doors.some((door) => !door.entrance && !door.locked)) items.push({ kind: 'door', text: 'Door' });
      if (this.model.doors.some((door) => door.locked)) items.push({ kind: 'locked', text: 'Locked door' });
      if (this.model.secrets.length > 0) items.push({ kind: 'secret', text: 'Secret door' });
      if (d.entrances.some((e) => e.kind !== 'stairs')) items.push({ kind: 'entrance', text: 'Entrance' });
      if (d.entrances.some((e) => e.kind === 'stairs')) items.push({ kind: 'stairs', text: 'Stairs entrance' });

      const swW = 26 * ui;
      const swH = 16 * ui;
      const gap = 8 * ui;
      const between = 30 * ui;
      const rowH = 24 * ui;
      let x = margin;
      let row = 0;
      const placed = items.map((it) => {
        const w = swW + gap + scratch.measureText(it.text).width;
        if (x > margin && x + w > W - margin) {
          row++;
          x = margin;
        }
        const at = { ...it, x, row };
        x += w + between;
        return at;
      });
      const padTop = 18 * ui;
      const captionH = 24 * ui;
      const padBetween = 12 * ui;
      const height = Math.ceil(padTop + captionH + padBetween + (row + 1) * rowH + 18 * ui);

      // a scale bar as long as a round number of cells that comes to at least about 100 px
      let cells = 1;
      for (const n of [1, 2, 5, 10, 20, 50, 100, 200]) {
        cells = n;
        if (n * s >= 100 * ui) break;
      }

      const draw = (ctx, top) => {
        const T = this.theme;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.font = font;
        // a thin rule between the map and the strip
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = T.wall;
        ctx.lineWidth = ui;
        ctx.beginPath();
        ctx.moveTo(margin, top);
        ctx.lineTo(W - margin, top);
        ctx.stroke();
        ctx.globalAlpha = 1;

        const capY = top + padTop + captionH / 2;
        ctx.fillStyle = T.label;
        ctx.fillText(caption, margin, capY);
        const label = `${cells * 5} ft`;
        const barLen = cells * s;
        const barX = W - margin - scratch.measureText(label).width - gap - barLen;
        ctx.strokeStyle = T.wall;
        ctx.lineWidth = 2 * ui;
        ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.moveTo(barX, capY - 6 * ui);
        ctx.lineTo(barX, capY + 4 * ui);
        ctx.lineTo(barX + barLen, capY + 4 * ui);
        ctx.lineTo(barX + barLen, capY - 6 * ui);
        ctx.stroke();
        ctx.fillText(label, barX + barLen + gap, capY);

        for (const it of placed) {
          const y = top + padTop + captionH + padBetween + it.row * rowH + rowH / 2;
          this._drawSwatch(ctx, it.kind, it.x, y - swH / 2, swW, swH, ui);
          ctx.fillStyle = T.label;
          ctx.fillText(it.text, it.x + swW + gap, y);
        }
        ctx.restore();
      };
      return { height, draw };
    }

    /** One sample in the key of an exported map: a room, hallway, wall, door, locked or secret door, entrance or stairs. */
    _drawSwatch(ctx, kind, x, y, w, h, ui) {
      const T = this.theme;
      ctx.save();
      ctx.lineWidth = ui;
      const outline = (rx, ry, rw, rh) => {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = T.wall;
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.globalAlpha = 1;
      };
      if (kind === 'room' || kind === 'hall') {
        ctx.fillStyle = kind === 'room' ? T.roomFloor : T.hallFloor;
        ctx.fillRect(x, y, w, h);
        outline(x, y, w, h);
      } else if (kind === 'wall') {
        // a wall line across a strip of room floor
        ctx.fillStyle = T.roomFloor;
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = T.wall;
        ctx.fillRect(x, y + h * 0.36, w, h * 0.28);
        outline(x, y, w, h);
      } else if (kind === 'door' || kind === 'locked' || kind === 'entrance') {
        const dw = w * 0.62;
        const dh = h * 0.55;
        ctx.fillStyle = kind === 'entrance' ? T.entranceFill : T.doorFill;
        ctx.strokeStyle = kind === 'entrance' ? T.entranceStroke : T.doorStroke;
        ctx.lineWidth = 1.5 * ui;
        ctx.fillRect(x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
        ctx.strokeRect(x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
        if (kind === 'locked') this._drawLock(ctx, x + w / 2, y + h / 2, h * 0.55, ui);
      } else if (kind === 'secret') {
        // a wall line across a strip of room floor, with the S written on it
        ctx.fillStyle = T.roomFloor;
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = T.wall;
        ctx.fillRect(x, y + h * 0.36, w, h * 0.28);
        outline(x, y, w, h);
        ctx.font = `700 ${h * 0.95}px Georgia, 'Times New Roman', serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(3, h * 0.3);
        ctx.strokeStyle = T.labelHalo;
        ctx.strokeText('S', x + w / 2, y + h / 2 + 0.5);
        ctx.fillStyle = T.label;
        ctx.fillText('S', x + w / 2, y + h / 2 + 0.5);
      } else if (kind === 'stairs') {
        const dw = w * 0.62;
        const x0 = x + (w - dw) / 2;
        ctx.fillStyle = T.roomFloor;
        ctx.fillRect(x0, y, dw, h);
        ctx.strokeStyle = T.arrow;
        ctx.beginPath();
        for (let i = 1; i <= 4; i++) {
          ctx.moveTo(x0 + dw * 0.15, y + (h * i) / 5);
          ctx.lineTo(x0 + dw * 0.85, y + (h * i) / 5);
        }
        ctx.stroke();
        ctx.strokeRect(x0, y, dw, h);
      }
      ctx.restore();
    }
  }

  DM.DungeonRenderer = DungeonRenderer;
})();
