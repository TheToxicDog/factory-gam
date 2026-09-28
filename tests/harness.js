// Loads the simulation scripts into a Node VM context (no DOM) for tests.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SIM_FILES = ['core', 'data', 'world', 'entities', 'belts', 'fluids', 'power', 'machines', 'combat', 'objectives', 'rails', 'trains', 'sim', 'save', 'demo'];

function load() {
  const ctx = { Buffer, console, Math, Date, JSON, Object, Array, Map, Set, Float32Array, Int32Array, Uint8Array, Uint32Array, Uint16Array, Number, String, Error, performance };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of SIM_FILES) {
    const p = path.join(__dirname, '..', 'js', f + '.js');
    if (!fs.existsSync(p)) continue;
    vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f + '.js' });
  }
  return ctx.FG;
}

module.exports = { load };
