import {
  Graph,
  normalizeConcentrationField,
  zeroOutFloatingTileValues,
  XorShift32
} from "./graphHandler.js";

export const GeneratorValueType = Object.freeze({
  SEED: "seed",
  UNIT_INTERVAL: "unitInterval",
  INTEGER: "integer",
  NUMBER: "number"
});

function getExclusiveUpperBound(valueType, upper, lower) {
  if (!Number.isFinite(upper)) {
    return upper;
  }

  if (valueType === GeneratorValueType.INTEGER) {
    return Math.max(lower, Math.ceil(upper) - 1);
  }

  const epsilon = Math.max(Math.abs(upper) * 1e-6, 1e-6);
  return Math.max(lower, upper - epsilon);
}

export function normalizeNumericValue(valueType, value, lower, upper, fallback) {
  const parsed =
    valueType === GeneratorValueType.INTEGER
      ? Number.parseInt(value, 10)
      : Number.parseFloat(value);

  if (Number.isNaN(parsed)) {
    return fallback;
  }

  const exclusiveUpper = getExclusiveUpperBound(valueType, upper, lower);
  const clamped = Math.min(exclusiveUpper, Math.max(lower, parsed));

  return valueType === GeneratorValueType.INTEGER ? Math.trunc(clamped) : clamped;
}

function getParameterScopeKey(implementedType) {
  if (!implementedType) {
    return "default";
  }

  if (typeof implementedType === "string") {
    return implementedType;
  }

  return implementedType.name ?? "default";
}

// Interface-like contract for generators that create concentration fields.
export class ConcentrationFieldGenerator {
  generateConcentrationField(size, seed) {
    throw new Error("ConcentrationFieldGenerator.generateConcentrationField must be implemented.");
  }
}

// Interface-like contract for interpolaters that derive concentration fields.
export class ConcentrationFieldInterpolater {
  interpolateConcentrationField(concentrationField, seed) {
    throw new Error(
      "ConcentrationFieldInterpolater.interpolateConcentrationField must be implemented."
    );
  }
}

// Interface-like contract for generators that create full maps.
export class MapGenerator {
  generateMap(size, seed) {
    throw new Error("MapGenerator.generateMap must be implemented.");
  }
}

// Interface-like contract for interpolaters that derive full maps.
export class MapInterpolater {
  interpolateMap(map, seed) {
    throw new Error("MapInterpolater.interpolateMap must be implemented.");
  }
}

export class SelectableGenerator {
  constructor(key, label, parameters = {}, implementedTypes = []) {
    if (new.target === SelectableGenerator) {
      throw new Error("SelectableGenerator is abstract and cannot be instantiated directly.");
    }

    this.key = key;
    this.label = label;
    this.parameters = { ...parameters };
    this.parameterScopes = new Map();
    this.implementedTypes = [...implementedTypes];
  }

  getKey() {
    return this.key;
  }

  getLabel() {
    return this.label;
  }

  getImplementedTypes() {
    return [...this.implementedTypes];
  }

  getSharedParameterDefinitions(implementedType = null) {
    void implementedType;
    return [];
  }

  getOwnParameterDefinitions(implementedType = null) {
    void implementedType;
    return [];
  }

  getParameterDefinitions(implementedType = null) {
    return [
      ...this.getSharedParameterDefinitions(implementedType),
      ...this.getOwnParameterDefinitions(implementedType)
    ];
  }

  getParameterScope(implementedType = null) {
    const scopeKey = getParameterScopeKey(implementedType);

    if (!this.parameterScopes.has(scopeKey)) {
      this.parameterScopes.set(scopeKey, { ...this.parameters });
    }

    return this.parameterScopes.get(scopeKey);
  }

  getParameters(implementedType = null) {
    return this.getParameterDefinitions(implementedType).map((definition) => ({
      ...definition,
      value: this.getParameterValue(definition.name, implementedType)
    }));
  }

  getParameterValue(name, implementedType = null) {
    return this.getParameterScope(implementedType)[name];
  }

