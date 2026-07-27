import assert from "node:assert/strict";
import test from "node:test";
import {
  JARVIS_FILE_DRAG_MIME,
  getFileDropMode,
  hasFileDrag,
  normalizeDraggedPaths,
  parseFileDrag,
  serializeFileDrag,
  writeFileDrag,
} from "../src/file-drag-model.js";

function createDataTransfer() {
  const values = new Map();
  return {
    effectAllowed: "none",
    dropEffect: "none",
    getData(type) {
      return values.get(type) ?? "";
    },
    setData(type, value) {
      values.set(type, value);
    },
  };
}

test("file drag payload is bounded, deduplicated, and round trips", () => {
  const transfer = createDataTransfer();
  assert.equal(writeFileDrag(
    transfer,
    ["C:\\A.txt", "C:\\A.txt", "", "D:\\Folder"],
    "desktop",
  ), true);
  assert.equal(transfer.effectAllowed, "copyMove");
  assert.deepEqual(parseFileDrag(transfer), {
    source: "desktop",
    paths: ["C:\\A.txt", "D:\\Folder"],
  });
  assert.match(transfer.getData(JARVIS_FILE_DRAG_MIME), /"version":1/);
  transfer.types = [JARVIS_FILE_DRAG_MIME, "text/plain"];
  assert.equal(hasFileDrag(transfer), true);
});

test("invalid drag payloads fail closed", () => {
  const transfer = createDataTransfer();
  transfer.setData(JARVIS_FILE_DRAG_MIME, "{\"version\":2,\"paths\":[\"C:\\\\A.txt\"]}");
  assert.equal(parseFileDrag(transfer), null);
  assert.equal(serializeFileDrag([], "explorer"), "");
  assert.deepEqual(normalizeDraggedPaths("C:\\A.txt"), []);
  assert.equal(hasFileDrag(null), false);
});

test("shift selects move while the default is copy", () => {
  assert.equal(getFileDropMode({ shiftKey: true }), "move");
  assert.equal(getFileDropMode({ shiftKey: false }), "copy");
  assert.equal(getFileDropMode(null), "copy");
});
