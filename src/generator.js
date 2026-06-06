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

// Interface-like contract for a biome generator using an existing map.
export class BiomeGenerator {
  generateBiomes(map, seed) {
    throw new Error(
      "BiomeGenerator.generateBiomes must be implemented."
    );
  }
}

// Interface-like contract for a biome generator using a full map.
export class BiomeInterpolater {
  interpolateBiomes(map, seed) {
    throw new Error(
      "BiomeInterpolater.interpolateBiomes must be implemented."
    );
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
    void implementedType;

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

  interpolateConcentrationField(
    concentrationField, 
    seed,
    density = this.getParameterValue("density", ConcentrationFieldInterpolater)
  ) {
    const graph = concentrationField;
    const random = new XorShift32(seed);

    graph.forEachTile((tile) => {
      let floor = random.nextFloat() > tile.value && random.nextFloat() < density 
      tile.value = floor ? 1 : 0
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

function cloneGraph(graph) {
  const clonedGraph = new Graph(graph.size);

  graph.forEachTile((tile) => {
    const clonedTile = clonedGraph.getTile(tile.x, tile.y);
    clonedTile.value = tile.value;
    clonedTile.biome = tile.biome;
  });

  return clonedGraph;
}

function countDifferentNeighbors(tile) {
  let count = 0;

  for (const neighbor of Object.values(tile.neighbors)) {
    if (!neighbor || neighbor.value === tile.value) {
      continue;
    }

    count += 1;
  }

  return count;
}

function runRandomAutomataPass(graph, random) {
  const nextStep = cloneGraph(graph);

  graph.forEachTile((tile) => {
    const swapChance = countDifferentNeighbors(tile) / 4;

    if (random.nextFloat() >= swapChance) {
      return;
    }

    nextStep.getTile(tile.x, tile.y).value = tile.value === 1 ? 0 : 1;
  });

  return nextStep;
}

function runRandomGrowthPass(graph, random) {
  const nextStep = cloneGraph(graph);

  graph.forEachTile((tile) => {
    if (tile.value !== 0) {
      return;
    }

    const swapChance = countDifferentNeighbors(tile) / 4;

    if (random.nextFloat() >= swapChance) {
      return;
    }

    nextStep.getTile(tile.x, tile.y).value = 1;
  });

  return nextStep;
}

function runRandomShrinkPass(graph, random) {
  const nextStep = cloneGraph(graph);

  graph.forEachTile((tile) => {
    if (tile.value !== 1) {
      return;
    }

    const swapChance = countDifferentNeighbors(tile) / 4;

    if (random.nextFloat() >= swapChance) {
      return;
    }

    nextStep.getTile(tile.x, tile.y).value = 0;
  });

  return nextStep;
}

function createRandomPhaseParameterDefinitions() {
  return [
    {
      name: "iterations",
      label: "Iterations",
      valueType: GeneratorValueType.INTEGER,
      getLimits: () => ({
        lower: 1,
        upper: 21
      })
    }
  ];
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

export class RandomAutomata extends SelectableGenerator {
  constructor() {
    super(
      "random-automata",
      "Random Automata",
      {
        iterations: 5
      },
      [MapInterpolater]
    );
  }

  getOwnParameterDefinitions() {
    return createRandomPhaseParameterDefinitions();
  }

  interpolateMap(
    map,
    seed,
    iterations = this.getParameterValue("iterations", MapInterpolater)
  ) {
    let graph = map;
    const random = new XorShift32(seed);

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      graph = runRandomAutomataPass(graph, random);
    }

    return graph;
  }
}

export class RandomGrowth extends SelectableGenerator {
  constructor() {
    super(
      "random-growth",
      "Random Growth",
      {
        iterations: 5
      },
      [MapInterpolater]
    );
  }

  getOwnParameterDefinitions() {
    return createRandomPhaseParameterDefinitions();
  }

  interpolateMap(
    map,
    seed,
    iterations = this.getParameterValue("iterations", MapInterpolater)
  ) {
    let graph = map;
    const random = new XorShift32(seed);

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      graph = runRandomGrowthPass(graph, random);
    }

    return graph;
  }
}

export class RandomShrink extends SelectableGenerator {
  constructor() {
    super(
      "random-shrink",
      "Random Shrink",
      {
        iterations: 5
      },
      [MapInterpolater]
    );
  }

  getOwnParameterDefinitions() {
    return createRandomPhaseParameterDefinitions();
  }

  interpolateMap(
    map,
    seed,
    iterations = this.getParameterValue("iterations", MapInterpolater)
  ) {
    let graph = map;
    const random = new XorShift32(seed);

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      graph = runRandomShrinkPass(graph, random);
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

    if (
      implementedType === ConcentrationFieldGenerator ||
      implementedType === BiomeGenerator
    ) {
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

  generateBiomes(
    map,
    seed,
    frequency = this.getParameterValue("frequency", BiomeGenerator)
  ) {
    void map;
    void seed;
    void frequency;

    throw new Error("PerlinNoise.generateBiomes must be implemented.");
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

    if (
      implementedType === ConcentrationFieldGenerator ||
      implementedType === BiomeGenerator
    ) {
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

  generateBiomes(
    map,
    seed,
    frequency = this.getParameterValue("frequency", BiomeGenerator),
    lacunarity = this.getParameterValue("lacunarity", BiomeGenerator),
    persistence = this.getParameterValue("persistence", BiomeGenerator),
    iterations = this.getParameterValue("iterations", BiomeGenerator)
  ) {
    void map;
    void seed;
    void frequency;
    void lacunarity;
    void persistence;
    void iterations;

    throw new Error("FractalBrownianMotion.generateBiomes must be implemented.");
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

  generateBiomes(
    map,
    seed,
    drunkardCount = this.getParameterValue("drunkardCount", BiomeGenerator),
    steps = this.getParameterValue("steps", BiomeGenerator)
  ) {
    void map;
    void seed;
    void drunkardCount;
    void steps;

    throw new Error("DrunkardsWalk.generateBiomes must be implemented.");
  }

  interpolateBiomes(
    map,
    seed,
    drunkardCount = this.getParameterValue("drunkardCount", BiomeInterpolater),
    steps = this.getParameterValue("steps", BiomeInterpolater)
  ) {
    void map;
    void seed;
    void drunkardCount;
    void steps;

    throw new Error("DrunkardsWalk.interpolateBiomes must be implemented.");
  }
}

function getWeightValue(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return value;
}

function weightedMove(weights, random) {
  if (!Array.isArray(weights) || weights.length === 0) {
    return null;
  }

  let totalWeight = 0;

  for (let i = 0; i < weights.length; i += 1) {
    totalWeight += getWeightValue(weights[i]?.value);
  }

  if (totalWeight <= 0) {
    return random.next(weights.length);
  }

  let remainingWeight = random.nextFloatTo(totalWeight);
  let fallbackIndex = null;

  for (let i = 0; i < weights.length; i += 1) {
    const weight = getWeightValue(weights[i]?.value);

    if (weight <= 0) {
      continue;
    }

    fallbackIndex = i;
    remainingWeight -= weight;

    if (remainingWeight < 0 || remainingWeight === 0) {
      return i;
    }
  }

  return fallbackIndex ?? random.next(weights.length);
}

function pickWeightedTile(graph, random, predicate = null) {
  if (!graph) {
    return null;
  }

  let candidateCount = 0;
  let totalWeight = 0;

  for (const row of graph.tiles) {
    for (const tile of row) {
      if (predicate && !predicate(tile)) {
        continue;
      }

      candidateCount += 1;
      totalWeight += getWeightValue(tile.value);
    }
  }

  if (candidateCount === 0) {
    return null;
  }

  if (totalWeight <= 0) {
    let remainingCandidates = random.next(candidateCount);

    for (const row of graph.tiles) {
      for (const tile of row) {
        if (predicate && !predicate(tile)) {
          continue;
        }

        if (remainingCandidates === 0) {
          return tile;
        }

        remainingCandidates -= 1;
      }
    }

    return null;
  }

  let remainingWeight = random.nextFloatTo(totalWeight);
  let fallbackTile = null;

  for (const row of graph.tiles) {
    for (const tile of row) {
      if (predicate && !predicate(tile)) {
        continue;
      }

      const weight = getWeightValue(tile.value);

      if (weight <= 0) {
        continue;
      }

      fallbackTile = tile;
      remainingWeight -= weight;

      if (remainingWeight < 0 || remainingWeight === 0) {
        return tile;
      }
    }
  }

  return fallbackTile;
}

class VoronoiRegion {

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

function getDistributedHexColor(totalColors, requiredColorIndex) {
  const normalizedTotal = Math.max(1, Math.trunc(totalColors));
  const normalizedIndex = Math.min(
    normalizedTotal - 1,
    Math.max(0, Math.trunc(requiredColorIndex))
  );
  const colorValue = Math.floor(
    ((normalizedIndex + 1) * 0xffffff) / (normalizedTotal + 1)
  );

  return `#${colorValue.toString(16).padStart(6, "0")}`;
}

function mergeBiomeMapIntoMap(biomeMap, basicMap) {
  if (!biomeMap || !basicMap || biomeMap.size !== basicMap.size) {
    return basicMap;
  }

  basicMap.forEachTile((tile) => {
    if (tile.value !== 1) {
      tile.biome = null;
      return;
    }

    tile.biome = biomeMap.getTile(tile.x, tile.y)?.biome ?? null;
  });

  return basicMap;
}

export class VoronoiRegions extends SelectableGenerator {
  constructor() {
    super(
      "voronoi-regions",
      "VoronoiRegions",
      {
        regionCount: 5
      },
      [MapGenerator, ConcentrationFieldGenerator, BiomeGenerator, BiomeInterpolater]
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
        const region = new VoronoiRegion(myTile)
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
        const region = new VoronoiRegion(myTile)
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

  generateBiomes(
    map,
    seed,
    regionCount = this.getParameterValue("regionCount", BiomeGenerator)
  ) {
    const basicMap = map;
    const biomeMap = this.generateMap(map.size, seed, regionCount);

    const isolatedFloorTiles = [];

    biomeMap.forEachTile((tile) => {
      if (tile.value !== 1) {
        return;
      }

      let adjacentFloorCount = 0;

      for (const neighbor of Object.values(tile.neighbors)) {
        if (neighbor?.value === 1) {
          adjacentFloorCount += 1;
        }
      }

      if (adjacentFloorCount === 0) {
        isolatedFloorTiles.push(tile);
      }
    });

    for (const tile of isolatedFloorTiles) {
      tile.value = 0;
    }

    const visited = new Set();
    let regionIndex = 0;

    biomeMap.forEachTile((tile) => {
      if (tile.value !== 1 || visited.has(tile)) {
        return;
      }

      const region = [];
      const queue = [tile];
      visited.add(tile);

      while (queue.length > 0) {
        const currentTile = queue.shift();
        region.push(currentTile);

        for (const neighbor of Object.values(currentTile.neighbors)) {
          if (!neighbor || neighbor.value !== 1 || visited.has(neighbor)) {
            continue;
          }

          visited.add(neighbor);
          queue.push(neighbor);
        }
      }

      const biomeColor = getDistributedHexColor(regionCount, regionIndex);
      regionIndex += 1;

      for (const regionTile of region) {
        regionTile.biome = biomeColor;
        regionTile.value = 0;
      }
    });

    return mergeBiomeMapIntoMap(biomeMap, basicMap);
  }

  interpolateBiomes(
    map,
    seed,
    regionCount = this.getParameterValue("regionCount", BiomeInterpolater)
  ) {
    const basicMap = map;
    const biomeMap = new Graph(map.size);
    const random = new XorShift32(seed);
    const floorTiles = [];

    basicMap.forEachTile((tile) => {
      const biomeTile = biomeMap.getTile(tile.x, tile.y);

      if (tile.value === 1) {
        biomeTile.value = 0;
        floorTiles.push(biomeTile);
        return;
      }

      // Non-zero tiles are treated as blocked by the Voronoi expansion.
      biomeTile.value = -1;
    });

    if (floorTiles.length === 0) {
      return mergeBiomeMapIntoMap(biomeMap, basicMap);
    }

    const catalystCount = Math.min(
      Math.max(1, Math.trunc(regionCount)),
      floorTiles.length
    );
    const activeRegions = new Set();
    const allRegions = [];

    for (let i = 0; i < catalystCount; i += 1) {
      const swapIndex = i + random.next(floorTiles.length - i);
      [floorTiles[i], floorTiles[swapIndex]] = [floorTiles[swapIndex], floorTiles[i]];

      const catalyst = floorTiles[i];
      const region = new VoronoiRegion(catalyst);
      activeRegions.add(region);
      allRegions.push(region);
    }

    while (activeRegions.size > 0) {
      for (const region of activeRegions) {
        region.advance();

        if (region.openEdge.size === 0) {
          activeRegions.delete(region);
        }
      }
    }

    const finalizedRegions = allRegions.filter((region) => region.tiles.size > 0);

    finalizedRegions.forEach((region, index) => {
      const biomeColor = getDistributedHexColor(finalizedRegions.length, index);

      for (const regionTile of region.tiles) {
        regionTile.biome = biomeColor;
      }
    });

    return mergeBiomeMapIntoMap(biomeMap, basicMap);
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
          upper: Math.ceil(size / 5) + 1
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

  generateMap(
    size, 
    seed,
    catalysts = this.getParameterValue("catalysts", MapGenerator),
    density = this.getParameterValue("density", MapGenerator)
  ) {
    const graph = new Graph(size);
    const random = new XorShift32(seed);

    return this.runAggregation({
      graph,
      random,
      catalysts,
      targetOccupiedTiles: this.getTargetOccupiedTileCount(size, density),
      pickCatalystTile: ({ pickRandomEmptyTile, isCatalystSafeTile }) =>
        pickRandomEmptyTile(isCatalystSafeTile),
      pickWalkerStep: ({ openNeighbors, random }) =>
        openNeighbors[random.next(openNeighbors.length)] ?? null
    });
  }

  interpolateConcentrationField(
    concentrationField,
    seed,
    catalysts = this.getParameterValue("catalysts", ConcentrationFieldInterpolater),
    density = this.getParameterValue("density", ConcentrationFieldInterpolater)
  ) {
    const graph = new Graph(concentrationField.size);
    const random = new XorShift32(seed);

    return this.runAggregation({
      graph,
      random,
      catalysts,
      targetOccupiedTiles: this.getTargetOccupiedTileCount(
        concentrationField.size,
        density
      ),
      pickCatalystTile: ({
        graph: aggregateGraph,
        pickRandomEmptyTile,
        isCatalystSafeTile
      }) => {
        const weightedTile = pickWeightedTile(
          concentrationField,
          random,
          (weightTile) => {
            const aggregateTile = aggregateGraph.getTile(weightTile.x, weightTile.y);
            return isCatalystSafeTile(aggregateTile);
          }
        );

        if (weightedTile) {
          return aggregateGraph.getTile(weightedTile.x, weightedTile.y);
        }

        return pickRandomEmptyTile(isCatalystSafeTile);
      },
      pickWalkerStep: ({ openNeighbors, random }) => {
        const weightedNeighbors = openNeighbors.map((neighbor) =>
          concentrationField.getTile(neighbor.x, neighbor.y)
        );
        const selectedIndex = weightedMove(weightedNeighbors, random);

        if (selectedIndex === null) {
          return null;
        }

        return openNeighbors[selectedIndex] ?? null;
      }
    });
  }

  getTargetOccupiedTileCount(size, density) {
    const totalTiles = size * size;

    return Math.max(0, Math.min(totalTiles, Math.round(totalTiles * density)));
  }

  runAggregation({
    graph,
    random,
    catalysts,
    targetOccupiedTiles,
    pickCatalystTile,
    pickWalkerStep
  }) {
    if (targetOccupiedTiles === 0) {
      return graph;
    }

    const size = graph.size;
    const totalTiles = size * size;
    let occupiedCount = 0;
    const bounds = {
      minX: size,
      maxX: -1,
      minY: size,
      maxY: -1
    };
    const maxActiveWalkers = Math.max(1, Math.floor(size / 10));
    const maxWalkerSteps = Math.max(1, size * 10);
    const catalystEdgePadding = Math.floor(size / 10);
    const catalystSafeZoneSize = Math.max(0, size - catalystEdgePadding * 2);
    const hasCatalystSafeZone = catalystSafeZoneSize > 0;
    const maxCatalystSafeZoneTiles = hasCatalystSafeZone
      ? catalystSafeZoneSize * catalystSafeZoneSize
      : totalTiles;

    function updateBounds(tile) {
      bounds.minX = Math.min(bounds.minX, tile.x);
      bounds.maxX = Math.max(bounds.maxX, tile.x);
      bounds.minY = Math.min(bounds.minY, tile.y);
      bounds.maxY = Math.max(bounds.maxY, tile.y);
    }

    function occupyTile(tile) {
      if (!tile || tile.value === 1) {
        return false;
      }

      tile.value = 1;
      occupiedCount += 1;
      updateBounds(tile);
      return true;
    }

    function getNeighbors(tile) {
      return Object.values(tile.neighbors).filter((neighbor) => neighbor !== null);
    }

    function hasOccupiedNeighbor(tile) {
      return getNeighbors(tile).some((neighbor) => neighbor.value === 1);
    }

    function canWalkerStick(tile) {
      return tile?.value === 0 && hasOccupiedNeighbor(tile);
    }

    function isEmptyNonStickingTile(tile) {
      return tile?.value === 0 && !hasOccupiedNeighbor(tile);
    }

    function isCatalystSafeTile(tile) {
      if (tile?.value !== 0) {
        return false;
      }

      if (!hasCatalystSafeZone) {
        return true;
      }

      return (
        tile.x >= catalystEdgePadding &&
        tile.x < size - catalystEdgePadding &&
        tile.y >= catalystEdgePadding &&
        tile.y < size - catalystEdgePadding
      );
    }

    function pickRandomEmptyTile(predicate = null) {
      const maxAttempts = Math.max(size * 4, 16);

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const tile = graph.getTile(random.next(size), random.next(size));

        if (tile?.value === 0 && (!predicate || predicate(tile))) {
          return tile;
        }
      }

      for (const row of graph.tiles) {
        for (const tile of row) {
          if (tile.value === 0 && (!predicate || predicate(tile))) {
            return tile;
          }
        }
      }

      return null;
    }

    function pickWalkerSpawnTile() {
      return pickRandomEmptyTile();
    }

    function createWalker() {
      const tile = pickWalkerSpawnTile();

      if (!tile) {
        return null;
      }

      return {
        tile,
        stepsTaken: 0
      };
    }

    const catalystCount = Math.min(
      targetOccupiedTiles,
      catalysts,
      maxCatalystSafeZoneTiles
    );

    for (let i = 0; i < catalystCount; i += 1) {
      const catalystTile =
        pickCatalystTile({
          graph,
          random,
          isCatalystSafeTile,
          pickRandomEmptyTile
        }) ??
        pickRandomEmptyTile(isCatalystSafeTile) ??
        pickRandomEmptyTile();

      if (!occupyTile(catalystTile)) {
        break;
      }
    }

    const activeWalkers = [];

    function refillWalkers() {
      while (
        activeWalkers.length < maxActiveWalkers &&
        occupiedCount < targetOccupiedTiles
      ) {
        const walker = createWalker();

        if (!walker) {
          break;
        }

        activeWalkers.push(walker);
      }
    }

    refillWalkers();

    while (occupiedCount < targetOccupiedTiles && activeWalkers.length > 0) {
      for (
        let walkerIndex = activeWalkers.length - 1;
        walkerIndex >= 0 && occupiedCount < targetOccupiedTiles;
        walkerIndex -= 1
      ) {
        const walker = activeWalkers[walkerIndex];

        if (!walker?.tile || walker.tile.value === 1) {
          activeWalkers.splice(walkerIndex, 1);
          continue;
        }

        if (canWalkerStick(walker.tile)) {
          occupyTile(walker.tile);
          activeWalkers.splice(walkerIndex, 1);
          continue;
        }

        const openNeighbors = getNeighbors(walker.tile).filter(
          (neighbor) => neighbor.value === 0
        );

        if (openNeighbors.length === 0) {
          activeWalkers.splice(walkerIndex, 1);
          continue;
        }

        const nextTile = pickWalkerStep({
          graph,
          random,
          walker,
          openNeighbors
        });

        if (!nextTile || nextTile.value !== 0) {
          activeWalkers.splice(walkerIndex, 1);
          continue;
        }

        walker.tile = nextTile;
        walker.stepsTaken += 1;

        if (canWalkerStick(walker.tile)) {
          occupyTile(walker.tile);
          activeWalkers.splice(walkerIndex, 1);
          continue;
        }

        if (walker.stepsTaken >= maxWalkerSteps) {
          activeWalkers.splice(walkerIndex, 1);
        }
      }

      refillWalkers();
    }

    return graph;
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

  interpolateMap(
    map,
    seed,
    minimumRegionSize = this.getParameterValue("minimumRegionSize", MapInterpolater)
  ) {
    void seed;

    const graph = map;

    const isolatedFloorTiles = [];

    graph.forEachTile((tile) => {
      if (tile.value !== 1) {
        return;
      }

      let adjacentFloorCount = 0;

      for (const neighbor of Object.values(tile.neighbors)) {
        if (neighbor?.value === 1) {
          adjacentFloorCount += 1;
        }
      }

      if (adjacentFloorCount === 0) {
        isolatedFloorTiles.push(tile);
      }
    });

    for (const tile of isolatedFloorTiles) {
      tile.value = 0;
    }

    const visited = new Set();

    graph.forEachTile((tile) => {
      if (tile.value !== 1 || visited.has(tile)) {
        return;
      }

      const region = [];
      const queue = [tile];
      visited.add(tile);

      while (queue.length > 0) {
        const currentTile = queue.shift();
        region.push(currentTile);

        for (const neighbor of Object.values(currentTile.neighbors)) {
          if (!neighbor || neighbor.value !== 1 || visited.has(neighbor)) {
            continue;
          }

          visited.add(neighbor);
          queue.push(neighbor);
        }
      }

      if (region.length >= minimumRegionSize) {
        return;
      }

      for (const regionTile of region) {
        regionTile.value = 0;
      }
    });

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
    new RandomAutomata(),
    new RandomGrowth(),
    new RandomShrink(),
    new PerlinNoise(),
    new FractalBrownianMotion(),
    new DrunkardsWalk(),
    new VoronoiRegions(),
    new DiffusionLimitedAggregation(),
    new FloodFill(),
    new RawThreshold()
  ];
}