  setParameterValue(name, value, size, implementedType = null) {
    const definition = this.getParameterDefinitions(implementedType).find(
      (parameterDefinition) => parameterDefinition.name === name
    );

    if (!definition) {
      throw new Error(`Unknown generator parameter: ${name}`);
    }

    if (definition.valueType === GeneratorValueType.SEED) {
      const scope = this.getParameterScope(implementedType);
      scope[name] = value;
      return scope[name];
    }

    const { lower, upper } = definition.getLimits(size);
    const fallback = this.getParameterValue(name, implementedType);
    const scope = this.getParameterScope(implementedType);

    scope[name] = normalizeNumericValue(
      definition.valueType,
      value,
      lower,
      upper,
      fallback
    );

    return scope[name];
  }

  setParameterValues(values, size, implementedType = null) {
    for (const definition of this.getParameterDefinitions(implementedType)) {
      if (!(definition.name in values)) {
        continue;
      }

      this.setParameterValue(
        definition.name,
        values[definition.name],
        size,
        implementedType
      );
    }
  }
}

export class RandomMapGenerator extends SelectableGenerator {
  constructor() {
    super("random", "Random", {
      density: 0.5
    }, [MapGenerator, ConcentrationFieldInterpolater]);
  }

  getOwnParameterDefinitions(implementedType = null) {
    if (implementedType === ConcentrationFieldInterpolater) {
      return [];
    }

    return [
      {
        name: "density",
        label: "Density",
        valueType: GeneratorValueType.UNIT_INTERVAL,
        getLimits: () => ({
          lower: 0,
          upper: 1
        })
      }
    ];
  }

  generateMap(
    size,
    seed,
    density = this.getParameterValue("density", MapGenerator)
  ) {
    const graph = new Graph(size);
    const random = new XorShift32(seed);

    graph.forEachTile((tile) => {
      tile.value = random.next() / 0x100000000 < density ? 1 : 0;
    });

    return graph;
  }

  interpolateConcentrationField(concentrationField, seed) {
    const graph = concentrationField;
    const random = new XorShift32(seed);

    graph.forEachTile((tile) => {
      tile.value = random.nextFloat() > tile.value ? 0 : 1
    })

    return graph
  }
}

export class CellularAutomata extends SelectableGenerator {
  constructor() {
    super(
      "cellular-automata",
      "Cellular Automata",
      {
        density: 0.7,
        iterations: 5,
        threshold: 3
      },
      [MapGenerator, MapInterpolater]
    );
  }

  getOwnParameterDefinitions(implementedType = null) {
    const sharedDefinitions = [
      {
        name: "iterations",
        label: "Iterations",
        valueType: GeneratorValueType.INTEGER,
        getLimits: () => ({
          lower: 1,
          upper: 21
        })
      },
      {
        name: "threshold",
        label: "Threshold",
        valueType: GeneratorValueType.INTEGER,
        getLimits: () => ({
          lower: 0,
          upper: 5
        })
      }
    ];

    if (implementedType === MapInterpolater) {
      return sharedDefinitions;
    }

    return [
      {
        name: "density",
        label: "Density",
        valueType: GeneratorValueType.UNIT_INTERVAL,
        getLimits: () => ({
          lower: 0,
          upper: 1
        })
      },
      ...sharedDefinitions
    ];
  }

  generateMap(
    size,
    seed,
    density = this.getParameterValue("density", MapGenerator),
    threshold = this.getParameterValue("threshold", MapGenerator),
    iterations = this.getParameterValue("iterations", MapGenerator)
  ) {
    let graph = new RandomMapGenerator().generateMap(size, seed, density);

    return this.interpolateMap(graph, seed, iterations, threshold)
  }

  interpolateMap(
    graph,
    seed,
    iterations = this.getParameterValue("iterations", MapInterpolater),
    threshold = this.getParameterValue("threshold", MapInterpolater)
  ) {
    for (let i = 0; i < iterations; i++) {
      const nextStep = new Graph(graph.size);
      graph.forEachTile((tile) => {
        let floorCount = 0
        for (let neighbor of Object.values(tile.neighbors)) {
          if (!neighbor) {
            continue;
          }

          floorCount += neighbor.value;
        }

        if (floorCount >= threshold) {
          nextStep.getTile(tile.x, tile.y).value = 1
        } else {
          nextStep.getTile(tile.x, tile.y).value = 0
        }
      })
      graph = nextStep
    }

    return graph
  }
}

