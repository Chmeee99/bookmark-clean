import type { Outcome } from "../../core/contracts/public.js";
import type { CatalogSnapshotStore } from "../../modules/catalog/public.js";
import type { HealthObservationRepository } from "../../modules/health/public.js";
import type { JobQueueStore } from "../../modules/jobs/public.js";
import {
  openBookmarkCleanDatabase,
  openCatalogDatabase,
  type BookmarkCleanDatabaseFailure,
  type BookmarkCleanDatabaseSession,
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
type ApplicationSessionContract = Assert<Equal<BookmarkCleanDatabaseSession, {
  readonly catalogStore: CatalogSnapshotStore;
  readonly jobQueueStore: JobQueueStore;
  readonly healthRepository: HealthObservationRepository;
  close(): void;
}>>;
type ApplicationFailureContract = Assert<Equal<BookmarkCleanDatabaseFailure, {
  readonly code: "storage_unavailable";
}>>;
type ApplicationOpenerContract = Assert<Equal<
  typeof openBookmarkCleanDatabase,
  (
    databasePath: string,
  ) => Outcome<BookmarkCleanDatabaseSession, BookmarkCleanDatabaseFailure>
>>;

declare const session: CatalogDatabaseSession;
declare const failure: CatalogDatabaseFailure;
declare const applicationSession: BookmarkCleanDatabaseSession;
declare const applicationFailure: BookmarkCleanDatabaseFailure;
// @ts-expect-error raw database handles never cross the session boundary
session.database.exec("SELECT 1");
// @ts-expect-error the broader session also hides the raw handle
applicationSession.database.exec("SELECT 1");
// @ts-expect-error open failures use one fixed code
failure.code = "migration_failed";
// @ts-expect-error broader open failures use one fixed code
applicationFailure.code = "migration_failed";

void (null as unknown as SessionContract);
void (null as unknown as FailureContract);
void (null as unknown as OpenerContract);
void (null as unknown as ApplicationSessionContract);
void (null as unknown as ApplicationFailureContract);
void (null as unknown as ApplicationOpenerContract);
