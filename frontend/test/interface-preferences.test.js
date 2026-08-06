import assert from "node:assert/strict";
import test from "node:test";
import {
  getInterfacePreferencesSnapshot,
  getEmissionVariables,
  normalizeInterfacePreferences,
  resetInterfacePreferences,
  setInterfacePreferences,
} from "../src/interface-preferences.js";

test("interface preferences fail closed to versioned accessible defaults", () => {
  assert.deepEqual(normalizeInterfacePreferences(null), {
    version: 1,
    motion: "system",
    emission: "standard",
  });
  assert.deepEqual(normalizeInterfacePreferences({
    version: 9,
    motion: "spin",
    emission: "laser",
  }), {
    version: 1,
    motion: "system",
    emission: "standard",
  });
});

test("motion and emission accept only the bounded product choices", () => {
  assert.deepEqual(normalizeInterfacePreferences({
    motion: "reduced",
    emission: "minimal",
  }), {
    version: 1,
    motion: "reduced",
    emission: "minimal",
  });
});

test("emission profiles preserve line color while scaling halo and bloom alpha", () => {
  const theme = {
    "--glow-halo": "rgba(255, 90, 0, 0.34)",
    "--glow-bloom": "rgba(255, 90, 0, 0.12)",
  };
  assert.deepEqual(getEmissionVariables(theme, "standard"), theme);
  assert.deepEqual(getEmissionVariables(theme, "minimal"), {
    "--glow-halo": "rgba(255, 90, 0, 0.082)",
    "--glow-bloom": "rgba(255, 90, 0, 0.010)",
  });
});

test("interface reset changes only the bounded local preference schema", () => {
  const writes = [];
  const properties = new Map();
  global.window = {
    localStorage: {
      setItem: (key, value) => writes.push([key, value]),
    },
  };
  global.document = {
    documentElement: {
      dataset: {},
      style: {
        setProperty: (name, value) => properties.set(name, value),
      },
    },
  };

  setInterfacePreferences({ motion: "reduced", emission: "minimal" });
  assert.equal(getInterfacePreferencesSnapshot().motion, "reduced");
  assert.equal(global.document.documentElement.dataset.emission, "minimal");
  resetInterfacePreferences();
  assert.deepEqual(getInterfacePreferencesSnapshot(), {
    version: 1,
    motion: "system",
    emission: "standard",
  });
  assert.match(writes.at(-1)[1], /"motion":"system"/);
  assert.equal(properties.get("--glow-halo"), "rgba(255, 90, 0, 0.34)");

  delete global.window;
  delete global.document;
});
