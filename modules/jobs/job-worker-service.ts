import type {
  JobHandler,
  JobQueue,
  JobQueueFailure,
  JobWorker,
  JobWorkerConfigurationFailure,
  JobWorkerFailure,
  JobWorkerOperation,
  JobWorkerStep,
  WorkerIdentity,
} from "./public.js";
import type { Outcome } from "../../core/contracts/public.js";
import type {
  HandlerRoute,
  InvalidHandlerOutput,
  ValidatedHandlerOutcome,
  ValidatedHandlerRegistry,
} from "./job-worker-validation.js";

interface WorkerValidationApi {
  validateHandlerRegistry(
    input: unknown,
  ): Outcome<ValidatedHandlerRegistry, JobWorkerConfigurationFailure>;
  validateHandlerOutcome(
    input: unknown,
  ): Outcome<ValidatedHandlerOutcome, InvalidHandlerOutput>;
}

declare const require: (specifier: "./job-worker-validation.ts") => unknown;
declare const module: { exports: Record<string, unknown> };

const { validateHandlerRegistry, validateHandlerOutcome } = require(
  "./job-worker-validation.ts",
) as WorkerValidationApi;

function queueFailure(
  operation: JobWorkerOperation,
  failure: JobQueueFailure,
): { readonly ok: false; readonly error: JobWorkerFailure } {
  return {
    ok: false,
    error: { code: "queue_failure", operation, failure },
  };
}

function queueInterrupted(
  operation: JobWorkerOperation,
): { readonly ok: false; readonly error: JobWorkerFailure } {
  return { ok: false, error: { code: "queue_interrupted", operation } };
}

function handlerInterrupted(): {
  readonly ok: false;
  readonly error: JobWorkerFailure;
} {
  return { ok: false, error: { code: "handler_interrupted" } };
}

function createJobWorker(
  queue: JobQueue,
  handlers: readonly JobHandler[],
): Outcome<JobWorker, JobWorkerConfigurationFailure> {
  const registry = validateHandlerRegistry(handlers);
  if (!registry.ok) {
    return registry;
  }

  const { capabilities, routes } = registry.value;

  async function runOne(
    worker: WorkerIdentity,
  ): Promise<Outcome<JobWorkerStep, JobWorkerFailure>> {
    let leaseOutcome: Awaited<ReturnType<JobQueue["lease"]>>;
    try {
      leaseOutcome = await queue.lease(worker, capabilities);
    } catch {
      return queueInterrupted("lease");
    }

    if (!leaseOutcome.ok) {
      return queueFailure("lease", leaseOutcome.error);
    }
    if (leaseOutcome.value === null) {
      return { ok: true, value: { status: "idle" } };
    }

    const lease = leaseOutcome.value;
    const route: HandlerRoute = routes[lease.type];
    let handlerOutcome: unknown;
    try {
      handlerOutcome = await route.handle(lease);
    } catch {
      return handlerInterrupted();
    }

    const validated = validateHandlerOutcome(handlerOutcome);
    if (!validated.ok) {
      return validated;
    }

    if (validated.value.kind === "success") {
      let reportOutcome: Awaited<ReturnType<JobQueue["succeed"]>>;
      try {
        reportOutcome = await queue.succeed(lease, validated.value.result);
      } catch {
        return queueInterrupted("succeed");
      }
      if (!reportOutcome.ok) {
        return queueFailure("succeed", reportOutcome.error);
      }
      return {
        ok: true,
        value: {
          status: "succeeded",
          lease,
          result: validated.value.result,
        },
      };
    }

    let reportOutcome: Awaited<ReturnType<JobQueue["fail"]>>;
    try {
      reportOutcome = await queue.fail(lease, validated.value.failure);
    } catch {
      return queueInterrupted("fail");
    }
    if (!reportOutcome.ok) {
      return queueFailure("fail", reportOutcome.error);
    }
    return {
      ok: true,
      value: {
        status: "failure_reported",
        lease,
        failure: validated.value.failure,
      },
    };
  }

  return { ok: true, value: { runOne } };
}

module.exports = { createJobWorker };
