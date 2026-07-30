import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStartMenuApplications,
  createStartMenuVirtualRows,
  filterStartMenuApplications,
  getStartPanelCommand,
  getStartViewNavigation,
  getStartMenuVirtualWindow,
  groupStartMenuApplications,
} from "../src/start-menu-model.js";

const installed = [
  {
    applicationId: "alpha-tools",
    label: "Alpha Tools",
    category: "Utilities",
    source: "common",
    processNames: ["alpha"],
  },
  {
    applicationId: "alpha",
    label: "Alpha",
    category: "Applications",
    source: "packaged",
    processNames: [],
  },
  {
    applicationId: "studio",
    label: "Blue Studio",
    category: "Creative",
    source: "user",
    processNames: ["studio"],
  },
];

test("ranks exact and prefix application matches ahead of metadata-only matches", () => {
  const applications = buildStartMenuApplications([], installed);
  const matches = filterStartMenuApplications(applications, "alpha");

  assert.deepEqual(matches.map((application) => application.label), [
    "Alpha",
    "Alpha Tools",
  ]);
  assert.equal(filterStartMenuApplications(applications, "creative")[0].label, "Blue Studio");
});

test("deduplicates installed applications already represented by a pinned capability", () => {
  const applications = buildStartMenuApplications([{
    id: "alpha-pinned",
    label: "Alpha",
    target: "alpha.exe",
    keywords: "alpha",
  }], installed);

  assert.equal(applications.filter((application) => application.label === "Alpha").length, 1);
  assert.equal(applications.find((application) => application.label === "Alpha").kind, "pinned");
});

test("virtualizes a large grouped application catalog to a bounded render window", () => {
  const largeCatalog = Array.from({ length: 10_000 }, (_, index) => ({
    applicationId: `app-${index}`,
    label: `Application ${String(index).padStart(5, "0")}`,
    category: "Performance",
    source: "common",
    processNames: [],
  }));
  const applications = buildStartMenuApplications([], largeCatalog);
  const groups = groupStartMenuApplications(applications);
  const layout = createStartMenuVirtualRows(groups);
  const firstWindow = getStartMenuVirtualWindow(layout.rows, 0, 320);
  const finalWindow = getStartMenuVirtualWindow(layout.rows, layout.totalHeight - 320, 320);

  assert.equal(applications.length, 10_000);
  assert.ok(layout.totalHeight > 200_000);
  assert.ok(firstWindow.length < 20);
  assert.ok(finalWindow.length < 20);
  assert.equal(firstWindow[0].kind, "group");
  assert.ok(finalWindow.some((row) => row.kind === "applications"));
});

test("search remains deterministic for a ten-thousand application catalog", () => {
  const largeCatalog = Array.from({ length: 10_000 }, (_, index) => ({
    applicationId: `app-${index}`,
    label: `Application ${String(index).padStart(5, "0")}`,
    category: index % 2 === 0 ? "Even" : "Odd",
    source: "common",
    processNames: [],
  }));
  const applications = buildStartMenuApplications([], largeCatalog);
  const matches = filterStartMenuApplications(applications, "application 09999");

  assert.equal(matches[0].applicationId, "app-9999");
  assert.equal(matches.length, 1);
});

test("routes only bounded Start keyboard commands", () => {
  assert.equal(getStartPanelCommand({ key: "f", ctrlKey: true }), "focus-search");
  assert.equal(getStartPanelCommand({ key: "1", ctrlKey: true }), "view-pinned");
  assert.equal(getStartPanelCommand({ key: "2", metaKey: true }), "view-all");
  assert.equal(getStartPanelCommand({ key: "f", ctrlKey: true, shiftKey: true }), null);
  assert.equal(getStartPanelCommand({ key: "x", ctrlKey: true }), null);
});

test("Start view navigation clamps to Pinned and All Apps", () => {
  assert.equal(getStartViewNavigation("pinned", "ArrowRight"), "all");
  assert.equal(getStartViewNavigation("all", "ArrowLeft"), "pinned");
  assert.equal(getStartViewNavigation("pinned", "ArrowLeft"), "pinned");
  assert.equal(getStartViewNavigation("all", "End"), "all");
  assert.equal(getStartViewNavigation("missing", "Home"), null);
});
