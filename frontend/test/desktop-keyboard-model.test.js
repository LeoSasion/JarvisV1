import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceDesktopTypeahead,
  getDesktopKeyboardTarget,
} from "../src/desktop-keyboard-model.js";

const positions = [
  { x: 0, y: 0 },
  { x: 0, y: 80 },
  { x: 0, y: 160 },
  { x: 100, y: 0 },
  { x: 100, y: 80 },
];

test("desktop arrows follow the adaptive visual grid without wrapping", () => {
  assert.equal(getDesktopKeyboardTarget(positions, 0, "ArrowDown"), 1);
  assert.equal(getDesktopKeyboardTarget(positions, 1, "ArrowRight"), 4);
  assert.equal(getDesktopKeyboardTarget(positions, 4, "ArrowUp"), 3);
  assert.equal(getDesktopKeyboardTarget(positions, 3, "ArrowLeft"), 0);
  assert.equal(getDesktopKeyboardTarget(positions, 2, "ArrowDown"), 2);
});

test("desktop Home and End stay bounded", () => {
  assert.equal(getDesktopKeyboardTarget(positions, 3, "Home"), 0);
  assert.equal(getDesktopKeyboardTarget(positions, 0, "End"), 4);
  assert.equal(getDesktopKeyboardTarget([], 0, "Home"), -1);
});

test("desktop typeahead appends briefly, resets later, and cycles repeated initials", () => {
  const entries = [
    { label: "Alpha" },
    { label: "Archive" },
    { label: "Beta" },
    { label: "Blue" },
  ];
  const first = advanceDesktopTypeahead(entries, -1, null, "b", 100);
  const appended = advanceDesktopTypeahead(entries, first.index, first, "l", 200);
  const reset = advanceDesktopTypeahead(entries, appended.index, appended, "a", 2_000);
  const cycle = advanceDesktopTypeahead(entries, reset.index, reset, "a", 2_100);

  assert.deepEqual([first.query, first.index], ["b", 2]);
  assert.deepEqual([appended.query, appended.index], ["bl", 3]);
  assert.deepEqual([reset.query, reset.index], ["a", 0]);
  assert.deepEqual([cycle.query, cycle.index], ["a", 1]);
});
