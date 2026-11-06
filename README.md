# Duckweed's Dungeon Drafter

Generates dungeon maps on a 5 ft grid and draws them on screen. No build step, no
dependencies: open `index.html` in a browser. The name sits across the top of the map,
above the dungeon (so it never covers it), in wine, over a 2pt gold rule.

The page is styled in the house style of Duckweed's Aeldara (see **Look** below). Its three typefaces
come from Google Fonts, so that is the one thing the page asks the network for; with no connection
it falls back to Georgia and works the same. Your dungeons are never sent anywhere.

## Look

Duckweed's Aeldara is a printed-book look: parchment, ink, and two accents, wine and gold.

- **Two themes**, chosen under **Theme** in the Display column: **Parchment** (the default) and **Dark**,
  for a dim room. Every color on the page is a custom property in `styles.css`: Parchment on `:root`
  (paper `#f4ecd9`, ink `#2a211b`, wine `#6b1f1a`, gold `#b0843a`, tint `#e9dcbf`, tint 2 `#efe4cb`, muted `#5b4a3a`,
  write-in lines `#a89276`) and Dark under `[data-theme="dark"]` (paper `#1f1814` on a `#1a1410` ground, ink `#efe4cb`,
  wine `#b5503f`, headings `#d98f80`, tint `#30261f`, tint 2 `#3d2d22`, muted `#c2b29a`, write-in lines `#7d6a55`).
  The choice is remembered on its own (see Remembered settings). `src/theme.js` sets it before the page is
  drawn, so there is no flash of the wrong one.
- **The map does not follow the theme.** It is drawn in the colors picked under Colors, in either theme, so the
  picture on screen, the PNG and the printout always match. For a dark map, pick the dark swatches
  (Background **Night**, Rooms **Umber**, Hallways **Soot**, Lines and text **Bone**).
- **Type**: IM Fell English SC for the title, column headings and the main buttons; Crimson Pro for everything
  else; IM Fell English italic for hint lines.
- **Rules of the house**: square corners everywhere, no all caps (small caps instead), no shadows. A column or
  section heading has a 1pt gold rule under it, the title a 2pt one. The map sits in a double gold frame
  (a 1.5pt line, then a 0.5pt line 5pt inside it). The segment chosen in a choice and Re-generate are filled wine
  (rose-wine with dark text in Dark); the random-seed button is a wine outline; a chip that is on shows a gold
  diamond; color swatches are square with a gold outline on the one chosen. Every input and button is at least
  44px tall. The brand has no icon set, so the little shape pictures on the chips are hidden: the diamond is
  the only mark.

## Inputs

| Input | Range | Meaning |
|---|---|---|
| Overall layout | Random / Cathedral / Ring / Cavern / Square / Long / Wide (default Random) | The shape the dungeon as a whole leans towards; see below |
| Room count | 1-99 | Number of rooms |
| Average room size | 1-999 | Mean room area, in grid squares (1 square = 5 ft x 5 ft) |
| Minimum room size: width and length | 1-30 each (default 1 x 1) | The least a room can measure across the map (width) and up and down it (length): 3 x 8 means every room is at least 3 wide and 8 long. 1 x 1 means no minimum |
| Room size variance | 0-100 | Standard deviation of room area, as a % of the average |
| Room shapes | at least one on (default on the page: Rectangle and Chamfered) | Which shapes rooms may take: rectangle, chamfered, L, T, U, H, Z, plus. Switch each on or off; rooms pick at random among the ones that are on |
| Room spacing | Compact / Normal / Spaced Out (default Compact) | In the Layout column. How far apart rooms are; see below. Compact rooms can share walls and rooms a hallway joins are at most 4 squares apart; Normal rooms are 1-6 apart and never touch; Spaced Out rooms are 2-12 apart and never touch. Spines are the exception to the furthest gap: they keep their own, longer length |
| Label position | Inside / Outside (default Inside) | Where room numbers are drawn: on the room's middle square, or just beyond one of its walls without overlapping any room (see below). A display option: it changes at once, without regenerating |
| Entrances | 1-10 (default 1) | External entrances into the dungeon |
| Entrances on outer edge only | On / Off (default On) | On: every entrance is a door in the outer wall. Off: entrances can be in any room (see below) |
| Connections | Hallways / Doorways | How most rooms are joined |
| Connection randomization | 0-100 (default 14) | % chance that a connection uses the other type. 14 is about 1 in 7; 0 never mixes; 50 is an even mix; 100 flips every connection |
| Hallway types | short, spine, curly, branching (default on the page: Short, Spine and Branching) | Which kinds of hallway may be built; see below. At least one of short, spine and curly must be on wherever hallways can occur at all |
| Hallway doors | None / Less / More / All (default All on the page) | How many of a hallway's openings into rooms have a door rather than an open archway: none, about 1 in 3, about 2 in 3, or all. Doorway connections always have a door. Changing it only adds or removes doors: with the same seed the rooms and hallways stay put |
| Seed (optional) | any text | Same inputs + same seed = identical dungeon. If the box is blank when you press **Re-generate dungeon**, the seed that was used is put in the box, so you can keep it, change it or share it; the next Generate then rebuilds that same dungeon, so clear the box (or use **Generate with random seed**, which ignores whatever is in the box, builds a new dungeon and puts its seed in the box) for a new one. The first dungeon, drawn when the page opens, does not fill the box |

