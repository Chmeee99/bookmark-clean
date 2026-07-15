import type { CatalogStorageFailure } from "../catalog/public.js";
import type {
  JobHandler,
  TypedJobFailure,
} from "../jobs/public.js";
import type { HealthCheckJobHandlerDependencies } from "./public.js";

declare const module: {
  exports: {
    createHealthCheckJobHandler: typeof createHealthCheckJobHandler;
  };
};

function catalogFailure(
  failure: CatalogStorageFailure,
): TypedJobFailure {
  switch (failure.code) {
    case "storage_unavailable":
      return { code: "catalog_unavailable", disposition: "retry" };
    case "stored_snapshot_invalid":
      return { code: "bookmark_invalid", disposition: "terminal" };
    case "snapshot_exists":
      throw new Error("Unexpected Catalog read failure");
  }
}

function createHealthCheckJobHandler({
  catalog,
  checker,
}: HealthCheckJobHandlerDependencies): JobHandler {
  return {
    type: "health_check",
    async handle(lease) {
      const bookmark = await catalog.getBookmark(lease.target.bookmarkId);
      if (!bookmark.ok) {
        return { ok: false, error: catalogFailure(bookmark.error) };
      }
      if (bookmark.value === null) {
        return {
          ok: false,
          error: { code: "bookmark_not_found", disposition: "terminal" },
        };
      }

      const checked = await checker.check({
        bookmarkId: lease.target.bookmarkId,
        inputVersion: lease.target.inputVersion,
        url: bookmark.value.url,
      });
      if (!checked.ok) {
        return checked;
      }
      return {
        ok: true,
        value: { kind: "health_observation", id: checked.value.id },
      };
    },
  };
}

module.exports = { createHealthCheckJobHandler };
