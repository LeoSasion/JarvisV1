import assert from "node:assert/strict";
import test from "node:test";
import {
  getTaskbarCapacity,
  getTaskbarLayoutPlan,
} from "../src/taskbar-layout-model.js";

test("taskbar capacity follows the active visual slot width", () => {
  assert.equal(getTaskbarCapacity(584, 116), 5);
  assert.equal(getTaskbarCapacity(284, 52), 5);
  assert.equal(getTaskbarCapacity(416, 52), 8);
});

test("taskbar capacity fails safe for invalid measurements", () => {
  assert.equal(getTaskbarCapacity(0, 0), 5);
  assert.equal(getTaskbarCapacity(Number.NaN, Number.NaN), 5);
});

test("taskbar planner keeps every complete label when intrinsic widths fit", () => {
  const plan = getTaskbarLayoutPlan([
    { id: "explorer", fullWidth: 118, canUseIconOnly: true },
    { id: "terminal", fullWidth: 104, canUseIconOnly: true },
    { id: "generic", fullWidth: 156, canUseIconOnly: false },
  ], 378);

  assert.equal(plan.mode, "full");
  assert.deepEqual(plan.visible.map(({ id, density }) => [id, density]), [
    ["explorer", "full"],
    ["terminal", "full"],
    ["generic", "full"],
  ]);
  assert.deepEqual(plan.overflowIds, []);
});

test("taskbar planner compacts only recognizable icons", () => {
  const plan = getTaskbarLayoutPlan([
    { id: "explorer", fullWidth: 118, canUseIconOnly: true },
    { id: "generic", fullWidth: 156, canUseIconOnly: false },
    { id: "terminal", fullWidth: 104, canUseIconOnly: true },
  ], 252);

  assert.equal(plan.mode, "mixed");
  assert.deepEqual(plan.visible.map(({ id, density, width }) => [id, density, width]), [
    ["explorer", "icon", 48],
    ["generic", "full", 156],
    ["terminal", "icon", 48],
  ]);
});

test("taskbar planner reserves overflow and preserves the atomic prefix", () => {
  const items = Array.from({ length: 14 }, (_, index) => ({
    id: `app-${index}`,
    fullWidth: 96,
    canUseIconOnly: true,
  }));

  assert.equal(getTaskbarLayoutPlan(items, 1349).mode, "full");
  assert.equal(getTaskbarLayoutPlan(items, 942).mode, "compact");
  assert.equal(getTaskbarLayoutPlan(items, 733).mode, "compact");
  const narrow = getTaskbarLayoutPlan(items, 598);
  assert.equal(narrow.mode, "overflow");
  assert.deepEqual(narrow.visible.map((item) => item.id), items.slice(0, 11).map((item) => item.id));
  assert.deepEqual(narrow.overflowIds, items.slice(11).map((item) => item.id));
});

test("an oversized generic item overflows instead of showing a clipped label", () => {
  const plan = getTaskbarLayoutPlan([
    { id: "generic", fullWidth: 420, canUseIconOnly: false },
    { id: "known", fullWidth: 90, canUseIconOnly: true },
  ], 300);

  assert.equal(plan.mode, "overflow");
  assert.deepEqual(plan.visible, []);
  assert.deepEqual(plan.overflowIds, ["generic", "known"]);
});
