import assert from "node:assert/strict";
import test from "node:test";
import { getFocusLoopTargetIndex } from "../src/hooks/useDialogFocusTrap.js";

test("dialog focus loops only at its boundaries", () => {
  assert.equal(getFocusLoopTargetIndex(0, 4, true), 3);
  assert.equal(getFocusLoopTargetIndex(3, 4, false), 0);
  assert.equal(getFocusLoopTargetIndex(1, 4, false), -1);
  assert.equal(getFocusLoopTargetIndex(2, 4, true), -1);
});

test("dialog focus recovers when focus starts outside the dialog", () => {
  assert.equal(getFocusLoopTargetIndex(-1, 3, false), 0);
  assert.equal(getFocusLoopTargetIndex(-1, 3, true), 2);
  assert.equal(getFocusLoopTargetIndex(0, 0, false), -1);
  assert.equal(getFocusLoopTargetIndex(0, Number.NaN, false), -1);
});
