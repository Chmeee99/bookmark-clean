class StoredQueueInvalidError extends Error {
  constructor() {
    super("stored_queue_invalid");
    this.name = "StoredQueueInvalidError";
  }
}

function rejectStoredQueue(): never {
  throw new StoredQueueInvalidError();
}

function isStoredQueueInvalid(error: unknown): boolean {
  return error instanceof StoredQueueInvalidError;
}

interface StoredQueueIntegrityApi {
  rejectStoredQueue: typeof rejectStoredQueue;
  isStoredQueueInvalid: typeof isStoredQueueInvalid;
}

declare const module: { exports: StoredQueueIntegrityApi };

module.exports = { rejectStoredQueue, isStoredQueueInvalid };
