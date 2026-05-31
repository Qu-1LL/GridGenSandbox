export class XorShift32 {
  constructor(seed) {
    this.state = 0;
    this.seed(seed);
  }

  seed(seed) {
    const fallbackSeed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    const nextSeed = normalizeSeed(seed, fallbackSeed);

    // Xorshift32 gets stuck at zero, so we remap that one invalid state.
    this.state = nextSeed === 0 ? 0x6d2b79f5 : nextSeed;
    return this.state;
  }

  next(modulo) {
    let value = this.state;

    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;

    this.state = value >>> 0;

    if (modulo === undefined) {
      return this.state;
    }

    if (!Number.isInteger(modulo) || modulo <= 0) {
      throw new Error("XorShift32.next(modulo) requires a positive integer modulo.");
    }

    return this.state % modulo;
  }

  nextFloat() {
    // Returns a float in [0, 1), with 1 excluded.
    return this.next() / 0x100000000;
  }

  nextFloatTo(maxExclusive) {
    if (!Number.isFinite(maxExclusive) || maxExclusive < 0) {
      throw new Error(
        "XorShift32.nextFloatTo(maxExclusive) requires a finite non-negative upper bound."
      );
    }

    return this.nextFloat() * maxExclusive;
  }

  nextSignedFloat() {
    // Returns a float in (-1, 1), with both ends excluded.
    return ((this.next() + 0.5) / 0x100000000) * 2 - 1;
  }
}

function normalizeSeed(seed, fallbackSeed) {
  if (seed === undefined || seed === null || seed === "") {
    return fallbackSeed >>> 0;
  }

  if (typeof seed === "number") {
    if (!Number.isFinite(seed)) {
      return fallbackSeed >>> 0;
    }

    return Math.trunc(seed) >>> 0;
  }

  if (typeof seed === "bigint") {
    return Number(seed & 0xffffffffn) >>> 0;
  }

  if (typeof seed === "boolean") {
    return seed ? 1 : 2;
  }

  const seedText =
    typeof seed === "string"
      ? seed
      : safeStringifySeed(seed);

  let hash = 0x811c9dc5;

  for (let index = 0; index < seedText.length; index += 1) {
    hash ^= seedText.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash >>> 0;
}

function safeStringifySeed(seed) {
  try {
    const jsonValue = JSON.stringify(seed);
    return jsonValue ?? String(seed);
  } catch {
    return String(seed);
  }
}

export class Tile {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.value = 0;
    this.neighbors = {
      up: null,
      right: null,
      down: null,
      left: null
    };
  }
}

export class Graph {
  constructor(size = 100) {
    this.size = size;
    this.tiles = Array.from({ length: size }, (_, y) =>
      Array.from({ length: size }, (_, x) => new Tile(x, y))
    );

    this.linkNeighbors();
  }

  getTile(x, y) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) {
      return null;
    }

    return this.tiles[y][x];
  }

  forEachTile(callback) {
    for (const row of this.tiles) {
      for (const tile of row) {
        callback(tile);
      }
    }
  }

  linkNeighbors() {
    this.forEachTile((tile) => {
      tile.neighbors.up = this.getTile(tile.x, tile.y - 1);
      tile.neighbors.right = this.getTile(tile.x + 1, tile.y);
      tile.neighbors.down = this.getTile(tile.x, tile.y + 1);
      tile.neighbors.left = this.getTile(tile.x - 1, tile.y);
    });
  }
}

export function normalizeConcentrationField(concentrationField) {
  const normalizedGraph = new Graph(concentrationField.size);
  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;

  concentrationField.forEachTile((tile) => {
    const value = Number.isFinite(tile.value) ? tile.value : 0;

    minValue = Math.min(minValue, value);
    maxValue = Math.max(maxValue, value);
  });

  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    return normalizedGraph;
  }

  const range = maxValue - minValue;

  concentrationField.forEachTile((tile) => {
    const normalizedTile = normalizedGraph.getTile(tile.x, tile.y);
    const value = Number.isFinite(tile.value) ? tile.value : 0;

    if (range <= 0) {
      normalizedTile.value = 0;
      return;
    }

    normalizedTile.value = ((value - minValue) / range) * 0.9999999;
  });

  return normalizedGraph;
}

export function checkeredPattern(graph) {
  graph.forEachTile((tile) => {
    if (tile.x === 0 && tile.y === 0) {
      tile.value = 1;
      return;
    }

    if (tile.neighbors.left) {
      tile.value = tile.neighbors.left.value === 1 ? 0 : 1;
      return;
    }

    if (tile.neighbors.up) {
      tile.value = tile.neighbors.up.value === 1 ? 0 : 1;
    }
  });

  return graph;
}

export function createCheckeredGraph(size = 100) {
  const graph = new Graph(size);
  return checkeredPattern(graph);
}
