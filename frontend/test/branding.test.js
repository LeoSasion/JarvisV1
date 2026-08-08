import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const productionSurfaces = [
  new URL("../index.html", import.meta.url),
  new URL("../src/App.jsx", import.meta.url),
  new URL("../src/components/BootSequence.jsx", import.meta.url),
  new URL("../src/components/ShellPanels.jsx", import.meta.url),
  new URL("../src/platform/mock-platform.js", import.meta.url),
];

test("production UI uses the canonical JARVIS brand", async () => {
  const sources = await Promise.all(productionSurfaces.map((file) => readFile(file, "utf8")));
  for (const source of sources) {
    assert.doesNotMatch(source, /night shell/iu);
  }

  assert.match(sources[0], /<title>JARVIS<\/title>/u);
  assert.match(sources[2], /JARVIS LOCAL VISUAL FRAME/u);
  assert.match(sources[4], /productName:\s*"JARVIS"/u);
});
