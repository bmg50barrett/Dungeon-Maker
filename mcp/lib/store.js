'use strict';
/*
 * The dungeons Claude is working on, and the files they are saved to.
 *
 * Dungeons live in memory under short ids (d1, d2, ...) for as long as the server runs; a saved file
 * (the app's own "Data (JSON)" format, plus a picture) is what outlives it. Claude refers to a
 * dungeon by id, so a big dungeon is not sent back and forth for every edit.
 */
const fs = require('fs');
const path = require('path');
const { load, renderPng } = require('./dm');
const { ToolError } = require('./errors');

/** Where saved maps go: the DUNGEON_MAKER_MAPS folder if that is set, else a "maps" folder next to the app. */
const DEFAULT_DIR = process.env.DUNGEON_MAKER_MAPS || path.join(__dirname, '..', '..', 'maps');

const isInt = (n) => Number.isInteger(n);

/**
 * Is this (the parsed text of a JSON file) a dungeon the app can draw and edit? Returns what is wrong
 * in a sentence, or null. Light on purpose: it catches a wrong file, not every way a file could be damaged.
 */
function whatIsWrong(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return 'the file should hold one JSON object, the dungeon';
  for (const key of ['rooms', 'halls', 'connections', 'entrances']) if (!Array.isArray(d[key])) return `it has no "${key}" list`;
  if (!isInt(d.width) || !isInt(d.height) || d.width < 1 || d.height < 1) return 'it has no width and height';
  const roomIds = new Set();
  for (const [i, r] of d.rooms.entries()) {
    if (!r || r.id !== i) return `room ${i} does not have id ${i}`;
    if (!Array.isArray(r.cells) || r.cells.length === 0 || !r.bbox || !Array.isArray(r.labelCell) || !isInt(r.label)) return `room ${i} is missing its squares, size or number`;
    if (r.name !== undefined && typeof r.name !== 'string') return `room ${i} has a name that is not text`;
    roomIds.add(r.id);
  }
  for (const [i, h] of d.halls.entries()) {
    if (!h || h.id !== i || !Array.isArray(h.cells) || !Array.isArray(h.rooms)) return `hallway ${i} is not in the usual form`;
  }
  for (const [i, c] of d.connections.entries()) {
    if (!c || c.id !== i || !Array.isArray(c.openings) || !Array.isArray(c.rooms)) return `connection ${i} is not in the usual form`;
    if (c.type === 'hall' ? !d.halls[c.hall] : c.type !== 'door') return `connection ${i} has an unknown type or hallway`;
    for (const o of c.openings) {
      if (!o || !isInt(o.x) || !isInt(o.y) || ![0, 1, 2, 3].includes(o.d) || !roomIds.has(o.room) || typeof o.style !== 'string') return `connection ${i} has a door that is not in the usual form`;
    }
  }
  for (const e of d.entrances) {
    if (!e || !isInt(e.x) || !isInt(e.y) || ![0, 1, 2, 3].includes(e.d) || !roomIds.has(e.room)) return 'an entrance is not in the usual form';
  }
  return null;
}

/** A name that is safe as a file name on any system, or '' if nothing is left of it. */
function safeName(name) {
  const s = String(name === undefined || name === null ? '' : name)
    .trim()
    .replace(/[^A-Za-z0-9_\- ]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s) ? `dungeon-${s}` : s;
}

class Store {
  constructor({ dir = DEFAULT_DIR } = {}) {
    this.dir = dir;
    this.items = new Map();
    this.counter = 0;
    this.lastId = null;
  }

  /** Keep a dungeon under a new id. `built` is its state as made or opened, to tell later whether it was edited. */
  add(dungeon, { file = null } = {}) {
    const id = `d${++this.counter}`;
    const item = { id, dungeon, built: load().editState(dungeon), file };
    this.items.set(id, item);
    this.lastId = id;
    return item;
  }