Room areas follow a normal distribution centred on the average. A room cannot be
smaller than one square, which would nudge the mean upward at high variance, so the
distribution is shifted to keep the mean on target. The standard deviation of what you
actually get is slightly below the nominal value at 75-100%.

**Minimum room size** sets a floor on a room's width (across the map) and length (up and
down it), the size of its bounding box, so an L or a T is measured across its whole
extent. Rooms are never turned to fit: 3 wide x 8 long means at least 3 across and 8
down, so every room is tall rather than wide at the minimum, and 8 x 3 gives the
opposite. Set both to the same number for rooms that can be either way round. If the
average room size is smaller than width x length (an average of 5 with a minimum of
5 x 5 = 25 squares), rooms are built around width x length instead, and the variance
percentage is taken of that. The average is still held, and no room is ever below the
minimum, so there is little room for variation when the average is at or just above
the minimum: nearly every room is exactly the minimum size, with a few larger (the real
mean ends up about 4% above at 30% variance, 20% above at 100%). The variance only
spreads rooms out once the average is comfortably above width x length. Very lopsided
minimums (1 wide x 15 long) leave little choice: a room 1 wide can only be a strip, and
any other shape needs a wider box than its area calls for, so those rooms average
larger than asked. Hallway lengths follow the size rooms are built around. A minimum of
1 x 1 changes nothing.

## The map

- Rooms are sets of whole grid squares, so every wall is a straight horizontal or
  vertical line with its corners on grid vertices, and every corner is 90 degrees
  (inside) or 270 degrees (outside). Shapes: rectangle, L, T, U, H, plus, Z/step,
  chamfered, each of which can be switched on or off (**Room shapes**). Shapes come
  in any rotation. No holes, no pinch points.
- A shape is only offered to a room big enough to look like it (an L needs 5 squares,
  an H 7, a plus or Z 10, a chamfered room 16). If every shape you left on is too big
  for a small room, that room is a plain rectangle and the summary says how many were.
  Rectangles are the one shape that fits any size, so with only a large shape on, a
  dungeon of tiny rooms is mostly rectangles.
- **Overall layout** (Layout column, ahead of Rooms) leans the whole dungeon towards a familiar
  shape. It is a *bias*, not a rule: the generator prefers places inside the shape, and gives ground a
  little at a time when it cannot find room, so a layout never costs a dungeon any of its rooms. How big
  the shape is follows from the room count, the room size and the Room spacing, so it fits what you ask
  for. The first room goes at the middle of the shape (on the circle, for a ring), and the rest grow
  out from it as usual.

  | Layout | The shape |
  |---|---|
  | Random | No shape: rooms grow outward in any direction (the way the generator always worked, and the same dungeons as before for a given seed) |
  | Cathedral | A Latin cross: a long nave up and down the map crossed by a shorter transept nearer the top, the rooms in a line along both |
  | Ring | The rooms are put in order round a circle with an empty middle, a courtyard. When the last room comes round near enough to the first, one more connection joins them, a doorway where they share a wall or else a short hallway (so a ring is the one place hallways run in a circle). It closes in most dungeons, not all: if the ends do not come close enough, it is left open like a C. With Short hallways switched off it closes by a doorway or not at all |
  | Cavern | A few round chambers of different sizes around a middle one, meeting in narrow necks, like the outline of a cave. Curly hallways are picked twice as often as usual (if Curly is on) |
  | Square | Packed into a square: as broad as it is long, and fuller than Random |
  | Long | Tall and narrow: two to three times as long up and down the map as across |
  | Wide | Wide and shallow: two to three times as long across the map as up and down |

  Everything else works the same: Room spacing, hallway types, doors and entrances are all kept to.
  A tiny dungeon (a few rooms) is too small to show much of a shape. Choosing a layout changes the dungeon
  for a given seed; Random does not.
