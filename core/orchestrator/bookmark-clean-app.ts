import type {
  BookmarkCleanApp,
  BookmarkCleanAppDependencies,
} from "./public.js";

function createBookmarkCleanApp(
  dependencies: BookmarkCleanAppDependencies,
): BookmarkCleanApp {
  return {
    async importChromeHtml(request) {
      const parsed = dependencies.importer.parse(request);
      if (!parsed.ok) {
        return {
          ok: false,
          error: { stage: "source", failure: parsed.error },
        };
      }

      const imported = await dependencies.catalog.importSnapshot(parsed.value);
      if (!imported.ok) {
        return {
          ok: false,
          error: { stage: "catalog", failure: imported.error },
        };
      }

      return imported;
    },
  };
}

declare const module: {
  exports: { createBookmarkCleanApp: typeof createBookmarkCleanApp };
};

module.exports = { createBookmarkCleanApp };
