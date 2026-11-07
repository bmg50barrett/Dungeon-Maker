/*
 * Undo and redo for edits made to a finished dungeon (Edit mode, room names, a level built again, and the same through the MCP
 * server). The dungeon is a plain data model, so a step is kept as a copy of the whole model as it was: the copy is text (JSON), so
 * it cannot be changed by accident, and undoing puts it back into the same dungeon object (the page and the tools keep holding that
 * object). To keep a long session from filling memory only the last steps are kept: at most `limit` of them, and at most `maxChars`
 * characters of copies between them.
 *
 *   const history = new DM.EditHistory();
 *   const before = history.snapshot(dungeon);        // just before a change
 *   ... change the dungeon ...
 *   history.push(dungeon, 'Draw hallway', before, { dx, dy });   // how far the change moved the map, if it did
 *   history.undo(dungeon)  ->  { ok, label, dx, dy }  // dx, dy: how far every square moved by undoing (the page moves its view the other way)
 *   history.redo(dungeon)
 *
 * A new change after undoing drops what could have been redone, as in any editor. Starting a new dungeon, or opening one, is
 * `history.clear()`.
 */
(function () {
  const DM = (globalThis.DM = globalThis.DM || {});

  const DEFAULT_LIMIT = 100;
  const DEFAULT_MAX_CHARS = 40e6;

  /** Put what a copy says into `target`, which stays the same object: its own properties are replaced. */
  function restoreInto(target, json) {
    const copy = JSON.parse(json);
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, copy);
  }

  class EditHistory {
    constructor({ limit = DEFAULT_LIMIT, maxChars = DEFAULT_MAX_CHARS } = {}) {
      this.limit = limit;
      this.maxChars = maxChars;
      this.undos = []; // { label, state, dx, dy }: state is the dungeon as it was before the change
      this.redos = []; // the same, with state the dungeon as it was after the change
    }

    /** Forget every step (a new dungeon has no past). */
    clear() {
      this.undos = [];
      this.redos = [];
    }

    /** A copy of the dungeon as it is now, to give to push. */
    snapshot(dungeon) {
      return JSON.stringify(dungeon);
    }

    get canUndo() {
      return this.undos.length > 0;
    }

    get canRedo() {
      return this.redos.length > 0;
    }

    /** What undoing would undo (for a button's label), or ''. */
    get undoLabel() {
      return this.undos.length ? this.undos[this.undos.length - 1].label : '';
    }

    get redoLabel() {
      return this.redos.length ? this.redos[this.redos.length - 1].label : '';
    }

    /**
     * A change was made to `dungeon`; `before` is the snapshot taken just before it. A change that left the dungeon as it was is not a
     * step. `shift` says how far the change moved the squares of the map, as the editing functions give it. Returns whether it was kept.
     */
    push(dungeon, label, before, shift = {}) {
      if (typeof before !== 'string' || before === this.snapshot(dungeon)) return false;
      this.undos.push({ label, state: before, dx: shift.dx || 0, dy: shift.dy || 0 });
      this.redos = [];
      this._trim();
      return true;
    }

    /** Put the dungeon back as it was before the last change. Returns { ok, label, dx, dy } or { ok: false, reason }. */
    undo(dungeon) {
      const step = this.undos.pop();
      if (!step) return { ok: false, reason: 'there is nothing to undo.' };
      this.redos.push({ ...step, state: this.snapshot(dungeon) });
      restoreInto(dungeon, step.state);
      return { ok: true, label: step.label, dx: -step.dx, dy: -step.dy };
    }

    /** Make the change again that was undone last. Returns { ok, label, dx, dy } or { ok: false, reason }. */
    redo(dungeon) {
      const step = this.redos.pop();
      if (!step) return { ok: false, reason: 'there is nothing to redo.' };
      this.undos.push({ ...step, state: this.snapshot(dungeon) });
      restoreInto(dungeon, step.state);
      return { ok: true, label: step.label, dx: step.dx, dy: step.dy };
    }

    /** Drop the oldest steps while there are too many, or their copies are too big (the newest is always kept). */
    _trim() {
      let chars = 0;
      for (const s of this.undos) chars += s.state.length;
      for (const s of this.redos) chars += s.state.length;
      while (this.undos.length > 1 && (this.undos.length > this.limit || chars > this.maxChars)) chars -= this.undos.shift().state.length;
    }
  }

  DM.EditHistory = EditHistory;
})();
