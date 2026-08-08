import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../src/", import.meta.url);

async function readSource(name) {
  return readFile(new URL(name, sourceUrl), "utf8");
}

test("motion stylesheet is loaded after the geometry and visual layers", async () => {
  const entry = await readSource("main.jsx");
  const geometryIndex = entry.indexOf('import "./styles.css"');
  const visualIndex = entry.indexOf('import "./vector-shell.css"');
  const motionIndex = entry.indexOf('import "./motion.css"');

  assert.ok(geometryIndex >= 0);
  assert.ok(visualIndex > geometryIndex);
  assert.ok(motionIndex > visualIndex);
});

test("motion.css is the sole CSS owner of reduced-motion behavior", async () => {
  const [legacy, visual, motion] = await Promise.all([
    readSource("styles.css"),
    readSource("vector-shell.css"),
    readSource("motion.css"),
  ]);

  for (const source of [legacy, visual]) {
    assert.doesNotMatch(source, /prefers-reduced-motion/u);
    assert.doesNotMatch(source, /data-motion=["']reduced["']/u);
  }

  assert.match(motion, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(motion, /:root:not\(\[data-motion="full"\]\)/u);
  assert.match(motion, /:root\[data-motion="reduced"\]/u);
  assert.doesNotMatch(`${legacy}\n${visual}\n${motion}`, /0\.01ms/u);
  assert.doesNotMatch(motion, /data-motion="reduced"\]\s+\*/u);
});

test("animated renderer components share the resolved motion hook", async () => {
  const components = await Promise.all([
    readSource("components/CoreStage.jsx"),
    readSource("components/WaveformCanvas.jsx"),
    readSource("components/LinkedWorkspaceRoutes.jsx"),
  ]);

  for (const component of components) {
    assert.match(component, /useReducedMotion\(\)/u);
    assert.doesNotMatch(component, /matchMedia\(["']\(prefers-reduced-motion/u);
  }
});