- **Room spacing** (Layout column) sets how far apart rooms are. A *gap* is the number of
  empty squares between two rooms, in a straight line: rooms that touch are 0 apart, and a
  room at another's corner counts as touching.

  | Spacing | Closest | Furthest (rooms a hallway joins) |
  |---|---|---|
  | Compact | 0: rooms can share a wall | 4 |
  | Normal | 1 | 6 |
  | Spaced Out | 2 | 12 |

  **A door overrides the closest rule.** Two rooms joined by a doorway share a wall (the door is
  in it), in every spacing. Every other pair of rooms keeps the closest gap, so in Normal and
  Spaced Out rooms only touch where a door joins them. A room is placed against a room it is
  joined to by a door, never against one it is not. (A room that touches its parent can still
  have its own gap to every other room.) Compact has no closest gap, so any rooms may touch.
  The furthest rule holds for rooms that a hallway joins: every room a hallway serves is within
  it of another room that hallway serves. **A spine is the exception**: it is a long straight
  passage by nature (8-20 squares at the default room size), so the rooms at its ends are as far
  apart as the spine is long, whatever the spacing. (Its closest gap still applies.) Held to 4 or 6
  squares, a spine left too little room for the rooms along its sides, and a dungeon of only
  spines and branching fell back to doorways.

  The furthest rule shortens hallways that would be longer: a short or spine hallway is cut to
  fit (so at Compact a spine is 3-4 squares long, at Normal 4-6, and only at Spaced Out does it
  reach 8-12), and a curly hallway shrinks its runs and jogs to fit (at Compact it is two jogs of
  one or two squares). Spines are always straight. This applies on top of the scaling with room
  size below, so a larger room no longer means a longer hallway beyond the limit.
- Doorways join rooms that share a wall.
- Hallways are 1 square wide and may bend, but one hallway can serve **many rooms**: a
  room can sit at each end, along either long side, or at the end of a branch that
  forks off the hallway. Some hallways run long and straight so that rooms line up
  along them. Every room's entrance into a hallway is a door or an open archway, as
  set by **Hallway doors**. A hallway can bend round a room that is in its way, but it
  is never allowed to be more than 1.5 times as long as the direct gap it crosses (plus
  4 squares), so no hallway wraps round the dungeon to reach a room that is close by; a
  room that cannot be reached more directly is placed somewhere else. Curly hallways wind
  on purpose and are not held to this.
- **Hallway types** are switched on and off like room shapes. Three are ways of
  starting a new hallway from a room, picked at random among the ones that are on
  (short 40, spine 40 and curly 20 parts in 100, shared out again when one is off):
  - **Short**: a short passage, which can end a few squares off to one side (2-8 squares
    long at the default room size, cut to fit the Room spacing: at most 4 at Compact, 6 at Normal).
  - **Spine**: a long straight passage (8-20 squares at the default room size, whatever the Room
    spacing; a crowded dungeon may stretch one by up to half as long again) with rooms lined up along its
    sides, so it serves several rooms. **Every spine serves at least 3 rooms**, whatever else
    is on, Branching included: the two rooms it joins and at least one more along its side.
    A spine is built together with its third room, and if no room fits along a candidate
    spine, that spine is not built at all (so a spine is never a plain two-room hallway).
    The last room of a dungeon can only join an existing spine, never start one; with Spine
    the only hallway type on, that room is now and then reached by a doorway instead, when
    no spine has space beside it. Other rooms then hang along the spine's sides as usual
    (about 4 rooms per spine with only Spine on). In a dungeon that is mostly doorways
    there are few hallway connections to go round, so it has fewer spines.
  - **Curly**: a winding passage that jogs sideways two or three times, so it has at
    least four bends. It runs about 15-20 squares in all at the default room size with Spaced Out
  spacing (shorter at Normal and Compact, where it still keeps its four bends).
  - **Branching**: hallways can fork (a branch is itself a short, spine or curly passage,
    whichever are on), and rooms can hang off the side of **any** hallway, not just a
    spine, so short and curly hallways can serve 3 or more rooms too. With it off, a hallway
    that is not a spine joins exactly two rooms.

  Hallways never loop: they only ever lead to rooms that are not connected yet, so if
  every connection is a hallway there is exactly one route between any two rooms. (There
  is no Loops type to switch on.) The one exception is the closing connection of a **Ring** layout.

  Doorways are not a hallway type: they are chosen with **Connections**. With every
  connection a doorway (Doorways at 0%, or Hallways at 100%) no hallway is built, so the
  types are not used. If a dungeon is crowded and the type it asked for does not fit,
  the other connection type is used as a last resort, but hallways built then still keep
  to the types that are on.
