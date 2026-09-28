// Cogworks Frontier — guided objectives that walk a new player through the tech arc.
(function () {
  'use strict';
  const D = FG.data;
  const total = (g, id) => g.stats.total.p[id] || 0;
  const count = (g, kind) => (g.byKind[kind] || []).length;
  const rate = (g, id) => { const r = g.stats.rates('1m')[id]; return r ? r.p : 0; };

  const LIST = [
    { id: 'mine', text: 'Mine 10 iron ore', hint: 'Walk with WASD. Hold right-click on an ore tile within reach to mine it by hand.', check: (g) => total(g, 'iron_ore') >= 10 },
    { id: 'fuel', text: 'Gather 10 stone and some wood', hint: 'Stone patches are grey. Hold right-click on a tree for wood (fuel) or a boulder for lots of stone.', check: (g) => total(g, 'stone') >= 10 && total(g, 'wood') >= 4 },
    { id: 'drill', text: 'Run a burner drill on iron ore', hint: 'Press 1 to hold the burner drill and click to place it on iron ore. Then open your inventory (E), click wood or coal, and click the drill to fuel it.', check: (g) => (g.byKind.drill || []).some((e) => e.p === 'burner_drill' && e.status === 'working') },
    { id: 'furnace', text: 'Smelt 20 iron plates automatically', hint: 'Place the stone furnace on the tile the drill faces (R rotates before placing). Drills drop ore straight into it. Fuel the furnace too.', check: (g) => total(g, 'iron_plate') >= 20 },
    { id: 'coal', text: 'Automate coal with a burner drill', hint: 'Craft another burner drill (E) and place it on coal. Two drills facing each other on coal keep each other fuelled.', check: (g) => (g.byKind.drill || []).some((e) => e.lastOre === 'coal') },
    { id: 'belts', text: 'Lay 20 conveyor belts', hint: 'Craft belts and drag to place a line. Drills can drop ore onto belts, and belts can feed furnaces through arms.', check: (g) => count(g, 'belt') >= 20 },
    { id: 'arms', text: 'Place 4 inserter arms', hint: 'Arms move items from the tile behind them to the tile in front: belt → furnace → belt. Burner arms need fuel; inserter arms need power.', check: (g) => count(g, 'inserter') >= 4 },
    { id: 'power', text: 'Generate electricity', hint: 'Water pump on a shore facing away from water → pipe → boiler (fuel it) → steam engine. Carry power with wooden poles.', check: (g) => (g.powerNets || []).some((n) => n.engOut > 0) },
    { id: 'lab', text: 'Research Automation', hint: 'Craft Mechanics packs (copper plate + gear), build a lab inside a pole’s blue supply area, load it, then pick Automation in the research screen (T).', check: (g) => !!g.research.done.automation },
    { id: 'assembler', text: 'Build an assembler making Mechanics packs', hint: 'Place an Assembler Mk1 in power range, click it and choose Mechanics pack. Feed copper plates and gears with arms.', check: (g) => (g.byKind.crafter || []).some((e) => e.recipe === 'sci_1' && e.status === 'working') },
    { id: 'red', text: 'Produce 10 Mechanics packs per minute', hint: 'Each assembler Mk1 makes 6 per minute. A gear assembler can feed two pack assemblers.', check: (g) => rate(g, 'sci_1') >= 10 },
    { id: 'green', text: 'Research the Logistics pack', hint: 'Open research (T) and queue Logistics pack.', check: (g) => !!g.research.done.logistic_science },
    { id: 'green_auto', text: 'Produce 5 Logistics packs per minute', hint: 'Logistics packs need an inserter arm and a belt: build small assembler lines for circuits, gears, arms and belts.', check: (g) => rate(g, 'sci_2') >= 5 },
    { id: 'defend', text: 'Protect your base with 4 gun turrets', hint: 'Pollution drifts toward native hives and provokes attacks. Turrets need magazines: feed them with arms or by hand.', check: (g) => count(g, 'turret') + count(g, 'laser') >= 4 },
    { id: 'steel', text: 'Smelt 50 steel plates', hint: 'Research Steel processing. Furnaces turn 5 iron plates into 1 steel plate.', check: (g) => total(g, 'steel_plate') >= 50 },
    { id: 'train', text: 'Run a train on a schedule', hint: 'Research Railway. Drag rails from a mine to your base, place a train stop at each end and name them, put a locomotive and a wagon on the track, fuel it, then click it to add both stops to its schedule and switch to Automatic.', check: (g) => g.rail.trains.some((t) => t.mode === 'auto' && t.arrivals >= 2) },
    { id: 'oil', text: 'Pump crude oil', hint: 'Research Oil processing. Place a pumpjack on an oil well (dark patches) and pipe it to a refinery.', check: (g) => total(g, 'crude_oil') >= 100 },
    { id: 'plastic', text: 'Make 100 plastic bars', hint: 'Refine crude into petroleum gas, then combine gas and coal in a chemical plant.', check: (g) => total(g, 'plastic') >= 100 },
    { id: 'blue', text: 'Produce 50 Chemistry packs', hint: 'Chemistry packs need engines, logic boards and sulfur. This is a big step: plan a dedicated block.', check: (g) => total(g, 'sci_3') >= 50 },
    { id: 'purple', text: 'Produce 50 Industry packs', hint: 'Industry packs consume arc furnaces and productivity modules. Scale up steel and logic boards first.', check: (g) => total(g, 'sci_4') >= 50 },
    { id: 'uplink', text: 'Build the Orbital Uplink', hint: 'Research Orbital Uplink, then craft the 7×7 structure in an assembler and power it.', check: (g) => count(g, 'uplink') >= 1 },
    { id: 'launch', text: 'Complete the uplink and launch a satellite', hint: 'Feed 40 stages (composite frames, guidance computers, rocket fuel), insert a Survey satellite, then press Launch.', check: (g) => g.launches >= 1 },
  ];

  class Objectives {
    constructor(g) { this.g = g; this.idx = 0; this.list = LIST; }
    get current() { return LIST[this.idx] || null; }
    check() {
      let changed = false;
      while (this.idx < LIST.length && LIST[this.idx].check(this.g)) {
        FG.emit('objective', LIST[this.idx]);
        this.idx++;
        changed = true;
      }
      if (changed) FG.emit('objectives');
    }
    skip() { if (this.idx < LIST.length) { this.idx++; FG.emit('objectives'); } }
  }
  FG.Objectives = Objectives;
})();