function countNeighborsWithValue(tile, value) {
  let count = 0;

  for (const neighbor of Object.values(tile.neighbors)) {
    if (!neighbor || neighbor.value !== value) {
      continue;
    }

    count += 1;
  }

  return count;
}

function createCellularPhaseParameterDefinitions(implementedType = null) {
  const sharedDefinitions = [
    {
      name: "iterations",
      label: "Iterations",
      valueType: GeneratorValueType.INTEGER,
      getLimits: () => ({
        lower: 1,
        upper: 21
      })
    },
    {
      name: "threshold",
      label: "Threshold",
      valueType: GeneratorValueType.INTEGER,
      getLimits: () => ({
        lower: 0,
        upper: 5
      })
    }
  ];

  if (implementedType === MapInterpolater) {
    return sharedDefinitions;
  }

  return [
    {
      name: "density",
      label: "Density",
      valueType: GeneratorValueType.UNIT_INTERVAL,
      getLimits: () => ({
        lower: 0,
        upper: 1
      })
    },
    ...sharedDefinitions
  ];
}

function runCellularGrowthPass(graph, threshold) {
  const nextStep = new Graph(graph.size);

  graph.forEachTile((tile) => {
    const nextTile = nextStep.getTile(tile.x, tile.y);
    nextTile.value = tile.value;

    if (tile.value !== 0) {
      return;
    }

    if (countNeighborsWithValue(tile, 1) >= threshold) {
      nextTile.value = 1;
    }
  });

  return nextStep;
}

function runCellularShrinkPass(graph, threshold) {
  const nextStep = new Graph(graph.size);

  graph.forEachTile((tile) => {
    const nextTile = nextStep.getTile(tile.x, tile.y);
    nextTile.value = tile.value;

    if (tile.value !== 1) {
      return;
    }

    if (countNeighborsWithValue(tile, 0) >= threshold) {
      nextTile.value = 0;
    }
  });

  return nextStep;
}

export class CellularGrowth extends SelectableGenerator {
  constructor() {
    super(
      "cellular-growth",
      "Cellular Growth",
      {
        density: 0.7,
        iterations: 5,
        threshold: 3
      },
      [MapGenerator, MapInterpolater]
    );
  }

  getOwnParameterDefinitions(implementedType = null) {
    return createCellularPhaseParameterDefinitions(implementedType);
  }

  generateMap(
    size,
    seed,
    density = this.getParameterValue("density", MapGenerator),
    threshold = this.getParameterValue("threshold", MapGenerator),
    iterations = this.getParameterValue("iterations", MapGenerator)
  ) {
    let graph = new RandomMapGenerator().generateMap(size, seed, density);

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      graph = runCellularGrowthPass(graph, threshold);
    }

    return graph;
  }

  interpolateMap(
    map,
    seed,
    iterations = this.getParameterValue("iterations", MapInterpolater),
    threshold = this.getParameterValue("threshold", MapInterpolater)
  ) {
    void seed;

    let graph = map;

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      graph = runCellularGrowthPass(graph, threshold);
    }

    return graph;
  }
}

export class CellularShrink extends SelectableGenerator {
  constructor() {
    super(
      "cellular-shrink",
      "Cellular Shrink",
      {
        density: 0.7,
        iterations: 5,
        threshold: 3
      },
      [MapGenerator, MapInterpolater]
    );
  }

  getOwnParameterDefinitions(implementedType = null) {
    return createCellularPhaseParameterDefinitions(implementedType);
  }

  generateMap(
    size,
    seed,
    density = this.getParameterValue("density", MapGenerator),
    threshold = this.getParameterValue("threshold", MapGenerator),
    iterations = this.getParameterValue("iterations", MapGenerator)
  ) {
    let graph = new RandomMapGenerator().generateMap(size, seed, density);

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      graph = runCellularShrinkPass(graph, threshold);
    }

    return graph;
  }

  interpolateMap(
    map,
    seed,
    iterations = this.getParameterValue("iterations", MapInterpolater),
    threshold = this.getParameterValue("threshold", MapInterpolater)
  ) {
    void seed;

    let graph = map;

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      graph = runCellularShrinkPass(graph, threshold);
    }

    return graph;
  }
}

