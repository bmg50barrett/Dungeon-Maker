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

      this._bindEvents();
      this.resize();
    }

    // ---- public API ---------------------------------------------------------

    setDungeon(dungeon) {
      this.dungeon = dungeon;
      this.model = dungeon ? this._buildModel(dungeon) : null;
      this.fit();
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
        this._drag = { x: e.clientX, y: e.clientY, tx: this.view.tx, ty: this.view.ty };
        c.classList.add('dragging');
      });
      c.addEventListener('pointermove', (e) => {
        if (!this._drag) return;
        this._fitted = false;
        this.view.tx = this._drag.tx + (e.clientX - this._drag.x);
        this.view.ty = this._drag.ty + (e.clientY - this._drag.y);
        this.requestDraw();
      });
      const end = () => {
        this._drag = null;
        c.classList.remove('dragging');
      };
      c.addEventListener('pointerup', end);
      c.addEventListener('pointercancel', end);
      c.addEventListener('dblclick', () => this.fit());
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => this.resize()).observe(c);
      } else {
        window.addEventListener('resize', () => this.resize());
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
      const doors = [];
      const markOpen = (o) => {
        const e = edgeOf(o.x, o.y, o.d);
        (e.h ? open.h : open.v)[e.i] = 1;
        return e;
      };
      for (const c of d.connections) {
        for (const o of c.openings) {
          markOpen(o);
          if (o.style === 'door') doors.push({ x: o.x, y: o.y, d: o.d, entrance: false });
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

      return { wallPath, roomFloor, hallFloor, allFloor, doors, stairs, labels };
    }

    // ---- drawing ------------------------------------------------------------

    draw({ scaleBar = true } = {}) {
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

      // screen-space overlays
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (this.options.showLabels) this._drawRoomLabels(model.labels);
      this._drawEntranceLabels();
      this._drawStairBadges(model.stairs);
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
      }
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
        if (ctx.roundRect) ctx.roundRect(sx - w / 2, sy - h / 2, w, h, 4 * ui);
        else ctx.rect(sx - w / 2, sy - h / 2, w, h);
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
        ctx.strokeText(l.text, sx, sy);
        ctx.fillText(l.text, sx, sy);
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
        this.draw({ scaleBar: false });
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
      if (this.model.doors.some((door) => !door.entrance)) items.push({ kind: 'door', text: 'Door' });
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

    /** One sample in the key of an exported map: a room, hallway, wall, door, entrance or stairs. */
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
      } else if (kind === 'door' || kind === 'entrance') {
        const dw = w * 0.62;
        const dh = h * 0.55;
        ctx.fillStyle = kind === 'door' ? T.doorFill : T.entranceFill;
        ctx.strokeStyle = kind === 'door' ? T.doorStroke : T.entranceStroke;
        ctx.lineWidth = 1.5 * ui;
        ctx.fillRect(x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
        ctx.strokeRect(x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
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