- Hallway lengths scale with room size, so the dungeon looks the same at any scale:
  at the default 30 squares a hallway between two rooms is 2-8 squares (8-20 for a long
  straight one); at 3 squares it is 1-3, and from about 270 squares up it stays at 6-24 (3x). The
  scale follows the room's side (the square root of its area) and stops at 0.3x and 3x.
  Each straight run of a curly hallway scales the same way (2-4 squares at the default).
  The figures for short hallways are before **Room spacing** caps them (4, 6 or 12 squares between rooms);
  spines are not capped.
- A few extra doorways are added after the rooms are joined, between rooms that share a
  wall, so some dungeons have a circuit. (Only doorways: hallways never make one. Rooms only
  share a wall where a doorway joined them, so at Normal and Spaced Out there are none to add.)
- Entrances are labelled E1, E2... With **Entrances on outer edge only** On they are
  doors in the outer walls, spread as far apart as possible, with an arrow pointing
  into the dungeon. A wall is on the outside only if a straight line out from its door,
  away from the room, runs to the edge of the map without crossing any room or hallway.
  A door that opens into a pocket between rooms, even one that winds round to open
  ground, is not on the outside.
- With it Off, entrances are spread over the whole dungeon and can be in any room. A
  room with a wall on the outside (by the same line test) still gets a door and arrow.
  A room buried inside the dungeon gets a **stairs** marker on its floor (a stairway or
  shaft to the surface) instead, kept clear of doorways. How many are stairs depends on
  how many rooms are buried: about 1 in 8 for a typical 14-room dungeon.
- Rooms are numbered breadth-first starting from E1's room.
- **Label position** (Display column) chooses where each room's number is drawn. **Inside**
  puts it on the square nearest the room's middle that has floor on all eight sides, so in an L or T
  (where the middle can fall beside a notch) it still never sits against a wall; a room too narrow
  for any such square gets a smaller number. **Outside** moves it just beyond one of the room's
  walls, in the gap between rooms, and never on top of any room (its own included). Each
  number goes on the nearest free wall, preferring the top and the side facing away from
  the middle of the dungeon, and keeps clear of other numbers, hallways and the arrows
  and labels of entrances where it can. If the only free place is a few squares from the
  wall, a thin line joins the number back to it. A room with no free place within reach
  keeps its number inside. This only changes how the map is drawn, so it applies at once
  without regenerating, and the map refits so the outside numbers are not cut off.
- **Colors** (Display column) has a row for each kind of thing on the map, each with four
  ready-made colors and a free color picker (the dashed square with a plus on the end; once you use
  it, it shows your color). The ready-made colors are the brand's own. The first one in every row is the
  default, which is the parchment look: Background Parchment `#f4ecd9`, Rooms Ivory `#fbf7ec`, Hallways Clay
  `#e2d2ae`, Lines and text Ink `#2a211b`, Grid Faded `#a89276`, Doors Gold `#b0843a`, Entrances Wine `#6b1f1a`.
  The legend on the map follows the colors, and **Reset** puts them all back. The
  rows:

  | Row | What it colors |
  |---|---|
  | Background | the paper behind the map, and the halo round the entrance labels |
  | Rooms | room floors (room numbers and the scale bar sit on a slightly see-through copy of it) |
  | Hallways | hallway floors |
  | Lines and text | walls, room numbers, the lines tying an outside number to its wall, the scale bar |
  | Grid | the 5 ft grid, fainter on bare ground and stronger on floors |
  | Doors | doors between rooms and hallways: the picked color, with a darker outline worked out from it |
  | Entrances | the arrow, its E1 label, the stairs marker, and the entrance door mark (a lighter shade, with a darker outline) |

  A color is one value, `#rrggbb`; the colors that go with it are worked out in
  `src/palette.js`. Colors are remembered between visits (see Remembered settings).