export class PerlinNoise extends SelectableGenerator {
  constructor() {
    super(
      "perlin-noise",
      "Perlin Noise",
      {
        threshold: 0.5,
        frequency: 1
      },
      [MapGenerator, ConcentrationFieldGenerator]
    );
  }

  getOwnParameterDefinitions(implementedType = null) {
    const sharedDefinitions = [
      {
        name: "frequency",
        label: "Frequency",
        valueType: GeneratorValueType.NUMBER,
        getLimits: () => ({
          lower: 0.01,
          upper: 100
        })
      }
    ];

    if (implementedType === ConcentrationFieldGenerator) {
      return sharedDefinitions;
    }

    return [
      {
        name: "threshold",
        label: "Threshold",
        valueType: GeneratorValueType.UNIT_INTERVAL,
        getLimits: () => ({
          lower: 0,
          upper: 1
        })
      },
      ...sharedDefinitions
    ];
  }

  generateMap(
    size, 
    seed,
    frequency = this.getParameterValue("frequency", MapGenerator),
    threshold = this.getParameterValue("threshold", MapGenerator)
  ) {
    const graph = this.generateConcentrationField(size, seed, frequency)
    
    graph.forEachTile((tile) => {
      tile.value = tile.value > threshold ? 1 : 0
    })

    return graph;
  }

  generateConcentrationField(
    size, 
    seed,
    frequency = this.getParameterValue("frequency", ConcentrationFieldGenerator)
  ) {
    const graph = this.makeWeirdField(size, seed, frequency)

    return normalizeConcentrationField(graph)
  }

  makeWeirdField(size, seed, frequency) {
    const graph = new Graph(size);
    const sampleScale = frequency / Math.max(size, 1);

    function dot(a, b) {
      return (a.x * b.x + a.y * b.y)
    }

    function fade(t) {
      return 6 * Math.pow(t, 5) - 15 * Math.pow(t, 4) + 10 * Math.pow(t, 3)
    }

    function lerp(a, b, d) {
      return a + ((b - a) * d)
    }

    function hash2D(x, y, seed) {
      let h = seed | 0;

      h ^= Math.imul(x | 0, 374761393);
      h ^= Math.imul(y | 0, 668265263);

      h = Math.imul(h ^ (h >>> 13), 1274126177);
      h = h ^ (h >>> 16);

      return h >>> 0;
    }

    function gradientAt(x, y, seed) {
      const h = hash2D(x, y, seed);

      switch (h & 7) {
        case 0: return { x:  1, y:  0 };
        case 1: return { x: -1, y:  0 };
        case 2: return { x:  0, y:  1 };
        case 3: return { x:  0, y: -1 };
        case 4: return { x:  0.70710678, y:  0.70710678 };
        case 5: return { x: -0.70710678, y:  0.70710678 };
        case 6: return { x:  0.70710678, y: -0.70710678 };
        case 7: return { x: -0.70710678, y: -0.70710678 };
      }
    }

    function perlin2D(x, y, seed) {
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);

      const x1 = x0 + 1;
      const y1 = y0 + 1;

      const sx = x - x0;
      const sy = y - y0;

      const g00 = gradientAt(x0, y0, seed);
      const g10 = gradientAt(x1, y0, seed);
      const g01 = gradientAt(x0, y1, seed);
      const g11 = gradientAt(x1, y1, seed);

      const n00 = dot(g00, { x: sx,     y: sy     });
      const n10 = dot(g10, { x: sx - 1, y: sy     });
      const n01 = dot(g01, { x: sx,     y: sy - 1 });
      const n11 = dot(g11, { x: sx - 1, y: sy - 1 });

      const u = fade(sx);
      const v = fade(sy);

      const bottom = lerp(n00, n10, u);
      const top = lerp(n01, n11, u);

      return lerp(bottom, top, v);
    }

    graph.forEachTile((tile) => {
      // Sample at tile centers in normalized map space so integer
      // frequencies do not collapse onto the Perlin lattice itself.
      const sampleX = (tile.x + 0.5) * sampleScale;
      const sampleY = (tile.y + 0.5) * sampleScale;

      tile.value = perlin2D(sampleX, sampleY, seed);
    });

    return graph;
  }
}