  /** The dungeon with this id; with none given, the one last made, opened or edited. */
  get(id) {
    if (id === undefined || id === null || id === '') {
      if (!this.lastId) throw new ToolError('There is no dungeon yet. Make one with generate_dungeon, or open a saved one with open_dungeon.');
      id = this.lastId;
    }
    const item = this.items.get(String(id));
    if (!item) {
      const known = [...this.items.keys()];
      throw new ToolError(`There is no dungeon "${id}".${known.length ? ` The ones in use are: ${known.join(', ')}.` : ' Make one with generate_dungeon first.'}`);
    }
    this.lastId = item.id;
    return item;
  }

  /** Has the dungeon been changed by hand since it was made or opened? */
  isEdited(item) {
    return load().editState(item.dungeon) !== item.built;
  }

  /** The path of a saved map to open: a bare name or a relative path is looked for in the maps folder first. */
  resolveFile(name) {
    const text = String(name || '').trim();
    if (!text) throw new ToolError('Give the path of a saved dungeon (.json).');
    const candidates = path.isAbsolute(text) ? [text] : [path.join(this.dir, text), path.resolve(text)];
    const found = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
    if (!found) throw new ToolError(`There is no file "${text}"${path.isAbsolute(text) ? '' : ` in ${this.dir}`}. list_dungeons shows the saved maps.`);
    return found;
  }

  /** Read a dungeon from a Data (JSON) file, as the app saves it (or save() does). */
  open(name) {
    const file = this.resolveFile(name);
    if (path.extname(file).toLowerCase() !== '.json') throw new ToolError('Only .json files can be opened: the "Data (JSON)" file the app saves.');
    let d;
    try {
      d = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      throw new ToolError(`${file} is not valid JSON (${err.message}).`);
    }
    const wrong = whatIsWrong(d);
    if (wrong) throw new ToolError(`${file} is not a dungeon this tool can use: ${wrong}.`);
    d.cellSizeFt = isInt(d.cellSizeFt) && d.cellSizeFt > 0 ? d.cellSizeFt : 5;
    d.warnings = Array.isArray(d.warnings) ? d.warnings : [];
    d.stats = d.stats && typeof d.stats === 'object' ? d.stats : {};
    d.params = d.params && typeof d.params === 'object' ? d.params : {};
    d.seed = d.seed === undefined || d.seed === null ? '' : d.seed;
    return this.add(d, { file });
  }

  /**
   * Write the dungeon's Data (JSON) file and a picture of it into the maps folder. A name that is taken gets
   * -2, -3, ... after it, so nothing is overwritten unless `overwrite` says so.
   * @returns {{ json: string, png: string }}
   */
  save(item, { name, look, overwrite = false } = {}) {
    const dm = load();
    fs.mkdirSync(this.dir, { recursive: true });
    const wanted = safeName(name) || `${dm.exportFileName(item.dungeon, 'x').replace(/\.x$/, '')}${this.isEdited(item) ? '-edited' : ''}`;
    let base = wanted;
    const taken = (b) => fs.existsSync(path.join(this.dir, `${b}.json`)) || fs.existsSync(path.join(this.dir, `${b}.png`));
    for (let n = 2; !overwrite && taken(base); n++) {
      if (n > 999) throw new ToolError('Too many saved maps with that name: give it another name.');
      base = `${wanted}-${n}`;
    }
    const json = path.join(this.dir, `${base}.json`);
    const png = path.join(this.dir, `${base}.png`);
    fs.writeFileSync(json, dm.dungeonJson(item.dungeon));
    fs.writeFileSync(png, renderPng(item.dungeon, look));
    item.file = json;
    return { json, png };
  }

  /** The .json files in the maps folder, newest first: [{ name, path, modified }]. */
  saved(limit = 50) {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.toLowerCase().endsWith('.json'))
      .map((f) => ({ name: f, path: path.join(this.dir, f), modified: fs.statSync(path.join(this.dir, f)).mtime }))
      .sort((a, b) => b.modified - a.modified)
      .slice(0, limit);
  }
}

module.exports = { Store, whatIsWrong, safeName, DEFAULT_DIR };
