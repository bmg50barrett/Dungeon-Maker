/*
 * UI glue: reads the form, runs the generator, hands the result to the renderer.
 */
(function () {
  const DM = globalThis.DM;
  const $ = (id) => document.getElementById(id);

  const FIELDS = ['roomCount', 'avgRoomSize', 'minRoomWidth', 'minRoomLength', 'sizeVariance', 'entrances', 'connectionRandomness', 'hallWidth', 'levels', 'levelStairs'];
  const renderer = new DM.DungeonRenderer($('map'));
  DM.renderer = renderer; // handy for poking around in the browser console

  // ---- collapsible columns ("blades") ----------------------------------------

  const BLADES_KEY = 'dungeonMaker.collapsedColumns';
  const bladeEls = () => Array.from(document.querySelectorAll('.blade'));

  function setBlade(blade, open) {
    const name = blade.querySelector('.blade-title').textContent;
    const toggle = blade.querySelector('.blade-toggle');
    blade.classList.toggle('collapsed', !open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.title = `${open ? 'Collapse' : 'Expand'} ${name}`;
  }

  function saveBlades() {
    try {
      const closed = bladeEls().filter((b) => b.classList.contains('collapsed')).map((b) => b.dataset.blade);
      localStorage.setItem(BLADES_KEY, JSON.stringify(closed));
    } catch (err) {
      // storage can be blocked (private mode, file:// in some browsers): the columns just open afresh next time
    }
  }

  function restoreBlades() {
    let closed = ['display']; // a first visit starts with Display folded away; once the columns have been used, what was chosen wins
    try {
      const saved = JSON.parse(localStorage.getItem(BLADES_KEY));
      if (Array.isArray(saved)) closed = saved;
    } catch (err) {
      // nothing saved, or unreadable: start as on a first visit
    }
    for (const blade of bladeEls()) setBlade(blade, !closed.includes(blade.dataset.blade));
  }

  /** A collapsed column cannot show its own error messages, so open any column that has one. */
  function openBladesWithErrors() {
    let changed = false;
    for (const blade of bladeEls()) {
      if (blade.classList.contains('collapsed') && blade.querySelector('.error:not(:empty)')) {
        setBlade(blade, true);
        changed = true;
      }
    }
    if (changed) saveBlades();
  }

  for (const blade of bladeEls()) {
    blade.querySelector('.blade-toggle').addEventListener('click', () => {
      setBlade(blade, blade.classList.contains('collapsed'));
      saveBlades();
    });
  }
  restoreBlades();

  function readParams() {
    const params = {};
    for (const f of FIELDS) params[f] = $(f).value;
    params.connectionType = document.querySelector('input[name="connectionType"]:checked').value;
    params.edgeEntrancesOnly = $('edgeEntrancesOnly').checked;
    params.roomShapes = shapeBoxes().filter((box) => box.checked).map((box) => box.value);
    params.hallTypes = hallBoxes().filter((box) => box.checked).map((box) => box.value);
    params.hallDoors = document.querySelector('input[name="hallDoors"]:checked').value;
    params.spacing = document.querySelector('input[name="spacing"]:checked').value;
    params.layout = document.querySelector('input[name="layout"]:checked').value;
    params.seed = $('seed').value;
    return params;
  }

  function shapeBoxes() {
    return Array.from(document.querySelectorAll('input[name="roomShape"]'));
  }

  function hallBoxes() {
    return Array.from(document.querySelectorAll('input[name="hallType"]'));
  }

  /** Show (or clear) the error under a group of chips and outline the group. */
  function showGroupError(id, msg) {
    $('err-' + id).textContent = msg;
    $(id).classList.toggle('invalid', Boolean(msg));
  }

  function showErrors(errors) {
    for (const f of FIELDS) {
      const msg = errors[f] || '';
      $('err-' + f).textContent = msg;
      $(f).setAttribute('aria-invalid', msg ? 'true' : 'false');
    }
    showGroupError('roomShapes', errors.roomShapes || '');
    showGroupError('hallTypes', errors.hallTypes || '');
    showGroupError('hallDoors', errors.hallDoors || '');
    showGroupError('spacing', errors.spacing || '');
    showGroupError('layout', errors.layout || '');
    openBladesWithErrors();
  }

  function updateShapesHint() {
    const boxes = shapeBoxes();
    const on = boxes.filter((box) => box.checked).length;
    $('shapesHint').textContent = on === 0 ? 'Switch on at least one shape' : `${on} of ${boxes.length} shapes on`;
    $('shapesAll').hidden = on === boxes.length;
    if (on > 0) showGroupError('roomShapes', '');
  }

  /** Whether the current connection settings can build hallways at all (a blank or bad randomization counts as yes). */
  function hallwaysPossible() {
    const pct = whole('connectionRandomness', 0, 100);
    if (pct === null) return true;
    return DM.hallwaysPossible({ connectionType: document.querySelector('input[name="connectionType"]:checked').value, connectionRandomness: pct });
  }

  const DOORS_HINTS = {
    none: 'Every hallway opening is an open archway',
    less: 'About 1 in 3 hallway openings have a door',
    more: 'About 2 in 3 hallway openings have a door',
    all: 'Every hallway opening has a door',
  };

  function updateDoorsHint() {
    const choice = document.querySelector('input[name="hallDoors"]:checked').value;
    $('hallDoorsHint').textContent = hallwaysPossible() ? DOORS_HINTS[choice] : 'Not used: every connection is a doorway';
  }

  const SPACING_HINTS = {
    compact: 'Rooms can touch · rooms a hallway joins are up to 4 squares apart · spines run longer',
    normal: 'Rooms 1–6 squares apart · except rooms joined by a door, which touch · spines run longer',
    spaced: 'Rooms 2–12 squares apart · except rooms joined by a door, which touch · spines run longer',
  };

  const LAYOUT_HINTS = {
    random: 'Rooms grow outward in any direction',
    cathedral: 'A long nave crossed by a transept, like a church floor plan',
    ring: 'Rooms circle an empty courtyard and close into a loop',
    spiral: 'Rooms wind outward in a spiral · the first two entrances are at its two ends',
    gauntlet: 'One chain of rooms, each joined only to the next, snaking back and forth (with Branching on, a hallway can fork to a one-room dead end) · the first two entrances are at its two ends',
    radial: 'The biggest room in the middle, every hallway running out from it like spokes, other rooms along them',
    mainst: 'One very long straight hallway, up and down the map, with the rooms and branches along it',
    square: 'Packed into a square footprint',
    long: 'A tall, narrow dungeon, longer up and down than across',
    wide: 'A wide, shallow dungeon, longer across than up and down',
  };

  function updateLayoutHint() {
    $('layoutHint').textContent = LAYOUT_HINTS[document.querySelector('input[name="layout"]:checked').value];
  }

  function updateSpacingHint() {
    $('spacingHint').textContent = SPACING_HINTS[document.querySelector('input[name="spacing"]:checked').value];
  }

  function updateHallTypesHint() {
    const boxes = hallBoxes();
    const on = boxes.filter((box) => box.checked).map((box) => box.value);
    const starts = on.some((v) => DM.HALL_KINDS.includes(v));
    const possible = hallwaysPossible();
    let text;
    if (!possible) {
      text = 'Not used: every connection is a doorway';
    } else if (!starts) {
      text = `${on.length} of ${boxes.length} types on · none of them can start a hallway`;
    } else {
      const notes = [];
      if (!on.includes('branching')) notes.push(on.includes('spine') ? 'only spines serve more than two rooms' : 'every hallway joins just two rooms');
      text = `${on.length} of ${boxes.length} types on` + (notes.length > 0 ? ` · ${notes.join(' · ')}` : '');
    }
    $('hallTypesHint').textContent = text;
    $('hallTypesAll').hidden = on.length === boxes.length;
    if (starts || !possible) showGroupError('hallTypes', '');
  }

  /** The field's value as a whole number within [lo, hi], or null if it is blank or out of range. */
  function whole(id, lo, hi) {
    const text = $(id).value.trim();
    const n = Number(text);
    return text !== '' && Number.isInteger(n) && n >= lo && n <= hi ? n : null;
  }

  function updateHints() {
    const avg = Number($('avgRoomSize').value);
    const sizeHint = $('sizeHint');
    if (Number.isInteger(avg) && avg >= 1 && avg <= 999) {
      const side = Math.sqrt(avg);
      sizeHint.textContent = `${avg} ${avg === 1 ? 'square' : 'squares'} ≈ ${avg * 25} sq ft (about ${Math.round(side * 5)}×${Math.round(side * 5)} ft)`;
    } else {
      sizeHint.textContent = 'Squares per room, 1–999';
    }

    const minW = whole('minRoomWidth', 1, 30);
    const minL = whole('minRoomLength', 1, 30);
    const minHint = $('minSizeHint');
    let base = avg; // what rooms are built around: the average, or the smallest room if that is bigger
    let raised = false;
    if (minW === null || minL === null) {
      minHint.textContent = 'Least a room measures across and up and down, 1–30 squares each';
    } else if (minW === 1 && minL === 1) {
      minHint.textContent = 'No minimum: rooms can be a single square';
    } else {
      const area = minW * minL;
      raised = Number.isInteger(avg) && avg >= 1 && avg < area;
      if (raised) base = area;
      minHint.textContent =
        `Every room is at least ${minW} wide × ${minL} long (${minW * 5}×${minL * 5} ft)` +
        (raised ? `, so rooms are built around ${area} squares instead of ${avg}` : '');
    }

    const pct = Number($('sizeVariance').value);
    const varianceHint = $('varianceHint');
    if (Number.isInteger(pct) && pct >= 0 && pct <= 100 && Number.isInteger(avg) && avg >= 1) {
      const sd = (base * pct) / 100;
      varianceHint.textContent =
        pct === 0
          ? 'Every room the same size'
          : `Std deviation ±${sd < 10 ? sd.toFixed(1) : Math.round(sd)} squares (${pct}% of ${raised ? `the ${base}-square base` : 'the average'})`;
    } else {
      varianceHint.textContent = 'Standard deviation, % of the average (0–100)';
    }

    updateRandomnessHint();
    updateSpacingHint();
    updateLayoutHint();
    updateLevelsHint();
  }

  /** The Levels hint, and the stairs input, which only means something with more than one level. */
  function updateLevelsHint() {
    const n = whole('levels', 1, 20);
    const stairs = whole('levelStairs', 1, 10);
    const many = n === null || n > 1; // (a blank or bad number leaves the stairs input alone)
    $('levelStairs').disabled = !many;
    $('levelsHint').textContent = n === null ? '1–20 floors' : n === 1 ? 'One floor' : `${n} floors, each built from the same settings · level 1 has the entrances`;
    $('levelStairsHint').textContent = !many
      ? 'Needs more than one level'
      : stairs === null
        ? 'Stairs between each pair of floors, 1–10'
        : `${stairs} ${stairs === 1 ? 'stair' : 'stairs'} between each pair of floors, in the same square on both`;
  }

  function updateRandomnessHint() {
    const pct = Number($('connectionRandomness').value);
    const hint = $('randomnessHint');
    const other = document.querySelector('input[name="connectionType"]:checked').value === 'hall' ? 'doorways' : 'hallways';
    const chosen = other === 'doorways' ? 'hallways' : 'doorways';
    if (!Number.isInteger(pct) || pct < 0 || pct > 100 || $('connectionRandomness').value.trim() === '') {
      hint.textContent = 'Chance a connection uses the other type (0–100)';
    } else if (pct === 0) {
      hint.textContent = `Every connection is ${chosen} (where the layout allows)`;
    } else if (pct === 100) {
      hint.textContent = `Every connection is ${other} (where the layout allows)`;
    } else {
      const oneIn = 100 / pct;
      const ratio = Math.abs(oneIn - Math.round(oneIn)) < 0.2 ? `${Math.round(oneIn)}` : oneIn.toFixed(1);
      hint.textContent = `About 1 in ${ratio} connections are ${other} instead of ${chosen}`;
    }
    // whether hallways can occur at all depends on these settings
    updateHallTypesHint();
    updateDoorsHint();
  }

  function updateEdgeOnlyHint() {
    const on = $('edgeEntrancesOnly').checked;
    $('edgeOnlyState').textContent = on ? 'On' : 'Off';
    $('edgeOnlyHint').textContent = on
      ? 'Entrances are doors in the outer walls.'
      : 'Entrances can be in any room. Rooms buried inside get a stairway to the surface.';
  }

  function row(label, value) {
    return `<dt>${label}</dt><dd>${value}</dd>`;
  }

  function showSummary(d, ms) {
    const s = d.stats;
    const levels = DM.levelCount(d);
    const floors = [d, ...(d.floors || [])]; // every floor's own figures
    const total = (key) => floors.reduce((n, f) => n + f.stats[key], 0);
    const ftW = d.width * d.cellSizeFt;
    const ftH = d.height * d.cellSizeFt;
    const warnings = d.warnings.map((w) => `<p class="warn">${escapeHtml(w)}</p>`).join('');
    const rooms = levels > 1 ? `${total('rooms')} (${s.rooms} on each level)` : s.rooms;
    const mean = floors.reduce((n, f) => n + f.stats.meanRoomArea, 0) / floors.length;
    const halls = total('hallConnections');
    const multi = total('multiRoomHalls');
    $('summary').innerHTML =
      '<dl>' +
      (levels > 1 ? row('Levels', levels) + row('Stairs', d.stairs.length) : '') +
      row('Rooms', rooms) +
      row('Avg room size', `${mean.toFixed(1)} sq`) +
      row('Hallways', multi > 0 ? `${halls} (${multi} serve 3+ rooms)` : halls) +
      row('Doorways', total('doorConnections')) +
      row('Entrances', s.stairsEntrances > 0 ? `${s.entrances} (${s.stairsEntrances} stairs)` : s.entrances) +
      row('Footprint', `${d.width}×${d.height} sq (${ftW}×${ftH} ft)`) +
      row('Seed', escapeHtml(d.seed)) +
      row('Built in', `${Math.max(1, Math.round(ms))} ms`) +
      '</dl>' +
      warnings;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  const generateButtons = [$('generate'), $('generateRandom')];
  const generateLabels = generateButtons.map((b) => b.textContent);

  // ---- edit mode ---------------------------------------------------------------------
  // The Edit button on the map lets a click on a door change it (door, locked, secret, none), and lets
  // hallways be drawn and deleted. The changes are made to the dungeon on the page (DM.current), so the
  // picture, the data and printing have them; a share link does not (it holds the settings, and
  // rebuilds the dungeon from them). Anything that builds a new dungeon would lose them, so those
  // buttons ask first.

  /** The doors and hallways as they were when the dungeon was built (DM.editState), to tell whether anything has been changed since. */
  let editsAsBuilt = '';
  /** Has anything been changed (and not changed back) since the dungeon was built? */
  const editsMade = () => !!DM.current && DM.editState(DM.current) !== editsAsBuilt;
  let builtMs = 0; // how long the dungeon on the map took to build, for the summary

  /** The warning before edits are thrown away. Resolves true if the user goes ahead. */
  function askToDiscardEdits() {
    const dialog = $('discardDialog');
    if (typeof dialog.showModal !== 'function') return Promise.resolve(window.confirm('Re-generating the dungeon will lose all edits. Go ahead?'));
    return new Promise((resolve) => {
      dialog.returnValue = '';
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'discard'), { once: true });
      dialog.showModal();
    });
  }

  /** Run `action`, which builds a new dungeon: at once if no door was edited, otherwise only if the user agrees. */
  function ifEditsDiscarded(action, onCancel) {
    if (!editsMade()) return action();
    return askToDiscardEdits().then((go) => {
      if (go) action();
      else if (onCancel) onCancel();
    });
  }

  // a click outside the box (on the dimmed page) is the same as Keep editing
  $('discardDialog').addEventListener('click', (e) => {
    if (e.target === $('discardDialog')) $('discardDialog').close('');
  });

  /** The legend names locked and secret doors only while the map has some. */
  function updateDoorLegend() {
    const n = renderer.doorCounts();
    $('legendLocked').hidden = n.locked === 0;
    $('legendSecret').hidden = n.secret === 0;
    $('legendLevelStairs').hidden = !renderer.dungeon || (renderer.dungeon.stairs || []).length === 0;
  }

  // ---- room names ---------------------------------------------------------------------
  // Each room may be given a name (room.name on the dungeon on the page). The Room names button on the map opens a
  // panel over it with a box for each room; the panel scrolls inside itself, so a dungeon of dozens of rooms is no
  // trouble. Names are not drawn on the map: the picture and the printout list them in a key, and the data has them.
  // Like edits, a share link does not.

  const MAX_ROOM_NAME = 60;
  const namePanelOpen = () => !$('roomPanel').hidden;

  function updateRoomNamesCount() {
    const rooms = DM.current ? DM.allRooms(DM.current) : [];
    const n = rooms.filter((r) => r.name).length;
    $('roomNamesCount').textContent = rooms.length === 0 ? '' : n === 0 ? `${rooms.length} rooms, none named` : `${n} of ${rooms.length} rooms named`;
  }

  /** One row (the room's number, then a text box) for each room, in number order, for the dungeon on show. */
  function showRoomNames(dungeon) {
    const list = $('roomNameList');
    list.textContent = '';
    if (!dungeon) {
      const none = document.createElement('p');
      none.className = 'room-name-empty';
      none.textContent = NO_DUNGEON;
      list.append(none);
      updateRoomNamesCount();
      return;
    }
    const inputs = [];
    for (const room of [...DM.allRooms(dungeon)].sort((a, b) => (a.level || 1) - (b.level || 1) || a.label - b.label)) {
      const row = document.createElement('div');
      row.className = 'room-name-row';
      const label = document.createElement('label');
      const inputId = `roomName${room.level || 1}-${room.id}`;
      label.htmlFor = inputId;
      label.textContent = DM.roomTag(room);
      const input = document.createElement('input');
      input.type = 'text';
      input.id = inputId;
      input.maxLength = MAX_ROOM_NAME;
      input.value = room.name || '';
      input.placeholder = 'Unnamed';
      input.autocomplete = 'off';
      input.setAttribute('aria-label', `Name of room ${DM.roomTag(room)}`);
      input.addEventListener('input', () => {
        const name = input.value.replace(/\s+/g, ' ').trim();
        if (name) room.name = name;
        else delete room.name;
        updateRoomNamesCount();
      });
      // Enter goes on to the next room's box
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const next = inputs[inputs.indexOf(input) + 1];
        if (next) next.focus();
      });
      inputs.push(input);
      row.append(label, input);
      list.append(row);
    }
    updateRoomNamesCount();
  }

  /** Show or hide the panel. Opening it puts the cursor in the first room's box. */
  function setRoomNamesOpen(open) {
    $('roomPanel').hidden = !open;
    $('roomNamesButton').setAttribute('aria-pressed', String(open));
    if (open) {
      showRoomNames(DM.current);
      const first = $('roomNameList').querySelector('input');
      if (first) first.focus();
    }
  }

  $('roomNamesButton').addEventListener('click', () => setRoomNamesOpen(!namePanelOpen()));
  $('closeRoomNames').addEventListener('click', () => {
    setRoomNamesOpen(false);
    $('roomNamesButton').focus();
  });
  $('roomPanel').addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    setRoomNamesOpen(false);
    $('roomNamesButton').focus();
  });
  $('clearRoomNames').addEventListener('click', () => {
    if (!DM.current) return;
    for (const room of DM.allRooms(DM.current)) delete room.name;
    showRoomNames(DM.current);
  });

  const MAP_HINT = 'Scroll to zoom · drag to pan · double-click to fit';
  const TOOL_HINTS = {
    door: 'Edit mode · click a door to change it',
    draw: 'Drag to draw a hallway · hold Space to pan',
    drawTouch: 'Drag to draw a hallway · pick Doors to pan',
    erase: 'Click a stretch of hallway to delete it',
  };

  /** What the hint says for a tool: a touch screen has no Space key, so there it says how else to pan. */
  function toolHint(tool) {
    const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    return TOOL_HINTS[tool === 'draw' && touch ? 'drawTouch' : tool];
  }

  /** Pick what a click or a drag on the map does in edit mode: 'door', 'draw' or 'erase'. */
  function setEditTool(tool) {
    renderer.setEditTool(tool);
    for (const b of $('editTools').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.tool === renderer.editTool));
    $('canvasHint').textContent = toolHint(renderer.editTool);
  }

  function setEditMode(on) {
    renderer.setEditMode(on);
    const button = $('editMode');
    button.setAttribute('aria-pressed', String(on));
    button.title = on ? 'Edit mode is on: click here to leave it' : 'Edit the doors and hallways';
    $('editTools').hidden = !on;
    if (on) setEditTool('door');
    else $('canvasHint').textContent = MAP_HINT;
  }

  $('editMode').addEventListener('click', () => setEditMode($('editMode').getAttribute('aria-pressed') !== 'true'));
  for (const b of $('editTools').querySelectorAll('button')) b.addEventListener('click', () => setEditTool(b.dataset.tool));
  renderer.onDoorChange = updateDoorLegend;
  // hallways were drawn or deleted: the legend, and the counts and footprint in the summary, follow
  renderer.onLayoutChange = () => {
    updateDoorLegend();
    showSummary(DM.current, builtMs);
  };

  // ---- levels ---------------------------------------------------------------------------
  // A dungeon of several levels has a row of buttons above the map, one for each floor and one for All. The map shows
  // one floor at a time (DM.floorView); All puts a picture of every floor over the map, side by side. Editing the doors and
  // hallways is for one floor at a time and is not offered yet.

  let viewLevel = 1; // the level on the map (from 1), or 'all'
  let shownDungeon = null; // the dungeon of several levels on the map, to tell a new one from another of its floors
  const mapArea = document.querySelector('.map-area');

  function levelButton(text, level, title) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.title = title;
    b.dataset.level = String(level);
    b.setAttribute('aria-pressed', String(level === viewLevel));
    b.addEventListener('click', () => {
      viewLevel = level;
      showFloor();
    });
    return b;
  }

  function buildLevelTabs(n) {
    const bar = $('levelTabs');
    bar.textContent = '';
    for (let i = 1; i <= n; i++) bar.append(levelButton(n <= 6 ? `Level ${i}` : String(i), i, `Show level ${i}`));
    const all = levelButton('All', 'all', 'Show every level side by side');
    all.classList.add('level-tabs-all');
    bar.append(all);
  }

  /** A small picture of every floor, in the all-levels view over the map. A click on one goes to that level. */
  function buildGallery(d) {
    const host = $('allLevels');
    host.textContent = '';
    for (let n = 1; n <= DM.levelCount(d); n++) {
      const figure = document.createElement('figure');
      const caption = document.createElement('figcaption');
      caption.textContent = `Level ${n}`;
      const canvas = renderer.imageOf(DM.floorView(d, n), { legend: false, size: 1100 });
      if (!canvas) continue;
      canvas.title = `Show level ${n}`;
      canvas.addEventListener('click', () => {
        viewLevel = n;
        showFloor();
      });
      figure.append(caption, canvas);
      host.append(figure);
    }
  }

  /** The all-levels pictures are drawn in the colors and numbering as they were: draw them again when those change. */
  function redrawGallery() {
    if (DM.current && viewLevel === 'all' && DM.levelCount(DM.current) > 1) buildGallery(DM.current);
  }

  /** Show the dungeon (DM.current) on the map: the level in viewLevel, or all of them. */
  function showFloor() {
    const d = DM.current;
    if (!d) return;
    const n = DM.levelCount(d);
    if (n === 1 || (viewLevel !== 'all' && viewLevel > n)) viewLevel = 1;
    const multi = n > 1;
    const all = multi && viewLevel === 'all';
    $('levelTabs').hidden = !multi;
    if (multi) buildLevelTabs(n);
    $('exportScope').hidden = !multi;
    $('editMode').hidden = multi;
    if (multi && $('editMode').getAttribute('aria-pressed') === 'true') setEditMode(false);
    mapArea.classList.toggle('showing-all', all);
    $('allLevels').hidden = !all;
    if (all) buildGallery(d);
    else $('allLevels').textContent = '';
    if (!multi) renderer.setDungeon(d);
    else {
      // every floor is shown in the view that fits level 1 (its entrances stick out of the map), so that a stair is in the
      // same place on screen on both of the floors it joins; the view is only fitted when a new dungeon comes
      const fresh = shownDungeon !== d;
      if (fresh) renderer.setDungeon(DM.floorView(d, 1));
      const level = all ? 1 : viewLevel;
      if (!fresh || level !== 1) renderer.setDungeon(DM.floorView(d, level), { keepView: true });
    }
    shownDungeon = multi ? d : null;
    updateDoorLegend();
  }

  /**
   * Build and show a dungeon from the current form values.
   * With randomSeed, the seed field is ignored and a fresh random seed is used instead;
   * that new seed is then put in the seed field.
   * fromLink is for a dungeon asked for by a share link: the link stays in the address bar.
   * Any other new dungeon is no longer the one the link describes, so the link is dropped.
   * fillSeed is for the Re-generate dungeon button: if the seed box was blank, it is filled in
   * with the seed the new dungeon was built from, so that seed can be kept, changed or shared.
   */
  function generate({ randomSeed = false, fromLink = false, fillSeed = false } = {}) {
    const raw = readParams();
    if (randomSeed) raw.seed = '';
    const check = DM.validateParams(raw);
    showErrors(check.errors);
    if (!check.ok) {
      $('summary').innerHTML = '<p class="fail">Fix the highlighted inputs and try again.</p>';
      return;
    }
    if (!fromLink) dropLinkFromAddress();
    const fillBlankSeed = fillSeed && !randomSeed && check.params.seed === null;

    const clicked = randomSeed ? $('generateRandom') : $('generate');
    for (const b of generateButtons) b.disabled = true;
    clicked.textContent = 'Generating…';
    // let the browser paint the busy state before the (synchronous) generation runs
    setTimeout(() => {
      try {
        const t0 = performance.now();
        const dungeon = DM.generateDungeon(check.params);
        const ms = performance.now() - t0;
        DM.current = dungeon;
        editsAsBuilt = DM.editState(dungeon);
        builtMs = ms;
        showFloor();
        showSummary(dungeon, ms);
        if (namePanelOpen()) showRoomNames(dungeon);
        setExportStatus('');
        // the random button always shows the seed it picked; a blank box is filled
        // (unless something was typed into it while the dungeon was being built)
        if (randomSeed || (fillBlankSeed && $('seed').value.trim() === '')) $('seed').value = dungeon.seed;
      } catch (err) {
        console.error(err);
        $('summary').innerHTML = `<p class="fail">Could not generate a dungeon: ${escapeHtml(err.message)}</p>`;
      } finally {
        generateButtons.forEach((b, i) => {
          b.disabled = false;
          b.textContent = generateLabels[i];
        });
      }
    }, 20);
  }

  $('params').addEventListener('submit', (e) => {
    e.preventDefault();
    ifEditsDiscarded(() => generate({ fillSeed: true }));
  });
  $('generateRandom').addEventListener('click', () => ifEditsDiscarded(() => generate({ randomSeed: true })));
  for (const f of ['avgRoomSize', 'minRoomWidth', 'minRoomLength', 'sizeVariance', 'connectionRandomness', 'levels', 'levelStairs']) $(f).addEventListener('input', updateHints);
  for (const radio of document.querySelectorAll('input[name="connectionType"]')) {
    radio.addEventListener('change', updateRandomnessHint);
  }

  $('edgeEntrancesOnly').addEventListener('change', updateEdgeOnlyHint);

  for (const box of shapeBoxes()) box.addEventListener('change', updateShapesHint);
  $('shapesAll').addEventListener('click', () => {
    for (const box of shapeBoxes()) box.checked = true;
    updateShapesHint();
    saveSettings();
  });

  for (const radio of document.querySelectorAll('input[name="hallDoors"]')) radio.addEventListener('change', updateDoorsHint);
  for (const radio of document.querySelectorAll('input[name="spacing"]')) radio.addEventListener('change', updateSpacingHint);
  for (const radio of document.querySelectorAll('input[name="layout"]')) radio.addEventListener('change', updateLayoutHint);
  for (const box of hallBoxes()) box.addEventListener('change', updateHallTypesHint);
  $('hallTypesAll').addEventListener('click', () => {
    for (const box of hallBoxes()) box.checked = true;
    updateHallTypesHint();
    saveSettings();
  });

  // Label position is about drawing, not building: it takes effect at once, with no new dungeon
  const LABEL_HINTS = {
    inside: 'Room numbers sit in the middle of each room',
    outside: "Room numbers sit just outside each room's wall, clear of the other rooms",
  };
  function updateLabelPosition() {
    const choice = document.querySelector('input[name="labelPosition"]:checked').value;
    $('labelPositionHint').textContent = LABEL_HINTS[choice];
    renderer.setOption('labelPosition', choice);
    redrawGallery();
  }
  for (const radio of document.querySelectorAll('input[name="labelPosition"]')) radio.addEventListener('change', updateLabelPosition);

  // ---- theme ----------------------------------------------------------------------
  // Parchment or Dark: the page around the map (src/theme.js sets it before the page is drawn). It is kept
  // apart from the other settings, so a share link and Reset all leave it alone, and the map keeps its
  // own colors in either theme (they are picked below), so the PNG and the printout match what is on screen.
  for (const radio of document.querySelectorAll('input[name="theme"]')) {
    radio.addEventListener('change', () => {
      if (radio.checked) DM.saveTheme(DM.applyTheme(radio.value));
    });
  }
  {
    const shown = DM.applyTheme(DM.savedTheme());
    for (const radio of document.querySelectorAll('input[name="theme"]')) radio.checked = radio.value === shown;
  }

  // ---- colors ------------------------------------------------------------------
  // One row per category (src/palette.js): its ready-made colors as swatches, then a free picker.
  // Like Label position, this is about drawing: the map and the legend change at once.
  const colors = DM.defaultColors();
  const colorRows = new Map(); // category id -> { cat, radios, custom, customSwatch, name }

  function applyColors() {
    const theme = DM.themeFrom(colors);
    renderer.setTheme(theme);
    redrawGallery();
    // the legend and the page behind the map follow along through CSS variables
    for (const [name, value] of Object.entries(DM.themeCssVars(theme))) document.documentElement.style.setProperty(name, value);
  }

  /** Show the category's current color: tick the matching ready-made swatch, or mark the free picker. */
  function showColor(row) {
    const hex = colors[row.cat.id];
    let match = null;
    for (const radio of row.radios) {
      radio.checked = radio.value === hex;
      if (radio.checked) match = radio;
    }
    row.custom.value = hex; // so the picker opens on the current color
    row.customSwatch.classList.toggle('active', !match);
    row.customSwatch.querySelector('.dot').style.setProperty('--sw', hex);
    row.name.textContent = match ? row.cat.presets.find((p) => p.hex === hex).name : hex;
  }

  function chooseColor(row, hex) {
    if (!DM.isHexColor(hex)) return;
    colors[row.cat.id] = hex.toLowerCase();
    showColor(row);
    applyColors();
  }

  for (const cat of DM.COLOR_CATEGORIES) {
    const field = document.createElement('fieldset');
    field.className = 'field color-field';
    field.id = `color-${cat.id}`;
    const legend = document.createElement('legend');
    legend.append(`${cat.title} `);
    const name = document.createElement('span');
    name.className = 'color-name';
    legend.append(name);
    const swatches = document.createElement('div');
    swatches.className = 'swatches';
    field.append(legend, swatches);

    const row = { cat, radios: [], custom: null, customSwatch: null, name };
    for (const preset of cat.presets) {
      const label = document.createElement('label');
      label.className = 'swatch';
      label.title = `${preset.name} ${preset.hex}`;
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `color-${cat.id}`;
      radio.value = preset.hex;
      radio.setAttribute('aria-label', `${cat.title}: ${preset.name}`);
      radio.addEventListener('change', () => chooseColor(row, preset.hex));
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.setProperty('--sw', preset.hex);
      label.append(radio, dot);
      swatches.append(label);
      row.radios.push(radio);
    }
    const customSwatch = document.createElement('label');
    customSwatch.className = 'swatch custom';
    customSwatch.title = 'Pick any color';
    const custom = document.createElement('input');
    custom.type = 'color';
    custom.setAttribute('aria-label', `${cat.title}: pick any color`);
    custom.addEventListener('input', () => chooseColor(row, custom.value));
    const customDot = document.createElement('span');
    customDot.className = 'dot';
    customSwatch.append(custom, customDot);
    swatches.append(customSwatch);
    row.custom = custom;
    row.customSwatch = customSwatch;

    $('colorPickers').append(field);
    colorRows.set(cat.id, row);
    showColor(row);
  }

  $('resetColors').addEventListener('click', () => {
    Object.assign(colors, DM.defaultColors());
    for (const row of colorRows.values()) showColor(row);
    applyColors();
    saveSettings();
  });

  // the legend sits on the map; its title folds it away when it is in the way
  $('legendToggle').addEventListener('click', () => {
    const open = $('legendToggle').getAttribute('aria-expanded') !== 'true';
    $('legendToggle').setAttribute('aria-expanded', String(open));
    $('legendToggle').title = open ? 'Hide the legend' : 'Show the legend';
    $('legendList').hidden = !open;
  });

  /** The On or Off beside a display switch. */
  const showSwitchState = (id) => ($(`${id}State`).textContent = $(id).checked ? 'On' : 'Off');
  for (const id of ['showGrid', 'showLabels']) {
    $(id).addEventListener('change', (e) => {
      renderer.setOption(id, e.target.checked);
      redrawGallery();
      showSwitchState(id);
    });
  }
  $('zoomIn').addEventListener('click', () => renderer.zoomBy(1.4));
  $('zoomOut').addEventListener('click', () => renderer.zoomBy(1 / 1.4));
  $('fit').addEventListener('click', () => renderer.fit());

  // ---- share and export ----------------------------------------------------------
  // A link, a picture, the data, or paper. All of it is made in the page: nothing is sent anywhere.

  function setExportStatus(text) {
    $('exportStatus').textContent = text;
  }

  function radioValue(name) {
    return document.querySelector(`input[name="${name}"]:checked`).value;
  }

  function setRadio(name, value) {
    for (const radio of document.querySelectorAll(`input[name="${name}"]`)) radio.checked = radio.value === value;
  }

  /** How the map is drawn right now (not part of building the dungeon, but part of how it looks). */
  function currentDisplay() {
    return {
      labelPosition: radioValue('labelPosition'),
      showGrid: $('showGrid').checked,
      showLabels: $('showLabels').checked,
      colors: { ...colors },
    };
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** The levels the picture and the printout cover: the one level, or (of several) the one on the map or all of them. */
  function levelsToDraw() {
    const n = DM.levelCount(DM.current);
    if (n === 1) return [1];
    if (viewLevel !== 'all' && radioValue('exportScope') === 'this') return [viewLevel];
    return Array.from({ length: n }, (_, i) => i + 1);
  }

  function levelCaption(n) {
    const d = DM.current;
    const levels = DM.levelCount(d);
    return levels === 1 ? DM.exportCaption(d) : `Level ${n} of ${levels} · ${DM.exportCaption(DM.floorView(d, n))}`;
  }

  /** A picture of the whole of each level asked for (not just what is on screen), a canvas each; `size` is the longer side, in px. */
  function pictureCanvases(size) {
    const d = DM.current;
    if (!d) return [];
    const legend = $('exportLegend').checked;
    return levelsToDraw().map((n) => renderer.imageOf(DM.floorView(d, n), { legend, caption: levelCaption(n), size }));
  }

  /** The pictures one above the other, in one canvas (one picture of a dungeon of several levels). */
  function stackCanvases(list) {
    if (list.length === 1) return list[0];
    const gap = 40;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(...list.map((c) => c.width));
    canvas.height = list.reduce((h, c) => h + c.height, 0) + gap * (list.length - 1);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = renderer.theme.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let y = 0;
    for (const c of list) {
      ctx.drawImage(c, Math.floor((canvas.width - c.width) / 2), y);
      y += c.height + gap;
    }
    return canvas;
  }

  /** The picture of the whole map (not just what is on screen) as a PNG, or null if the browser cannot make it. */
  function pictureCanvas() {
    if (!DM.current) return null;
    const n = levelsToDraw().length;
    // (the more levels in one picture, the smaller each, so that the picture stays a size a browser can make)
    const list = pictureCanvases(n === 1 ? 3920 : Math.max(500, Math.min(3920, Math.floor(14000 / n) - 300)));
    return list.length === 0 || list.some((c) => !c) ? null : stackCanvases(list);
  }

  function pictureBlob() {
    const canvas = pictureCanvas();
    if (!canvas) return Promise.resolve(null);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  const NO_DUNGEON = 'Generate a dungeon first.';
  const NO_PICTURE = 'The browser could not make the picture. Try it without the legend, or with a smaller dungeon.';

  async function downloadPicture() {
    if (!DM.current) return setExportStatus(NO_DUNGEON);
    setExportStatus('Making the picture…');
    await pause(30); // let that show before the picture is drawn
    const blob = await pictureBlob();
    if (!blob) return setExportStatus(NO_PICTURE);
    let name = DM.exportFileName(DM.current, 'png');
    const drawn = levelsToDraw();
    if (DM.levelCount(DM.current) > 1 && drawn.length === 1) name = name.replace(/\.png$/, `-level${drawn[0]}.png`);
    download(blob, name);
    setExportStatus(`Saved ${name}`);
  }

  function downloadData() {
    if (!DM.current) return setExportStatus(NO_DUNGEON);
    const name = DM.exportFileName(DM.current, 'json');
    download(new Blob([DM.dungeonJson(DM.current)], { type: 'application/json' }), name);
    setExportStatus(`Saved ${name}`);
  }

  /** The link for the dungeon on show: its inputs (with the seed it really used) and how it is drawn. */
  function shareLink() {
    const text = DM.encodeShare({ params: DM.current.params, display: currentDisplay() });
    return `${location.href.split('#')[0]}#${text}`;
  }

  async function copyLink() {
    if (!DM.current) return setExportStatus(NO_DUNGEON);
    const url = shareLink();
    const field = $('shareUrl');
    field.value = url;
    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch (err) {
      // no clipboard access (an old browser, or a page that is not secure): fall back to selecting the text
      field.hidden = false;
      field.select();
      try {
        copied = document.execCommand('copy');
      } catch (err2) {
        copied = false;
      }
    }
    field.hidden = copied;
    if (!copied) field.focus();
    // a link holds the settings, not the edits: the dungeon it rebuilds has the doors the generator made
    const copiedText = editsMade() ? 'Link copied. It brings back this dungeon without your edits to its doors and hallways, or the room names you typed: save the picture or the data to keep those.' : 'Link copied. Opening it brings back this dungeon.';
    setExportStatus(copied ? copiedText : 'Copy the link from the box above.');
  }

  // Print: the whole map is drawn into a picture, which is the only thing on the printed page
  // (see @media print). The picture is made when asked for, and dropped once printing is done.
  let printUrls = [];

  /** The pictures on the printed pages: #printImage, and one more after it for each further level. */
  function printImages() {
    return [$('printImage'), ...document.querySelectorAll('.print-extra')];
  }

  function clearPrintImage() {
    for (const img of printImages()) {
      img.removeAttribute('src');
      if (img.classList.contains('print-extra')) img.remove();
    }
    for (const url of printUrls) URL.revokeObjectURL(url);
    printUrls = [];
  }

  /** Put one picture (a URL) in the printed pages for each level: the first in #printImage, the others after it. */
  function setPrintImages(urls) {
    let after = $('printImage');
    urls.forEach((url, i) => {
      let img = $('printImage');
      if (i > 0) {
        img = document.createElement('img');
        img.className = 'print-extra';
        img.alt = 'The dungeon map, for printing';
        after.after(img);
      }
      img.src = url;
      after = img;
    });
  }

  async function printMap() {
    if (!DM.current) return setExportStatus(NO_DUNGEON);
    setExportStatus('Getting the page ready…');
    await pause(30);
    const list = pictureCanvases(levelsToDraw().length === 1 ? 3920 : 2400);
    const blobs = list.length === 0 || list.some((c) => !c) ? [] : await Promise.all(list.map((c) => new Promise((resolve) => c.toBlob(resolve, 'image/png'))));
    if (blobs.length === 0 || blobs.some((b) => !b)) return setExportStatus(NO_PICTURE);
    clearPrintImage();
    printUrls = blobs.map((b) => URL.createObjectURL(b));
    setPrintImages(printUrls);
    try {
      await Promise.all(printImages().map((img) => img.decode())); // printing before the pictures are ready would give blank pages
    } catch (err) {
      clearPrintImage();
      return setExportStatus(NO_PICTURE);
    }
    setExportStatus('');
    window.print();
  }

  // Ctrl+P and the browser's own Print menu skip the button: make the pictures right then
  window.addEventListener('beforeprint', () => {
    if (!$('printImage').getAttribute('src') && DM.current) {
      const list = pictureCanvases(levelsToDraw().length === 1 ? 3920 : 2400);
      if (list.length > 0 && list.every((c) => c)) setPrintImages(list.map((c) => c.toDataURL('image/png')));
    }
  });
  window.addEventListener('afterprint', clearPrintImage);

  $('downloadPng').addEventListener('click', downloadPicture);
  $('downloadJson').addEventListener('click', downloadData);
  $('copyLink').addEventListener('click', copyLink);
  $('printMap').addEventListener('click', printMap);
  // the link box sits inside the form: Enter there should not build a new dungeon
  $('shareUrl').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
  });

  // ---- opening a share link ---------------------------------------------------------

  /** Take the inputs from a link. Anything the link leaves out stays as it is. */
  function applyForm(form) {
    for (const f of FIELDS) if (form[f] !== undefined) $(f).value = String(form[f]);
    if (form.connectionType !== undefined) setRadio('connectionType', form.connectionType);
    if (form.hallDoors !== undefined) setRadio('hallDoors', form.hallDoors);
    if (form.spacing !== undefined) setRadio('spacing', form.spacing);
    if (form.layout !== undefined) setRadio('layout', form.layout);
    if (form.edgeEntrancesOnly !== undefined) $('edgeEntrancesOnly').checked = form.edgeEntrancesOnly;
    if (form.roomShapes !== undefined) for (const box of shapeBoxes()) box.checked = form.roomShapes.includes(box.value);
    if (form.hallTypes !== undefined) for (const box of hallBoxes()) box.checked = form.hallTypes.includes(box.value);
    // a link without a seed asks for a random dungeon, not whatever is left in the box
    $('seed').value = form.seed !== undefined ? form.seed : '';
    updateHints();
    updateEdgeOnlyHint();
    updateShapesHint();
  }

  /** A link holds only what differs from the usual look, so what it leaves out is the usual. */
  function applyDisplay(display) {
    setRadio('labelPosition', display.labelPosition || 'inside');
    updateLabelPosition();
    $('showGrid').checked = display.showGrid !== false;
    renderer.setOption('showGrid', $('showGrid').checked);
    $('showLabels').checked = display.showLabels !== false;
    renderer.setOption('showLabels', $('showLabels').checked);
    showSwitchState('showGrid');
    showSwitchState('showLabels');
    Object.assign(colors, DM.defaultColors(), display.colors);
    for (const row of colorRows.values()) showColor(row);
    applyColors();
  }

  /** Build the dungeon a link describes. Returns false if the address holds no link. */
  function openLink() {
    const link = DM.decodeShare(location.hash);
    if (!link.hasSettings) return false;
    applyForm(link.form);
    applyDisplay(link.display);
    generate({ fromLink: true });
    return true;
  }

  /** Once a different dungeon is made, the address should not still point at the old one. */
  function dropLinkFromAddress() {
    if (!location.hash) return;
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (err) {
      // some browsers will not rewrite the address of a local file: the link just stays
    }
  }

  // a link pasted into the address bar of this page (if the edits are kept, the address stops naming a link)
  window.addEventListener('hashchange', () => ifEditsDiscarded(openLink, dropLinkFromAddress));

  // ---- remembered settings -------------------------------------------------------
  // Every input, switch and color is kept in this browser (localStorage) as it changes, in the same
  // text as a share link, and comes back on the next visit. The seed is left out: it would make
  // every visit open the same dungeon. A share link opened in the address bar wins over what is kept,
  // and does not overwrite it until something is changed.

  const SETTINGS_KEY = 'dungeonMaker.settings';

  /** The inputs as typed (even half-typed: the tolerant reading of a link drops what is not valid), without the seed. */
  function settingsText() {
    const params = readParams();
    delete params.seed;
    return DM.encodeShare({ params, display: currentDisplay() });
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, settingsText());
    } catch (err) {
      // storage can be blocked (private mode, a local file in some browsers): settings just are not kept
    }
  }

  function restoreSettings() {
    let text = null;
    try {
      text = localStorage.getItem(SETTINGS_KEY);
    } catch (err) {
      return false;
    }
    const kept = DM.decodeShare(text);
    if (!kept.hasSettings) return false;
    delete kept.form.seed;
    applyForm(kept.form);
    applyDisplay(kept.display);
    return true;
  }

  // how the page first comes (taken before anything is restored), for Reset all
  const factoryForm = readParams();
  factoryForm.seed = '';
  factoryForm.hallTypes = factoryForm.hallTypes.slice();
  factoryForm.roomShapes = factoryForm.roomShapes.slice();
  const factoryDisplay = { labelPosition: 'inside', showGrid: true, showLabels: true, colors: DM.defaultColors() };

  $('resetSettings').addEventListener('click', () =>
    ifEditsDiscarded(() => {
      applyForm({ ...factoryForm, roomShapes: factoryForm.roomShapes.slice(), hallTypes: factoryForm.hallTypes.slice() });
      applyDisplay(factoryDisplay);
      $('exportLegend').checked = true;
      try {
        localStorage.removeItem(SETTINGS_KEY);
      } catch (err) {
        // nothing was kept, or it cannot be reached
      }
      generate();
    })
  );

  // any change in the columns (typing, chips, switches, colors) is kept; a link opened in the address bar is not,
  // until something is changed
  $('params').addEventListener('input', saveSettings);
  $('params').addEventListener('change', saveSettings);

  updateHints();
  updateEdgeOnlyHint();
  updateShapesHint();
  updateLabelPosition(); // (a browser can bring back a choice made before a reload)
  applyColors();
  if (!openLink()) {
    restoreSettings();
    generate();
  }
})();