export class FractalBrownianMotion extends SelectableGenerator {
  constructor() {
    super(
      "fractal-brownian-motion",
      "Fractal Brownian Motion",
      {
        threshold: 0.5,
        frequency: 1,
        lacunarity: 2,
        persistence: 0.5,
        iterations: 4
      },
      [MapGenerator, ConcentrationFieldGenerator]
    );
  }

  getOwnParameterDefinitions(implementedType = null) {
    const sharedDefinitions = [
      {
        name: "frequency",
        label: "Frequency",
        valueType: GeneratorValueType.NUMBER,
        getLimits: () => ({
          lower: 0.01,
          upper: 100
        })
      },
      {
        name: "lacunarity",
        label: "Lacunarity",
        valueType: GeneratorValueType.NUMBER,
        getLimits: () => ({
          lower: 0.01,
          upper: 100
        })
      },
      {
        name: "persistence",
        label: "Persistence",
        valueType: GeneratorValueType.NUMBER,
        getLimits: () => ({
          lower: 0.01,
          upper: 100
        })
      },
      {
        name: "iterations",
        label: "Iterations",
        valueType: GeneratorValueType.INTEGER,
        getLimits: () => ({
          lower: 2,
          upper: 21
        })
      }
    ];

    if (implementedType === ConcentrationFieldGenerator) {
      return sharedDefinitions;
    }

    return [
      {
        name: "threshold",
        label: "Threshold",
        valueType: GeneratorValueType.UNIT_INTERVAL,
        getLimits: () => ({
          lower: 0,
          upper: 1
        })
      },
      ...sharedDefinitions
    ];
  }

  generateMap(
    size, 
    seed,
    threshold = this.getParameterValue("threshold", MapGenerator),
    frequency = this.getParameterValue("frequency", MapGenerator),
    lacunarity = this.getParameterValue("lacunarity", MapGenerator),
    persistence = this.getParameterValue("persistence", MapGenerator),
    iterations = this.getParameterValue("iterations", MapGenerator)
  ) {
    const field = this.generateConcentrationField(size, seed, frequency, lacunarity, persistence, iterations)

    field.forEachTile((tile) => {
      tile.value = tile.value > threshold ? 1 : 0
    })

    return field
  }

  generateConcentrationField(
    size, 
    seed,
    frequency = this.getParameterValue("frequency", ConcentrationFieldGenerator),
    lacunarity = this.getParameterValue("lacunarity", ConcentrationFieldGenerator),
    persistence = this.getParameterValue("persistence", ConcentrationFieldGenerator),
    iterations = this.getParameterValue("iterations", ConcentrationFieldGenerator)
  ) {
    const noise = new PerlinNoise();
    let myFields = []
    let myFrequency = frequency
    let amplitude = 1

    for (let i = 0; i < iterations; i++) {
      const field = noise.makeWeirdField(size, seed, myFrequency)
      field.forEachTile((tile) => {
        tile.value = tile.value * amplitude
      })
      myFields.push(field)
      myFrequency *= lacunarity
      amplitude *= persistence
    }

    const graph = new Graph(size);

    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        let val = 0
        for (const f of myFields) {
          val += f.getTile(x, y).value
        }
        graph.getTile(x, y).value = val
      }
    }

    return normalizeConcentrationField(graph)
  }
}

export class DrunkardsWalk extends SelectableGenerator {
  constructor() {
    super(
      "drunkards-walk",
      "Drunkard's Walk",
      {
        drunkardCount: 1,
        steps: 10
      },
      [MapGenerator, ConcentrationFieldInterpolater]
    );
  }

  getOwnParameterDefinitions() {
    return [
      {
        name: "drunkardCount",
        label: "Drunkard Count",
        valueType: GeneratorValueType.INTEGER,
        getLimits: (size) => ({
          lower: 1,
          upper: size + 1
        })
      },
      {
        name: "steps",
        label: "Steps",
        valueType: GeneratorValueType.INTEGER,
        getLimits: () => ({
          lower: 10,
          upper: 5001
        })
      }
    ];
  }

