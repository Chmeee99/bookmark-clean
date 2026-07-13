export type BookmarkId = string & { readonly __brand: "BookmarkId" };
export type SnapshotId = string & { readonly __brand: "SnapshotId" };
export type JobId = string & { readonly __brand: "JobId" };
export type JobBatchId = string & { readonly __brand: "JobBatchId" };
export type WorkerId = string & { readonly __brand: "WorkerId" };
export type JobLeaseToken = string & { readonly __brand: "JobLeaseToken" };
export type JobResultId = string & { readonly __brand: "JobResultId" };
export type ReviewItemId = string & { readonly __brand: "ReviewItemId" };
export type ContentHash = string & { readonly __brand: "ContentHash" };
export type ModelProfileId = string & { readonly __brand: "ModelProfileId" };
export type IsoDateTime = string & { readonly __brand: "IsoDateTime" };

export type Outcome<T, E extends { code: string }> =
  | { ok: true; value: T }
  | { ok: false; error: E };
