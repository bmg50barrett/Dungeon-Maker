/*
 * Seedable random number generator.
 *
 * Every random decision in the generator goes through this class so that a
 * dungeon can be reproduced exactly from its seed.
 */
(function () {
  const DM = (globalThis.DM = globalThis.DM || {});

  /** Hash an arbitrary string/number into a 32-bit unsigned integer (xmur3). */
  function hashSeed(seed) {
    const str = String(seed);
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }

  class Rng {
    constructor(seed) {
      this.state = hashSeed(seed);
      this._spare = null; // cached second value from the Box-Muller transform
    }

    /** Uniform float in [0, 1) (mulberry32). */
    next() {
      let t = (this.state = (this.state + 0x6d2b79f5) | 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /** Uniform float in [lo, hi). */
    range(lo, hi) {
      return lo + (hi - lo) * this.next();
    }

    /** Uniform integer in [lo, hi] (inclusive). */
    int(lo, hi) {
      return lo + Math.floor(this.next() * (hi - lo + 1));
    }

    /** True with probability p. */
    chance(p) {
      return this.next() < p;
    }

    pick(arr) {
      return arr[Math.floor(this.next() * arr.length)];
    }

    /** Index chosen with probability proportional to weights[i]. */
    weightedIndex(weights) {
      let total = 0;
      for (let i = 0; i < weights.length; i++) total += weights[i];
      let r = this.next() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r < 0) return i;
      }
      return weights.length - 1;
    }

    /** Normally distributed float (Box-Muller). */
    normal(mean = 0, stdDev = 1) {
      let z;
      if (this._spare !== null) {
        z = this._spare;
        this._spare = null;
      } else {
        let u = 0;
        while (u === 0) u = this.next();
        const v = this.next();
        const mag = Math.sqrt(-2 * Math.log(u));
        z = mag * Math.cos(2 * Math.PI * v);
        this._spare = mag * Math.sin(2 * Math.PI * v);
      }
      return mean + z * stdDev;
    }

    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(this.next() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
      return arr;
    }
  }

  DM.Rng = Rng;
  DM.hashSeed = hashSeed;
})();