  generateMap(
    size, 
    seed,
    drunkardCount = this.getParameterValue("drunkardCount", MapGenerator),
    steps = this.getParameterValue("steps", MapGenerator)
  ) {
    const graph = new Graph(size);
    const random = new XorShift32(seed);

    const drunkards = []

    for (let i = 0; i < drunkardCount; i++) {
      const x = random.next(size)
      const y = random.next(size)
      const myTile = graph.getTile(x, y)
      myTile.value = 1
      drunkards.push(myTile)
    }

    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < drunkardCount; j++) {
        let myTile = drunkards[j]

        const neighbors = Object.values(myTile.neighbors).filter((val) => {return val !== null})
        const sel = random.next(neighbors.length)

        myTile = neighbors[sel]
        myTile.value = 1
        drunkards[j] = myTile
      }
    }

    return graph
  }

  interpolateConcentrationField(
    concentrationField, 
    seed,
    drunkardCount = this.getParameterValue("drunkardCount", ConcentrationFieldInterpolater),
    steps = this.getParameterValue("steps", ConcentrationFieldInterpolater)
  ) {
    const graph = concentrationField
    const size = concentrationField.size
    const random = new XorShift32(seed);

    const drunkards = []

    for (let i = 0; i < drunkardCount; i++) {
      const x = random.next(size)
      const y = random.next(size)
      const myTile = graph.getTile(x, y)
      myTile.value = 1
      drunkards.push(myTile)
    }

    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < drunkardCount; j++) {
        let myTile = drunkards[j]

        const neighbors = Object.values(myTile.neighbors).filter((val) => {return val !== null})
        const sel = weightedMove(neighbors, random)

        myTile = neighbors[sel]
        myTile.value = 1
        drunkards[j] = myTile
      }
    }

    return zeroOutFloatingTileValues(graph)
  }
}

function weightedMove(weights, random) {

  let totalWeight = 0
  for (let i = 0; i < weights.length; i++) {
    totalWeight += weights[i].value
  }

  let myWeight = random.nextFloatTo(totalWeight)

  for (let i = 0; i < weights.length; i++) {
    myWeight -= weights[i].value
    if (myWeight <= 0) {
      return i
    }
  }

  return null
}

class Region {

    constructor(catalyst) {
      this.tiles = new Set()
      this.openEdge = new Set()
      this.steps = 1

      this.tiles.add(catalyst)
      this.openEdge.add(catalyst)
      catalyst.value = 1
    }

    advance() {
      this.steps++

      const deadEdge = new Set();
      const newEdge = new Set();

      for (let tile of this.openEdge) {
        if (tile.value === this.steps) {
          this.tiles.delete(tile)
          deadEdge.add(tile)
          continue
        }
        for (let neighbor of Object.values(tile.neighbors)) {
          if (!neighbor) {
            continue
          }
          if (neighbor.value === 0) {
            neighbor.value = this.steps
            this.tiles.add(neighbor)
            newEdge.add(neighbor)
          } else if (!this.tiles.has(neighbor)) {
            neighbor.value = neighbor.value === this.steps ? this.steps + 1 : this.steps
            deadEdge.add(tile)
          } else {
            continue
          }
        } 
      }

      this.openEdge = newEdge
      return deadEdge
    }

  }

export class VoronoiRegions extends SelectableGenerator {
  constructor() {
    super(
      "voronoi-regions",
      "VoronoiRegions",
      {
        regionCount: 5
      },
      [MapGenerator, ConcentrationFieldGenerator]
    );
  }

  getOwnParameterDefinitions() {
    return [
      {
        name: "regionCount",
        label: "Region Count",
        valueType: GeneratorValueType.INTEGER,
        getLimits: () => ({
          lower: 2,
          upper: 5001
        })
      }
    ];
  }

  generateMap(
    size, 
    seed,
    regionCount = this.getParameterValue("regionCount", MapGenerator)
  ) {
    const graph = new Graph(size)
    const random = new XorShift32(seed)

    const regions = new Set()
    const chosen = new Set()

    for (let i = 0; i < regionCount; i++) {
      const x = random.next(size)
      const y = random.next(size)
      const myTile = graph.getTile(x, y)
      if (!chosen.has(myTile)) {
        chosen.add(myTile)
        const region = new Region(myTile)
        regions.add(region)
      }
      
    }

    const walls = new Set()

    while (regions.size > 0) {
      for (let region of regions){
        const newWalls = region.advance()

        if (region.openEdge.size === 0) {
          regions.delete(region)
        }
        for (let wall of newWalls) {
          walls.add(wall)
        }
      }
    }

    const finalGraph = new Graph(size, 1)
    
    for (let tile of walls) {
      finalGraph.getTile(tile.x, tile.y).value = 0
    }

    return finalGraph

  }

