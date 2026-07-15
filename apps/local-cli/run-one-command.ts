import type { JobBatchId, JobId, WorkerId } from "../../core/contracts/public.js";
import type {
  JobResultReference,
  JobWorkerFailure,
  JobWorkerStep,
} from "../../modules/jobs/public.js";
import type {
  HealthWorkerSessionConfig,
  openHealthWorkerSession,
} from "./health-worker-session.js";

export type RunOneCommandSuccess =
  | {
      readonly ok: true;
      readonly status: "idle";
    }
  | {
      readonly ok: true;
      readonly status: "succeeded";
      readonly jobId: JobId;
      readonly batchId: JobBatchId;
      readonly result: JobResultReference;
    }
  | {
      readonly ok: true;
      readonly status: "failure_reported";
      readonly jobId: JobId;
      readonly batchId: JobBatchId;
      readonly failureCode: string;
      readonly disposition: "retry" | "terminal";
    };

export interface RunOneCommandFailure {
  readonly ok: false;
  readonly code:
    | "invalid_arguments"
    | "storage_unavailable"
    | "worker_unavailable"
    | "unexpected_failure";
}

export type RunOneCommandResult =
  | {
      readonly exitCode: 0;
      readonly output: RunOneCommandSuccess;
    }
  | {
      readonly exitCode: 1 | 2 | 4 | 12;
      readonly output: RunOneCommandFailure;
    };

export type RunOneCommand = (
  arguments_: readonly string[],
) => Promise<RunOneCommandResult>;

interface HealthWorkerSessionRuntime {
  openHealthWorkerSession: typeof openHealthWorkerSession;
}

declare const require: (specifier: "./health-worker-session.ts") => unknown;
declare const module: { exports: { runOneCommand: RunOneCommand } };

const { openHealthWorkerSession: openSession } = require(
  "./health-worker-session.ts",
) as HealthWorkerSessionRuntime;

const PROFILE: HealthWorkerSessionConfig = {
  health: {
    timeoutMs: 10_000,
    maxRedirects: 5,
    maxBodyBytes: 65_536,
  },
  queue: { leaseDurationMs: 300_000 },
  retrySchedule: {
    nextRetryAt(_attempt, failedAt) {
      return failedAt;
    },
  },
};

function failure(
  exitCode: 2 | 4 | 12,
  code: RunOneCommandFailure["code"],
): RunOneCommandResult {
  return { exitCode, output: { ok: false, code } };
}

function completed(step: JobWorkerStep): RunOneCommandResult {
  switch (step.status) {
    case "idle":
      return { exitCode: 0, output: { ok: true, status: "idle" } };
    case "succeeded":
      return {
        exitCode: 0,
        output: {
          ok: true,
          status: "succeeded",
          jobId: step.lease.jobId,
          batchId: step.lease.batchId,
          result: step.result,
        },
      };
    case "failure_reported":
      return {
        exitCode: 0,
        output: {
          ok: true,
          status: "failure_reported",
          jobId: step.lease.jobId,
          batchId: step.lease.batchId,
          failureCode: step.failure.code,
          disposition: step.failure.disposition,
        },
      };
  }
}

function workerFailure(error: JobWorkerFailure): RunOneCommandResult {
  if (error.code === "invalid_handler_output") {
    throw new Error("Health worker returned invalid handler output");
  }
  if (
    error.code === "queue_failure"
    && error.failure.code === "storage_unavailable"
  ) {
    return failure(4, "storage_unavailable");
  }
  return failure(12, "worker_unavailable");
}

const runOneCommand: RunOneCommand = async (arguments_) => {
  if (
    arguments_.length !== 2
    || arguments_[0] !== "--database"
    || arguments_[1].length === 0
  ) {
    return failure(2, "invalid_arguments");
  }

  const opened = openSession(arguments_[1], PROFILE);
  if (!opened.ok) {
    if (opened.error.code === "storage_unavailable") {
      return failure(4, "storage_unavailable");
    }
    throw new Error("Health worker session configuration is invalid");
  }

  try {
    const result = await opened.value.worker.runOne({
      id: "worker:local-once" as WorkerId,
    });
    return result.ok ? completed(result.value) : workerFailure(result.error);
  } finally {
    opened.value.close();
  }
};

module.exports = { runOneCommand };
