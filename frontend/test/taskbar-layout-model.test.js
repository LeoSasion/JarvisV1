import assert from "node:assert/strict";
import test from "node:test";
import { getTaskbarCapacity } from "../src/taskbar-layout-model.js";

test("taskbar capacity follows the active visual slot width", () => {
  assert.equal(getTaskbarCapacity(584, 116), 5);
  assert.equal(getTaskbarCapacity(284, 52), 5);
  assert.equal(getTaskbarCapacity(416, 52), 8);
});

test("taskbar capacity fails safe for invalid measurements", () => {
  assert.equal(getTaskbarCapacity(0, 0), 5);
  assert.equal(getTaskbarCapacity(Number.NaN, Number.NaN), 5);
});
