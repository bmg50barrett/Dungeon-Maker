/*
 * UI glue: reads the form, runs the generator, hands the result to the renderer.
 */
(function () {
  const DM = globalThis.DM;
  const $ = (id) => document.getElementById(id);

  const FIELDS = ['roomCount', 'avgRoomSize', 'minRoomWidth', 'minRoomLength', 'sizeVariance', 'entrances', 'connectionRandomness'];
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
    let closed = [];
    try {
      const saved = JSON.parse(localStorage.getItem(BLADES_KEY));
      if (Array.isArray(saved)) closed = saved;
    } catch (err) {
      // nothing saved, or unreadable: start with every column open
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
    compact: 'Rooms can touch · rooms a hallway joins are up to 4 squares apart',
    normal: 'Rooms 1–6 squares apart · except rooms joined by a door, which touch',
    spaced: 'Rooms 2–12 squares apart · except rooms joined by a door, which touch',
  };

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
    const ftW = d.width * d.cellSizeFt;
    const ftH = d.height * d.cellSizeFt;
    const warnings = d.warnings.map((w) => `<p class="warn">${escapeHtml(w)}</p>`).join('');
    $('summary').innerHTML =
      '<dl>' +
      row('Rooms', s.rooms) +
      row('Avg room size', `${s.meanRoomArea.toFixed(1)} sq`) +
      row('Hallways', s.multiRoomHalls > 0 ? `${s.hallConnections} (${s.multiRoomHalls} serve 3+ rooms)` : s.hallConnections) +
      row('Doorways', s.doorConnections) +
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
  // The Edit button on the map lets a click on a door change it (door, locked, secret, none). The
  // changes are made to the dungeon on the page (DM.current), so the picture, the data and printing
  // have them; a share link does not (it holds the settings, and rebuilds the dungeon from them).
  // Anything that builds a new dungeon would lose them, so those buttons ask first.

  /** How every opening was when the dungeon was built, to tell whether anything has been changed since. */
  let doorsAsBuilt = '';
  /** Has a door been changed (and not changed back) since the dungeon was built? */
  const editsMade = () => !!DM.current && DM.doorStates(DM.current) !== doorsAsBuilt;

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
  }

  const MAP_HINT = 'Scroll to zoom · drag to pan · double-click to fit';
  const EDIT_HINT = 'Edit mode · click a door to change it';

  function setEditMode(on) {
    renderer.setEditMode(on);
    const button = $('editMode');
    button.setAttribute('aria-pressed', String(on));
    button.title = on ? 'Edit mode is on: click a door to change it. Click here to leave it.' : 'Edit the doors: each click on a door changes it (door, locked, secret, no door)';
    $('canvasHint').textContent = on ? EDIT_HINT : MAP_HINT;
  }

  $('editMode').addEventListener('click', () => setEditMode($('editMode').getAttribute('aria-pressed') !== 'true'));
  renderer.onDoorChange = updateDoorLegend;

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
        doorsAsBuilt = DM.doorStates(dungeon);
        renderer.setDungeon(dungeon);
        updateDoorLegend();
        showSummary(dungeon, ms);
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
  for (const f of ['avgRoomSize', 'minRoomWidth', 'minRoomLength', 'sizeVariance', 'connectionRandomness']) $(f).addEventListener('input', updateHints);
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
  }
  for (const radio of document.querySelectorAll('input[name="labelPosition"]')) radio.addEventListener('change', updateLabelPosition);

  // ---- colors ------------------------------------------------------------------
  // One row per category (src/palette.js): its ready-made colors as swatches, then a free picker.
  // Like Label position, this is about drawing: the map and the legend change at once.
  const colors = DM.defaultColors();
  const colorRows = new Map(); // category id -> { cat, radios, custom, customSwatch, name }

  function applyColors() {
    const theme = DM.themeFrom(colors);
    renderer.setTheme(theme);
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

  $('showGrid').addEventListener('change', (e) => renderer.setOption('showGrid', e.target.checked));
  $('showLabels').addEventListener('change', (e) => renderer.setOption('showLabels', e.target.checked));
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

  /** The picture of the whole map (not just what is on screen) as a PNG, or null if the browser cannot make it. */
  function pictureCanvas() {
    const d = DM.current;
    if (!d) return null;
    return renderer.exportImage({ legend: $('exportLegend').checked, caption: DM.exportCaption(d) });
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
    const name = DM.exportFileName(DM.current, 'png');
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
    const copiedText = editsMade() ? 'Link copied. It brings back this dungeon without your door edits: save the picture or the data to keep those.' : 'Link copied. Opening it brings back this dungeon.';
    setExportStatus(copied ? copiedText : 'Copy the link from the box above.');
  }

  // Print: the whole map is drawn into a picture, which is the only thing on the printed page
  // (see @media print). The picture is made when asked for, and dropped once printing is done.
  let printUrl = null;

  function clearPrintImage() {
    const img = $('printImage');
    img.removeAttribute('src');
    if (printUrl) URL.revokeObjectURL(printUrl);
    printUrl = null;
  }

  async function printMap() {
    if (!DM.current) return setExportStatus(NO_DUNGEON);
    setExportStatus('Getting the page ready…');
    await pause(30);
    const blob = await pictureBlob();
    if (!blob) return setExportStatus(NO_PICTURE);
    clearPrintImage();
    printUrl = URL.createObjectURL(blob);
    const img = $('printImage');
    img.src = printUrl;
    try {
      await img.decode(); // printing before the picture is ready would give a blank page
    } catch (err) {
      clearPrintImage();
      return setExportStatus(NO_PICTURE);
    }
    setExportStatus('');
    window.print();
  }

  // Ctrl+P and the browser's own Print menu skip the button: make the picture right then
  window.addEventListener('beforeprint', () => {
    if (!$('printImage').getAttribute('src')) {
      const canvas = pictureCanvas();
      if (canvas) $('printImage').src = canvas.toDataURL('image/png');
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
