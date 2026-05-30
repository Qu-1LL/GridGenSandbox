import "./style.css";
import { Application, Container, Graphics } from "pixi.js";
import {
  ConcentrationFieldGenerator,
  ConcentrationFieldInterpolater,
  createSelectableGenerators,
  GeneratorValueType,
  MapGenerator,
  MapInterpolater
} from "./generator.js";
import { Graph } from "./graphHandler.js";

const DEFAULT_GRAPH_SIZE = 100;
const MIN_GRAPH_SIZE = 1;
const MAX_GRAPH_SIZE = 1000;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeGraphSize(value) {
  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) {
    return DEFAULT_GRAPH_SIZE;
  }

  return clamp(parsed, MIN_GRAPH_SIZE, MAX_GRAPH_SIZE);
}

function getExclusiveInputMax(valueType, lower, upper) {
  if (!Number.isFinite(upper)) {
    return null;
  }

  if (valueType === GeneratorValueType.INTEGER) {
    return String(Math.max(lower, Math.ceil(upper) - 1));
  }

  const epsilon = Math.max(Math.abs(upper) * 1e-6, 1e-6);
  return String(Math.max(lower, upper - epsilon));
}

function formatParameterValue(valueType, value) {
  if (valueType === GeneratorValueType.SEED) {
    return value ?? "";
  }

  if (valueType === GeneratorValueType.INTEGER) {
    return String(value);
  }

  return Number(value.toFixed(6)).toString();
}

function resolveGraphFromGenerator(generator, size) {
  const generatedGraph =
    typeof generator?.generateMap === "function"
      ? generator.generateMap(size)
      : null;

  if (
    generatedGraph &&
    typeof generatedGraph.forEachTile === "function" &&
    Number.isInteger(generatedGraph.size)
  ) {
    return generatedGraph;
  }

  return new Graph(size);
}

function isGraph(value) {
  return (
    value &&
    typeof value.forEachTile === "function" &&
    Number.isInteger(value.size)
  );
}

function resolveConcentrationFieldGraph(generator, size) {
  const generatedGraph =
    typeof generator?.generateConcentrationField === "function"
      ? generator.generateConcentrationField(size)
      : null;

  if (isGraph(generatedGraph)) {
    return generatedGraph;
  }

  return new Graph(size);
}

function resolveInterpolatedMapFromConcentrationField(generator, concentrationField) {
  const generatedGraph =
    typeof generator?.interpolateConcentrationField === "function"
      ? generator.interpolateConcentrationField(concentrationField)
      : null;

  if (isGraph(generatedGraph)) {
    return generatedGraph;
  }

  return new Graph(concentrationField.size);
}

function resolveInterpolatedMap(generator, sourceMap) {
  const generatedGraph =
    typeof generator?.interpolateMap === "function"
      ? generator.interpolateMap(sourceMap)
      : null;

  if (isGraph(generatedGraph)) {
    return generatedGraph;
  }

  return new Graph(sourceMap.size);
}

function invertConcentrationField(graph) {
  graph.forEachTile((tile) => {
    const value = Number.isFinite(tile.value) ? tile.value : 0;
    tile.value = 0.9999999 - value;
  });
}

function buildDisplayGraph({
  size,
  useConcentrationField,
  invert,
  useMapInterpolator,
  concentrationFieldGenerator,
  mapSelectionGenerator,
  mapInterpolatorGenerator
}) {
  let map;

  if (useConcentrationField) {
    const concentrationField = resolveConcentrationFieldGraph(
      concentrationFieldGenerator,
      size
    );

    if (invert) {
      invertConcentrationField(concentrationField);
    }

    map = resolveInterpolatedMapFromConcentrationField(
      mapSelectionGenerator,
      concentrationField
    );
  } else {
    map = resolveGraphFromGenerator(mapSelectionGenerator, size);
  }

  if (!useMapInterpolator) {
    return map;
  }

  return resolveInterpolatedMap(mapInterpolatorGenerator, map);
}

function getGeneratorsByType(generators, type) {
  return generators.filter((generator) =>
    generator.getImplementedTypes().includes(type)
  );
}

function ensureGeneratorKey(generators, currentKey) {
  return generators.find((generator) => generator.getKey() === currentKey)?.getKey() ??
    generators[0]?.getKey() ??
    "";
}

