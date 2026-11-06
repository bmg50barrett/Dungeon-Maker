/*
 * The colours of the map. The map is drawn from a theme (a colour for each thing that gets
 * drawn), and the theme is worked out from a handful of choices, one per category: background,
 * rooms, hallways, lines and text, grid, doors, entrances. Each category offers a few
 * ready-made colours (the first is the default; for every category but Hallways it is the colour the
 * map was first drawn in) and the page
 * adds a free colour picker beside them.
 *
 * A category's choice is a single colour. The colours that go with it (the darker outline of
 * a door, the see-through tint of the grid) are worked out from it, so the picker only ever
 * has to ask for one.
 *
 * Pure functions, no drawing and no page, so this can be tested without a browser.
 */
(function () {
  const DM = (globalThis.DM = globalThis.DM || {});

  const HEX = /^#[0-9a-f]{6}$/i;

  /** Is this a colour the pickers can hold: "#" and six hex digits? */
  function isHexColor(value) {
    return typeof value === 'string' && HEX.test(value);
  }

  function toRgb(hex) {
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }

  function toHex(rgb) {
    return '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  }

  /** A colour `t` of the way from `a` towards `b` (t = 0 is a, t = 1 is b). */
  function mix(a, b, t) {
    const x = toRgb(a);
    const y = toRgb(b);
    return toHex(x.map((v, i) => v + (y[i] - v) * t));
  }

  /** The colour as a CSS rgba() string with the given opacity. */
  function rgba(hex, alpha) {
    const [r, g, b] = toRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /**
   * The categories, in the order the page shows them. `presets[0]` is the default colour (the
   * one the map was first drawn in, except for Hallways, which now starts as Clay). `extra` pins the colours that go with a ready-made colour exactly, where
   * they were chosen by hand and not worked out; any other colour gets them worked out.
   * `derive(hex)` gives the theme entries the category's colour controls.
   */
  const CATEGORIES = [
    {
      id: 'background',
      title: 'Background',
      presets: [
        { name: 'Parchment', hex: '#e6dbc0' },
        { name: 'Sage', hex: '#d3dcc4' },
        { name: 'Slate', hex: '#c9d3db' },
        { name: 'Night', hex: '#23262d' },
      ],
      derive: (hex) => ({ background: hex }),
    },
    {
      id: 'rooms',
      title: 'Rooms',
      presets: [
        { name: 'Ivory', hex: '#fbf7ec' },
        { name: 'White', hex: '#ffffff' },
        { name: 'Sand', hex: '#f1e1bf' },
        { name: 'Mist', hex: '#e9f0f5' },
      ],
      // the halo round a room number, and the scale bar's backing, are the room colour, a little see-through
      derive: (hex) => ({ roomFloor: hex, labelHalo: rgba(hex, 0.85) }),
    },
    {
      id: 'hallways',
      title: 'Hallways',
      presets: [
        { name: 'Clay', hex: '#e2c9a8' },
        { name: 'Stone', hex: '#d8d3c6' },
        { name: 'Moss', hex: '#d5dcb5' },
        { name: 'Straw', hex: '#efe5ca' },
      ],
      derive: (hex) => ({ hallFloor: hex }),
    },
    {
      id: 'lines',
      title: 'Lines and text',
      presets: [
        { name: 'Ink', hex: '#2a2018' },
        { name: 'Black', hex: '#111111' },
        { name: 'Navy', hex: '#1c2b4a' },
        { name: 'Forest', hex: '#1f3d2b' },
      ],
      // walls, room numbers, the lines that tie an outside number to its wall, and the scale bar
      derive: (hex) => ({ wall: hex, label: hex }),
    },
    {
      id: 'grid',
      title: 'Grid',
      presets: [
        { name: 'Brown', hex: '#78623e' },
        { name: 'Grey', hex: '#6e6e6e' },
        { name: 'Blue', hex: '#3d5a80' },
        { name: 'Green', hex: '#4a6741' },
      ],
      // fainter over the bare ground, stronger over the floors
      derive: (hex) => ({ gridFaint: rgba(hex, 0.1), gridFloor: rgba(hex, 0.38) }),
    },
    {
      id: 'doors',
      title: 'Doors',
      presets: [
        { name: 'Amber', hex: '#d9a45a', extra: { doorStroke: '#4a3018' } },
        { name: 'Oak', hex: '#8b5a2b' },
        { name: 'Iron', hex: '#9aa3ab' },
        { name: 'Teal', hex: '#3fa7a0' },
      ],
      derive: (hex) => ({ doorFill: hex, doorStroke: mix(hex, '#000000', 0.72) }),
    },
    {
      id: 'entrances',
      title: 'Entrances',
      presets: [
        { name: 'Red', hex: '#c0392b', extra: { entranceFill: '#e4573d', entranceStroke: '#4a1a10' } },
        { name: 'Blue', hex: '#1f6fb2' },
        { name: 'Green', hex: '#2e8b57' },
        { name: 'Purple', hex: '#7d3c98' },
      ],
      // the arrow, its E1 label, the stairs marker and (a shade lighter) the door mark
      derive: (hex) => ({
        arrow: hex,
        entranceFill: mix(hex, '#ffffff', 0.18),
        entranceStroke: mix(hex, '#000000', 0.75),
        stairsTint: rgba(hex, 0.1),
      }),
    },
  ];

  /** The colour chosen for each category when nothing has been changed: { background: '#e6dbc0', ... }. */
  function defaultColors() {
    const colors = {};
    for (const cat of CATEGORIES) colors[cat.id] = cat.presets[0].hex;
    return colors;
  }

  /**
   * Work out the theme the renderer draws with from the choice made for each category.
   * A category that is missing, or whose colour is not valid, falls back to its default.
   * @param {Object<string,string>} colors category id -> "#rrggbb"
   */
  function themeFrom(colors) {
    const theme = {};
    for (const cat of CATEGORIES) {
      const given = colors && colors[cat.id];
      const hex = isHexColor(given) ? given.toLowerCase() : cat.presets[0].hex;
      const preset = cat.presets.find((p) => p.hex === hex);
      Object.assign(theme, cat.derive(hex), preset && preset.extra);
    }
    return theme;
  }

  /**
   * The theme as CSS custom properties, so the legend and the page behind the map follow the
   * colours. Returns { '--map-bg': '#e6dbc0', ... }.
   */
  function themeCssVars(theme) {
    return {
      '--map-bg': theme.background,
      '--c-room': theme.roomFloor,
      '--c-hall': theme.hallFloor,
      '--c-wall': theme.wall,
      '--c-door': theme.doorFill,
      '--c-door-line': theme.doorStroke,
      '--c-entrance': theme.entranceFill,
      '--c-entrance-line': theme.entranceStroke,
      '--c-arrow': theme.arrow,
    };
  }

  DM.COLOR_CATEGORIES = CATEGORIES;
  DM.defaultColors = defaultColors;
  DM.themeFrom = themeFrom;
  DM.themeCssVars = themeCssVars;
  DM.isHexColor = isHexColor;
})();
