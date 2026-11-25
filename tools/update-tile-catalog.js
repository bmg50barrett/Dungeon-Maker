/*
 * Refresh src/tiles-catalog.js, the copy of the Dungeon Tiles catalog the tile list uses, after the tiles change.
 * Run by hand (the page itself never fetches anything):
 *
 *   node tools/update-tile-catalog.js                                   from GitHub (the Dungeon-Tiles repo, main)
 *   node tools/update-tile-catalog.js ../Dungeon-Tiles/catalog/tiles.json   from a copy on this computer
 */
'use strict';
const fs = require('fs');
const path = require('path');

const URL = 'https://raw.githubusercontent.com/bmg50barrett/Dungeon-Tiles/main/catalog/tiles.json';
const OUT = path.join(__dirname, '..', 'src', 'tiles-catalog.js');

function wrap(cat) {
  return (
    '/*\n * The Dungeon Tiles catalog (catalog/tiles.json from github.com/bmg50barrett/Dungeon-Tiles), kept in the app so the tile list\n' +
    ' * works offline and the page never fetches anything. Do not edit by hand: refresh it with  node tools/update-tile-catalog.js\n' +
    ' * after the tiles change.\n */\n' +
    '(function () {\n  const DM = (globalThis.DM = globalThis.DM || {});\n  DM.TILE_CATALOG = ' +
    JSON.stringify(cat, null, 2).replace(/\n/g, '\n  ') +
    ';\n})();\n'
  );
}

async function main() {
  const from = process.argv[2];
  const text = from ? fs.readFileSync(from, 'utf8') : await (await fetch(URL)).text();
  const cat = JSON.parse(text);
  if (!cat || !cat.faces || !Array.isArray(cat.editions)) throw new Error('That is not a Dungeon Tiles catalog (no faces or editions).');
  fs.writeFileSync(OUT, wrap(cat));
  console.log(`Wrote ${path.relative(process.cwd(), OUT)}: catalog version ${cat.catalog_version}, ${Object.keys(cat.faces).length} tiles, ${cat.editions.length} printed files (from ${from || URL}).`);
}

main().catch((err) => {
  console.error(`Could not update the tile catalog: ${err.message}`);
  process.exit(1);
});
