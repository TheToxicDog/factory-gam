# Cogworks Frontier

A factory-building game that runs in the browser. You crash-land on an untouched world and start by mining ore by hand. From there you automate everything: drills, furnaces, belts, inserter arms, power, research, oil and chemistry. Your pollution draws attacks from native hives, so you'll need defenses. The game ends when you launch a satellite from the Orbital Uplink.

It uses no frameworks, has no build step and needs no assets. All art is drawn procedurally on a canvas.

## Play

- **Locally:** open `index.html` in a browser. It works straight from disk because it uses classic scripts, not modules.
- **Single file:** run `node tools/build.mjs` and open `dist/cogworks.html`. It contains the whole game in one file.
- **Hosted:** the included GitHub Actions workflow publishes the game to GitHub Pages on every push to `main`. To turn it on, go to *Settings → Pages → Build and deployment* and set the source to *GitHub Actions*.

A keyboard and mouse are required.

**Demo factory:** the title screen's *Demo factory* button starts a ready-made mid-game base on seed 2024, built on the map's real terrain. It has:

- steam power by the lake;
- a burner miner feeding a stone furnace;
- a self-fuelling burner-drill coal outpost;
- eight electric miners feeding a belt into an eight-furnace smelting column;
- assemblers making gears and Mechanics packs for two labs;
- a copper railway whose drills load the wagon and whose arms unload it into furnaces.

It's a normal game from there: explore it, open every machine, or keep building.

## Controls

| Action | Input |
| --- | --- |
| Walk | W A S D |
| Mine resources / pick up buildings | Hold right-click |
| Open a machine | Left-click |
| Place the held item (drag for lines of belts) | Left-click |
| Lay track: the planner curves it to reach the point | Hold rails, drag from a rail point |
| Get in or out of a train | Enter (then W go, S brake or reverse, A/D pick a branch) |
| Put the held item into a machine (fuel, ore, ammo) | Left-click the machine |
| Put one of the held item into a machine, chest, belt or train | Z (hold it and sweep to put one into each) |
| Split a stack | Right-click it in the inventory (Shift+right-click takes it all), then click a slot; right-click puts down one at a time |
| Move half a stack into a machine | Right-click it in the machine's window |
| Rotate | R (Shift+R reverses) |
| Clear hand, or copy the hovered building into your hand | Q |
| Inventory and crafting | E |
| Research | T |
| Production statistics | P |
| Map | M |
| Hotbar | 1 – 0 |
| Take a machine's output (Ctrl+click again for its fuel; works on burners, drills, boilers and rail cars) | Ctrl+click |
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
6. **Railways:** lay track with the rail planner, name train stops, and send locomotives with cargo wagons between your mines and smelters on schedules. Signals let many trains share the network.
7. **Optimization:** modules, beacons, faster belts, arc furnaces, solar fields and accumulators.
8. **Endgame:** build the Orbital Uplink, then feed it 40 stages of composite frames, guidance computers and rocket fuel. Load a Survey satellite and launch.

Guided objectives in the top-left walk you through the arc.

## Systems

- **Belts** have two lanes that carry visible items. Arms put items on the far lane and pick up from either lane, as in Factorio; drills drop ore on the lane nearest them, so drills on both sides of a belt fill both lanes. They handle curves, side-loading, tunnel belts and splitters (with priority and filters), in three speed tiers of 15, 30 and 45 items/s. Items are processed downstream-first, so fully compressed belts reach their full rated throughput.
- **Arms** only pick up what their target can use, keep small input buffers, and take output only. Burner arms refuel themselves. A burner holds one kind of fuel at a time, so an arm bringing coal waits (and says so) until hand-loaded wood is burnt or taken out.
- **Machines** show a status: working, no power, low power, out of fuel, missing ingredients, output full, or ore depleted. Stuck machines get a badge in the world.
- **Power networks** are built from poles. Steam engines draw from shared steam networks. Solar output follows the day/night cycle, and accumulators buffer the difference. When demand exceeds supply, every machine slows down.
- **Fluids** pool across connected pipes and machines. Each network holds one fluid. A full output blocks the machine, which is what makes oil byproducts a puzzle.
- **Pollution** spreads between 32×32 chunks and is absorbed by terrain and forests. When it reaches a hive, the hive gathers an attack wave that pathfinds (A*) to your polluting buildings. Hive evolution rises with time, pollution and destroyed hives, bringing crawlers, brutes, titans and colossi. Defend with turrets, laser turrets and walls, or play with Peaceful or no enemies.
- **Railways** follow Factorio's rail grid. Track runs between rail points on a 2-tile grid in eight directions: straight pieces, diagonal pieces, and curved pieces that bend 45° as a wide arc (radius about 9.7 tiles) and cost 4 rails. Two curves make a smooth 90° turn over 12×12 tiles. Drag with rails in hand and the planner (A* over rail states) lays straights, diagonals and curves to reach the point under the mouse, joining existing track and avoiding buildings. Track beyond your reach, or beyond the rails you carry, is left planned; click it to build it, or let drones do it.
- **Trains** are locomotives and cargo wagons riding the track. They only drive the way a locomotive faces, so a line with a stop at each end needs a locomotive at each end (or a loop). A stop serves trains passing with the stop on their right. Schedules wait for a time, full or empty cargo, or inactivity. Arms load and unload stopped wagons. Rail signals split track into blocks that hold one train each; a track signalled on one side only is one-way; chain signals keep trains out of a junction until they can get through it. You can ride and drive a train yourself.
- **Blueprints** copy, cut and paste areas, including track (kept on the rail grid). After you research Construction drones, ghosts build themselves from your inventory while you are nearby.
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
js/rails.js       rail geometry (2-tile grid, curves), track network, planner, signal blocks
js/trains.js      trains: cars, reservations, signals, pathfinding, schedules, driving
js/sim.js         game state, research, hand crafting, player, drones, fixed-rate tick
js/save.js        save / load / save codes
js/demo.js        the Demo factory scenario
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
node tests/sim.test.js   # data integrity + simulation behaviour (belts, power, oil, combat, railways, saves…)
node tests/perf.js       # ~14,000-entity factory: ms per tick and topology rebuild cost
```

The browser scripts (`tests/smoke.cjs`, `tests/play.cjs`, `tests/trains.cjs`, `tests/tour.cjs`, `tests/showcase.cjs` and others) drive the real page with Playwright. `tests/tour.cjs` walks through the Demo factory with real clicks and takes about 40 screenshots of the buildings and every window. They mine, build, fuel, drag belts, configure assemblers, save and load, and take screenshots.

## Not in this version yet

Fluid wagons, logistic robots and the circuit network are left for later iterations.
