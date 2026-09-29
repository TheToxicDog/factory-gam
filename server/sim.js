// Loads the game's simulation scripts (the same files the browser runs) into an isolated
// VM context. Each multiplayer lobby gets its own copy, so worlds never share state.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SIM_FILES = ['core', 'data', 'world', 'entities', 'belts', 'fluids', 'power', 'machines', 'combat', 'objectives', 'rails', 'trains', 'sim', 'commands', 'save'];
const JS_DIR = path.join(__dirname, '..', 'js');

let scripts = null;
function compile() {
  scripts = SIM_FILES.map((f) => {
    const file = path.join(JS_DIR, f + '.js');
    return new vm.Script(fs.readFileSync(file, 'utf8'), { filename: f + '.js' });
  });
}

// A fresh FG namespace with the simulation loaded.
function loadFG() {
  if (!scripts) compile();
  const ctx = { console, Buffer };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const s of scripts) s.runInContext(ctx);
  return ctx.FG;
}

module.exports = { loadFG };
