import { Graph, XorShift32 } from "./graphHandler.js";

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

function normalizeNumericValue(valueType, value, lower, upper, fallback) {
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
    this.parameters = {
      seed: "",
      ...parameters
    };
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

  getSharedParameterDefinitions() {
    return [
      {
        name: "seed",
        label: "Seed",
        valueType: GeneratorValueType.SEED,
        getLimits: () => ({
          lower: Number.NEGATIVE_INFINITY,
          upper: Number.POSITIVE_INFINITY
        })
      }
    ];
  }

  getOwnParameterDefinitions() {
    return [];
  }

  getParameterDefinitions() {
    return [
      ...this.getSharedParameterDefinitions(),
      ...this.getOwnParameterDefinitions()
    ];
  }

  getParameters() {
    return this.getParameterDefinitions().map((definition) => ({
      ...definition,
      value: this.getParameterValue(definition.name)
    }));
  }

  getParameterValue(name) {
    return this.parameters[name];
  }

  setParameterValue(name, value, size) {
    const definition = this.getParameterDefinitions().find(
      (parameterDefinition) => parameterDefinition.name === name
    );

    if (!definition) {
      throw new Error(`Unknown generator parameter: ${name}`);
    }

    if (definition.valueType === GeneratorValueType.SEED) {
      this.parameters[name] = value;
      return this.parameters[name];
    }

    const { lower, upper } = definition.getLimits(size);
    const fallback = this.getParameterValue(name);

    this.parameters[name] = normalizeNumericValue(
      definition.valueType,
      value,
      lower,
      upper,
      fallback
    );

    return this.parameters[name];
  }

  setParameterValues(values, size) {
    for (const definition of this.getParameterDefinitions()) {
      if (!(definition.name in values)) {
        continue;
      }

      this.setParameterValue(definition.name, values[definition.name], size);
    }
  }
}

export class RandomMapGenerator extends SelectableGenerator {
  constructor() {
    super("random", "Random", {
      density: 0.5
    }, [MapGenerator, ConcentrationFieldInterpolater]);
  }

  getOwnParameterDefinitions() {
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

  generateMap(size, seed = this.getParameterValue("seed")) {
    const graph = new Graph(size);
    const density = this.getParameterValue("density");
    const random = new XorShift32(seed);

    graph.forEachTile((tile) => {
      tile.value = random.next() / 0x100000000 < density ? 1 : 0;
    });

    return graph;
  }

  interpolateConcentrationField(concentrationField, seed) {
    void concentrationField;
    void seed;
    return null;
  }
}

export class CellularAutomata extends SelectableGenerator {
  constructor() {
    super(
      "cellular-automata",
      "CellularAutomata",
      {
        density: 0.5,
        iterations: 5,
        threshold: 2
      },
      [MapGenerator, MapInterpolater]
    );
  }

  getOwnParameterDefinitions() {
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
  }

  generateMap(size, seed = this.getParameterValue("seed")) {
    void size;
    void seed;
  }

  interpolateMap(map, seed = this.getParameterValue("seed")) {
    void map;
    void seed;
  }
}

export class PerlinNoise extends SelectableGenerator {
  constructor() {
    super(
      "perlin-noise",
      "PerlinNoise",
      {
        threshold: 0.5,
        frequency: 1
      },
      [MapGenerator, ConcentrationFieldGenerator]
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
      },
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
  }

  generateMap(size, seed = this.getParameterValue("seed")) {
    void size;
    void seed;
  }

  generateConcentrationField(size, seed = this.getParameterValue("seed")) {
    void size;
    void seed;
  }
}

export class FractalBrownianMotion extends SelectableGenerator {
  constructor() {
    super(
      "fractal-brownian-motion",
      "FractalBrownianMotion",
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
      },
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
  }

  generateMap(size, seed = this.getParameterValue("seed")) {
    void size;
    void seed;
  }

  generateConcentrationField(size, seed = this.getParameterValue("seed")) {
    void size;
    void seed;
  }
}

export class DrunkardsWalk extends SelectableGenerator {
  constructor() {
    super(
      "drunkards-walk",
      "DrunkardsWalk",
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
          upper: Math.ceil(size / 5) + 1
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

  generateMap(size, seed = this.getParameterValue("seed")) {
    void size;
    void seed;
  }

  interpolateConcentrationField(concentrationField, seed = this.getParameterValue("seed")) {
    void concentrationField;
    void seed;
    return null;
  }
}

export class VoronoiRegions extends SelectableGenerator {
  constructor() {
    super(
      "voronoi-regions",
      "VoronoiRegions",
      {
        regionCount: 1
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
          lower: 1,
          upper: 501
        })
      }
    ];
  }

  generateMap(size, seed = this.getParameterValue("seed")) {
    void size;
    void seed;
  }

  generateConcentrationField(size, seed = this.getParameterValue("seed")) {
    void size;
    void seed;
  }
}

export class DiffusionLimitedAggregation extends SelectableGenerator {
  constructor() {
    super(
      "diffusion-limited-aggregation",
      "DiffusionLimitedAggregation",
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

  generateMap(size, seed = this.getParameterValue("seed")) {
    void size;
    void seed;
  }

  interpolateConcentrationField(concentrationField, seed = this.getParameterValue("seed")) {
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

  interpolateMap(map, seed = this.getParameterValue("seed")) {
    void map;
    void seed;
  }
}

export class RawThreshold extends SelectableGenerator {
  constructor() {
    super(
      "raw-threshold",
      "RawThreshold",
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

  interpolateConcentrationField(concentrationField, seed = this.getParameterValue("seed")) {
    void concentrationField;
    void seed;
    return null;
  }
}

export function createSelectableGenerators() {
  return [
    new RandomMapGenerator(),
    new CellularAutomata(),
    new PerlinNoise(),
    new FractalBrownianMotion(),
    new DrunkardsWalk(),
    new VoronoiRegions(),
    new DiffusionLimitedAggregation(),
    new FloodFill(),
    new RawThreshold()
  ];
}
