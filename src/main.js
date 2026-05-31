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
const MAX_MAP_INTERPOLATORS = 3;

function createRandomSeed() {
  if (globalThis.crypto?.getRandomValues) {
    return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  }

  return Math.floor(Math.random() * 0x100000000);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function cloneParameterValues(values = {}) {
  return { ...values };
}

function cloneMapInterpolatorSelection(selection = {}) {
  return {
    key: selection.key ?? "",
    parameterValues: cloneParameterValues(selection.parameterValues)
  };
}

function normalizeMapInterpolatorSelections(selections) {
  if (!Array.isArray(selections)) {
    return [];
  }

  return selections
    .slice(0, MAX_MAP_INTERPOLATORS)
    .map((selection) => cloneMapInterpolatorSelection(selection));
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
  if (typeof value === "string") {
    return value;
  }

  if (valueType === GeneratorValueType.SEED) {
    return value ?? "";
  }

  if (value === undefined || value === null || !Number.isFinite(value)) {
    return "";
  }

  if (valueType === GeneratorValueType.INTEGER) {
    return String(value);
  }

  return Number(value.toFixed(6)).toString();
}

function resolveGraphFromGenerator(generator, size, seed) {
  const generatedGraph =
    typeof generator?.generateMap === "function"
      ? generator.generateMap(size, seed)
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

function resolveConcentrationFieldGraph(generator, size, seed) {
  const generatedGraph =
    typeof generator?.generateConcentrationField === "function"
      ? generator.generateConcentrationField(size, seed)
      : null;

  if (isGraph(generatedGraph)) {
    return generatedGraph;
  }

  return new Graph(size);
}

function resolveInterpolatedMapFromConcentrationField(
  generator,
  concentrationField,
  seed
) {
  const generatedGraph =
    typeof generator?.interpolateConcentrationField === "function"
      ? generator.interpolateConcentrationField(concentrationField, seed)
      : null;

  if (isGraph(generatedGraph)) {
    return generatedGraph;
  }

  return new Graph(concentrationField.size);
}

function resolveInterpolatedMap(generator, sourceMap, seed) {
  const generatedGraph =
    typeof generator?.interpolateMap === "function"
      ? generator.interpolateMap(sourceMap, seed)
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
  seed,
  useConcentrationField,
  invert,
  concentrationFieldGenerator,
  mapSelectionGenerator,
  mapInterpolatorSelections = []
}) {
  const runSeed = seed === "" ? createRandomSeed() : seed;
  let map;

  if (useConcentrationField) {
    const concentrationField = resolveConcentrationFieldGraph(
      concentrationFieldGenerator,
      size,
      runSeed
    );

    if (invert) {
      invertConcentrationField(concentrationField);
    }

    map = resolveInterpolatedMapFromConcentrationField(
      mapSelectionGenerator,
      concentrationField,
      runSeed
    );
  } else {
    map = resolveGraphFromGenerator(mapSelectionGenerator, size, runSeed);
  }

  let currentMap = map;

  for (const selection of mapInterpolatorSelections) {
    const generator = selection?.generator ?? null;

    if (!generator) {
      continue;
    }

    generator.setParameterValues(
      selection.parameterValues ?? {},
      currentMap.size,
      MapInterpolater
    );
    currentMap = resolveInterpolatedMap(generator, currentMap, runSeed);
  }

  return currentMap;
}

function getGeneratorsByType(generators, type) {
  return generators.filter((generator) =>
    generator.getImplementedTypes().includes(type)
  );
}

function getMapSelectionType(useConcentrationField) {
  return useConcentrationField
    ? ConcentrationFieldInterpolater
    : MapGenerator;
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
    ...initialSelection,
    mapInterpolatorSelections: normalizeMapInterpolatorSelections(
      initialSelection.mapInterpolatorSelections
    )
  };
  const topRow = document.createElement("div");
  topRow.className = "menu-overlay__top-row";
  const bodySection = document.createElement("div");
  bodySection.className = "menu-overlay__body";

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

  const seedField = document.createElement("label");
  seedField.className = "menu-overlay__field";

  const seedFieldLabel = document.createElement("span");
  seedFieldLabel.className = "menu-overlay__label";
  seedFieldLabel.textContent = "Seed";

  const seedInput = document.createElement("input");
  seedInput.className = "menu-overlay__input";
  seedInput.type = "text";
  seedInput.value = selectionState.seed ?? "";

  sizeField.append(sizeFieldLabel, sizeInput);
  seedField.append(seedFieldLabel, seedInput);
  topRow.append(sizeField, seedField);

  const useConcentrationToggle = createToggleRow(
    "Use Concentration Field",
    selectionState.useConcentrationField
  );
  const invertToggle = createToggleRow("Invert", selectionState.invert);

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

  const mapInterpolatorHeader = document.createElement("div");
  mapInterpolatorHeader.className = "menu-overlay__section-header";

  const mapInterpolatorTitle = document.createElement("div");
  mapInterpolatorTitle.className = "menu-overlay__section-title";
  mapInterpolatorTitle.textContent = "Map Interpolater";

  const addMapInterpolatorButton = document.createElement("button");
  addMapInterpolatorButton.className = "menu-overlay__icon-button";
  addMapInterpolatorButton.type = "button";
  addMapInterpolatorButton.textContent = "+";
  addMapInterpolatorButton.ariaLabel = "Add map interpolater";

  mapInterpolatorHeader.append(
    mapInterpolatorTitle,
    addMapInterpolatorButton
  );

  const mapInterpolatorList = document.createElement("div");
  mapInterpolatorList.className = "menu-overlay__interpolator-list";
  let mapInterpolatorRenderState = [];
  const saveButton = document.createElement("button");
  saveButton.className = "menu-overlay__button";
  saveButton.type = "button";
  saveButton.textContent = "Save";

  function getMapSelectionPool() {
    return selectionState.useConcentrationField
      ? concentrationFieldInterpolaters
      : mapGenerators;
  }

  function createMapInterpolatorSelection(key = mapInterpolaters[0]?.getKey() ?? "") {
    return {
      key,
      parameterValues: {}
    };
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
    selectionState.mapInterpolatorSelections = selectionState.mapInterpolatorSelections
      .slice(0, MAX_MAP_INTERPOLATORS)
      .map((selection) => ({
        key: ensureGeneratorKey(mapInterpolaters, selection.key),
        parameterValues: cloneParameterValues(selection.parameterValues)
      }));
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

  function renderGeneratorParameterFields(
    target,
    inputsMap,
    generator,
    implementedType,
    draftValues = {}
  ) {
    inputsMap.clear();
    target.replaceChildren();

    if (!generator) {
      return;
    }

    for (const parameter of generator.getParameters(implementedType)) {
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

  function syncMapInterpolatorDraftValues() {
    selectionState.mapInterpolatorSelections = selectionState.mapInterpolatorSelections.map(
      (selection, index) => {
        const renderedSection = mapInterpolatorRenderState[index];

        if (!renderedSection) {
          return selection;
        }

        return {
          key: renderedSection.select.value,
          parameterValues: readInputValues(renderedSection.inputsMap)
        };
      }
    );
  }

  function renderMapInterpolatorSections() {
    syncMapInterpolatorDraftValues();
    mapInterpolatorRenderState = [];
    mapInterpolatorList.replaceChildren();

    selectionState.mapInterpolatorSelections.forEach((selection, index) => {
      const item = document.createElement("div");
      item.className = "menu-overlay__interpolator-item";

      const removeButton = document.createElement("button");
      removeButton.className = "menu-overlay__icon-button";
      removeButton.type = "button";
      removeButton.textContent = "X";
      removeButton.ariaLabel = `Remove map interpolater ${index + 1}`;
      removeButton.addEventListener("click", () => {
        syncMapInterpolatorDraftValues();
        selectionState.mapInterpolatorSelections.splice(index, 1);
        renderControls();
      });

      const controlsRow = document.createElement("div");
      controlsRow.className = "menu-overlay__controls";

      const field = document.createElement("label");
      field.className = "menu-overlay__field";

      const fieldLabel = document.createElement("span");
      fieldLabel.className = "menu-overlay__label";
      fieldLabel.textContent = "Method";

      const select = document.createElement("select");
      select.className = "menu-overlay__select";

      for (const generator of mapInterpolaters) {
        const option = document.createElement("option");
        option.value = generator.getKey();
        option.textContent = generator.getLabel();
        select.appendChild(option);
      }

      select.value = ensureGeneratorKey(mapInterpolaters, selection.key);
      select.addEventListener("change", () => {
        syncMapInterpolatorDraftValues();
        selectionState.mapInterpolatorSelections[index].key = select.value;
        renderControls();
      });

      field.append(fieldLabel, select);

      const parameterFields = document.createElement("div");
      parameterFields.className = "menu-overlay__parameters";
      const parameterInputs = new Map();

      const removeField = document.createElement("div");
      removeField.className = "menu-overlay__field menu-overlay__field--icon";

      const removeFieldSpacer = document.createElement("span");
      removeFieldSpacer.className = "menu-overlay__label menu-overlay__label--spacer";
      removeFieldSpacer.setAttribute("aria-hidden", "true");
      removeFieldSpacer.textContent = "Remove";

      removeField.append(removeFieldSpacer, removeButton);

      renderGeneratorParameterFields(
        parameterFields,
        parameterInputs,
        getSelectedGenerator(select.value),
        MapInterpolater,
        selection.parameterValues
      );

      controlsRow.append(field, parameterFields, removeField);
      item.append(controlsRow);
      mapInterpolatorList.appendChild(item);
      mapInterpolatorRenderState.push({
        select,
        inputsMap: parameterInputs
      });
    });

    addMapInterpolatorButton.disabled =
      selectionState.mapInterpolatorSelections.length >= MAX_MAP_INTERPOLATORS;
  }

  function handleSave() {
    const nextSize = normalizeGraphSize(sizeInput.value);
    const concentrationFieldParameterValues = {};
    const mapParameterValues = {};
    syncMapInterpolatorDraftValues();

    sizeInput.value = String(nextSize);

    for (const [parameterName, input] of concentrationParameterInputs) {
      concentrationFieldParameterValues[parameterName] = input.value;
    }

    for (const [parameterName, input] of mapParameterInputs) {
      mapParameterValues[parameterName] = input.value;
    }

    onSave({
      size: nextSize,
      seed: seedInput.value,
      useConcentrationField: selectionState.useConcentrationField,
      invert: selectionState.invert,
      concentrationFieldGeneratorKey: selectionState.concentrationFieldGeneratorKey,
      mapSelectionKey: selectionState.mapSelectionKey,
      mapInterpolatorSelections: selectionState.mapInterpolatorSelections.map(
        (selection) => ({
          key: selection.key,
          parameterValues: cloneParameterValues(selection.parameterValues)
        })
      ),
      concentrationFieldParameterValues,
      mapParameterValues
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
    syncMapInterpolatorDraftValues();
    const mapSelectionType = getMapSelectionType(
      selectionState.useConcentrationField
    );

    syncSelections();

    concentrationSelect.value = selectionState.concentrationFieldGeneratorKey;
    renderMapSelectOptions();

    concentrationSection.classList.toggle(
      "menu-overlay__section--hidden",
      !selectionState.useConcentrationField
    );

    renderGeneratorParameterFields(
      concentrationParameterFields,
      concentrationParameterInputs,
      selectionState.useConcentrationField
        ? getSelectedGenerator(selectionState.concentrationFieldGeneratorKey)
        : null,
      ConcentrationFieldGenerator,
      concentrationDraftValues
    );
    renderGeneratorParameterFields(
      mapParameterFields,
      mapParameterInputs,
      getSelectedGenerator(selectionState.mapSelectionKey),
      mapSelectionType,
      mapDraftValues
    );
    renderMapInterpolatorSections();

    useConcentrationToggle.input.checked = selectionState.useConcentrationField;
    invertToggle.input.checked = selectionState.invert;
  }

  concentrationSelect.addEventListener("change", () => {
    selectionState.concentrationFieldGeneratorKey = concentrationSelect.value;
    renderControls();
  });

  mapSelect.addEventListener("change", () => {
    selectionState.mapSelectionKey = mapSelect.value;
    renderControls();
  });

  useConcentrationToggle.input.addEventListener("change", () => {
    selectionState.useConcentrationField = useConcentrationToggle.input.checked;
    renderControls();
  });

  invertToggle.input.addEventListener("change", () => {
    selectionState.invert = invertToggle.input.checked;
  });

  addMapInterpolatorButton.addEventListener("click", () => {
    syncMapInterpolatorDraftValues();

    if (selectionState.mapInterpolatorSelections.length >= MAX_MAP_INTERPOLATORS) {
      return;
    }

    selectionState.mapInterpolatorSelections.push(createMapInterpolatorSelection());
    renderControls();
  });

  sizeInput.addEventListener("change", () => {
    renderControls();
  });

  sizeInput.addEventListener("input", () => {
    renderControls();
  });
  addSaveKeyBinding(sizeInput);
  addSaveKeyBinding(seedInput);
  saveButton.addEventListener("click", handleSave);

  mapControlsRow.append(mapField, mapParameterFields);
  mapSection.append(mapTitle, mapControlsRow);

  concentrationControlsRow.append(concentrationField, concentrationParameterFields);
  concentrationSection.append(concentrationTitle, concentrationControlsRow);

  mapInterpolatorSection.append(mapInterpolatorHeader, mapInterpolatorList);

  bodySection.append(
    useConcentrationToggle.row,
    concentrationSection,
    invertToggle.row,
    mapSection,
    mapInterpolatorSection
  );

  overlay.append(topRow, bodySection, saveButton);
  root.appendChild(overlay);
  renderControls();

  return {
    overlay,
    sizeInput,
    update(layout) {
      overlay.style.left = `${layout.menuX}px`;
      overlay.style.top = `${layout.menuY}px`;
      overlay.style.width = `${layout.menuWidth}px`;
      overlay.style.height = `${layout.menuHeight}px`;
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
  const selectionState = {
    seed: "",
    useConcentrationField: false,
    invert: false,
    concentrationFieldGeneratorKey: concentrationFieldGenerators[0]?.getKey() ?? "",
    mapSelectionKey: mapGenerators[0]?.getKey() ?? "",
    mapInterpolatorSelections: []
  };

  const generatorsByKey = new Map(
    generators.map((generator) => [generator.getKey(), generator])
  );

  let graph = buildDisplayGraph({
    size: DEFAULT_GRAPH_SIZE,
    seed: selectionState.seed,
    useConcentrationField: selectionState.useConcentrationField,
    invert: selectionState.invert,
    concentrationFieldGenerator: generatorsByKey.get(
      selectionState.concentrationFieldGeneratorKey
    ),
    mapSelectionGenerator: generatorsByKey.get(selectionState.mapSelectionKey),
    mapInterpolatorSelections: []
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
      seed,
      useConcentrationField,
      invert,
      concentrationFieldGeneratorKey,
      mapSelectionKey,
      mapInterpolatorSelections,
      concentrationFieldParameterValues,
      mapParameterValues
    }) => {
      selectionState.seed = seed;
      selectionState.useConcentrationField = useConcentrationField;
      selectionState.invert = invert;
      selectionState.concentrationFieldGeneratorKey = concentrationFieldGeneratorKey;
      selectionState.mapSelectionKey = mapSelectionKey;
      selectionState.mapInterpolatorSelections = normalizeMapInterpolatorSelections(
        mapInterpolatorSelections
      );

      const concentrationFieldGenerator = generatorsByKey.get(
        concentrationFieldGeneratorKey
      );
      const mapSelectionGenerator = generatorsByKey.get(mapSelectionKey);
      const resolvedMapInterpolatorSelections =
        selectionState.mapInterpolatorSelections.map((selection) => ({
          generator: generatorsByKey.get(selection.key),
          parameterValues: cloneParameterValues(selection.parameterValues)
        }));

      concentrationFieldGenerator?.setParameterValues(
        concentrationFieldParameterValues,
        size,
        ConcentrationFieldGenerator
      );
      mapSelectionGenerator?.setParameterValues(
        mapParameterValues,
        size,
        getMapSelectionType(useConcentrationField)
      );

      graph = buildDisplayGraph({
        size,
        seed,
        useConcentrationField,
        invert,
        concentrationFieldGenerator,
        mapSelectionGenerator,
        mapInterpolatorSelections: resolvedMapInterpolatorSelections
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
    menuArea.position.set(layout.menuX, layout.menuY);
    menuOverlay.update(layout);

    menuBackground
      .clear()
      .roundRect(0, 0, layout.menuWidth, layout.menuHeight, 30)
      .fill({ color: 0x111827, alpha: 0.94 })
      .stroke({ width: 2, color: 0x334155, alpha: 1 });
  }

  let currentLayout = computeLayout();

  function refreshLayout() {
    currentLayout = computeLayout();
    renderLayout(currentLayout);
    graphDirty = false;
  }

  app.ticker.add(() => {
    if (!graphDirty) {
      return;
    }

    renderLayout(currentLayout);
    graphDirty = false;
  });

  window.addEventListener("resize", () => {
    refreshLayout();
  });

  refreshLayout();
}

init();
