import type { CatalogResourceLimits } from "./public.js";

declare const module: {
  exports: {
    CATALOG_RESOURCE_LIMITS: CatalogResourceLimits;
  };
};

const CATALOG_RESOURCE_LIMITS: CatalogResourceLimits = Object.freeze({
  maximumNodes: 20_000,
  maximumDepth: 256,
});

module.exports = { CATALOG_RESOURCE_LIMITS };