  generateConcentrationField(
    size, 
    seed,
    regionCount = this.getParameterValue("regionCount", ConcentrationFieldInterpolater)
  ) {
    const graph = new Graph(size)
    const random = new XorShift32(seed)

    const regions = new Set()
    const chosen = new Set()

    for (let i = 0; i < regionCount; i++) {
      const x = random.next(size)
      const y = random.next(size)
      const myTile = graph.getTile(x, y)
      if (!chosen.has(myTile)) {
        chosen.add(myTile)
        const region = new Region(myTile)
        regions.add(region)
      }
      
    }

    while (regions.size > 0) {
      for (let region of regions){
        const newWalls = region.advance()

        if (region.openEdge.size === 0) {
          regions.delete(region)
        }
      }
    }

    return normalizeConcentrationField(graph)
  }
}

export class DiffusionLimitedAggregation extends SelectableGenerator {
  constructor() {
    super(
      "diffusion-limited-aggregation",
      "Diffusion Limited Aggregation",
      {
        catalysts: 1,
        density: 0.5
      },
      [MapGenerator, ConcentrationFieldInterpolater]
    );
  }

  getOwnParameterDefinitions() {
    return [
      {
        name: "catalysts",
        label: "Catalysts",
        valueType: GeneratorValueType.INTEGER,
        getLimits: (size) => ({
          lower: 1,
          upper: Math.ceil(size / 50) + 1
        })
      },
      {
        name: "density",
        label: "Density",
        valueType: GeneratorValueType.UNIT_INTERVAL,
        getLimits: () => ({
          lower: 0,
          upper: 1
        })
      }
    ];
  }

  generateMap(size, seed) {
    void size;
    void seed;
  }

  interpolateConcentrationField(concentrationField, seed) {
    void concentrationField;
    void seed;
    return null;
  }
}

export class FloodFill extends SelectableGenerator {
  constructor() {
    super(
      "flood-fill",
      "FloodFill",
      {
        minimumRegionSize: 2
      },
      [MapInterpolater]
    );
  }

  getOwnParameterDefinitions() {
    return [
      {
        name: "minimumRegionSize",
        label: "Minimum Region Size",
        valueType: GeneratorValueType.INTEGER,
        getLimits: () => ({
          lower: 2,
          upper: 1001
        })
      }
    ];
  }

  interpolateMap(map, seed) {
    void seed;

    const graph = map;
    graph.forEachTile((tile) => {
      let floorCount = 0
      for (let neighbor of Object.values(tile.neighbors)) {
        if (!neighbor) {
          floorCount++
          continue;
        }

        floorCount += neighbor.value;
      }
      if (floorCount === 0) {
        tile.value = 0
      }
    })

    return graph;
  }
}

export class RawThreshold extends SelectableGenerator {
  constructor() {
    super(
      "raw-threshold",
      "Raw Threshold",
      {
        threshold: 0.5
      },
      [ConcentrationFieldInterpolater]
    );
  }

  getOwnParameterDefinitions() {
    return [
      {
        name: "threshold",
        label: "Threshold",
        valueType: GeneratorValueType.UNIT_INTERVAL,
        getLimits: () => ({
          lower: 0,
          upper: 1
        })
      }
    ];
  }

  interpolateConcentrationField(
    concentrationField, 
    seed,
    threshold = this.getParameterValue("threshold", ConcentrationFieldInterpolater)
  ) {
    const graph = concentrationField;

    graph.forEachTile((tile) => {
      tile.value = tile.value > threshold ? 1 : 0
    })

    return graph
  }
}

export function createSelectableGenerators() {
  return [
    new RandomMapGenerator(),
    new CellularAutomata(),
    new CellularGrowth(),
    new CellularShrink(),
    new PerlinNoise(),
    new FractalBrownianMotion(),
    new DrunkardsWalk(),
    new VoronoiRegions(),
    new DiffusionLimitedAggregation(),
    new FloodFill(),
    new RawThreshold()
  ];
}
