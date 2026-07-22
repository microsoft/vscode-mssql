/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as path from "path";
import {
    HEADLESS_EXIT_CODES,
    headlessCapabilities,
    runHeadlessPreview,
    validateHeadlessPreview,
} from "./headlessRunner";
import { parseHeadlessCliArguments } from "./headlessCliArguments";
import { writeHeadlessRunOutputs } from "./headlessOutputStore";
import {
    EnvironmentHeadlessSecretProvider,
    HeadlessApprovalManifest,
    ManifestHeadlessApprovalProvider,
} from "./headlessExecutionProviders";
import { runHeadlessActivities } from "./headlessActivityRunner";

const MAX_PARAMETER_BYTES = 1024 * 1024;

async function main(): Promise<number> {
    const args = parseHeadlessCliArguments(process.argv.slice(2));
    if (!args.command || args.error) {
        writeJson({
            schemaVersion: 1,
            error: args.error ?? "HeadlessPreview.Usage",
            usage: [
                "runbookHeadless capabilities --json",
                "runbookHeadless validate <artifact> [--params <json>]",
                "runbookHeadless run <artifact> --deterministic-preview [--approve-preview | --approval-manifest <json>] [--secret-env-map <json>] [--params <json>] [--output <dir>] [--run-id <id>]",
                "runbookHeadless run-activities <artifact> --workspace <trusted-root> --activity-artifacts <dir> [--approval-manifest <json>] [--secret-env-map <json>] [--params <json>] [--output <dir>] [--run-id <id>]",
            ],
        });
        return HEADLESS_EXIT_CODES.invalid;
    }
    if (args.command === "capabilities") {
        writeJson(headlessCapabilities());
        return HEADLESS_EXIT_CODES.pass;
    }
    if (!args.artifactPath) {
        writeJson({ schemaVersion: 1, error: "HeadlessPreview.ArtifactRequired" });
        return HEADLESS_EXIT_CODES.invalid;
    }
    try {
        const artifactText = readBoundedText(args.artifactPath, 2 * 1024 * 1024);
        const parameters = args.paramsPath ? readParameters(args.paramsPath) : {};
        if (args.command === "validate") {
            const checked = await validateHeadlessPreview(artifactText, parameters);
            writeJson(checked.result);
            return checked.result.valid
                ? checked.result.executable
                    ? HEADLESS_EXIT_CODES.pass
                    : HEADLESS_EXIT_CODES.blocked
                : HEADLESS_EXIT_CODES.invalid;
        }
        const secretProvider = args.secretEnvironmentMapPath
            ? new EnvironmentHeadlessSecretProvider(readStringMap(args.secretEnvironmentMapPath))
            : undefined;
        const approvalProvider = args.approvalManifestPath
            ? new ManifestHeadlessApprovalProvider(
                  JSON.parse(
                      readBoundedText(args.approvalManifestPath, MAX_PARAMETER_BYTES),
                  ) as HeadlessApprovalManifest,
              )
            : undefined;
        if (
            args.command === "run-activities" &&
            (!args.trustedWorkspaceRoot || !args.activityArtifactRoot)
        ) {
            writeJson({ schemaVersion: 1, error: "HeadlessActivity.HostPathsRequired" });
            return HEADLESS_EXIT_CODES.invalid;
        }
        const result =
            args.command === "run-activities"
                ? await runActivitiesWithInterruptCancellation(
                      artifactText,
                      parameters,
                      args,
                      secretProvider,
                      approvalProvider,
                  )
                : await runWithInterruptCancellation(
                      artifactText,
                      parameters,
                      args,
                      secretProvider,
                      approvalProvider,
                  );
        const summary = {
            schemaVersion: result.schemaVersion,
            mode: result.mode,
            outcome: result.outcome,
            exitCode: result.exitCode,
            runId: result.runId,
            runbookId: result.runbookId,
            planRevision: result.planRevision,
            planHash: result.planHash,
            terminalState: result.terminalState,
            verdict: result.verdict,
            blockedGateId: result.blockedGateId,
            approvalPolicyDigest: result.approvalPolicyDigest,
            nodeCounts: result.nodeCounts,
            ...(result.mode === "productionActivityHost"
                ? { effects: result.effects, outputs: result.outputs }
                : { evidenceAvailable: result.evidenceAvailable }),
            validation: result.validation,
        };
        if (args.outputDirectory) {
            try {
                writeHeadlessRunOutputs(
                    args.outputDirectory,
                    summary,
                    result.mode === "deterministicPreview" ? result.exports : undefined,
                );
            } catch {
                writeJson({ schemaVersion: 1, error: "HeadlessPreview.OutputUnwritable" });
                return HEADLESS_EXIT_CODES.internal;
            }
        }
        writeJson(summary);
        return result.exitCode;
    } catch {
        writeJson({ schemaVersion: 1, error: "HeadlessPreview.InputUnreadable" });
        return HEADLESS_EXIT_CODES.invalid;
    }
}

