import { readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const testsRoot = resolve(root, "tests");

function testFilesBelow(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...testFilesBelow(entryPath));
    if (entry.isFile() && entry.name.endsWith(".test.ts")) files.push(entryPath);
  }
  return files.sort();
}

const testFiles = testFilesBelow(testsRoot);
const displayedFiles = testFiles.map((file) => relative(root, file).replaceAll("\\", "/"));

if (process.argv[2] === "--list") {
  process.stdout.write(`${displayedFiles.join("\n")}\n`);
} else {
  process.stdout.write(`[test-runner] discovered ${testFiles.length} test files\n`);
  const result = spawnSync(process.execPath, ["--test", ...testFiles], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error !== undefined) {
    process.stderr.write(`[test-runner] ${result.error.message}\n`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
}
