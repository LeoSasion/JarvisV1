import assert from "node:assert/strict";
import test from "node:test";
import {
  formatExplorerCopyPath,
  getExplorerEscapeAction,
  getExplorerGridColumnCount,
  getExplorerKeyboardCommand,
  getExplorerKeyboardSelection,
  getExplorerKeyboardTarget,
  getExplorerSearchSummary,
  getExplorerSortTransition,
  normalizeExplorerAddress,
  normalizeExplorerPreferences,
  normalizeExplorerSearchQuery,
  segmentExplorerSearchMatch,
  sortExplorerEntries,
  toggleExplorerFocusedSelection,
} from "../src/explorer-interaction-model.js";

test("Explorer preferences reject unknown view and sort values", () => {
  assert.deepEqual(normalizeExplorerPreferences({
    version: 99,
    viewMode: "tiles",
    sortKey: "owner",
    sortDirection: "sideways",
  }), {
    version: 1,
    viewMode: "list",
    sortKey: "name",
    sortDirection: "ascending",
  });
});

test("Explorer sorting is directory-first, stable, and direction-aware", () => {
  const entries = [
    { name: "z.txt", typeLabel: "Text", sizeBytes: 9, modified: "2026-01-02", isDirectory: false },
    { name: "Folder", typeLabel: "Folder", sizeBytes: null, modified: "2026-01-01", isDirectory: true },
    { name: "a.txt", typeLabel: "Text", sizeBytes: 9, modified: "2026-01-03", isDirectory: false },
  ];
  assert.deepEqual(
    sortExplorerEntries(entries, { sortKey: "name", sortDirection: "ascending" })
      .map((entry) => entry.name),
    ["Folder", "a.txt", "z.txt"],
  );
  assert.deepEqual(
    sortExplorerEntries(entries, { sortKey: "modified", sortDirection: "descending" })
      .map((entry) => entry.name),
    ["Folder", "a.txt", "z.txt"],
  );
});

test("Explorer keyboard navigation adapts list and grid columns", () => {
  assert.equal(getExplorerGridColumnCount(640, "grid"), 5);
  assert.equal(getExplorerGridColumnCount(640, "list"), 1);
  assert.equal(getExplorerKeyboardTarget(12, 2, "ArrowDown", 5), 7);
  assert.equal(getExplorerKeyboardTarget(12, 10, "ArrowDown", 5), 11);
  assert.equal(getExplorerKeyboardTarget(12, 5, "Home", 5), 0);
  assert.equal(getExplorerKeyboardTarget(12, 5, "End", 5), 11);
});

test("Explorer keyboard ranges preserve their anchor while expanding and contracting", () => {
  const visiblePaths = ["a", "b", "c", "d", "e"];
  const expanded = getExplorerKeyboardSelection({
    visiblePaths,
    selectedPaths: ["b"],
    focusedPath: "b",
    selectionAnchor: "b",
    targetIndex: 4,
    extendSelection: true,
  });
  assert.deepEqual(expanded, {
    focusedPath: "e",
    selectionAnchor: "b",
    selectedPaths: ["b", "c", "d", "e"],
  });

  const contracted = getExplorerKeyboardSelection({
    visiblePaths,
    selectedPaths: expanded.selectedPaths,
    focusedPath: expanded.focusedPath,
    selectionAnchor: expanded.selectionAnchor,
    targetIndex: 2,
    extendSelection: true,
  });
  assert.deepEqual(contracted, {
    focusedPath: "c",
    selectionAnchor: "b",
    selectedPaths: ["b", "c"],
  });
});

test("Explorer Ctrl navigation preserves selection and Ctrl Shift adds a range", () => {
  const visiblePaths = ["a", "b", "c", "d"];
  const focusOnly = getExplorerKeyboardSelection({
    visiblePaths,
    selectedPaths: ["a", "d"],
    focusedPath: "a",
    selectionAnchor: "a",
    targetIndex: 2,
    focusOnly: true,
  });
  assert.deepEqual(focusOnly, {
    focusedPath: "c",
    selectionAnchor: "a",
    selectedPaths: ["a", "d"],
  });

  assert.deepEqual(getExplorerKeyboardSelection({
    visiblePaths,
    selectedPaths: focusOnly.selectedPaths,
    focusedPath: focusOnly.focusedPath,
    selectionAnchor: focusOnly.selectionAnchor,
    targetIndex: 2,
    extendSelection: true,
    additiveSelection: true,
  }), {
    focusedPath: "c",
    selectionAnchor: "a",
    selectedPaths: ["a", "d", "b", "c"],
  });
});