- Controls: scroll to zoom, drag to pan, double-click (or **Fit**) to fit the map.
- **Edit mode** (the **Edit** button on the map, left of the zoom buttons). Click it to start editing
  doors and hallways, and click it again to stop. While it is on, the button stays pressed in, the map has a
  coloured frame, and a row of three tools appears under the buttons. Leaving edit mode keeps the edits,
  and turning it on again starts on **Doors**. The line at the bottom of the map says what the tool does.
  - **Doors.** Every door between rooms (and hallways) has a ring round it, so a doorway with no door in
    it can be seen too. **Click a door to change it to the next state**: door, locked door (a padlock on it),
    secret door (the wall stays solid, with an **S** on it), no door (the wall is left open, with
    nothing in the gap), then back to a plain door. Hovering a door names what it is now. Dragging
    still pans (a click that wobbles a few pixels is still a click), and a quick double-click on a door is for
    the door, not Fit. Entrance doors (the ones with arrows) are not editable. The legend
    names locked and secret doors only while the map has some.
  - **Draw hallway.** Press and drag over the squares you want as hallway; a dashed preview follows the
    pointer, and the squares go in when you let go. Esc cancels a stroke that is still down. Dragging does
    not pan with this tool: hold **Space** while you drag (or use the middle mouse button) to pan. On a
    touch screen there is no Space key, so switch to **Doors** to pan, and back to draw (the zoom buttons
    and **Fit** work with any tool).
    - **Branching.** Squares that touch are one hallway, so a stroke that starts on, crosses or ends next to
      a hallway joins it, and a stroke from the middle of a hallway is a branch. Strokes that touch nothing
      are fine too: a hallway may be a dead end and serve no rooms at all.
    - **Rooms.** Where a stroke ends against a room's wall (or runs on into the room) it makes an opening into
      that room, and the opening follows the generator's **Hallway doors** setting: with *All*, every new
      opening has a door; with *None*, every one is an archway; in between, some are. The ring in the preview
      shows each opening that will be made, and the chance is worked out from the seed and the spot, so the
      preview is what you get. Running *along* a wall opens nothing. Room squares cannot be drawn on (a
      stroke through a room simply skips it), and neither can the square just outside an entrance door.
      The new openings can then be changed with the **Doors** tool like any others.
    - **The map grows to fit.** A stroke past the edge makes the map bigger (up to 1200 squares across),
      and the picture does not jump when it does. Deleting what was drawn out there shrinks it again.
  - **Delete hallway.** Hovering a hallway picks out one **stretch** in red: the squares between one
    junction and the next, or up to a dead end. A *junction* is a square with three or more hallway
    neighbours, or a side door into a room. **Click to delete the stretch**; its doors go with it, and what is
    left is re-counted, so deleting a junction can split one hallway into several. A whole hallway can be
    removed this way, generated ones included. Room numbers are not renumbered after an edit.
  - The edits are made to the dungeon on the page, so **Picture (PNG)**, **Data (JSON)** and **Print**
    have them (the picture never shows edit mode's rings or a stroke's preview), and the results in the
    Generate column (hallway count, footprint and so on) follow them. **Copy link** does not: a link holds
    the settings and rebuilds the dungeon from them, so it gives the doors and hallways the generator made;
    the status line under the share buttons says so once something has been changed. There is no undo yet:
    delete or redraw to put something back.
  - **Re-generate dungeon**, **Generate with random seed**, **Reset all** and a share link opened in the
    address bar all build a new dungeon, so if a door or hallway has been changed they first ask in a box:
    *"Re-generating the dungeon will lose all edits you made to its doors and hallways. To keep them, save the
    picture or the data first."* **Keep editing** (also Esc, or a click outside the
    box) leaves everything as it was; **Re-generate anyway** goes ahead. An edit that is put back as it was
    is not an edit, so four clicks on a door, or drawing a hallway and deleting it, and the box does not
    appear. Changing the inputs or the colors, or the Display choices, never builds a new dungeon, so it
    never asks.
- The inputs are in five columns side by side: **Layout** (the overall layout and room spacing), **Rooms** (count, sizes, shapes),
  **Hallways** (connection type, randomization, hallway types, doors, entrances),
  **Generate** (seed, the buttons and the results) and **Display** (theme, label position, the
  grid and room-number switches, and colors). Display only changes how the map is
  drawn (and, for the theme, the page around it), so it applies at once. Click a
  column's title bar to collapse it to a thin strip and give the map more room, and
  click the strip to open it again. Which columns are collapsed is remembered; on a first visit Display starts collapsed. A
  collapsed column opens by itself if one of its inputs has an error. On a narrow
  screen the columns stack and collapse like an accordion.
- The **legend** is a small card in the bottom right corner of the map, not in a column, so it
  stays in view however many columns are collapsed. Click its title to fold it away if it
  is covering part of the dungeon, and again to bring it back.

## Remembered settings

The page keeps your settings in this browser and puts them back on your next visit:
every input in the Layout, Rooms and Hallways columns (the layout, spacing, counts, sizes, shapes, hallway types, doors,
entrances, the outer-edge switch), the display choices (label position, grid and room-number
switches) and every color. They are saved as you change them. Which columns are collapsed is
remembered too, separately, and so is the theme (Parchment or Dark, under `dungeonMaker.theme`). The
theme is about the viewer, not the dungeon, so a share link does not hold it and **Reset all** leaves it alone.

- The **seed is not remembered**: it would make every visit open the same dungeon. The
  first dungeon of a visit is built with a new random seed.
