import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const testsRoot = resolve(root, "tests");
const CAPABILITY_PREFIX = "// test-capability: ";

function parseArguments(arguments_) {
  let listOnly = false;
  const excludedCapabilities = new Set();
  for (const argument of arguments_) {
    if (argument === "--list") {
      listOnly = true;
      continue;
    }
    if (argument.startsWith("--exclude-capability=")) {
      const capability = argument.slice("--exclude-capability=".length);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(capability)) {
        throw new Error(`Invalid excluded capability: ${capability}`);
      }
      excludedCapabilities.add(capability);
      continue;
    }
    throw new Error(`Unknown test-runner argument: ${argument}`);
  }
  return { listOnly, excludedCapabilities };
}

function testFilesBelow(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...testFilesBelow(entryPath));
    if (entry.isFile() && entry.name.endsWith(".test.ts")) files.push(entryPath);
  }
  return files.sort();
}

function declaredCapabilities(file) {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.startsWith(CAPABILITY_PREFIX))
    .map((line) => line.slice(CAPABILITY_PREFIX.length));
}

const { listOnly, excludedCapabilities } = parseArguments(process.argv.slice(2));
const discoveredTestFiles = testFilesBelow(testsRoot);
const excludedTestFiles = discoveredTestFiles.filter((file) =>
  declaredCapabilities(file).some((capability) =>
    excludedCapabilities.has(capability),
  ),
);
const testFiles = discoveredTestFiles.filter(
  (file) => !excludedTestFiles.includes(file),
);
const displayedFiles = testFiles.map((file) => relative(root, file).replaceAll("\\", "/"));

for (const capability of [...excludedCapabilities].sort()) {
  const count = discoveredTestFiles.filter((file) =>
    declaredCapabilities(file).includes(capability),
  ).length;
  process.stderr.write(
    `[test-runner] excluded capability ${capability} from ${count} test files\n`,
  );
}

if (listOnly) {
  process.stdout.write(`${displayedFiles.join("\n")}\n`);
} else {
  process.stdout.write(
    `[test-runner] discovered ${discoveredTestFiles.length} test files; ` +
      `running ${testFiles.length}\n`,
  );
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