function createToggleRow(labelText, checked) {
  const row = document.createElement("label");
  row.className = "menu-overlay__toggle-row";

  const label = document.createElement("span");
  label.className = "menu-overlay__toggle-label";
  label.textContent = labelText;

  const input = document.createElement("input");
  input.className = "menu-overlay__toggle-input";
  input.type = "checkbox";
  input.checked = checked;

  const slider = document.createElement("span");
  slider.className = "menu-overlay__toggle-slider";

  row.append(label, input, slider);

  return { row, input };
}

function createMenuOverlay(root, initialSize, generators, initialSelection, onSave) {
  const overlay = document.createElement("div");
  overlay.className = "menu-overlay";
  const generatorsByKey = new Map(
    generators.map((generator) => [generator.getKey(), generator])
  );
  const concentrationFieldGenerators = getGeneratorsByType(
    generators,
    ConcentrationFieldGenerator
  );
  const concentrationFieldInterpolaters = getGeneratorsByType(
    generators,
    ConcentrationFieldInterpolater
  );
  const mapGenerators = getGeneratorsByType(generators, MapGenerator);
  const mapInterpolaters = getGeneratorsByType(generators, MapInterpolater);
  const selectionState = {
    ...initialSelection
  };

  const sizeField = document.createElement("label");
  sizeField.className = "menu-overlay__field";

  const sizeFieldLabel = document.createElement("span");
  sizeFieldLabel.className = "menu-overlay__label";
  sizeFieldLabel.textContent = "Graph Size";

  const sizeInput = document.createElement("input");
  sizeInput.className = "menu-overlay__input";
  sizeInput.type = "number";
  sizeInput.min = String(MIN_GRAPH_SIZE);
  sizeInput.max = String(MAX_GRAPH_SIZE);
  sizeInput.step = "1";
  sizeInput.value = String(initialSize);

  sizeField.append(sizeFieldLabel, sizeInput);

  const useConcentrationToggle = createToggleRow(
    "Use Concentration Field",
    selectionState.useConcentrationField
  );
  const invertToggle = createToggleRow("Invert", selectionState.invert);
  const useMapInterpolatorToggle = createToggleRow(
    "Use Map Interpolator",
    selectionState.useMapInterpolator
  );

  const concentrationSection = document.createElement("div");
  concentrationSection.className = "menu-overlay__section";

  const concentrationTitle = document.createElement("div");
  concentrationTitle.className = "menu-overlay__section-title";
  concentrationTitle.textContent = "Concentration Field";

  const concentrationControlsRow = document.createElement("div");
  concentrationControlsRow.className = "menu-overlay__controls";

  const concentrationField = document.createElement("label");
  concentrationField.className = "menu-overlay__field";

  const concentrationFieldLabel = document.createElement("span");
  concentrationFieldLabel.className = "menu-overlay__label";
  concentrationFieldLabel.textContent = "Method";

  const concentrationSelect = document.createElement("select");
  concentrationSelect.className = "menu-overlay__select";

  for (const generator of concentrationFieldGenerators) {
    const option = document.createElement("option");
    option.value = generator.getKey();
    option.textContent = generator.getLabel();
    concentrationSelect.appendChild(option);
  }

  concentrationField.append(concentrationFieldLabel, concentrationSelect);

  const concentrationParameterFields = document.createElement("div");
  concentrationParameterFields.className = "menu-overlay__parameters";
  const concentrationParameterInputs = new Map();

  const mapSection = document.createElement("div");
  mapSection.className = "menu-overlay__section";

  const mapTitle = document.createElement("div");
  mapTitle.className = "menu-overlay__section-title";
  mapTitle.textContent = "Map Generator";

  const mapControlsRow = document.createElement("div");
  mapControlsRow.className = "menu-overlay__controls";

  const mapField = document.createElement("label");
  mapField.className = "menu-overlay__field";

  const mapFieldLabel = document.createElement("span");
  mapFieldLabel.className = "menu-overlay__label";
  mapFieldLabel.textContent = "Method";

  const mapSelect = document.createElement("select");
  mapSelect.className = "menu-overlay__select";

  mapField.append(mapFieldLabel, mapSelect);

  const mapParameterFields = document.createElement("div");
  mapParameterFields.className = "menu-overlay__parameters";
  const mapParameterInputs = new Map();

  const mapInterpolatorSection = document.createElement("div");
  mapInterpolatorSection.className = "menu-overlay__section";

  const mapInterpolatorTitle = document.createElement("div");
  mapInterpolatorTitle.className = "menu-overlay__section-title";
  mapInterpolatorTitle.textContent = "Map Interpolator";

  const mapInterpolatorControlsRow = document.createElement("div");
  mapInterpolatorControlsRow.className = "menu-overlay__controls";

  const mapInterpolatorField = document.createElement("label");
  mapInterpolatorField.className = "menu-overlay__field";

  const mapInterpolatorFieldLabel = document.createElement("span");
  mapInterpolatorFieldLabel.className = "menu-overlay__label";
  mapInterpolatorFieldLabel.textContent = "Method";

  const mapInterpolatorSelect = document.createElement("select");
  mapInterpolatorSelect.className = "menu-overlay__select";

  for (const generator of mapInterpolaters) {
    const option = document.createElement("option");
    option.value = generator.getKey();
    option.textContent = generator.getLabel();
    mapInterpolatorSelect.appendChild(option);
  }

  mapInterpolatorField.append(mapInterpolatorFieldLabel, mapInterpolatorSelect);

  const mapInterpolatorParameterFields = document.createElement("div");
  mapInterpolatorParameterFields.className = "menu-overlay__parameters";
  const mapInterpolatorParameterInputs = new Map();
  const saveButton = document.createElement("button");
  saveButton.className = "menu-overlay__button";
  saveButton.type = "button";
  saveButton.textContent = "Save";

  function getMapSelectionPool() {
    return selectionState.useConcentrationField
      ? concentrationFieldInterpolaters
      : mapGenerators;
  }

  function syncSelections() {
    selectionState.concentrationFieldGeneratorKey = ensureGeneratorKey(
      concentrationFieldGenerators,
      selectionState.concentrationFieldGeneratorKey
    );
    selectionState.mapSelectionKey = ensureGeneratorKey(
      getMapSelectionPool(),
      selectionState.mapSelectionKey
    );
    selectionState.mapInterpolatorKey = ensureGeneratorKey(
      mapInterpolaters,
      selectionState.mapInterpolatorKey
    );
  }

  function getSelectedGenerator(key) {
    return generatorsByKey.get(key) ?? null;
  }

  function readInputValues(inputsMap) {
    const values = {};

    for (const [parameterName, input] of inputsMap) {
      values[parameterName] = input.value;
    }

    return values;
  }

  function addSaveKeyBinding(input) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleSave();
      }
    });
  }

  function renderGeneratorParameterFields(target, inputsMap, generator, draftValues = {}) {
    inputsMap.clear();
    target.replaceChildren();

    if (!generator) {
      return;
    }

    for (const parameter of generator.getParameters()) {
      const parameterField = document.createElement("label");
      parameterField.className = "menu-overlay__field";

      const parameterLabel = document.createElement("span");
      parameterLabel.className = "menu-overlay__label";
      parameterLabel.textContent = parameter.label ?? parameter.name;

      let parameterInput;

      if (parameter.valueType === GeneratorValueType.SEED) {
        parameterInput = document.createElement("input");
        parameterInput.className = "menu-overlay__input";
        parameterInput.type = "text";
        parameterInput.value = draftValues[parameter.name] ?? parameter.value ?? "";
      } else {
        const { lower, upper } = parameter.getLimits(normalizeGraphSize(sizeInput.value));

        parameterInput = document.createElement("input");
        parameterInput.className = "menu-overlay__input";
        parameterInput.type = "number";
        parameterInput.min = String(lower);

        const exclusiveInputMax = getExclusiveInputMax(
          parameter.valueType,
          lower,
          upper
        );

        if (exclusiveInputMax !== null) {
          parameterInput.max = exclusiveInputMax;
        }

        parameterInput.step =
          parameter.valueType === GeneratorValueType.INTEGER ? "1" : "0.01";
        parameterInput.value = formatParameterValue(
          parameter.valueType,
          draftValues[parameter.name] ?? parameter.value
        );
      }

      addSaveKeyBinding(parameterInput);

      parameterField.append(parameterLabel, parameterInput);
      target.appendChild(parameterField);
      inputsMap.set(parameter.name, parameterInput);
    }
  }

  function handleSave() {
    const nextSize = normalizeGraphSize(sizeInput.value);
    const concentrationFieldParameterValues = {};
    const mapParameterValues = {};
    const mapInterpolatorParameterValues = {};

    sizeInput.value = String(nextSize);

    for (const [parameterName, input] of concentrationParameterInputs) {
      concentrationFieldParameterValues[parameterName] = input.value;
    }

    for (const [parameterName, input] of mapParameterInputs) {
      mapParameterValues[parameterName] = input.value;
    }

    for (const [parameterName, input] of mapInterpolatorParameterInputs) {
      mapInterpolatorParameterValues[parameterName] = input.value;
    }

    onSave({
      size: nextSize,
      useConcentrationField: selectionState.useConcentrationField,
      invert: selectionState.invert,
      useMapInterpolator: selectionState.useMapInterpolator,
      concentrationFieldGeneratorKey: selectionState.concentrationFieldGeneratorKey,
      mapSelectionKey: selectionState.mapSelectionKey,
      mapInterpolatorKey: selectionState.mapInterpolatorKey,
      concentrationFieldParameterValues,
      mapParameterValues,
      mapInterpolatorParameterValues
    });

    renderControls();
  }

  function renderMapSelectOptions() {
    const selectedKey = selectionState.mapSelectionKey;
    mapSelect.replaceChildren();

    for (const generator of getMapSelectionPool()) {
      const option = document.createElement("option");
      option.value = generator.getKey();
      option.textContent = generator.getLabel();
      mapSelect.appendChild(option);
    }

    mapSelect.value = ensureGeneratorKey(getMapSelectionPool(), selectedKey);
  }

  function renderControls() {
    const concentrationDraftValues = readInputValues(concentrationParameterInputs);
    const mapDraftValues = readInputValues(mapParameterInputs);
    const mapInterpolatorDraftValues = readInputValues(
      mapInterpolatorParameterInputs
    );

    syncSelections();

    concentrationSelect.value = selectionState.concentrationFieldGeneratorKey;
    mapInterpolatorSelect.value = selectionState.mapInterpolatorKey;
    renderMapSelectOptions();

    concentrationSection.classList.toggle(
      "menu-overlay__section--hidden",
      !selectionState.useConcentrationField
    );
    mapInterpolatorSection.classList.toggle(
      "menu-overlay__section--hidden",
      !selectionState.useMapInterpolator
    );

    renderGeneratorParameterFields(
      concentrationParameterFields,
      concentrationParameterInputs,
      selectionState.useConcentrationField
        ? getSelectedGenerator(selectionState.concentrationFieldGeneratorKey)
        : null,
      concentrationDraftValues
    );
    renderGeneratorParameterFields(
      mapParameterFields,
      mapParameterInputs,
      getSelectedGenerator(selectionState.mapSelectionKey),
      mapDraftValues
    );
    renderGeneratorParameterFields(
      mapInterpolatorParameterFields,
      mapInterpolatorParameterInputs,
      selectionState.useMapInterpolator
        ? getSelectedGenerator(selectionState.mapInterpolatorKey)
        : null,
      mapInterpolatorDraftValues
    );

    useConcentrationToggle.input.checked = selectionState.useConcentrationField;
    invertToggle.input.checked = selectionState.invert;
    useMapInterpolatorToggle.input.checked = selectionState.useMapInterpolator;
  }

  concentrationSelect.addEventListener("change", () => {
    selectionState.concentrationFieldGeneratorKey = concentrationSelect.value;
    renderControls();
  });

  mapSelect.addEventListener("change", () => {
    selectionState.mapSelectionKey = mapSelect.value;
    renderControls();
  });

  mapInterpolatorSelect.addEventListener("change", () => {
    selectionState.mapInterpolatorKey = mapInterpolatorSelect.value;
    renderControls();
  });

  useConcentrationToggle.input.addEventListener("change", () => {
    selectionState.useConcentrationField = useConcentrationToggle.input.checked;
    renderControls();
  });

  invertToggle.input.addEventListener("change", () => {
    selectionState.invert = invertToggle.input.checked;
  });

  useMapInterpolatorToggle.input.addEventListener("change", () => {
    selectionState.useMapInterpolator = useMapInterpolatorToggle.input.checked;
    renderControls();
  });

  sizeInput.addEventListener("change", () => {
    renderControls();
  });

  sizeInput.addEventListener("input", () => {
    renderControls();
  });
  addSaveKeyBinding(sizeInput);
  saveButton.addEventListener("click", handleSave);

  mapControlsRow.append(mapField, mapParameterFields);
  mapSection.append(mapTitle, mapControlsRow);

  concentrationControlsRow.append(concentrationField, concentrationParameterFields);
  concentrationSection.append(concentrationTitle, concentrationControlsRow);

  mapInterpolatorControlsRow.append(
    mapInterpolatorField,
    mapInterpolatorParameterFields
  );
  mapInterpolatorSection.append(
    mapInterpolatorTitle,
    mapInterpolatorControlsRow
  );

  overlay.append(
    sizeField,
    useConcentrationToggle.row,
    concentrationSection,
    invertToggle.row,
    mapSection,
    useMapInterpolatorToggle.row,
    mapInterpolatorSection,
    saveButton
  );
  root.appendChild(overlay);
  renderControls();

  return {
    overlay,
    sizeInput,
    update(layout, visible) {
      overlay.style.left = `${layout.menuX}px`;
      overlay.style.top = `${layout.menuY}px`;
      overlay.style.width = `${layout.menuWidth}px`;
      overlay.style.height = `${layout.menuHeight}px`;
      overlay.style.opacity = String(layout.menuAlpha);
      overlay.classList.toggle("menu-overlay--hidden", !visible);
    }
  };
}

