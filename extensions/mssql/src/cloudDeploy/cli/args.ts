/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy CLI — argument parsing.
 *
 * Pure, side-effect-free parsing of `run-gates` arguments using Node's built-in
 * `util.parseArgs` (no third-party dependency). Splitting this out from the
 * entry point keeps the parser unit-testable in isolation: it never reads
 * `process.argv`, never writes to a stream, and never exits — it returns a
 * typed `CliArgs` or throws `CliUsageError`.
 */

import { parseArgs } from "util";

/** The parsed, validated `run-gates` arguments. */
export interface CliArgs {
    /** Environment id to validate (must exist in the config file). */
    readonly envId: string;
    /** Path to `.mssql/environments.json`. */
    readonly configPath: string;
    /** Destination path for the produced `.cdrun.zip`. */
    readonly outPath: string;
    /** Source-path resolution root. Defaults to the config file's grandparent. */
    readonly workspaceRoot?: string;
    /** Git commit SHA the run validated; stamped onto the run record's source version. */
    readonly sourceCommit?: string;
    /** PR number / ref the run validated; stamped onto the run record's source version. */
    readonly sourceRef?: string;
    /** Baseline `.cdrun.zip` to diff the produced run against. */
    readonly baselinePath?: string;
    /** Destination path for a Markdown validation report (the PR comment body). */
    readonly reportOut?: string;
}

/**
 * Thrown for any argument problem (missing required flag, unknown flag) and for
 * an explicit `--help`. `isHelp` lets the entry point print usage to stdout and
 * exit 0 for help, versus stderr and exit 2 for a real error.
 */
export class CliUsageError extends Error {
    public constructor(
        message: string,
        public readonly isHelp: boolean = false,
    ) {
        super(message);
        this.name = "CliUsageError";
    }
}

/** The `run-gates` subcommand token, accepted (and ignored) as an optional leading positional. */
const RUN_GATES_COMMAND = "run-gates";

export const USAGE = `Cloud Deploy — schema validation CLI

Usage:
  mssql-validate run-gates --env <env-id> --config <path> --out <path> [options]

Required:
  --env <env-id>        Environment id to validate (from the config file)
  --config <path>       Path to .mssql/environments.json
  --out <path>          Destination path for the produced .cdrun.zip

Options:
  --workspace <dir>     Source-path root (default: the config file's grandparent)
  --source-commit <sha> Git commit SHA the run validated (stamped on the artifact)
  --source-ref <ref>    PR number / ref the run validated (stamped on the artifact)
  --baseline <path>     Baseline .cdrun.zip to diff the produced run against
  --report-out <path>   Write a Markdown validation report (PR comment body) here
  -h, --help            Print this help and exit

Exit codes:
  0   Run completed; worst status was Passed, Skipped, or Warning
  1   A gate Failed or Errored
  2   Usage error (bad flag, config not found, env id not found)
  130 Cancelled`;

/**
 * Parses `run-gates` arguments. Accepts an optional leading `run-gates`
 * positional (forward-compat for future subcommands). Throws `CliUsageError`
 * on `--help`, an unknown flag, an unexpected positional, or a missing required
 * flag.
 */
export function parseCliArgs(argv: readonly string[]): CliArgs {
    let parsed: ReturnType<typeof parseArgs<ParseConfig>>;
    try {
        parsed = parseArgs({
            args: [...argv],
            options: {
                env: { type: "string" },
                config: { type: "string" },
                out: { type: "string" },
                workspace: { type: "string" },
                "source-commit": { type: "string" },
                "source-ref": { type: "string" },
                baseline: { type: "string" },
                "report-out": { type: "string" },
                help: { type: "boolean", short: "h" },
            },
            allowPositionals: true,
            strict: true,
        });
    } catch (err) {
        throw new CliUsageError((err as Error).message);
    }

    const { values, positionals } = parsed;

    if (values.help) {
        throw new CliUsageError(USAGE, true);
    }

    for (const positional of positionals) {
        if (positional !== RUN_GATES_COMMAND) {
            throw new CliUsageError(`Unexpected argument: "${positional}".`);
        }
    }

    const envId = requireFlag(values.env, "--env");
    const configPath = requireFlag(values.config, "--config");
    const outPath = requireFlag(values.out, "--out");

    return {
        envId,
        configPath,
        outPath,
        workspaceRoot: values.workspace,
        sourceCommit: values["source-commit"],
        sourceRef: values["source-ref"],
        baselinePath: values.baseline,
        reportOut: values["report-out"],
    };
}

type ParseConfig = {
    readonly options: {
        readonly env: { readonly type: "string" };
        readonly config: { readonly type: "string" };
        readonly out: { readonly type: "string" };
        readonly workspace: { readonly type: "string" };
        readonly "source-commit": { readonly type: "string" };
        readonly "source-ref": { readonly type: "string" };
        readonly baseline: { readonly type: "string" };
        readonly "report-out": { readonly type: "string" };
        readonly help: { readonly type: "boolean"; readonly short: "h" };
    };
    readonly allowPositionals: true;
    readonly strict: true;
};

function requireFlag(value: string | undefined, flag: string): string {
    if (value === undefined || value.length === 0) {
        throw new CliUsageError(`Missing required flag: ${flag}.`);
    }
    return value;
}
