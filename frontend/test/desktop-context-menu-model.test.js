import assert from "node:assert/strict";
import test from "node:test";
import {
  getDesktopContextMenuPosition,
  getDesktopFallbackPosition,
  getDesktopIconMetrics,
  snapDesktopPosition,
  sortDesktopEntries,
} from "../src/desktop-layout.js";

const entries = [
  {
    id: "z",
    label: "Zeta 10",
    kind: "file",
    extension: ".txt",
    source: "public",
  },
  {
    id: "a",
    label: "Alpha",
    kind: "directory",
    extension: "",
    source: "user",
  },
  {
    id: "b",
    label: "Zeta 2",
    kind: "file",
    extension: ".lnk",
    source: "user",
  },
];

test("desktop icon metrics preserve the current medium layout and support view sizes", () => {
  assert.deepEqual(getDesktopIconMetrics("medium"), {
    cellWidth: 96,
    cellHeight: 88,
    iconSize: 44,
    labelSize: 13,
  });
  assert.equal(getDesktopIconMetrics("small").cellWidth, 80);
  assert.equal(getDesktopIconMetrics("large").iconSize, 58);
  assert.deepEqual(
    getDesktopFallbackPosition(4, 300, getDesktopIconMetrics("large")),
    { x: 258, y: 18 },
  );
});

test("desktop sorting is stable by intent and never mutates source entries", () => {
  assert.equal(sortDesktopEntries(entries, "none"), entries);
  assert.deepEqual(sortDesktopEntries(entries, "name").map(({ id }) => id), ["a", "b", "z"]);
  assert.deepEqual(sortDesktopEntries(entries, "type").map(({ id }) => id), ["a", "b", "z"]);
  assert.deepEqual(sortDesktopEntries(entries, "source").map(({ id }) => id), ["z", "a", "b"]);
  assert.deepEqual(entries.map(({ id }) => id), ["z", "a", "b"]);
});

test("manual desktop positions snap to the selected grid and remain on screen", () => {
  const metrics = getDesktopIconMetrics("medium");
  assert.deepEqual(
    snapDesktopPosition({ x: 61, y: 124 }, metrics, { width: 500, height: 400 }),
    { x: 18, y: 106 },
  );
  assert.deepEqual(
    snapDesktopPosition({ x: 490, y: 390 }, metrics, { width: 500, height: 400 }),
    { x: 404, y: 312 },
  );
});

test("context menus stay inside the viewport and submenus flip near the right edge", () => {
  assert.deepEqual(getDesktopContextMenuPosition({
    clientX: 20,
    clientY: 20,
    viewportWidth: 1280,
    viewportHeight: 720,
    kind: "desktop",
  }), {
    x: 20,
    y: 20,
    submenuSide: "right",
  });
  assert.deepEqual(getDesktopContextMenuPosition({
    clientX: 1260,
    clientY: 710,
    viewportWidth: 1280,
    viewportHeight: 720,
    kind: "desktop",
  }), {
    x: 1024,
    y: 386,
    submenuSide: "left",
  });
  assert.equal(getDesktopContextMenuPosition({
    clientX: 1260,
    clientY: 710,
    viewportWidth: 1280,
    viewportHeight: 720,
    kind: "item",
  }).y, 486);
});
