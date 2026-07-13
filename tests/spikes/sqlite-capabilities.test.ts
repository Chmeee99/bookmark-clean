interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

declare const require: (
  specifier: "node:test" | "node:sqlite" | "../helpers/temporary-database.ts" | "node:fs",
) => unknown;

interface SqliteRow {
  readonly [key: string]: unknown;
}

interface SqliteStatement {
  all(...parameters: unknown[]): SqliteRow[];
  get(...parameters: unknown[]): SqliteRow | undefined;
  run(...parameters: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}

interface SqliteDatabase {
  readonly isOpen: boolean;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface SqliteApi {
  DatabaseSync: new (location: string) => SqliteDatabase;
  backup(source: SqliteDatabase, destination: string): Promise<void>;
}

interface TemporaryDatabase {
  readonly directory: string;
  readonly databasePath: string;
  readonly backupPath: string;
}

interface TemporaryDatabaseApi {
  withTemporaryDatabase<T>(
    work: (database: TemporaryDatabase) => T | PromiseLike<T>,
  ): Promise<T>;
}

interface FileSystemApi {
  existsSync(path: string): boolean;
}

const loadModule = require as unknown as (specifier: string) => unknown;
const { test } = loadModule("node:test") as NodeTestApi;
const { DatabaseSync, backup } = loadModule("node:sqlite") as SqliteApi;
const { withTemporaryDatabase } = loadModule(
  "../helpers/temporary-database.ts",
) as TemporaryDatabaseApi;
const { existsSync } = loadModule("node:fs") as FileSystemApi;

const FLOAT_TOLERANCE = 1e-6;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function bytesForVector(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}

function vectorFromBlob(value: unknown): Float32Array {
  assert(value instanceof Uint8Array, "SQLite BLOB did not return a Uint8Array");
  assert(
    value.byteLength % Float32Array.BYTES_PER_ELEMENT === 0,
    "SQLite BLOB length is not aligned to Float32 values",
  );

  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return new Float32Array(copy.buffer);
}

async function expectRejected(promise: Promise<unknown>, message: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    assert(error instanceof Error, "Expected a standard Error rejection");
    assertEqual(error.message, message, "Unexpected rejection message");
    return;
  }

  throw new Error("Expected the temporary-database callback to reject");
}

test("node:sqlite supports FTS5 virtual tables and MATCH queries", async () => {
  await withTemporaryDatabase(async ({ databasePath }) => {
    const database = new DatabaseSync(databasePath);

    try {
      database.exec("CREATE VIRTUAL TABLE documents USING fts5(title, body)");
      database
        .prepare("INSERT INTO documents(title, body) VALUES (?, ?)")
        .run("SQLite guide", "Node built-in SQLite capability evidence");

      const matches = database
        .prepare("SELECT title FROM documents WHERE documents MATCH ?")
        .all("capability");

      assertEqual(matches.length, 1, "FTS5 should return one matching row");
      assertEqual(matches[0]?.title, "SQLite guide", "FTS5 returned the wrong title");
    } finally {
      if (database.isOpen) {
        database.close();
      }
    }
  });
});

test("node:sqlite rolls back an explicit transaction", async () => {
  await withTemporaryDatabase(async ({ databasePath }) => {
    const database = new DatabaseSync(databasePath);

    try {
      database.exec("CREATE TABLE events (label TEXT NOT NULL)");
      database.exec(
        "BEGIN TRANSACTION; INSERT INTO events(label) VALUES ('rolled-back'); ROLLBACK",
      );

      const result = database.prepare("SELECT COUNT(*) AS count FROM events").get();
      assertEqual(result?.count, 0, "rolled-back rows must not remain visible");
    } finally {
      if (database.isOpen) {
        database.close();
      }
    }
  });
});

test("node:sqlite round-trips Float32 vectors through BLOBs", async () => {
  await withTemporaryDatabase(async ({ databasePath }) => {
    const database = new DatabaseSync(databasePath);

    try {
      const expected = new Float32Array([0.125, -2.5, Math.PI, 1000.25]);
      database.exec("CREATE TABLE embeddings (id TEXT PRIMARY KEY, vector BLOB NOT NULL)");
      database
        .prepare("INSERT INTO embeddings(id, vector) VALUES (?, ?)")
        .run("known-vector", bytesForVector(expected));

      const result = database
        .prepare("SELECT vector FROM embeddings WHERE id = ?")
        .get("known-vector");
      const actual = vectorFromBlob(result?.vector);

      assertEqual(actual.length, expected.length, "vector length changed during round-trip");
      for (let index = 0; index < expected.length; index += 1) {
        assert(
          Math.abs(actual[index] - expected[index]) <= FLOAT_TOLERANCE,
          `vector value at index ${index} exceeded tolerance`,
        );
      }
    } finally {
      if (database.isOpen) {
        database.close();
      }
    }
  });
});

test("node:sqlite backs up, closes, reopens, and queries a database copy", async () => {
  await withTemporaryDatabase(async ({ databasePath, backupPath }) => {
    const source = new DatabaseSync(databasePath);
    let backupHandle: SqliteDatabase | undefined;
    let reopened: SqliteDatabase | undefined;

    try {
      source.exec("CREATE TABLE copied_data (value TEXT NOT NULL)");
      source.prepare("INSERT INTO copied_data(value) VALUES (?)").run("backup evidence");

      await backup(source, backupPath);
      assert(existsSync(backupPath), "backup should create the destination file");

      backupHandle = new DatabaseSync(backupPath);
      source.close();
      backupHandle.close();

      reopened = new DatabaseSync(backupPath);
      const result = reopened.prepare("SELECT value FROM copied_data").get();
      assertEqual(result?.value, "backup evidence", "reopened backup returned the wrong value");
    } finally {
      if (reopened?.isOpen) {
        reopened.close();
      }
      if (backupHandle?.isOpen) {
        backupHandle.close();
      }
      if (source.isOpen) {
        source.close();
      }
    }
  });
});

test("temporary database paths are cleaned on success and callback failure", async () => {
  let successfulDirectory = "";
  await withTemporaryDatabase(async (database) => {
    successfulDirectory = database.directory;
  });
  assert(!existsSync(successfulDirectory), "successful probe directory was not removed");

  let failedDirectory = "";
  await expectRejected(
    withTemporaryDatabase(async (database) => {
      failedDirectory = database.directory;
      throw new Error("intentional cleanup failure");
    }),
    "intentional cleanup failure",
  );
  assert(!existsSync(failedDirectory), "failed probe directory was not removed");
});
