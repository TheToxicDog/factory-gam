// Cogworks Frontier — game data. Items, fluids, recipes, buildings and research
// are all defined here so balancing never requires touching simulation code.
(function () {
  'use strict';

  // ---------------------------------------------------------------- items
  // group: crafting-menu tab. place: entity prototype created when the item is placed.
  const items = {};
  let order = 0;
  function item(id, name, group, sub, opts) {
    items[id] = Object.assign({ id, name, group, sub, stack: 50, order: order++ }, opts || {});
  }

  // Raw resources
  item('wood', 'Wood', 'intermediate', 'raw', { stack: 100, fuel: 2000 });
  item('coal', 'Coal', 'intermediate', 'raw', { fuel: 4000 });
  item('stone', 'Stone', 'intermediate', 'raw');
  item('iron_ore', 'Iron ore', 'intermediate', 'raw');
  item('copper_ore', 'Copper ore', 'intermediate', 'raw');
  // Materials
  item('iron_plate', 'Iron plate', 'intermediate', 'material', { stack: 100 });
  item('copper_plate', 'Copper plate', 'intermediate', 'material', { stack: 100 });
  item('stone_brick', 'Stone brick', 'intermediate', 'material', { stack: 100 });
  item('steel_plate', 'Steel plate', 'intermediate', 'material', { stack: 100 });
  item('plastic', 'Plastic bar', 'intermediate', 'material', { stack: 100 });
  item('sulfur', 'Sulfur', 'intermediate', 'material');
  item('solid_fuel', 'Solid fuel', 'intermediate', 'material', { fuel: 12000 });
  item('rocket_fuel', 'Rocket fuel', 'intermediate', 'material', { stack: 10, fuel: 100000 });
  // Components
  item('iron_gear', 'Iron gear', 'intermediate', 'component', { stack: 100 });
  item('copper_wire', 'Copper wire', 'intermediate', 'component', { stack: 200 });
  item('circuit', 'Circuit board', 'intermediate', 'component', { stack: 200 });
  item('engine_unit', 'Engine unit', 'intermediate', 'component');
  item('advanced_circuit', 'Logic board', 'intermediate', 'component', { stack: 200 });
  item('battery', 'Battery', 'intermediate', 'component', { stack: 200 });
  item('electric_motor', 'Electric motor', 'intermediate', 'component');
  item('processing_unit', 'Processor core', 'intermediate', 'component', { stack: 100 });
  item('low_density', 'Composite frame', 'intermediate', 'component', { stack: 10 });
  item('guidance_unit', 'Guidance computer', 'intermediate', 'component', { stack: 10 });
  item('satellite', 'Survey satellite', 'intermediate', 'component', { stack: 1 });
  // Science
  item('sci_1', 'Mechanics pack', 'intermediate', 'science', { stack: 200, color: '#d8423a' });
  item('sci_2', 'Logistics pack', 'intermediate', 'science', { stack: 200, color: '#4cae48' });
  item('sci_mil', 'Defense pack', 'intermediate', 'science', { stack: 200, color: '#8a8f99' });
  item('sci_3', 'Chemistry pack', 'intermediate', 'science', { stack: 200, color: '#3b8fe0' });
  item('sci_4', 'Industry pack', 'intermediate', 'science', { stack: 200, color: '#a24fd0' });
  // Modules
  item('speed_module', 'Speed module', 'production', 'module', { module: { speed: 0.2, power: 0.5 } });
  item('efficiency_module', 'Efficiency module', 'production', 'module', { module: { power: -0.3 } });
  item('productivity_module', 'Productivity module', 'production', 'module', {
    module: { prod: 0.04, speed: -0.05, power: 0.4, pollution: 0.05 },
  });

  // Logistics
  item('wooden_chest', 'Wooden chest', 'logistics', 'storage', { place: 'wooden_chest' });
  item('iron_chest', 'Iron chest', 'logistics', 'storage', { place: 'iron_chest' });
  item('steel_chest', 'Steel chest', 'logistics', 'storage', { place: 'steel_chest' });
  item('storage_tank', 'Storage tank', 'logistics', 'storage', { place: 'storage_tank' });
  item('belt', 'Conveyor belt', 'logistics', 'belt', { stack: 100, place: 'belt' });
  item('fast_belt', 'Fast conveyor', 'logistics', 'belt', { stack: 100, place: 'fast_belt' });
  item('express_belt', 'Express conveyor', 'logistics', 'belt', { stack: 100, place: 'express_belt' });
  item('underground_belt', 'Tunnel belt', 'logistics', 'belt', { place: 'underground_belt' });
  item('fast_underground', 'Fast tunnel belt', 'logistics', 'belt', { place: 'fast_underground' });
  item('express_underground', 'Express tunnel belt', 'logistics', 'belt', { place: 'express_underground' });
  item('splitter', 'Splitter', 'logistics', 'belt', { place: 'splitter' });
  item('fast_splitter', 'Fast splitter', 'logistics', 'belt', { place: 'fast_splitter' });
  item('express_splitter', 'Express splitter', 'logistics', 'belt', { place: 'express_splitter' });
  item('burner_inserter', 'Burner arm', 'logistics', 'inserter', { place: 'burner_inserter' });
  item('inserter', 'Inserter arm', 'logistics', 'inserter', { place: 'inserter' });
  item('long_inserter', 'Long arm', 'logistics', 'inserter', { place: 'long_inserter' });
  item('fast_inserter', 'Fast arm', 'logistics', 'inserter', { place: 'fast_inserter' });
  item('filter_inserter', 'Sorting arm', 'logistics', 'inserter', { place: 'filter_inserter' });
  item('small_pole', 'Wooden pole', 'logistics', 'power', { place: 'small_pole' });
  item('medium_pole', 'Steel pole', 'logistics', 'power', { place: 'medium_pole' });
  item('big_pole', 'Pylon', 'logistics', 'power', { place: 'big_pole' });
  item('pipe', 'Pipe', 'logistics', 'fluid', { stack: 100, place: 'pipe' });
  item('pipe_ug', 'Tunnel pipe', 'logistics', 'fluid', { place: 'pipe_ug' });
  // Production
  item('offshore_pump', 'Water pump', 'production', 'energy', { place: 'offshore_pump' });
  item('boiler', 'Boiler', 'production', 'energy', { place: 'boiler' });
  item('steam_engine', 'Steam engine', 'production', 'energy', { place: 'steam_engine' });
  item('solar_panel', 'Solar panel', 'production', 'energy', { place: 'solar_panel' });
  item('accumulator', 'Accumulator', 'production', 'energy', { place: 'accumulator' });
  item('burner_drill', 'Burner drill', 'production', 'extraction', { place: 'burner_drill' });
  item('electric_drill', 'Electric drill', 'production', 'extraction', { place: 'electric_drill' });
  item('pumpjack', 'Pumpjack', 'production', 'extraction', { place: 'pumpjack' });
  item('stone_furnace', 'Stone furnace', 'production', 'smelting', { place: 'stone_furnace' });
  item('steel_furnace', 'Steel furnace', 'production', 'smelting', { place: 'steel_furnace' });
  item('electric_furnace', 'Arc furnace', 'production', 'smelting', { place: 'electric_furnace' });
  item('assembler_1', 'Assembler Mk1', 'production', 'assembly', { place: 'assembler_1' });
  item('assembler_2', 'Assembler Mk2', 'production', 'assembly', { place: 'assembler_2' });
  item('assembler_3', 'Assembler Mk3', 'production', 'assembly', { place: 'assembler_3' });
  item('refinery', 'Oil refinery', 'production', 'chemistry', { place: 'refinery' });
  item('chem_plant', 'Chemical plant', 'production', 'chemistry', { place: 'chem_plant' });
  item('lab', 'Research lab', 'production', 'research', { place: 'lab' });
  item('beacon', 'Beacon', 'production', 'research', { place: 'beacon' });
  item('uplink', 'Orbital Uplink', 'production', 'research', { stack: 1, place: 'uplink' });
  // Combat
  item('pistol', 'Sidearm', 'combat', 'gun', { stack: 1, gun: { rate: 15, range: 15 } });
  item('smg', 'Autorifle', 'combat', 'gun', { stack: 1, gun: { rate: 6, range: 18 } });
  item('ammo_basic', 'Standard magazine', 'combat', 'ammo', { stack: 200, ammo: { dmg: 5, rounds: 10 } });
  item('ammo_pierce', 'Piercing magazine', 'combat', 'ammo', { stack: 200, ammo: { dmg: 9, rounds: 10 } });
  item('grenade', 'Grenade', 'combat', 'ammo', { stack: 100 });
  item('repair_pack', 'Repair kit', 'combat', 'tool', { stack: 100, repair: 300 });
  item('gun_turret', 'Gun turret', 'combat', 'defense', { place: 'gun_turret' });
  item('laser_turret', 'Laser turret', 'combat', 'defense', { place: 'laser_turret' });
  item('stone_wall', 'Stone wall', 'combat', 'defense', { stack: 100, place: 'stone_wall' });

  // --------------------------------------------------------------- fluids
  const fluids = {
    water: { id: 'water', name: 'Water', color: '#3a8fd8' },
    steam: { id: 'steam', name: 'Steam', color: '#d8dde2' },
    crude_oil: { id: 'crude_oil', name: 'Crude oil', color: '#3a2c24' },
    heavy_oil: { id: 'heavy_oil', name: 'Heavy oil', color: '#b8641f' },
    light_oil: { id: 'light_oil', name: 'Light oil', color: '#e6b83a' },
    petroleum: { id: 'petroleum', name: 'Petroleum gas', color: '#9a6ab0' },
    lubricant: { id: 'lubricant', name: 'Lubricant', color: '#4c9c3f' },
    acid: { id: 'acid', name: 'Sulfuric acid', color: '#c9d63a' },
  };

  // -------------------------------------------------------------- recipes
  // cat: crafting (hand + assembler), advanced (assembler only), smelting,
  // chemistry, refining, uplink. fin/fout are fluid ingredients/results.
  const recipes = {};
  function recipe(id, time, ing, out, opts) {
    const r = Object.assign({ id, time, ing, out, cat: 'crafting', start: false }, opts || {});
    r.fin = r.fin || {};
    r.fout = r.fout || {};
    if (!r.name) {
      const first = Object.keys(out)[0] || Object.keys(r.fout)[0];
      r.name = (items[first] || fluids[first]).name;
    }
    r.main = Object.keys(out)[0] || Object.keys(r.fout)[0];
    recipes[id] = r;
  }
  const S = { start: true };
  const SM = { cat: 'smelting', start: true };
  const ADV = { cat: 'advanced' };
  const CHEM = { cat: 'chemistry' };

  recipe('iron_plate', 3.2, { iron_ore: 1 }, { iron_plate: 1 }, SM);
  recipe('copper_plate', 3.2, { copper_ore: 1 }, { copper_plate: 1 }, SM);
  recipe('stone_brick', 3.2, { stone: 2 }, { stone_brick: 1 }, SM);
  recipe('steel_plate', 16, { iron_plate: 5 }, { steel_plate: 1 }, { cat: 'smelting' });

  recipe('iron_gear', 0.5, { iron_plate: 2 }, { iron_gear: 1 }, S);
  recipe('copper_wire', 0.5, { copper_plate: 1 }, { copper_wire: 2 }, S);
  recipe('circuit', 0.5, { iron_plate: 1, copper_wire: 3 }, { circuit: 1 }, S);
  recipe('pipe', 0.5, { iron_plate: 1 }, { pipe: 1 }, S);
  recipe('pipe_ug', 0.5, { pipe: 10, iron_plate: 5 }, { pipe_ug: 2 }, S);
  recipe('engine_unit', 10, { steel_plate: 1, iron_gear: 1, pipe: 2 }, { engine_unit: 1 }, ADV);
  recipe('advanced_circuit', 6, { circuit: 2, plastic: 2, copper_wire: 4 }, { advanced_circuit: 1 });
  recipe('electric_motor', 10, { engine_unit: 1, circuit: 2 }, { electric_motor: 1 }, { cat: 'advanced', fin: { lubricant: 15 } });
  recipe('processing_unit', 10, { circuit: 20, advanced_circuit: 2 }, { processing_unit: 1 }, { cat: 'advanced', fin: { acid: 5 } });
  recipe('low_density', 20, { steel_plate: 2, copper_plate: 20, plastic: 5 }, { low_density: 1 }, ADV);
  recipe('guidance_unit', 30, { processing_unit: 1, speed_module: 1 }, { guidance_unit: 1 }, ADV);
  recipe('satellite', 5, { low_density: 50, solar_panel: 50, accumulator: 50, processing_unit: 50, rocket_fuel: 25 }, { satellite: 1 }, ADV);

  recipe('sci_1', 5, { copper_plate: 1, iron_gear: 1 }, { sci_1: 1 }, S);
  recipe('sci_2', 6, { inserter: 1, belt: 1 }, { sci_2: 1 });
  recipe('sci_mil', 10, { ammo_pierce: 1, grenade: 1, stone_wall: 2 }, { sci_mil: 2 });
  recipe('sci_3', 24, { engine_unit: 2, advanced_circuit: 3, sulfur: 1 }, { sci_3: 2 }, ADV);
  recipe('sci_4', 21, { electric_furnace: 1, productivity_module: 1, steel_plate: 10 }, { sci_4: 3 }, ADV);

  recipe('speed_module', 15, { advanced_circuit: 5, circuit: 5 }, { speed_module: 1 });
  recipe('efficiency_module', 15, { advanced_circuit: 5, circuit: 5 }, { efficiency_module: 1 });
  recipe('productivity_module', 15, { advanced_circuit: 5, circuit: 5 }, { productivity_module: 1 });

  recipe('wooden_chest', 0.5, { wood: 2 }, { wooden_chest: 1 }, S);
  recipe('iron_chest', 0.5, { iron_plate: 8 }, { iron_chest: 1 }, S);
  recipe('steel_chest', 0.5, { steel_plate: 8 }, { steel_chest: 1 });
  recipe('storage_tank', 3, { iron_plate: 20, steel_plate: 5 }, { storage_tank: 1 });
  recipe('belt', 0.5, { iron_plate: 1, iron_gear: 1 }, { belt: 2 }, S);
  recipe('fast_belt', 0.5, { iron_gear: 5, belt: 1 }, { fast_belt: 1 });
  recipe('express_belt', 0.5, { iron_gear: 5, fast_belt: 1, advanced_circuit: 1 }, { express_belt: 1 });
  recipe('underground_belt', 1, { iron_plate: 10, belt: 5 }, { underground_belt: 2 });
  recipe('fast_underground', 2, { iron_gear: 40, underground_belt: 2 }, { fast_underground: 2 });
  recipe('express_underground', 2, { advanced_circuit: 4, iron_gear: 40, fast_underground: 2 }, { express_underground: 2 });
  recipe('splitter', 1, { circuit: 5, iron_plate: 5, belt: 4 }, { splitter: 1 });
  recipe('fast_splitter', 2, { splitter: 1, iron_gear: 10, circuit: 10 }, { fast_splitter: 1 });
  recipe('express_splitter', 2, { fast_splitter: 1, iron_gear: 10, advanced_circuit: 10 }, { express_splitter: 1 });
  recipe('burner_inserter', 0.5, { iron_plate: 1, iron_gear: 1 }, { burner_inserter: 1 }, S);
  recipe('inserter', 0.5, { circuit: 1, iron_gear: 1, iron_plate: 1 }, { inserter: 1 }, S);
  recipe('long_inserter', 0.5, { inserter: 1, iron_gear: 1, iron_plate: 1 }, { long_inserter: 1 });
  recipe('fast_inserter', 0.5, { inserter: 1, circuit: 2, iron_plate: 2 }, { fast_inserter: 1 });
  recipe('filter_inserter', 0.5, { fast_inserter: 1, circuit: 4 }, { filter_inserter: 1 });
  recipe('small_pole', 0.5, { wood: 1, copper_wire: 2 }, { small_pole: 2 }, S);
  recipe('medium_pole', 0.5, { steel_plate: 2, copper_plate: 2, iron_plate: 2 }, { medium_pole: 1 });
  recipe('big_pole', 0.5, { steel_plate: 5, copper_plate: 5, iron_plate: 5 }, { big_pole: 1 });

  recipe('offshore_pump', 0.5, { circuit: 2, pipe: 1, iron_gear: 1 }, { offshore_pump: 1 }, S);
  recipe('boiler', 0.5, { stone_furnace: 1, pipe: 4 }, { boiler: 1 }, S);
  recipe('steam_engine', 0.5, { iron_gear: 8, pipe: 5, iron_plate: 10 }, { steam_engine: 1 }, S);
  recipe('solar_panel', 10, { steel_plate: 5, circuit: 15, copper_plate: 15 }, { solar_panel: 1 });
  recipe('accumulator', 10, { iron_plate: 2, battery: 5 }, { accumulator: 1 });
  recipe('burner_drill', 2, { iron_gear: 3, stone_furnace: 1, iron_plate: 3 }, { burner_drill: 1 }, S);
  recipe('electric_drill', 2, { circuit: 3, iron_gear: 5, iron_plate: 10 }, { electric_drill: 1 }, S);
  recipe('pumpjack', 5, { steel_plate: 5, iron_gear: 10, circuit: 5, pipe: 10 }, { pumpjack: 1 });
  recipe('stone_furnace', 0.5, { stone: 5 }, { stone_furnace: 1 }, S);
  recipe('steel_furnace', 3, { steel_plate: 6, stone_brick: 10 }, { steel_furnace: 1 });
  recipe('electric_furnace', 5, { steel_plate: 10, advanced_circuit: 5, stone_brick: 10 }, { electric_furnace: 1 });
  recipe('assembler_1', 0.5, { circuit: 3, iron_gear: 5, iron_plate: 9 }, { assembler_1: 1 });
  recipe('assembler_2', 0.5, { steel_plate: 2, circuit: 3, iron_gear: 5, assembler_1: 1 }, { assembler_2: 1 });
  recipe('assembler_3', 0.5, { speed_module: 4, assembler_2: 2 }, { assembler_3: 1 });
  recipe('refinery', 8, { steel_plate: 15, iron_gear: 10, stone_brick: 10, circuit: 10, pipe: 10 }, { refinery: 1 });
  recipe('chem_plant', 5, { steel_plate: 5, iron_gear: 5, circuit: 5, pipe: 5 }, { chem_plant: 1 });
  recipe('lab', 2, { circuit: 10, iron_gear: 10, belt: 4 }, { lab: 1 }, S);
  recipe('beacon', 15, { advanced_circuit: 20, circuit: 20, steel_plate: 10, copper_wire: 10 }, { beacon: 1 });
  recipe('uplink', 30, { steel_plate: 200, stone_brick: 200, processing_unit: 50, electric_motor: 50, pipe: 50 }, { uplink: 1 });

  recipe('pistol', 5, { copper_plate: 5, iron_plate: 5 }, { pistol: 1 }, S);
  recipe('smg', 10, { iron_gear: 10, copper_plate: 5, iron_plate: 10 }, { smg: 1 });
  recipe('ammo_basic', 1, { iron_plate: 4 }, { ammo_basic: 1 }, S);
  recipe('ammo_pierce', 3, { ammo_basic: 1, steel_plate: 1, copper_plate: 5 }, { ammo_pierce: 1 });
  recipe('grenade', 8, { coal: 10, iron_plate: 5 }, { grenade: 1 });
  recipe('repair_pack', 0.5, { circuit: 2, iron_gear: 2 }, { repair_pack: 1 }, S);
  recipe('gun_turret', 8, { iron_gear: 10, copper_plate: 10, iron_plate: 20 }, { gun_turret: 1 });
  recipe('laser_turret', 20, { steel_plate: 20, circuit: 20, battery: 12 }, { laser_turret: 1 });
  recipe('stone_wall', 0.5, { stone_brick: 5 }, { stone_wall: 1 });

  // Chemistry and refining (fluid recipes)
  recipe('basic_refining', 5, {}, {}, { cat: 'refining', name: 'Basic refining', fin: { crude_oil: 100 }, fout: { petroleum: 45 } });
  recipe('advanced_refining', 5, {}, {}, {
    cat: 'refining', name: 'Advanced refining',
    fin: { water: 50, crude_oil: 100 }, fout: { heavy_oil: 25, light_oil: 45, petroleum: 55 },
  });
  recipe('plastic', 1, { coal: 1 }, { plastic: 2 }, { cat: 'chemistry', fin: { petroleum: 20 } });
  recipe('sulfur', 1, {}, { sulfur: 2 }, { cat: 'chemistry', fin: { water: 30, petroleum: 30 } });
  recipe('acid', 1, { sulfur: 5, iron_plate: 1 }, {}, { cat: 'chemistry', fin: { water: 100 }, fout: { acid: 50 } });
  recipe('battery', 4, { iron_plate: 1, copper_plate: 1 }, { battery: 1 }, { cat: 'chemistry', fin: { acid: 20 } });
  recipe('lubricant', 1, {}, {}, { cat: 'chemistry', fin: { heavy_oil: 10 }, fout: { lubricant: 10 } });
  recipe('heavy_cracking', 2, {}, {}, { cat: 'chemistry', name: 'Heavy oil cracking', fin: { water: 30, heavy_oil: 40 }, fout: { light_oil: 30 } });
  recipe('light_cracking', 2, {}, {}, { cat: 'chemistry', name: 'Light oil cracking', fin: { water: 30, light_oil: 30 }, fout: { petroleum: 20 } });
  recipe('solid_fuel_light', 2, {}, { solid_fuel: 1 }, { cat: 'chemistry', name: 'Solid fuel (light oil)', fin: { light_oil: 10 } });
  recipe('solid_fuel_heavy', 2, {}, { solid_fuel: 1 }, { cat: 'chemistry', name: 'Solid fuel (heavy oil)', fin: { heavy_oil: 20 } });
  recipe('solid_fuel_pet', 2, {}, { solid_fuel: 1 }, { cat: 'chemistry', name: 'Solid fuel (petroleum)', fin: { petroleum: 20 } });
  recipe('rocket_fuel', 30, { solid_fuel: 10 }, { rocket_fuel: 1 }, { cat: 'chemistry', fin: { light_oil: 10 } });

  recipe('uplink_stage', 3, { low_density: 5, guidance_unit: 5, rocket_fuel: 5 }, {}, { cat: 'uplink', name: 'Uplink stage' });

  // Crafting categories each machine family can perform.
  const HAND_CATS = ['crafting'];

  // -------------------------------------------------------------- buildings
  // w/h are for the north orientation. fb = fluid boxes: conns are [x, y, dir]
  // meaning the tile (x,y) inside the footprint connects out in direction dir.
  const protos = {};
  function proto(id, kind, opts) {
    protos[id] = Object.assign({ id, kind, w: 1, h: 1, hp: 150, item: id, rotatable: false, solid: true }, opts || {});
  }
  const ALL4 = [[0, 0, 0], [0, 0, 1], [0, 0, 2], [0, 0, 3]];

  proto('wooden_chest', 'chest', { slots: 16, hp: 100 });
  proto('iron_chest', 'chest', { slots: 32, hp: 200 });
  proto('steel_chest', 'chest', { slots: 48, hp: 350 });
  proto('storage_tank', 'tank', {
    w: 3, h: 3, hp: 500, rotatable: true,
    fb: [{ cap: 25000, io: 'both', conns: [[1, 0, 0], [2, 1, 1], [1, 2, 2], [0, 1, 3]] }],
  });

  proto('belt', 'belt', { speed: 1.875, tier: 1, rotatable: true, solid: false });
  proto('fast_belt', 'belt', { speed: 3.75, tier: 2, rotatable: true, solid: false });
  proto('express_belt', 'belt', { speed: 5.625, tier: 3, rotatable: true, solid: false });
  proto('underground_belt', 'underground', { speed: 1.875, tier: 1, maxDist: 5, rotatable: true, solid: false });
  proto('fast_underground', 'underground', { speed: 3.75, tier: 2, maxDist: 7, rotatable: true, solid: false });
  proto('express_underground', 'underground', { speed: 5.625, tier: 3, maxDist: 9, rotatable: true, solid: false });
  proto('splitter', 'splitter', { w: 2, h: 1, speed: 1.875, tier: 1, rotatable: true, solid: false });
  proto('fast_splitter', 'splitter', { w: 2, h: 1, speed: 3.75, tier: 2, rotatable: true, solid: false });
  proto('express_splitter', 'splitter', { w: 2, h: 1, speed: 5.625, tier: 3, rotatable: true, solid: false });

  // swing = ticks for one half rotation. power in kW.
  proto('burner_inserter', 'inserter', { swing: 48, burner: true, power: 94, rotatable: true, reach: 1, tint: '#8a6a4a' });
  proto('inserter', 'inserter', { swing: 34, power: 13, drain: 0.4, rotatable: true, reach: 1, tint: '#d8b23a' });
  proto('long_inserter', 'inserter', { swing: 24, power: 20, drain: 0.4, rotatable: true, reach: 2, tint: '#c8453a' });
  proto('fast_inserter', 'inserter', { swing: 12, power: 46, drain: 0.5, rotatable: true, reach: 1, tint: '#3a8ad8' });
  proto('filter_inserter', 'inserter', { swing: 12, power: 53, drain: 0.5, rotatable: true, reach: 1, tint: '#9a4ac8', filter: true });

  proto('small_pole', 'pole', { reach: 7.5, supply: 2.5, hp: 100, solid: true });
  proto('medium_pole', 'pole', { reach: 9, supply: 3.5, hp: 100 });
  proto('big_pole', 'pole', { w: 2, h: 2, reach: 30, supply: 2, hp: 150 });

  proto('pipe', 'pipe', { hp: 100, fb: [{ cap: 100, io: 'both', conns: ALL4 }] });
  proto('pipe_ug', 'pipe_ug', { hp: 150, maxDist: 10, rotatable: true, fb: [{ cap: 100, io: 'both', conns: [[0, 0, 0]] }] });

  proto('offshore_pump', 'offshore', { rate: 1200, rotatable: true, hp: 150, fb: [{ cap: 100, io: 'out', filter: 'water', conns: [[0, 0, 0]] }] });
  proto('boiler', 'boiler', {
    w: 3, h: 2, hp: 200, burner: true, power: 1800, rotatable: true, pollution: 30,
    fb: [
      { cap: 200, io: 'in', filter: 'water', conns: [[0, 1, 3], [2, 1, 1]] },
      { cap: 200, io: 'out', filter: 'steam', conns: [[1, 0, 0]] },
    ],
  });
  proto('steam_engine', 'engine', {
    w: 3, h: 5, hp: 400, max: 900, rotatable: true,
    fb: [{ cap: 200, io: 'in', filter: 'steam', conns: [[1, 0, 0], [1, 4, 2]] }],
  });
  proto('solar_panel', 'solar', { w: 3, h: 3, hp: 200, peak: 60 });
  proto('accumulator', 'accumulator', { w: 2, h: 2, hp: 150, capacity: 5000, rate: 300 });

  proto('burner_drill', 'drill', { w: 2, h: 2, hp: 150, burner: true, power: 150, speed: 0.25, area: 2, rotatable: true, pollution: 12, out: [0, -1] });
  proto('electric_drill', 'drill', { w: 3, h: 3, hp: 300, power: 90, drain: 3, speed: 0.5, area: 5, modules: 3, rotatable: true, pollution: 10, out: [1, -1] });
  proto('pumpjack', 'pumpjack', {
    w: 3, h: 3, hp: 200, power: 90, drain: 3, rotatable: true, pollution: 10, modules: 2,
    fb: [{ cap: 100, io: 'out', filter: 'crude_oil', conns: [[1, 0, 0]] }],
  });

  proto('stone_furnace', 'furnace', { w: 2, h: 2, hp: 200, burner: true, power: 90, speed: 1, pollution: 2 });
  proto('steel_furnace', 'furnace', { w: 2, h: 2, hp: 300, burner: true, power: 90, speed: 2, pollution: 4 });
  proto('electric_furnace', 'furnace', { w: 3, h: 3, hp: 350, power: 180, drain: 6, speed: 2, modules: 2, pollution: 1 });

  const ASM_FB = [{ cap: 100, io: 'in', cond: true, conns: [[1, 0, 0]] }];
  proto('assembler_1', 'crafter', { w: 3, h: 3, hp: 300, power: 75, drain: 2.5, speed: 0.5, cats: ['crafting', 'advanced'], pollution: 4 });
  proto('assembler_2', 'crafter', { w: 3, h: 3, hp: 350, power: 150, drain: 5, speed: 0.75, modules: 2, cats: ['crafting', 'advanced'], pollution: 3, rotatable: true, fb: ASM_FB });
  proto('assembler_3', 'crafter', { w: 3, h: 3, hp: 400, power: 375, drain: 12.5, speed: 1.25, modules: 4, cats: ['crafting', 'advanced'], pollution: 2, rotatable: true, fb: ASM_FB });
  proto('chem_plant', 'crafter', {
    w: 3, h: 3, hp: 300, power: 210, drain: 7, speed: 1, modules: 3, cats: ['chemistry'], pollution: 4, rotatable: true,
    fb: [
      { cap: 100, io: 'in', conns: [[0, 2, 2]] },
      { cap: 100, io: 'in', conns: [[2, 2, 2]] },
      { cap: 100, io: 'out', conns: [[0, 0, 0]] },
      { cap: 100, io: 'out', conns: [[2, 0, 0]] },
    ],
  });
  proto('refinery', 'crafter', {
    w: 5, h: 5, hp: 350, power: 420, drain: 14, speed: 1, modules: 3, cats: ['refining'], pollution: 6, rotatable: true,
    fb: [
      { cap: 1000, io: 'in', prefer: 'water', conns: [[1, 4, 2]] },
      { cap: 1000, io: 'in', prefer: 'crude_oil', conns: [[3, 4, 2]] },
      { cap: 1000, io: 'out', prefer: 'heavy_oil', conns: [[0, 0, 0]] },
      { cap: 1000, io: 'out', prefer: 'light_oil', conns: [[2, 0, 0]] },
      { cap: 1000, io: 'out', prefer: 'petroleum', conns: [[4, 0, 0]] },
    ],
  });
  proto('lab', 'lab', { w: 3, h: 3, hp: 150, power: 60, drain: 2, speed: 1, modules: 2 });
  proto('beacon', 'beacon', { w: 3, h: 3, hp: 200, power: 480, modules: 2, range: 3, efficiency: 0.5 });
  proto('uplink', 'uplink', { w: 7, h: 7, hp: 2000, power: 250, drain: 10, speed: 1, stages: 40, cats: ['uplink'] });

  proto('gun_turret', 'turret', { w: 2, h: 2, hp: 400, range: 18, cooldown: 6 });
  proto('laser_turret', 'laser', { w: 2, h: 2, hp: 1000, range: 24, cooldown: 40, dmg: 20, shot: 800, power: 2400, drain: 24 });
  proto('stone_wall', 'wall', { hp: 350 });

  // Energy per fluid unit of steam (kJ): engine 900 kW at 30 steam/s.
  const STEAM_KJ = 30;

  // ------------------------------------------------------------- research
  const techs = {};
  let torder = 0;
  function tech(id, name, cost, units, time, prereq, unlocks, opts) {
    techs[id] = Object.assign({ id, name, cost, units, time, prereq, unlocks, effects: [], order: torder++ }, opts || {});
  }
  const R = { sci_1: 1 };
  const RG = { sci_1: 1, sci_2: 1 };
  const RGM = { sci_1: 1, sci_2: 1, sci_mil: 1 };
  const RGB = { sci_1: 1, sci_2: 1, sci_3: 1 };
  const RGBM = { sci_1: 1, sci_2: 1, sci_3: 1, sci_mil: 1 };
  const RGBP = { sci_1: 1, sci_2: 1, sci_3: 1, sci_4: 1 };

  tech('automation', 'Automation', R, 10, 10, [], ['assembler_1', 'long_inserter']);
  tech('logistics', 'Logistics', R, 30, 15, [], ['underground_belt', 'splitter']);
  tech('turrets', 'Turrets', R, 10, 10, [], ['gun_turret']);
  tech('military', 'Military', R, 10, 15, [], ['smg']);
  tech('walls', 'Stone walls', R, 10, 10, [], ['stone_wall']);
  tech('bullet_dmg_1', 'Bullet damage 1', R, 20, 15, ['military'], [], { effects: [{ type: 'bullet_dmg', v: 0.1 }], icon: 'ammo_basic' });
  tech('steel', 'Steel processing', R, 50, 5, [], ['steel_plate', 'steel_chest']);
  tech('fast_inserter', 'Fast arms', R, 30, 15, ['automation'], ['fast_inserter']);
  tech('logistic_science', 'Logistics pack', R, 75, 5, ['automation'], ['sci_2']);
  tech('drones', 'Construction drones', RG, 50, 15, ['logistic_science', 'automation'], [], {
    effects: [{ type: 'drones', v: 1 }], icon: 'repair_pack', desc: 'Personal drones build ghost blueprints and deconstruct marked buildings near you.',
  });
  tech('toolbelt', 'Toolbelt', RG, 30, 15, ['logistic_science'], [], { effects: [{ type: 'inv', v: 20 }], icon: 'wooden_chest' });
  tech('filter_inserter', 'Sorting arms', RG, 40, 15, ['fast_inserter', 'logistic_science'], ['filter_inserter']);
  tech('automation_2', 'Automation 2', RG, 40, 15, ['logistic_science', 'steel'], ['assembler_2']);
  tech('logistics_2', 'Logistics 2', RG, 200, 15, ['logistics', 'logistic_science'], ['fast_belt', 'fast_underground', 'fast_splitter']);
  tech('adv_material', 'Advanced smelting', RG, 75, 15, ['steel', 'logistic_science'], ['steel_furnace']);
  tech('power_distribution', 'Power distribution', RG, 120, 15, ['steel', 'logistic_science'], ['medium_pole', 'big_pole']);
  tech('solar', 'Solar energy', RG, 100, 15, ['steel', 'logistic_science'], ['solar_panel']);
  tech('fluid_handling', 'Fluid handling', RG, 50, 15, ['logistic_science', 'steel'], ['storage_tank']);
  tech('oil_processing', 'Oil processing', RG, 100, 15, ['fluid_handling'], ['pumpjack', 'refinery', 'chem_plant', 'basic_refining', 'solid_fuel_pet']);
  tech('plastics', 'Plastics', RG, 200, 15, ['oil_processing'], ['plastic']);
  tech('sulfur', 'Sulfur processing', RG, 150, 15, ['oil_processing'], ['sulfur', 'acid']);
  tech('advanced_electronics', 'Logic boards', RG, 200, 15, ['plastics'], ['advanced_circuit']);
  tech('engine', 'Engines', RG, 100, 15, ['steel', 'logistic_science'], ['engine_unit']);
  tech('chemical_science', 'Chemistry pack', RG, 75, 15, ['advanced_electronics', 'sulfur', 'engine'], ['sci_3']);
  tech('military_2', 'Military 2', RG, 20, 15, ['military', 'steel', 'logistic_science'], ['ammo_pierce', 'grenade']);
  tech('military_science', 'Defense pack', RG, 30, 15, ['military_2', 'walls'], ['sci_mil']);
  tech('bullet_dmg_2', 'Bullet damage 2', RG, 50, 20, ['bullet_dmg_1', 'logistic_science'], [], { effects: [{ type: 'bullet_dmg', v: 0.1 }], icon: 'ammo_basic' });
  tech('bullet_dmg_3', 'Bullet damage 3', RGM, 100, 30, ['bullet_dmg_2', 'military_science'], [], { effects: [{ type: 'bullet_dmg', v: 0.2 }], icon: 'ammo_pierce' });
  tech('fire_rate_1', 'Weapon cadence 1', RGM, 100, 30, ['military_science'], [], { effects: [{ type: 'fire_rate', v: 0.2 }], icon: 'gun_turret' });
  tech('inserter_cap_1', 'Arm capacity 1', RG, 150, 20, ['fast_inserter', 'logistic_science'], [], { effects: [{ type: 'hand', v: 1 }], icon: 'fast_inserter' });
  tech('research_speed_1', 'Research speed 1', RG, 100, 20, ['logistic_science'], [], { effects: [{ type: 'lab_speed', v: 0.2 }], icon: 'lab' });
  tech('mining_prod_1', 'Mining productivity 1', RG, 250, 30, ['logistic_science'], [], { effects: [{ type: 'mining_prod', v: 0.1 }], icon: 'electric_drill' });
  tech('battery', 'Batteries', RGB, 150, 30, ['sulfur', 'chemical_science'], ['battery']);
  tech('accumulators', 'Energy storage', RGB, 150, 30, ['battery', 'power_distribution'], ['accumulator']);
  tech('laser_turrets', 'Laser turrets', RGBM, 150, 30, ['turrets', 'battery', 'military_science'], ['laser_turret']);
  tech('laser_dmg_1', 'Laser power 1', RGBM, 150, 30, ['laser_turrets'], [], { effects: [{ type: 'laser_dmg', v: 0.3 }], icon: 'laser_turret' });
  tech('advanced_oil', 'Advanced oil processing', RGB, 75, 30, ['chemical_science'], [
    'advanced_refining', 'heavy_cracking', 'light_cracking', 'solid_fuel_heavy', 'solid_fuel_light',
  ]);
  tech('lubricant', 'Lubricant', RGB, 50, 30, ['advanced_oil'], ['lubricant']);
  tech('electric_motor', 'Electric motors', RGB, 50, 30, ['lubricant', 'automation_2'], ['electric_motor']);
  tech('adv_material_2', 'Arc smelting', RGB, 250, 30, ['adv_material', 'chemical_science'], ['electric_furnace']);
  tech('modules', 'Modules', RGB, 100, 30, ['advanced_electronics', 'chemical_science'], ['speed_module', 'efficiency_module', 'productivity_module']);
  tech('beacons', 'Beacons', RGB, 150, 30, ['modules'], ['beacon']);
  tech('logistics_3', 'Logistics 3', RGB, 300, 30, ['logistics_2', 'chemical_science'], ['express_belt', 'express_underground', 'express_splitter']);
  tech('processing_unit', 'Processor cores', RGB, 300, 30, ['advanced_electronics', 'sulfur', 'chemical_science'], ['processing_unit']);
  tech('inserter_cap_2', 'Arm capacity 2', RGB, 250, 30, ['inserter_cap_1', 'chemical_science'], [], { effects: [{ type: 'hand', v: 1 }], icon: 'filter_inserter' });
  tech('research_speed_2', 'Research speed 2', RGB, 200, 30, ['research_speed_1', 'chemical_science'], [], { effects: [{ type: 'lab_speed', v: 0.3 }], icon: 'lab' });
  tech('mining_prod_2', 'Mining productivity 2', RGB, 500, 30, ['mining_prod_1', 'chemical_science'], [], { effects: [{ type: 'mining_prod', v: 0.1 }], icon: 'electric_drill' });
  tech('production_science', 'Industry pack', RGB, 100, 30, ['adv_material_2', 'modules'], ['sci_4']);
  tech('automation_3', 'Automation 3', RGBP, 150, 45, ['automation_2', 'production_science'], ['assembler_3']);
  tech('low_density', 'Composite frames', RGBP, 300, 45, ['production_science', 'plastics'], ['low_density']);
  tech('rocket_fuel', 'Rocket fuel', RGBP, 300, 45, ['production_science', 'advanced_oil'], ['rocket_fuel']);
  tech('guidance', 'Guidance computers', RGBP, 300, 45, ['production_science', 'processing_unit'], ['guidance_unit']);
  tech('mining_prod_3', 'Mining productivity 3', RGBP, 1000, 45, ['mining_prod_2', 'production_science'], [], { effects: [{ type: 'mining_prod', v: 0.1 }], icon: 'electric_drill' });
  tech('orbital_uplink', 'Orbital Uplink', RGBP, 1000, 60, ['low_density', 'rocket_fuel', 'guidance', 'electric_motor', 'solar', 'accumulators'], ['uplink', 'uplink_stage', 'satellite']);

  // --------------------------------------------------------------- enemies
  const enemies = {
    crawler: { id: 'crawler', name: 'Crawler', hp: 15, dmg: 7, speed: 0.085, cooldown: 35, range: 0.9, flat: 0, pct: 0, cost: 4, color: '#c9a255', size: 0.35 },
    brute: { id: 'brute', name: 'Brute', hp: 75, dmg: 15, speed: 0.078, cooldown: 35, range: 1.0, flat: 4, pct: 0.1, cost: 20, color: '#c8603a', size: 0.5 },
    titan: { id: 'titan', name: 'Titan', hp: 375, dmg: 45, speed: 0.07, cooldown: 40, range: 1.2, flat: 8, pct: 0.1, cost: 80, color: '#5a7ac8', size: 0.7 },
    colossus: { id: 'colossus', name: 'Colossus', hp: 3000, dmg: 90, speed: 0.065, cooldown: 45, range: 1.5, flat: 10, pct: 0.2, cost: 400, color: '#3aa85a', size: 1.0 },
  };
  const NEST_HP = 350;

  FG.data = { items, fluids, recipes, protos, techs, enemies, HAND_CATS, STEAM_KJ, NEST_HP };

  // Build lookup tables.
  FG.data.smeltingByInput = {};
  for (const id in recipes) {
    const r = recipes[id];
    if (r.cat === 'smelting') FG.data.smeltingByInput[Object.keys(r.ing)[0]] = r;
  }
  // Which tech unlocks a recipe (for tooltips).
  FG.data.recipeTech = {};
  for (const id in techs) for (const r of techs[id].unlocks) FG.data.recipeTech[r] = id;
  // Recipes that produce each item (first one wins for the crafting menu).
  FG.data.recipeFor = {};
  for (const id in recipes) {
    const r = recipes[id];
    for (const o in r.out) if (!FG.data.recipeFor[o]) FG.data.recipeFor[o] = r;
  }
  for (const id in techs) {
    const t = techs[id];
    if (!t.icon) {
      const r = recipes[t.unlocks[0]];
      t.icon = r ? r.main : 'sci_1';
    }
  }
  // Sanity checks catch typos during development.
  for (const id in recipes) {
    const r = recipes[id];
    for (const k of Object.keys(r.ing).concat(Object.keys(r.out))) if (!items[k]) throw new Error('recipe ' + id + ' unknown item ' + k);
    for (const k of Object.keys(r.fin).concat(Object.keys(r.fout))) if (!fluids[k]) throw new Error('recipe ' + id + ' unknown fluid ' + k);
  }
  for (const id in techs) {
    for (const p of techs[id].prereq) if (!techs[p]) throw new Error('tech ' + id + ' unknown prereq ' + p);
    for (const u of techs[id].unlocks) if (!recipes[u]) throw new Error('tech ' + id + ' unknown recipe ' + u);
  }
  for (const id in items) if (items[id].place && !protos[items[id].place]) throw new Error('item ' + id + ' unknown place ' + items[id].place);
})();