async function init() {
  const app = new Application();

  await app.init({
    antialias: true,
    background: "#0f172a",
    resizeTo: window
  });

  const appRoot = document.querySelector("#app");
  appRoot.appendChild(app.canvas);
  const generators = createSelectableGenerators();
  const concentrationFieldGenerators = getGeneratorsByType(
    generators,
    ConcentrationFieldGenerator
  );
  const concentrationFieldInterpolaters = getGeneratorsByType(
    generators,
    ConcentrationFieldInterpolater
  );
  const mapGenerators = getGeneratorsByType(generators, MapGenerator);
  const mapInterpolaters = getGeneratorsByType(generators, MapInterpolater);
  const selectionState = {
    useConcentrationField: false,
    invert: false,
    useMapInterpolator: false,
    concentrationFieldGeneratorKey: concentrationFieldGenerators[0]?.getKey() ?? "",
    mapSelectionKey: mapGenerators[0]?.getKey() ?? "",
    mapInterpolatorKey: mapInterpolaters[0]?.getKey() ?? ""
  };

  const generatorsByKey = new Map(
    generators.map((generator) => [generator.getKey(), generator])
  );

  let graph = buildDisplayGraph({
    size: DEFAULT_GRAPH_SIZE,
    useConcentrationField: selectionState.useConcentrationField,
    invert: selectionState.invert,
    useMapInterpolator: selectionState.useMapInterpolator,
    concentrationFieldGenerator: generatorsByKey.get(
      selectionState.concentrationFieldGeneratorKey
    ),
    mapSelectionGenerator: generatorsByKey.get(selectionState.mapSelectionKey),
    mapInterpolatorGenerator: generatorsByKey.get(selectionState.mapInterpolatorKey)
  });
  let graphDirty = true;

  const playArea = new Container();
  const playBackground = new Graphics();
  const graphLayer = new Graphics();
  const playFrame = new Graphics();
  const menuArea = new Container();
  const menuBackground = new Graphics();

  app.stage.addChild(playArea, menuArea);
  playArea.addChild(playBackground, graphLayer, playFrame);
  menuArea.addChild(menuBackground);

  const menuOverlay = createMenuOverlay(
    appRoot,
    graph.size,
    generators,
    selectionState,
    ({
      size,
      useConcentrationField,
      invert,
      useMapInterpolator,
      concentrationFieldGeneratorKey,
      mapSelectionKey,
      mapInterpolatorKey,
      concentrationFieldParameterValues,
      mapParameterValues,
      mapInterpolatorParameterValues
    }) => {
      selectionState.useConcentrationField = useConcentrationField;
      selectionState.invert = invert;
      selectionState.useMapInterpolator = useMapInterpolator;
      selectionState.concentrationFieldGeneratorKey = concentrationFieldGeneratorKey;
      selectionState.mapSelectionKey = mapSelectionKey;
      selectionState.mapInterpolatorKey = mapInterpolatorKey;

      const concentrationFieldGenerator = generatorsByKey.get(
        concentrationFieldGeneratorKey
      );
      const mapSelectionGenerator = generatorsByKey.get(mapSelectionKey);
      const mapInterpolatorGenerator = generatorsByKey.get(mapInterpolatorKey);

      concentrationFieldGenerator?.setParameterValues(
        concentrationFieldParameterValues,
        size
      );
      mapSelectionGenerator?.setParameterValues(mapParameterValues, size);
      mapInterpolatorGenerator?.setParameterValues(
        mapInterpolatorParameterValues,
        size
      );

      graph = buildDisplayGraph({
        size,
        useConcentrationField,
        invert,
        useMapInterpolator,
        concentrationFieldGenerator,
        mapSelectionGenerator,
        mapInterpolatorGenerator
      });

      graphDirty = true;
    }
  );

  function computeLayout() {
    const screenWidth = app.screen.width;
    const screenHeight = app.screen.height;
    const padding = clamp(Math.min(screenWidth, screenHeight) * 0.04, 20, 36);
    const minMenuWidth = clamp(screenWidth * 0.28, 160, 300);
    const openSquareSize = clamp(
      Math.min(screenHeight - padding * 2, screenWidth - padding * 3 - minMenuWidth),
      96,
      screenHeight - padding * 2
    );
    const squareX = padding;
    const squareY = (screenHeight - openSquareSize) / 2;
    const menuX = squareX + openSquareSize + padding;
    const menuWidth = Math.max(160, screenWidth - menuX - padding);

    return {
      squareX,
      squareY,
      squareSize: openSquareSize,
      menuX,
      menuY: padding,
      menuWidth,
      menuHeight: screenHeight - padding * 2,
      menuAlpha: 1,
      padding
    };
  }

  function drawGraph(squareSize) {
    graphLayer.clear();

    const tileSize = squareSize / graph.size;

    graph.forEachTile((tile) => {
      graphLayer
        .rect(tile.x * tileSize, tile.y * tileSize, tileSize, tileSize)
        .fill(tile.value === 1 ? 0xffffff : 0x000000);
    });
  }

  function renderLayout(layout) {
    playArea.position.set(layout.squareX, layout.squareY);

    playBackground
      .clear()
      .rect(0, 0, layout.squareSize, layout.squareSize)
      .fill(0x000000);

    drawGraph(layout.squareSize);

    playFrame
      .clear()
      .rect(0, 0, layout.squareSize, layout.squareSize)
      .stroke({ width: 2, color: 0x334155, alpha: 1 });

    menuArea.visible = true;
    menuArea.alpha = layout.menuAlpha;
    menuArea.position.set(layout.menuX, layout.menuY);
    menuOverlay.update(layout, true);

    menuBackground
      .clear()
      .roundRect(0, 0, layout.menuWidth, layout.menuHeight, 30)
      .fill({ color: 0x111827, alpha: 0.94 })
      .stroke({ width: 2, color: 0x334155, alpha: 1 });
  }

  const targetLayout = computeLayout();
  const currentLayout = { ...targetLayout };

  function setTargetLayout() {
    Object.assign(targetLayout, computeLayout());
  }

  app.ticker.add((ticker) => {
    const easing = 1 - Math.pow(0.82, ticker.deltaTime);
    let layoutDirty = graphDirty;

    for (const key of Object.keys(targetLayout)) {
      const delta = targetLayout[key] - currentLayout[key];

      if (Math.abs(delta) < 0.1) {
        if (currentLayout[key] !== targetLayout[key]) {
          currentLayout[key] = targetLayout[key];
          layoutDirty = true;
        }
        continue;
      }

      currentLayout[key] += delta * easing;
      layoutDirty = true;
    }

    if (!layoutDirty) {
      return;
    }

    renderLayout(currentLayout);
    graphDirty = false;
  });

  window.addEventListener("resize", () => {
    setTargetLayout();
  });

  renderLayout(currentLayout);
  graphDirty = false;
}

init();
