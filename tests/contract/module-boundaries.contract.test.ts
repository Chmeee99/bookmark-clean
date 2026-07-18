interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface DirectoryEntry {
  readonly name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

interface FileSystemApi {
  readdirSync(path: string, options: { readonly withFileTypes: true }): DirectoryEntry[];
  readFileSync(path: string, encoding: "utf8"): string;
  unlinkSync(path: string): void;
  writeFileSync(path: string, data: string): void;
}

interface PathApi {
  readonly sep: string;
  dirname(path: string): string;
  relative(from: string, to: string): string;
  resolve(...paths: string[]): string;
}

interface ChildProcessApi {
  spawnSync(
    executable: string,
    arguments_: readonly string[],
    options: { readonly cwd: string; readonly encoding: "utf8" },
  ): { readonly status: number | null; readonly stdout: string; readonly stderr: string };
}

declare const require: (specifier: string) => unknown;
declare const process: {
  readonly execPath: string;
  readonly pid: number;
  cwd(): string;
};

const { test } = require("node:test") as NodeTestApi;
const fileSystem = require("node:fs") as FileSystemApi;
const path = require("node:path") as PathApi;
const childProcess = require("node:child_process") as ChildProcessApi;
const ts = require("typescript") as typeof import("typescript");
const root = process.cwd();
const modulesRoot = path.resolve(root, "modules");
const testsRoot = path.resolve(root, "tests");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function filesBelow(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fileSystem.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesBelow(entryPath));
    if (entry.isFile() && entry.name.endsWith(".ts")) files.push(entryPath);
  }
  return files.sort();
}

function isWithin(directory: string, file: string): boolean {
  const relative = path.relative(directory, file);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function staticSpecifiers(file: string, source: string): readonly string[] {
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];
  const visit = (node: import("typescript").Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)) {
      specifiers.push(node.argument.literal.text);
    }
    if (ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression !== undefined &&
      ts.isStringLiteralLike(node.moduleReference.expression)) {
      specifiers.push(node.moduleReference.expression.text);
    }
    if (ts.isCallExpression(node) && node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) && node.arguments[0].text.startsWith(".")) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return specifiers;
}

function boundaryViolation(sourceFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".") || isWithin(testsRoot, sourceFile)) return undefined;
  const target = path.resolve(path.dirname(sourceFile), specifier);
  if (!isWithin(modulesRoot, target)) return undefined;
  const targetParts = path.relative(modulesRoot, target).split(path.sep);
  if (targetParts.length < 2) return undefined;
  const targetOwner = targetParts[0];
  const targetFile = targetParts[targetParts.length - 1];
  const sourceOwner = isWithin(modulesRoot, sourceFile)
    ? path.relative(modulesRoot, sourceFile).split(path.sep)[0]
    : undefined;
  if (sourceOwner === targetOwner || targetFile === "public.ts" || targetFile === "public.js") {
    return undefined;
  }
  return `${path.relative(root, sourceFile)} imports ${specifier}`;
}

function productionViolations(): readonly string[] {
  const violations: string[] = [];
  for (const sourceRoot of ["apps", "core", "modules", "adapters", "tools"]) {
    for (const file of filesBelow(path.resolve(root, sourceRoot))) {
      for (const specifier of staticSpecifiers(file, fileSystem.readFileSync(file, "utf8"))) {
        const violation = boundaryViolation(file, specifier);
        if (violation !== undefined) violations.push(violation);
      }
    }
  }
  return violations.sort();
}

test("production cross-module imports use public module surfaces", () => {
  const violations = productionViolations();
  assert(
    JSON.stringify(violations) === "[]",
    `Module boundary violations: ${JSON.stringify(violations)}`,
  );

  const appFile = path.resolve(root, "apps/local-cli/synthetic.ts");
  assert(
    boundaryViolation(appFile, "../../modules/catalog/catalog-service.js") !== undefined,
    "Forbidden cross-module internal import was not detected",
  );
  assert(
    boundaryViolation(appFile, "../../modules/catalog/public.js") === undefined,
    "Public module import was rejected",
  );
  assert(
    boundaryViolation(path.resolve(root, "modules/catalog/synthetic.ts"), "./catalog-service.js") === undefined,
    "Same-module internal import was rejected",
  );
  assert(
    boundaryViolation(path.resolve(root, "tests/synthetic.test.ts"), "../modules/catalog/catalog-service.js") === undefined,
    "Test-only internal import was rejected",
  );

  const forbiddenImportEquals = staticSpecifiers(
    appFile,
    'import Internal = require("../../modules/catalog/catalog-service.js");',
  );
  assert(
    JSON.stringify(forbiddenImportEquals) ===
      '["../../modules/catalog/catalog-service.js"]',
    "Import-equals internal specifier was not detected",
  );
  assert(
    boundaryViolation(appFile, forbiddenImportEquals[0]) !== undefined,
    "Import-equals internal import was not rejected",
  );

  const publicImportEquals = staticSpecifiers(
    appFile,
    'import Catalog = require("../../modules/catalog/public.js");',
  );
  assert(
    JSON.stringify(publicImportEquals) === '["../../modules/catalog/public.js"]',
    "Import-equals public specifier was not detected",
  );
  assert(
    boundaryViolation(appFile, publicImportEquals[0]) === undefined,
    "Import-equals public import was rejected",
  );
});

test("test runner discovers new test files without package metadata edits", () => {
  const probeName = `.runner-probe-${process.pid}.test.ts`;
  const probePath = path.resolve(testsRoot, probeName);
  fileSystem.writeFileSync(probePath, "throw new Error('list-only discovery probe must not execute');\n");
  try {
    const result = childProcess.spawnSync(
      process.execPath,
      ["scripts/run-tests.mjs", "--list"],
      { cwd: root, encoding: "utf8" },
    );
    assert(result.status === 0, `Test discovery failed: ${result.stderr}`);
    const discovered = result.stdout.trim().split(/\r?\n/).filter(Boolean);
    assert(discovered.some((file) => file.endsWith(probeName)), "New test was not discovered");
    assert(
      discovered.some((file) => file.endsWith("tests/contract/module-boundaries.contract.test.ts")),
      "Boundary contract test was not discovered",
    );
    assert(JSON.stringify(discovered) === JSON.stringify([...discovered].sort()), "Test order is not stable");
  } finally {
    fileSystem.unlinkSync(probePath);
  }
});

test("test runner explicitly excludes only marked runtime capabilities", () => {
  const result = childProcess.spawnSync(
    process.execPath,
    [
      "scripts/run-tests.mjs",
      "--list",
      "--exclude-capability=loopback-listener",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert(result.status === 0, `Capability-filtered discovery failed: ${result.stderr}`);
  const discovered = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  assert(
    !discovered.some((file) => file.endsWith("health-node-transport.test.ts")),
    "Marked loopback test was not excluded",
  );
  assert(
    discovered.some((file) => file.endsWith("module-boundaries.contract.test.ts")),
    "Unmarked contract test was excluded",
  );
  assert(
    result.stderr.includes(
      "[test-runner] excluded capability loopback-listener from 5 test files",
    ),
    "Capability exclusion was not reported transparently",
  );
});