async function runActivitiesWithInterruptCancellation(
    artifactText: string,
    parameters: Record<string, string | number | boolean | null>,
    args: ReturnType<typeof parseHeadlessCliArguments>,
    secretProvider: EnvironmentHeadlessSecretProvider | undefined,
    approvalProvider: ManifestHeadlessApprovalProvider | undefined,
) {
    const cancellation = new AbortController();
    const onInterrupt = () => cancellation.abort();
    process.once("SIGINT", onInterrupt);
    try {
        return await runHeadlessActivities({
            artifactText,
            trustedWorkspaceRoot: args.trustedWorkspaceRoot!,
            activityArtifactRoot: args.activityArtifactRoot!,
            parameterValues: parameters,
            ...(args.runId ? { runId: args.runId } : {}),
            ...(secretProvider ? { secretProvider, allowInlineSecrets: false } : {}),
            ...(approvalProvider ? { approvalProvider } : {}),
            cancellationSignal: cancellation.signal,
        });
    } finally {
        process.removeListener("SIGINT", onInterrupt);
    }
}

async function runWithInterruptCancellation(
    artifactText: string,
    parameters: Record<string, string | number | boolean | null>,
    args: ReturnType<typeof parseHeadlessCliArguments>,
    secretProvider: EnvironmentHeadlessSecretProvider | undefined,
    approvalProvider: ManifestHeadlessApprovalProvider | undefined,
) {
    const cancellation = new AbortController();
    const onInterrupt = () => cancellation.abort();
    process.once("SIGINT", onInterrupt);
    try {
        return await runHeadlessPreview({
            artifactText,
            parameterValues: parameters,
            ...(args.runId ? { runId: args.runId } : {}),
            deterministicPreviewAcknowledged: args.deterministicPreview,
            approvePreviewGates: args.approvePreview,
            ...(secretProvider ? { secretProvider, allowInlineSecrets: false } : {}),
            ...(approvalProvider ? { approvalProvider } : {}),
            cancellationSignal: cancellation.signal,
        });
    } finally {
        process.removeListener("SIGINT", onInterrupt);
    }
}

function readStringMap(filePath: string): Record<string, string> {
    const parsed: unknown = JSON.parse(readBoundedText(filePath, MAX_PARAMETER_BYTES));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("mapping must be an object");
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (typeof value !== "string") {
            throw new Error("mapping values must be strings");
        }
        result[key] = value;
    }
    return result;
}

function readBoundedText(filePath: string, maximumBytes: number): string {
    const resolved = path.resolve(filePath);
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size <= 0 || stat.size > maximumBytes) {
        throw new Error("input size invalid");
    }
    return fs.readFileSync(resolved, "utf8");
}

function readParameters(filePath: string): Record<string, string | number | boolean | null> {
    const parsed: unknown = JSON.parse(readBoundedText(filePath, MAX_PARAMETER_BYTES));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("parameters must be an object");
    }
    const result: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (
            value !== null &&
            typeof value !== "string" &&
            typeof value !== "number" &&
            typeof value !== "boolean"
        ) {
            throw new Error("parameter values must be scalar");
        }
        result[key] = value;
    }
    return result;
}

function writeJson(value: unknown): void {
    process.stdout.write(JSON.stringify(value, undefined, 2) + "\n");
}

void main().then(
    (exitCode) => {
        process.exitCode = exitCode;
    },
    () => {
        writeJson({ schemaVersion: 1, error: "HeadlessPreview.Internal" });
        process.exitCode = HEADLESS_EXIT_CODES.internal;
    },
);
