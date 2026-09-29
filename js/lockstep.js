// Cogworks Frontier — the client side of multiplayer lockstep. The server sends frames:
// [tick, [[playerId, command, seq], ...], checksum?, flags?] plus `u`, the tick it has
// reached. This runs the local copy of the world up to `u`, applying each frame's commands
// at its tick, checking checksums, and rebuilding the world from its save when a frame
// says so (that keeps everyone identical when someone joins). No browser APIs here, so
// the tests drive it in Node.
(function () {
  'use strict';

  class Lockstep {
    // hooks: onReplace(g) when the world object is swapped, onDesync(tick) on a checksum
    // mismatch, onResult(seq, result) when one of our own commands runs.
    constructor(hooks) {
      this.hooks = hooks || {};
      this.g = null;
      this.pid = 0;
      this.frames = new Map();
      this.u = -1;       // server tick: we may simulate every tick below it
      this.skip = -1;    // the snapshot's tick: its frame is already applied
      this.stalled = false;
    }
    // Load the world from a snapshot taken at `tick` (after that tick's commands).
    load(json, tick, pid) {
      const g = FG.save.deserialize(json);
      this.pid = pid;
      this.adopt(g);
      for (const t of Array.from(this.frames.keys())) if (t <= tick) this.frames.delete(t);
      this.skip = tick;
      this.u = Math.max(this.u, tick);
      this.stalled = false;
      if (this.hooks.onReplace) this.hooks.onReplace(g);
      return g;
    }
    adopt(g) {
      g.localPid = this.pid;
      g.player = g.players.get(this.pid) || g.player;
      g.input = g.inputs.get(this.pid) || g.input;
      this.g = g;
    }
    addFrames(list, u) {
      for (const f of list) if (f[0] > this.skip) this.frames.set(f[0], f);
      if (u > this.u) this.u = u;
    }
    get lag() { return this.g ? this.u - this.g.tick : 0; }
    // Simulate up to n ticks. Returns how many ran.
    advance(n) {
      let done = 0;
      while (done < n && this.g && !this.stalled && this.g.tick < this.u) {
        let g = this.g;
        const T = g.tick;
        const f = this.frames.get(T);
        if (f) {
          this.frames.delete(T);
          if (f[2] !== undefined && f[2] !== null) {
            const h = FG.stateHash(g);
            if (h !== f[2]) {
              this.stalled = true;
              if (this.hooks.onDesync) this.hooks.onDesync(T, h, f[2]);
              return done;
            }
          }
          for (const [pid, c, q] of f[1]) {
            const r = FG.cmd.exec(g, pid, c);
            if (pid === this.pid && q && this.hooks.onResult) this.hooks.onResult(q, r);
          }
          if (f[3] & 1) {
            g = FG.save.deserialize(FG.save.serialize(g));
            this.adopt(g);
            if (this.hooks.onReplace) this.hooks.onReplace(g);
          }
        }
        g.step();
        done++;
      }
      return done;
    }
  }
  FG.Lockstep = Lockstep;
})();
