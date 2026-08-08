import assert from "node:assert/strict";
import test from "node:test";
import { filterHelpSections, helpCenterSections } from "../src/help-center-model.js";
import { isHelpShortcut } from "../src/shell-shortcuts.js";

test("help center keeps task, shortcut, privacy, and recovery guidance discoverable", () => {
  assert.ok(helpCenterSections.length >= 5);
  assert.equal(filterHelpSections("metadata only")[0].id, "linked");
  assert.equal(filterHelpSections("ctrl shift q")[0].id, "windows");
  assert.equal(filterHelpSections("recovery check")[0].id, "recovery");
  assert.deepEqual(filterHelpSections("not-a-command"), []);
});

test("F1 opens help only when it is unmodified and not repeated", () => {
  assert.equal(isHelpShortcut({ key: "F1" }), true);
  assert.equal(isHelpShortcut({ key: "F1", repeat: true }), false);
  assert.equal(isHelpShortcut({ key: "F1", altKey: true }), false);
  assert.equal(isHelpShortcut({ key: "F1", ctrlKey: true }), false);
  assert.equal(isHelpShortcut({ key: "F2" }), false);
});
