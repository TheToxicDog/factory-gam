# Cogworks Frontier

A factory-building game that runs in the browser. You crash-land on an untouched world and start by mining ore by hand. From there you automate everything: drills, furnaces, belts, inserter arms, power, research, oil and chemistry. Your pollution draws attacks from native hives, so you'll need defenses. The game ends when you launch a satellite from the Orbital Uplink.

It uses no frameworks, has no build step and needs no assets. All art is drawn procedurally on a canvas.

## Play

- **Locally:** open `index.html` in a browser. It works straight from disk because it uses classic scripts, not modules.
- **Single file:** run `node tools/build.mjs` and open `dist/cogworks.html`. It contains the whole game in one file.
- **Hosted:** the included GitHub Actions workflow publishes the game to GitHub Pages on every push to `main`. To turn it on, go to *Settings → Pages → Build and deployment* and set the source to *GitHub Actions*.

A keyboard and mouse are required.

## Controls

| Action | Input |
| --- | --- |
| Walk | W A S D |
| Mine resources / pick up buildings | Hold right-click |
| Open a machine | Left-click |
| Place the held item (drag for lines of belts) | Left-click |
| Put the held item into a machine (fuel, ore, ammo) | Left-click the machine |
| Rotate | R (Shift+R reverses) |
| Clear hand, or copy the hovered building into your hand | Q |
| Inventory and crafting | E |
| Research | T |
| Production statistics | P |
| Map | M |
| Hotbar | 1 – 0 |
| Take a machine's output | Ctrl+click |
| Copy / paste machine settings | Shift+right-click / Shift+click |
| Copy an area as a blueprint, cut, paste | Ctrl+C / Ctrl+X then drag, Ctrl+V |
| Pick up everything in an area | X then drag |
| Shoot the nearest enemy | Hold Space |
| Throw a grenade | G |
| Detail overlay / pollution overlay | Alt / F |
| Pause menu (save, load, new game) | Esc |

## How a game unfolds

1. **Hands:** mine iron, stone and wood yourself. Put a burner drill on ore and a stone furnace in front of it.
2. **Mechanization:** burner drills feed each other coal. Belts and arms connect mines to furnaces.
3. **Electricity:** water pump → boiler → steam engines, carried by poles. Electric drills, arms and assemblers.
4. **Research:** labs consume research packs your factory makes. There are five tiers: Mechanics, Logistics, Defense, Chemistry and Industry.
5. **Chemistry:** pumpjacks, refineries and chemical plants turn crude oil into plastic, sulfur, acid, lubricant and rocket fuel. Advanced refining produces byproducts you have to deal with.
6. **Optimization:** modules, beacons, faster belts, arc furnaces, solar fields and accumulators.
7. **Endgame:** build the Orbital Uplink, then feed it 40 stages of composite frames, guidance computers and rocket fuel. Load a Survey satellite and launch.

Guided objectives in the top-left walk you through the arc.

## Systems

- **Belts** have two lanes that carry visible items. They handle curves, side-loading, tunnel belts and splitters (with priority and filters), in three speed tiers of 15, 30 and 45 items/s. Items are processed downstream-first, so fully compressed belts reach their full rated throughput.
- **Arms** only pick up what their target can use, keep small input buffers, and take output only. Burner arms refuel themselves.
- **Machines** show a status: working, no power, low power, out of fuel, missing ingredients, output full, or ore depleted. Stuck machines get a badge in the world.
- **Power networks** are built from poles. Steam engines draw from shared steam networks. Solar output follows the day/night cycle, and accumulators buffer the difference. When demand exceeds supply, every machine slows down.
- **Fluids** pool across connected pipes and machines. Each network holds one fluid. A full output blocks the machine, which is what makes oil byproducts a puzzle.
- **Pollution** spreads between 32×32 chunks and is absorbed by terrain and forests. When it reaches a hive, the hive gathers an attack wave that pathfinds (A*) to your polluting buildings. Hive evolution rises with time, pollution and destroyed hives, bringing crawlers, brutes, titans and colossi. Defend with turrets, laser turrets and walls, or play with Peaceful or no enemies.
- **Blueprints** copy, cut and paste areas. After you research Construction drones, ghosts build themselves from your inventory while you are nearby.
- **Saves** go to browser storage as gzip. There are three slots plus an autosave every 3 minutes (and whenever you quit or start another game). You can also export or import a save code to move a game between browsers.

## Project layout

```
index.html        page shell (loads css/ and js/ in order)
css/style.css     interface styles
js/core.js        namespace, directions, RNG, noise, helpers
js/data.js        items, fluids, recipes, buildings, research, enemies (all balancing lives here)
js/world.js       procedural terrain, ore patches, oil, hive sites
js/entities.js    inventories, placement, removal, fast-replace, item exchange
js/belts.js       lanes, curves, side-loading, tunnels, splitters, update ordering
js/fluids.js      fluid networks
js/power.js       electric networks, generation and demand
js/machines.js    drills, furnaces, assemblers, labs, boilers, pumps, arms, modules
js/combat.js      pollution spread, hives, attack waves, turrets, weapons
js/objectives.js  guided objectives
js/sim.js         game state, research, hand crafting, player, drones, fixed-rate tick
js/save.js        save / load / save codes
js/sprites.js     procedural building art (cached per direction)
js/icons.js       procedural item icons
js/render.js      world renderer (terrain chunk cache, belts, entities, lighting, overlays)
js/ui.js          HUD and windows
js/input.js       keyboard and mouse, building, blueprints
js/main.js        boot, title screen, main loop, autosave
tools/build.mjs   bundles everything into dist/cogworks.html
tests/            headless simulation tests and browser scripts
```

The simulation runs at a fixed 60 ticks per second, separate from rendering. It is deterministic apart from enemy spawning, and doesn't touch the DOM, so the tests run it headless in Node.

## Tests

```
node tests/sim.test.js   # data integrity + simulation behaviour (belts, power, oil, combat, saves…)
node tests/perf.js       # ~14,000-entity factory: ms per tick and topology rebuild cost
```

The browser scripts (`tests/smoke.cjs`, `tests/play.cjs`, `tests/showcase.cjs`) drive the real page with Playwright. They mine, build, fuel, drag belts, configure assemblers, save and load, and take screenshots.

## Not in this version yet

Trains and rail signals, logistic robots, the circuit network, and the planned late-game twist (contracts, markets or rival companies) are left for later iterations.