- A **share link** opened in the address bar wins over what is remembered, and does not
  replace it: your own settings come back next time you open the page without a link. (Once
  you change something while a link's settings are showing, the whole set is remembered.)
- **Reset all** (the Settings section at the bottom of the Generate column) puts every
  input, switch and color back to how the page first comes, forgets what was kept, and builds
  a new dungeon.
- The settings are stored in the browser's `localStorage` under `dungeonMaker.settings`,
  as the same text a share link holds (so they are read as forgivingly: anything that is not
  valid is dropped and the usual value is used). Nothing is sent anywhere. If the browser
  blocks storage (private windows, a local file in some browsers), the page works as before
  and nothing is remembered. Clearing the site's data forgets them.

## Share and export

At the bottom of the Generate column. All of it is made in the page: nothing is uploaded.

- **Copy link** copies a link that opens this exact dungeon. It holds the inputs, the seed
  that was really used (even if the seed box was blank) and how the map is drawn: label
  position, grid and room-number switches, and any colors you changed. Open it, or paste
  it into the address bar of a page that is already open, and the form fills in and the
  same dungeon is built. The link is for the dungeon on the map, not for what is typed in
  the form now, so change something and press Generate first if you want a link to that.
  If the browser will not let the page use the clipboard, the link appears in a box to
  copy by hand. Making any new dungeon takes the link out of the address bar.
- **Picture (PNG)** saves the whole map, not just the part on screen, as `dungeon-<seed>.png`.
  It is drawn bigger than the screen (about 4000 pixels on the long side, but never less
  than 8 pixels a square, so a very large dungeon gives a larger file) so it stays sharp
  when printed. With **Legend and details on the picture** on, a strip under
  the map shows the seed, room count and size, a scale bar and a key to the symbols that
  dungeon actually has.
- **Data (JSON)** saves the dungeon as data (see the model below) for other programs.
- **Print** prints the map on one page, with the same picture (and the same legend switch).
  Ctrl+P and the browser's own Print menu print the map too, but the picture is made at
  the last moment there, so the Print button is the more dependable way.

A link looks like

```
#v=1&rooms=12&size=30&minw=1&minl=1&var=30&ent=2&rand=14&conn=hall&edge=1&shapes=rect,L,T&halls=short,spine&doors=less&spacing=compact&layout=ring&seed=679300265&label=outside&grid=0&nums=0&color.rooms=aabbcc
```

A link made before **Room spacing** existed has no `spacing` key, and one from before the **Overall layout**
has no `layout` key; they leave the page's choice as it is (Compact and Random when the page opens fresh),
like any other key a link leaves out. Every link made now names both.

The display keys (`label`, `grid`, `nums`, `color.<row>`) appear only when they differ from
the usual look, so what a link leaves out is the usual. (Links made before the brand colors came in leave out the colors the map then started in, so they now open in the parchment look; to bring the old tan map back, add `color.background=e6dbc0&color.hallways=e2c9a8&color.doors=d9a45a&color.entrances=c0392b&color.lines=2a2018&color.grid=78623e`.) Anything in a link that is not
valid is ignored, key by key, so a damaged link still opens with what is left. Links
need the page they were made on to still exist: one made from a file on your computer
only works on your computer.

A link holds the inputs, not the dungeon, so it relies on the generator making the same
dungeon from the same inputs. That holds for as long as the generator does not change;
an update to the layout rules can make an old link open a different (but still valid)
dungeon. The JSON file does not have that problem.

## Using it with Claude (MCP server)

The `mcp/` folder is a small server that lets Claude, in the Claude desktop app, make dungeons with this
generator, change them with the Edit mode tools, and draw them with this page's own picture code (the
picture is the one **Picture (PNG)** makes). So a campaign can be drafted in one conversation: Claude makes
the map, then writes the content for each room by the numbers printed on it.

**Setup** (once; needs Node.js 18 or newer):

1. In the `mcp` folder run `npm install`. It brings `@napi-rs/canvas`, the one package, which draws the picture.
2. Add the server to Claude's config file (`claude_desktop_config.json`; in Claude, Settings, Developer,
   **Edit Config** opens it). Add a `"mcpServers"` entry next to what is already there, with the paths of
   your own Node and of `mcp/server.js`:

   ```json
   {
     "mcpServers": {
       "dungeon-maker": {
         "command": "C:\\Program Files\\nodejs\\node.exe",
         "args": ["C:\\Users\\you\\OneDrive\\D&D\\Dungeon Maker\\mcp\\server.js"]
       }
     }
   }
   ```

   Backslashes are doubled in JSON. To save maps somewhere other than the `maps` folder next to the app, add
   `"env": { "DUNGEON_MAKER_MAPS": "C:\\somewhere\\else" }` inside the `"dungeon-maker"` entry.
