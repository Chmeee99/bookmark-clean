import type { Outcome } from "../../core/contracts/public.js";
import type { CatalogSnapshotStore } from "../../modules/catalog/public.js";
import {
  openCatalogDatabase,
  type CatalogDatabaseFailure,
  type CatalogDatabaseSession,
} from "../../adapters/sqlite/public.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Assert<Condition extends true> = Condition;

type SessionContract = Assert<Equal<CatalogDatabaseSession, {
  readonly store: CatalogSnapshotStore;
  close(): void;
}>>;
type FailureContract = Assert<Equal<CatalogDatabaseFailure, {
  readonly code: "storage_unavailable";
}>>;
type OpenerContract = Assert<Equal<
  typeof openCatalogDatabase,
  (databasePath: string) => Outcome<CatalogDatabaseSession, CatalogDatabaseFailure>
>>;

declare const session: CatalogDatabaseSession;
declare const failure: CatalogDatabaseFailure;
// @ts-expect-error raw database handles never cross the session boundary
session.database.exec("SELECT 1");
// @ts-expect-error open failures use one fixed code
failure.code = "migration_failed";

void (null as unknown as SessionContract);
void (null as unknown as FailureContract);
void (null as unknown as OpenerContract);
