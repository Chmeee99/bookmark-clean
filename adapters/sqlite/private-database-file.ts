interface FileSystemApi {
  readonly constants: {
    readonly O_CREAT: number;
    readonly O_RDWR: number;
  };
  closeSync(descriptor: number): void;
  fchmodSync(descriptor: number, mode: number): void;
  fstatSync(descriptor: number): { isFile(): boolean };
  openSync(path: string, flags: number, mode: number): number;
}

declare const require: (specifier: "node:fs") => unknown;
declare const module: {
  exports: { preparePrivateDatabaseFile: typeof preparePrivateDatabaseFile };
};

const fileSystem = require("node:fs") as FileSystemApi;

function preparePrivateDatabaseFile(databasePath: string): boolean {
  if (databasePath === ":memory:") return true;
  let descriptor: number | undefined;
  let prepared = false;
  try {
    const flags = fileSystem.constants.O_CREAT | fileSystem.constants.O_RDWR;
    descriptor = fileSystem.openSync(databasePath, flags, 0o600);
    if (!fileSystem.fstatSync(descriptor).isFile()) return false;
    fileSystem.fchmodSync(descriptor, 0o600);
    prepared = true;
  } catch {
    prepared = false;
  } finally {
    if (descriptor !== undefined) {
      try { fileSystem.closeSync(descriptor); } catch { prepared = false; }
    }
  }
  return prepared;
}

module.exports = { preparePrivateDatabaseFile };
