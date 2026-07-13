interface FileSystemApi {
  mkdtempSync(prefix: string): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
}

declare const require: (
  specifier: "node:fs" | "node:os" | "node:path",
) => unknown;

interface OperatingSystemApi {
  tmpdir(): string;
}

interface PathApi {
  join(...paths: string[]): string;
}

interface TemporaryDatabase {
  readonly directory: string;
  readonly databasePath: string;
  readonly backupPath: string;
  cleanup(): void;
}

const loadModule = require as unknown as (specifier: string) => unknown;
const fileSystem = loadModule("node:fs") as FileSystemApi;
const operatingSystem = loadModule("node:os") as OperatingSystemApi;
const path = loadModule("node:path") as PathApi;

function createTemporaryDatabase(prefix = "bookmark-clean-"): TemporaryDatabase {
  const directory = fileSystem.mkdtempSync(path.join(operatingSystem.tmpdir(), prefix));
  let cleaned = false;

  return {
    directory,
    databasePath: path.join(directory, "source.sqlite"),
    backupPath: path.join(directory, "backup.sqlite"),
    cleanup(): void {
      if (cleaned) {
        return;
      }

      fileSystem.rmSync(directory, { recursive: true, force: true });
      cleaned = true;
    },
  };
}

async function withTemporaryDatabase<T>(
  work: (database: TemporaryDatabase) => T | PromiseLike<T>,
): Promise<T> {
  const database = createTemporaryDatabase();

  try {
    return await work(database);
  } finally {
    database.cleanup();
  }
}

declare const module: {
  exports: {
    createTemporaryDatabase: typeof createTemporaryDatabase;
    withTemporaryDatabase: typeof withTemporaryDatabase;
  };
};

module.exports = { createTemporaryDatabase, withTemporaryDatabase };
