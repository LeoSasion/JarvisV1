import assert from "node:assert/strict";
import test from "node:test";
import {
  getReducedMotionSnapshot,
  resolveReducedMotion,
  subscribeReducedMotion,
} from "../src/motion-preference.js";
import {
  resetInterfacePreferences,
  setInterfacePreferences,
} from "../src/interface-preferences.js";

test("motion preference resolves SYSTEM, REDUCED, and FULL deterministically", () => {
  assert.equal(resolveReducedMotion("system", false), false);
  assert.equal(resolveReducedMotion("system", true), true);
  assert.equal(resolveReducedMotion("reduced", false), true);
  assert.equal(resolveReducedMotion("reduced", true), true);
  assert.equal(resolveReducedMotion("full", false), false);
  assert.equal(resolveReducedMotion("full", true), false);
  assert.equal(resolveReducedMotion("unknown", true), true);
});

test("resolved motion subscribers receive local and Windows preference changes", () => {
  const systemListeners = new Set();
  let systemReduced = true;
  const media = {
    get matches() {
      return systemReduced;
    },
    addEventListener: (type, listener) => {
      if (type === "change") systemListeners.add(listener);
    },
    removeEventListener: (type, listener) => {
      if (type === "change") systemListeners.delete(listener);
    },
  };
  global.window = { matchMedia: () => media };

  resetInterfacePreferences();
  let notifications = 0;
  const unsubscribe = subscribeReducedMotion(() => {
    notifications += 1;
  });

  assert.equal(getReducedMotionSnapshot(), true);
  setInterfacePreferences({ motion: "full" });
  assert.equal(getReducedMotionSnapshot(), false);
  assert.equal(notifications, 1);

  systemReduced = false;
  systemListeners.forEach((listener) => listener({ matches: false }));
  assert.equal(notifications, 2);
  assert.equal(getReducedMotionSnapshot(), false);

  setInterfacePreferences({ motion: "reduced" });
  assert.equal(getReducedMotionSnapshot(), true);
  assert.equal(notifications, 3);

  unsubscribe();
  assert.equal(systemListeners.size, 0);
  resetInterfacePreferences();
  delete global.window;
});

test("motion subscribers share one Windows media-query listener", () => {
  const systemListeners = new Set();
  let matchMediaCalls = 0;
  const media = {
    matches: false,
    addEventListener: (type, listener) => {
      if (type === "change") systemListeners.add(listener);
    },
    removeEventListener: (type, listener) => {
      if (type === "change") systemListeners.delete(listener);
    },
  };
  global.window = {
    matchMedia: () => {
      matchMediaCalls += 1;
      return media;
    },
  };

  const first = subscribeReducedMotion(() => {});
  const second = subscribeReducedMotion(() => {});
  assert.equal(matchMediaCalls, 1);
  assert.equal(systemListeners.size, 1);

  first();
  assert.equal(systemListeners.size, 1);
  second();
  assert.equal(systemListeners.size, 0);
  delete global.window;
});
