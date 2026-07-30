import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptsTaskbarHoverPointer,
  getTaskbarHoverPreviewTarget,
  TASKBAR_HOVER_DISMISS_DELAY_MS,
  TASKBAR_HOVER_PREVIEW_DELAY_MS,
} from "../src/taskbar-hover-preview.js";

test("hover previews require a running window", () => {
  assert.equal(
    getTaskbarHoverPreviewTarget({ id: "pinned:notepad", windows: [] }, "native"),
    null,
  );
});

test("native hover previews reject mixed internal window groups", () => {
  const item = {
    id: "builtin:explorer",
    windows: [
      { windowId: "0x1234" },
      { windowId: "jarvis:explorer", internalWindowId: "explorer" },
    ],
  };

  assert.equal(getTaskbarHoverPreviewTarget(item, "native"), null);
  assert.deepEqual(getTaskbarHoverPreviewTarget(item, "mock"), {
    itemId: "builtin:explorer",
    kind: "mock",
    windowIds: ["0x1234", "jarvis:explorer"],
  });
});

test("hover preview capabilities are deduplicated and bounded", () => {
  const item = {
    id: "running:browser",
    windows: Array.from({ length: 30 }, (_, index) => ({
      windowId: index === 1 ? "window:0" : `window:${index}`,
    })),
  };

  const target = getTaskbarHoverPreviewTarget(item, "native");
  assert.equal(target.windowIds.length, 24);
  assert.equal(new Set(target.windowIds).size, 24);
  assert.equal(target.windowIds[0], "window:0");
});

test("hover intent accepts only an idle mouse pointer", () => {
  assert.equal(acceptsTaskbarHoverPointer("mouse", null), true);
  assert.equal(acceptsTaskbarHoverPointer("touch", null), false);
  assert.equal(acceptsTaskbarHoverPointer("pen", null), false);
  assert.equal(acceptsTaskbarHoverPointer("mouse", "pinned:notepad"), false);
  assert.ok(TASKBAR_HOVER_PREVIEW_DELAY_MS >= 400);
  assert.ok(TASKBAR_HOVER_DISMISS_DELAY_MS > TASKBAR_HOVER_PREVIEW_DELAY_MS);
});