test("Explorer Ctrl Space toggles only the focused item", () => {
  const visiblePaths = ["a", "b", "c"];
  assert.deepEqual(toggleExplorerFocusedSelection({
    visiblePaths,
    selectedPaths: ["a", "c"],
    focusedPath: "b",
    selectionAnchor: "a",
  }), {
    focusedPath: "b",
    selectionAnchor: "b",
    selectedPaths: ["a", "c", "b"],
  });
  assert.deepEqual(toggleExplorerFocusedSelection({
    visiblePaths,
    selectedPaths: ["a", "b"],
    focusedPath: "b",
    selectionAnchor: "b",
  }).selectedPaths, ["a"]);
});

test("Explorer column sorting toggles active keys and defaults new numeric keys descending", () => {
  assert.deepEqual(getExplorerSortTransition({
    viewMode: "list",
    sortKey: "name",
    sortDirection: "ascending",
  }, "name"), {
    version: 1,
    viewMode: "list",
    sortKey: "name",
    sortDirection: "descending",
  });
  assert.equal(getExplorerSortTransition({
    viewMode: "list",
    sortKey: "name",
    sortDirection: "descending",
  }, "modified").sortDirection, "descending");
  assert.equal(getExplorerSortTransition({
    viewMode: "list",
    sortKey: "size",
    sortDirection: "descending",
  }, "type").sortDirection, "ascending");
});

test("Explorer shortcuts route without capturing unrelated chords", () => {
  assert.equal(getExplorerKeyboardCommand({ key: "l", ctrlKey: true }), "focus-address");
  assert.equal(getExplorerKeyboardCommand({ key: "f", ctrlKey: true }), "focus-search");
  assert.equal(getExplorerKeyboardCommand({ key: "c", ctrlKey: true, shiftKey: true }), "copy-path");
  assert.equal(getExplorerKeyboardCommand({ key: "Enter", altKey: true }), "properties");
  assert.equal(getExplorerKeyboardCommand({
    key: "Enter",
    altKey: true,
    shiftKey: true,
  }), null);
  assert.equal(getExplorerKeyboardCommand({ key: "ArrowLeft", altKey: true }), "back");
  assert.equal(getExplorerKeyboardCommand({ key: "F5" }), "refresh");
  assert.equal(getExplorerKeyboardCommand({ key: "c", ctrlKey: true }), null);
});

test("Explorer address and Copy Path text are bounded and safe for display", () => {
  assert.equal(normalizeExplorerAddress("  C:\\Users\\Pilot\0  "), "C:\\Users\\Pilot");
  assert.equal(normalizeExplorerAddress("x".repeat(3_000)).length, 2_048);
  assert.equal(
    formatExplorerCopyPath(["C:\\Alpha One", "D:\\Beta"]),
    "\"C:\\Alpha One\"\r\n\"D:\\Beta\"",
  );
});

test("Explorer search normalization, highlighting, and counts remain bounded", () => {
  assert.equal(normalizeExplorerSearchQuery("  ＤＥＳＩＧＮ  "), "design");
  assert.equal(normalizeExplorerSearchQuery("x".repeat(140)).length, 96);
  assert.deepEqual(segmentExplorerSearchMatch("Design_Review.md", "review"), [
    { text: "Design_", match: false },
    { text: "Review", match: true },
    { text: ".md", match: false },
  ]);
  assert.deepEqual(getExplorerSearchSummary(7, 2, "design"), {
    total: 7,
    visible: 2,
    filtered: true,
    noMatches: false,
    label: "2 OF 7 ITEMS",
  });
  assert.equal(getExplorerSearchSummary(7, 0, "missing").noMatches, true);
  assert.equal(getExplorerSearchSummary(7, 7, "").label, "7 ITEMS");
});

test("Explorer Escape clears transient state before closing the window", () => {
  assert.equal(getExplorerEscapeAction({
    contextMenu: {},
    addressEditing: true,
  }), "close-context-menu");
  assert.equal(getExplorerEscapeAction({
    addressEditing: true,
    search: "report",
    selectionCount: 2,
  }), "cancel-address");
  assert.equal(getExplorerEscapeAction({
    pendingTransfer: {},
    search: "report",
  }), "cancel-transfer");
  assert.equal(getExplorerEscapeAction({
    commandDialog: {},
    search: "report",
  }), "cancel-dialog");
  assert.equal(getExplorerEscapeAction({ search: "report", selectionCount: 2 }), "clear-search");
  assert.equal(getExplorerEscapeAction({ selectionCount: 2 }), "clear-selection");
  assert.equal(getExplorerEscapeAction(), "close");
});