3. Quit Claude completely and open it again. In a new chat the tools are under the tools menu.

**What Claude can do.** Each tool answers in words, and with the picture where it says so.

| Tool | What it does |
| --- | --- |
| `generate_dungeon` | Makes a dungeon from any of the page's settings (all optional, with the page's starting values) and a seed. Answers with the picture and a description of every room, door, hallway and entrance. |
| `open_dungeon` | Opens a dungeon saved as **Data (JSON)**, from the page or from `save_dungeon`. A bare file name is looked for in the maps folder. |
| `describe_dungeon` | The description alone: each room by its number on the map, with its shape, size in feet and place on the map, its doors and what they lead to. |
| `edit_dungeon` | A list of edits: change a door (door, locked, secret, no door), draw a hallway through some squares, delete a stretch of hallway. The rules are Edit mode's. |
| `draw_map` | The picture alone, with the legend, grid, room numbers, number position and colors as chosen. |
| `save_dungeon` | Writes the picture (`.png`) and the data (`.json`) to the maps folder. A name already used gets `-2`, `-3`, ... unless `overwrite` is set. |
| `list_dungeons` | The dungeons in use, and the saved maps. |

Things to know:

- Claude always calls rooms by the numbers on the map (a room's `label`, which is not its index in the data), so
  what it writes matches the picture.
- A door is written like `(12,7) east`: the east side of square (12,7), counted from the top left. That is
  what `edit_dungeon` takes to change it. Hallways are changed by the squares they pass through.
- Dungeons live in memory under ids (`d1`, `d2`, ...) while the server runs; the files from `save_dungeon` are
  what stays. As with the page, a seed no longer gives the dungeon once it has been edited, so save the data.
- If a hallway reaches past the top or left edge the map grows and every square's coordinates move; the
  answer says by how much, and hallways are numbered again (H1, H2, ...).
- Entrance doors cannot be changed, as in Edit mode. Nothing is sent anywhere: the server runs on your
  computer and Claude only gets what the tools answer.

`node tests/mcp.js` checks the tools, the protocol and the real process (after `npm install` in `mcp/`).

## Files

```
index.html, styles.css   page (styles.css holds the two themes as custom properties)
src/theme.js             Parchment or Dark: sets `data-theme` on the page, remembers the choice (loaded in the <head>)
src/rng.js               seedable random numbers
src/shapes.js            room shapes (rectilinear polyominoes), `DM.SHAPE_KINDS`
src/layout.js            the overall layouts and the shape each leans towards: `DM.LAYOUTS`, `DM.makeLayout`
src/generator.js         layout: placement, hallway routing (A*), entrances, output model
src/labels.js            where room numbers go (inside, or outside the walls): `DM.placeOutsideLabels`
src/palette.js           map colors: the ready-made choices per category, `DM.themeFrom`
src/share.js             share links, file names, JSON and caption for exports: `DM.encodeShare`, `DM.decodeShare`
src/edit.js              hallway editing on the data: `DM.planHallway`, `DM.addHallway`, `DM.deleteHallStretch`, `DM.editState`, `DM.walkCells`
src/render.js            canvas drawing, zoom/pan, the Edit mode tools (clicks, strokes), the exported picture (`exportImage`)
src/app.js               form handling, export buttons, opening links, the Edit button and tools, the lose-edits warning
tests/run.js             headless validation:  node tests/run.js
mcp/server.js            the MCP server Claude connects to: the protocol, over stdin and stdout
mcp/lib/tools.js         the tools Claude can call, and what each accepts
mcp/lib/dm.js            loads src/ into Node, and draws the picture with the page's own renderer
mcp/lib/describe.js      a dungeon in words, by the numbers on the map
mcp/lib/store.js         dungeons in use, saving and opening files
tests/mcp.js             tests of the server:  node tests/mcp.js  (after npm install in mcp/)
```

`DM.generateDungeon(params)` returns plain JSON-serialisable data, which is what
future export / editing features should build on:

```
{ width, height,                 // in squares
  rooms:       [{ id, label, kind, area, bbox, labelCell, cells: [[x, y], ...] }],
               // kind: 'rect' | 'chamfer' | 'L' | 'T' | 'U' | 'H' | 'Z' | 'plus'
  halls:       [{ id, kind, cells: [[x, y], ...], rooms: [roomId, ...], connection }],
               // kind: how the hallway started: 'short' | 'spine' | 'curly', or 'drawn' (Edit mode);
  connections: [{ id, type: 'door'|'hall', rooms: [roomId, ...], hall,
                  openings: [{ x, y, d, style, room }] }],
  entrances:   [{ id, label, kind: 'door'|'stairs', room, x, y, d }],
  warnings, stats, seed, params }
```

`params.hallTypes` lists the hallway types that were on. `stats.hallTypeCounts` says how
often each was used, `{ short, spine, curly, branching }`: a branch off an existing
hallway counts as its own kind and as `branching`, and so does a room hung off a hallway's
side (unless Branching is off: rooms along a spine are then just part of the spine).

`params.spacing` is the room spacing (`'compact'`, the default when it is left out, `'normal'` or
`'spaced'`); `DM.SPACING_GAPS` holds each one's closest and furthest gap. `params.layout` is the overall
layout (one of `DM.LAYOUTS`: `'random'`, the default when it is left out, `'cathedral'`, `'ring'`, `'cavern'`,
`'square'`, `'long'` or `'wide'`). Each layout other than random is a footprint (`DM.makeLayout`) that candidate
places are scored against and, early on, kept inside; it draws its numbers from a stream of its own, so
random dungeons come out as they always did. A ring's closing connection is the one hallway between rooms
that are already joined.

An opening's `style` is `'door'` or `'open'` (an archway) as the generator makes it; Edit mode can also
make it `'locked'` or `'secret'` (`DM.DOOR_STYLES`, in the order the clicks go round, with
`DM.nextDoorStyle` and `DM.DOOR_LABELS`). A secret door is drawn as solid wall with an S on it. The
Data (JSON) export has whatever the styles are when it is saved.

A `'door'` connection joins exactly two rooms through one opening. A `'hall'`
connection is one hallway: its `cells` form a single connected (possibly branching)
passage, `rooms` lists every room it serves (2 or more), and each of those rooms has
exactly one entry in `openings`. That is what the generator makes. Dungeons changed with the
Edit mode hallway tools are looser: a hallway may serve 0 or 1 rooms (a dead end), and may have
several openings into the same room. A hallway's `kind` after an edit is the kind that
contributed most of its squares, or `'drawn'` when it is all new. Rooms keep their numbers, and a
hall's `id` is always its index in `halls`. The edits live in `src/edit.js`, which changes the squares
and then rebuilds `halls`, `connections`, the map's size (squares of the map shift if it grows up or
left, so the rooms and entrances move with them) and `stats`. `DM.editState(dungeon)` is a canonical
text of the hallway squares and every opening's style, in an order that does not depend on how the
dungeon got there: the page compares it with the state as built to tell whether anything has been edited.

