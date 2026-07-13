# Queue resume trace

This test answers one practical question: what happens if the service disappears after a handler has saved useful work and before the queue hears about it?

The short answer is that the saved result survives, the lease expires, and the next worker reuses the same result. The queue finishes without creating a duplicate.

## The run

The fixture creates a two-job `health_check` batch in a real SQLite file. A test-only result repository uses a stable key made from job type, bookmark target, and input version. Lease tokens, worker IDs, job IDs, and attempt numbers are excluded from that key.

| Point | Job 1 | Job 2 | Durable results |
| --- | --- | --- | --- |
| Enqueue | `pending`, attempt 0 | `pending`, attempt 0 | 0 |
| First lease | `leased`, attempt 1, `lease-1` | `pending`, attempt 0 | 0 |
| Handler interruption | still `leased` | still `pending` | `fake-result-1` committed |
| Reopen at expiry | recovered and leased, attempt 2, `lease-2` | still `pending` | same `fake-result-1` loaded |
| First resumed success | `succeeded`, attempt 2 | `pending`, attempt 0 | 1 |
| Second resumed success | `succeeded`, attempt 2 | `succeeded`, attempt 1, `lease-3` | `fake-result-1`, `fake-result-2` |
| Final worker call | unchanged | unchanged | unchanged; worker reports `idle` |

The attempt-1 lease is kept by the test. Submitting it after recovery returns `stale_lease` and changes no queue or result rows. A second close and reopen confirms that the final progress and both result rows remain intact.

## Why the order matters

The handler commits its domain result before returning a result reference to the worker. There is an unavoidable gap between that commit and the queue's `succeed` call. A crash inside that gap leaves a durable result alongside an unfinished lease.

The recovery design handles that gap in two parts:

1. The queue treats the unfinished lease as expired work and issues a new attempt.
2. The handler treats the stable input as already processed and returns the existing result reference.

The queue owns attempts and leases. The handler owns result idempotency. Keeping those responsibilities separate means retries do not need to inspect exception text or guess whether an earlier handler call finished its write.

## What this proves

The executable trace covers result-before-success ordering, lease expiry at the exact time boundary, database reopen, attempt progression, stale-token rejection, handler idempotency, ordered completion of the remaining job, idle termination, and persistence after a second reopen.

The test uses deterministic in-memory clocks and ID sequences so every row can be asserted exactly. A production composition root will use a real clock and collision-resistant IDs.

This is infrastructure evidence for MVP acceptance criterion 2. Full acceptance still requires selected-folder planning, the long-running service composition, and user-facing stop/resume controls.

Run it with:

```sh
npm run test:jobs-worker-resume
```

The executable source is [job-worker-resume.test.ts](../../tests/integration/job-worker-resume.test.ts).
