import type { JobBatchId, JobId } from "../../core/contracts/public.js";
import type { JobResultReference } from "../../modules/jobs/public.js";
import type {
  RunOneCommand,
  RunOneCommandFailure,
  RunOneCommandResult,
  RunOneCommandSuccess,
} from "../../apps/local-cli/run-one-command.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Assert<Condition extends true> = Condition;

type Idle = Extract<RunOneCommandSuccess, { readonly status: "idle" }>;
type Succeeded = Extract<
  RunOneCommandSuccess,
  { readonly status: "succeeded" }
>;
type FailureReported = Extract<
  RunOneCommandSuccess,
  { readonly status: "failure_reported" }
>;

type IdleContract = Assert<Equal<Idle, {
  readonly ok: true;
  readonly status: "idle";
}>>;
type SucceededContract = Assert<Equal<Succeeded, {
  readonly ok: true;
  readonly status: "succeeded";
  readonly jobId: JobId;
  readonly batchId: JobBatchId;
  readonly result: JobResultReference;
}>>;
type FailureReportedContract = Assert<Equal<FailureReported, {
  readonly ok: true;
  readonly status: "failure_reported";
  readonly jobId: JobId;
  readonly batchId: JobBatchId;
  readonly failureCode: string;
  readonly disposition: "retry" | "terminal";
}>>;
type FailureContract = Assert<Equal<RunOneCommandFailure, {
  readonly ok: false;
  readonly code:
    | "invalid_arguments"
    | "storage_unavailable"
    | "worker_unavailable"
    | "unexpected_failure";
}>>;
type ResultContract = Assert<Equal<RunOneCommandResult,
  | { readonly exitCode: 0; readonly output: RunOneCommandSuccess }
  | { readonly exitCode: 1 | 2 | 4 | 12; readonly output: RunOneCommandFailure }
>>;
type CommandContract = Assert<Equal<RunOneCommand,
  (arguments_: readonly string[]) => Promise<RunOneCommandResult>
>>;

type ForbiddenOutputKey =
  | "leaseToken"
  | "target"
  | "inputVersion"
  | "url"
  | "startedAt"
  | "completedAt"
  | "diagnostics";
type IdleForbiddenKeys = Assert<Equal<
  Extract<keyof Idle, ForbiddenOutputKey>,
  never
>>;
type SucceededForbiddenKeys = Assert<Equal<
  Extract<keyof Succeeded, ForbiddenOutputKey>,
  never
>>;
type FailureReportedForbiddenKeys = Assert<Equal<
  Extract<keyof FailureReported, ForbiddenOutputKey>,
  never
>>;
type FailureForbiddenKeys = Assert<Equal<
  Extract<keyof RunOneCommandFailure, ForbiddenOutputKey>,
  never
>>;

void (null as unknown as IdleContract);
void (null as unknown as SucceededContract);
void (null as unknown as FailureReportedContract);
void (null as unknown as FailureContract);
void (null as unknown as ResultContract);
void (null as unknown as CommandContract);
void (null as unknown as IdleForbiddenKeys);
void (null as unknown as SucceededForbiddenKeys);
void (null as unknown as FailureReportedForbiddenKeys);
void (null as unknown as FailureForbiddenKeys);
