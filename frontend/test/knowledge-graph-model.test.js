import assert from "node:assert/strict";
import test from "node:test";
import {
  getKnowledgeGraphPresentation,
  normalizeKnowledgeGraphState,
} from "../src/knowledge-graph-model.js";

test("knowledge graph remains disconnected without a verified source", () => {
  assert.deepEqual(normalizeKnowledgeGraphState({ connected: true, sourceCount: 0, relationCount: 120 }), {
    connected: false,
    sourceCount: 0,
    relationCount: 0,
  });
  const presentation = getKnowledgeGraphPresentation(null);
  assert.equal(presentation.status, "disconnected");
  assert.equal(presentation.title, "SOURCE DISCONNECTED");
  assert.match(presentation.announcement, /No verified knowledge source is connected/u);
  assert.deepEqual(presentation.actions.map((action) => action.id), [
    "search-local",
    "open-files",
    "desktop-only",
  ]);
  assert.equal(presentation.actions.some((action) => /agent|connected/iu.test(`${action.label} ${action.detail}`)), false);
});

test("knowledge graph exposes counts only after a verified connection", () => {
  const presentation = getKnowledgeGraphPresentation({
    connected: true,
    sourceCount: 2,
    relationCount: 48,
  });
  assert.equal(presentation.status, "connected");
  assert.equal(presentation.sourceCount, 2);
  assert.equal(presentation.relationCount, 48);
  assert.match(presentation.detail, /2 SOURCES \/ 48 RELATIONS/u);
  assert.deepEqual(presentation.actions, []);
});
