import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const agentSource = readFileSync(
  new URL("../src/components/AgentConversationWindow.jsx", import.meta.url),
  "utf8",
);
const explorerSource = readFileSync(
  new URL("../src/components/FileExplorerWindow.jsx", import.meta.url),
  "utf8",
);
const visualSource = readFileSync(new URL("../src/vector-shell.css", import.meta.url), "utf8");

test("workspace notices use one visible pane-owned live region", () => {
  assert.match(appSource, /notice=\{agentInlineNotice\}/);
  assert.match(appSource, /notice=\{explorerInlineNotice\}/);
  assert.match(appSource, /notice=\{hasInlineNotice \? null : notice\}/);
  assert.match(agentSource, /placement="inline"/);
  assert.match(explorerSource, /placement="inline"/);
});

test("inline notices remain visible without resetting a scrolled workspace", () => {
  const inlineRule = visualSource.match(/\.system-notice\.is-placement-inline\s*\{[^}]+\}/)?.[0] ?? "";
  assert.match(inlineRule, /position:\s*sticky/);
  assert.match(inlineRule, /top:\s*0/);
  assert.doesNotMatch(inlineRule, /position:\s*fixed/);
});
