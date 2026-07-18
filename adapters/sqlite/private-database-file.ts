interface FileSystemApi {
  readonly constants: {
    readonly O_CREAT: number;
    readonly O_DIRECTORY: number;
    readonly O_NOFOLLOW: number;
    readonly O_RDONLY: number;
    readonly O_RDWR: number;
  };
  closeSync(descriptor: number): void;
  fchmodSync(descriptor: number, mode: number): void;
  fstatSync(descriptor: number): {
    readonly mode: number;
    readonly nlink: number;
    readonly uid: number;
    isDirectory(): boolean;
    isFile(): boolean;
  };
  openSync(path: string, flags: number, mode: number): number;
}

interface PathApi {
  dirname(path: string): string;
}

interface ProcessApi {
  getuid?(): number;
}

declare const require: (specifier: "node:fs" | "node:path" | "node:process") => unknown;
declare const module: {
  exports: { preparePrivateDatabaseFile: typeof preparePrivateDatabaseFile };
};

const fileSystem = require("node:fs") as FileSystemApi;
const path = require("node:path") as PathApi;
const processApi = require("node:process") as ProcessApi;

function isCurrentUserOwned(uid: number): boolean {
  return processApi.getuid === undefined || uid === processApi.getuid();
}

function prepareParentDirectory(databasePath: string): number | undefined {
  if (
    typeof fileSystem.constants.O_DIRECTORY !== "number" ||
    typeof fileSystem.constants.O_NOFOLLOW !== "number"
  ) {
    return undefined;
  }
  let descriptor: number | undefined;
  try {
    descriptor = fileSystem.openSync(
      path.dirname(databasePath),
      fileSystem.constants.O_RDONLY | fileSystem.constants.O_DIRECTORY,
      0,
    );
    const status = fileSystem.fstatSync(descriptor);
    if (
      !status.isDirectory() ||
      !isCurrentUserOwned(status.uid) ||
      (status.mode & 0o022) !== 0
    ) {
      fileSystem.closeSync(descriptor);
      return undefined;
    }
    return descriptor;
  } catch {
    if (descriptor !== undefined) {
      try {
        fileSystem.closeSync(descriptor);
      } catch {
        // The parent descriptor is already unusable.
      }
    }
    return undefined;
  }
}

function preparePrivateDatabaseFile(databasePath: string): boolean {
  if (databasePath === ":memory:") return true;
  const parentDescriptor = prepareParentDirectory(databasePath);
  if (parentDescriptor === undefined) return false;
  let descriptor: number | undefined;
  let prepared = false;
  try {
    const flags =
      fileSystem.constants.O_CREAT |
      fileSystem.constants.O_RDWR |
      fileSystem.constants.O_NOFOLLOW;
    descriptor = fileSystem.openSync(databasePath, flags, 0o600);
    const status = fileSystem.fstatSync(descriptor);
    if (
      !status.isFile() ||
      !isCurrentUserOwned(status.uid) ||
      status.nlink !== 1
    ) {
      return false;
    }
    fileSystem.fchmodSync(descriptor, 0o600);
    prepared = true;
  } catch {
    prepared = false;
  } finally {
    if (descriptor !== undefined) {
      try { fileSystem.closeSync(descriptor); } catch { prepared = false; }
    }
    try { fileSystem.closeSync(parentDescriptor); } catch { prepared = false; }
  }
  return prepared;
}

module.exports = { preparePrivateDatabaseFile };
