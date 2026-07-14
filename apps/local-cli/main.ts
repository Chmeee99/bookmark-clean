import type {
  ImportCommandResult,
  RunImportCommand,
} from "./import-command.js";
import type {
  InspectCommandResult,
  RunInspectCommand,
} from "./inspect-command.js";

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

type CommandResult = ImportCommandResult | InspectCommandResult;

declare const require: (
  specifier: "node:process" | "./import-command.ts" | "./inspect-command.ts",
) => unknown;

const processApi = require("node:process") as ProcessApi;
const { runImportCommand } = require(
  "./import-command.ts",
) as ImportCommandRuntime;
const { runInspectCommand } = require(
  "./inspect-command.ts",
) as InspectCommandRuntime;

const unexpected: CommandResult = {
  exitCode: 1,
  output: { ok: false, code: "unexpected_failure" },
};

const main: LocalCliMain = async (arguments_) => {
  let result: CommandResult;
  try {
    result = arguments_[0] === "inspect"
      ? await runInspectCommand(arguments_.slice(1))
      : await runImportCommand(arguments_);
  } catch {
    result = unexpected;
  }

  processApi.exitCode = result.exitCode;
  const stream = result.exitCode === 0 ? processApi.stdout : processApi.stderr;
  stream.write(`${JSON.stringify(result.output)}\n`);
};

void main(processApi.argv.slice(2));