Coordinates start at (0, 0) top-left, y grows downward. Cell `(x, y)` covers the
square `[x, x+1] x [y, y+1]`. `d` is a side of the cell: 0 = N, 1 = E, 2 = S, 3 = W.
An opening is the edge on side `d` of room cell `(x, y)` (`room` says which room that
is); across that edge is the other room, or the hallway. A `'door'` entrance is the
edge on that side of that cell. A `'stairs'` entrance is the floor cell `(x, y)`
itself, and `d` is the wall side the stairs climb towards.

## Tuning

`DM.GENERATOR_CONFIG` in `src/generator.js` holds the knobs: how many extra doorways
to add (`extraConnectionFraction`), hallway length, how many hallway openings get a door for each Hallway doors
setting (`hallDoorChance`), how often each kind of new hallway is chosen (`hallKindWeights`:
short, spine, curly), how winding curly hallways are (`curlySegment`, `curlyJogs`), how
often a room joins an existing hallway instead of starting a new one
(`hallParentChance`), how
tightly the dungeon packs together, and so on.

How far apart rooms are is the `SPACING` table (`DM.SPACING_GAPS`): the closest and furthest gap
for each Room spacing choice. It caps the distances of every hallway but a spine, whatever the room size.

The hallway distances there (`hallLength`, `spineLength`, `curlySegment`, `hallLateral`,
`maxHallPath`, `pathMargin`) are for rooms of `hallScaleSize` (30) squares and are
scaled for other sizes by `DM.hallSettings(avgRoomSize)`. `maxDetour` and `detourSlack` set
how much longer than the direct gap a routed hallway may be (`DM.hallPathLimit`). Set `hallScaleMin` and
`hallScaleMax` to 1 to switch the scaling off, or widen them to scale further.

The randomization percentage is the chance for each connection, not a quota, so a
small dungeon can land a little above or below it. It is also not a hard guarantee:
if the layout leaves no room for the chosen type at some spot (for example a
doorway where no wall can be shared), the other type is used instead. If every
hallway type that can start a hallway is switched off, that fallback is not available
either, and a crowded dungeon may end up with fewer rooms than asked for (the summary
says so).
