import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const extensions = new Set([".js", ".jsx", ".css", ".html", ".json"]);
const ignoredDirectories = new Set(["dist", "node_modules"]);
const failures = [];

async function inspect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (ignoredDirectories.has(entry.name)) return;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await inspect(path);
      return;
    }
    if (!extensions.has(extname(entry.name))) return;
    const content = await readFile(path, "utf8");
    const lines = content.split(/\r?\n/u);
    lines.forEach((line, index) => {
      if (/[ \t]+$/u.test(line)) {
        failures.push(`${relative(root, path)}:${index + 1} trailing whitespace`);
      }
    });
    if (content && !content.endsWith("\n")) {
      failures.push(`${relative(root, path)} missing final newline`);
    }
  }));
}

await inspect(root);
if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Format contract passed.\n");
}
