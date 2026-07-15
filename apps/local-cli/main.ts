import type {
  ImportCommandResult,
  RunImportCommand,
} from "./import-command.js";
import type {
  InspectCommandResult,
  RunInspectCommand,
} from "./inspect-command.js";
import type {
  PreviewCommandResult,
  RunPreviewCommand,
} from "./preview-command.js";
import type {
  EnqueueCommandResult,
  RunEnqueueCommand,
} from "./enqueue-command.js";
import type {
  RunOneCommand,
  RunOneCommandResult,
} from "./run-one-command.js";

export type LocalCliMain = (arguments_: readonly string[]) => Promise<void>;

interface WritableStream {
  write(chunk: string): boolean;
}

interface ProcessApi {
  readonly argv: readonly string[];
  readonly stdout: WritableStream;
  readonly stderr: WritableStream;
  exitCode: number | undefined;
}

interface ImportCommandRuntime {
  runImportCommand: RunImportCommand;
}

interface InspectCommandRuntime {
  runInspectCommand: RunInspectCommand;
}

interface PreviewCommandRuntime {
  runPreviewCommand: RunPreviewCommand;
}

interface EnqueueCommandRuntime {
  runEnqueueCommand: RunEnqueueCommand;
}

interface RunOneCommandRuntime {
  runOneCommand: RunOneCommand;
}

type CommandResult =
  | ImportCommandResult
  | InspectCommandResult
  | PreviewCommandResult
  | EnqueueCommandResult
  | RunOneCommandResult;

declare const require: (
  specifier:
    | "node:process"
    | "./import-command.ts"
    | "./inspect-command.ts"
    | "./preview-command.ts"
    | "./enqueue-command.ts"
    | "./run-one-command.ts",
) => unknown;

const processApi = require("node:process") as ProcessApi;
const { runImportCommand } = require(
  "./import-command.ts",
) as ImportCommandRuntime;
const { runInspectCommand } = require(
  "./inspect-command.ts",
) as InspectCommandRuntime;
const { runPreviewCommand } = require(
  "./preview-command.ts",
) as PreviewCommandRuntime;
const { runEnqueueCommand } = require(
  "./enqueue-command.ts",
) as EnqueueCommandRuntime;
const { runOneCommand } = require(
  "./run-one-command.ts",
) as RunOneCommandRuntime;

const unexpected: CommandResult = {
  exitCode: 1,
  output: { ok: false, code: "unexpected_failure" },
};

const main: LocalCliMain = async (arguments_) => {
  let result: CommandResult;
  try {
    if (arguments_[0] === "inspect") {
      result = await runInspectCommand(arguments_.slice(1));
    } else if (arguments_[0] === "preview") {
      result = await runPreviewCommand(arguments_.slice(1));
    } else if (arguments_[0] === "enqueue") {
      result = await runEnqueueCommand(arguments_.slice(1));
    } else if (arguments_[0] === "worker:once") {
      result = await runOneCommand(arguments_.slice(1));
    } else {
      result = await runImportCommand(arguments_);
    }
  } catch {
    result = unexpected;
  }

  processApi.exitCode = result.exitCode;
  const stream = result.exitCode === 0 ? processApi.stdout : processApi.stderr;
  stream.write(`${JSON.stringify(result.output)}\n`);
};

void main(processApi.argv.slice(2));
