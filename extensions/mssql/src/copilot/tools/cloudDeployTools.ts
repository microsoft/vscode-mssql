/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import { ToolBase } from "./toolBase";
import * as Constants from "../../constants/constants";
import { MssqlChatAgent as loc } from "../../constants/locConstants";
import { getErrorMessage } from "../../utils/utils";
import type { CloudDeployService } from "../../cloudDeploy/cloudDeployService";
import {
    Environment,
    SourceOfTruth,
    SourceOfTruthKind,
    ValidationConfig,
    ValidationType,
} from "../../cloudDeploy/environments/types";
import { Finding, RunRecord, ValidationStatus } from "../../cloudDeploy/runs/types";

/**
 * Cloud Deploy — Copilot agent tools.
 *
 * Language-model tools that let an agent drive the Cloud Deploy loop the way a
 * person would: enumerate environments, create one (asking the user for any
 * missing detail), run the validation gates, and read back the structured
 * findings so it can propose a fix. Each tool is a thin wrapper over the
 * `CloudDeployService` facade — the same seam the commands and webviews use —
 * so there is no duplicated orchestration and every result is machine-readable.
 *
 * The service is resolved lazily through an accessor because the tools are
 * registered during activation BEFORE the service instance exists; the accessor
 * is invoked per call, by which time activation has wired the service.
 */

/** Resolves the live `CloudDeployService`. Lazy: called per tool invocation. */
export type CloudDeployServiceAccessor = () => CloudDeployService;

// =============================================================================
// Shared projections (structured, machine-readable output for the model)
// =============================================================================

const SOURCE_OF_TRUTH_KINDS: readonly string[] = [
    SourceOfTruthKind.SqlProj,
    SourceOfTruthKind.Dacpac,
    SourceOfTruthKind.Connection,
];

/** Validations enabled by default when the caller names none. */
const DEFAULT_VALIDATION_TYPES: readonly ValidationType[] = [
    ValidationType.Connectivity,
    ValidationType.StaticAnalysis,
];

/** Flattens an environment's source-of-truth union into a plain object. */
function describeSourceOfTruth(sourceOfTruth: SourceOfTruth): Record<string, unknown> {
    switch (sourceOfTruth.kind) {
        case SourceOfTruthKind.SqlProj:
        case SourceOfTruthKind.Dacpac:
            return { kind: sourceOfTruth.kind, path: sourceOfTruth.path };
        case SourceOfTruthKind.Connection:
            return {
                kind: sourceOfTruth.kind,
                connectionProfileId: sourceOfTruth.connectionProfileId,
            };
    }
}

/** Compact, machine-readable projection of a single finding, per its kind. */
function summarizeFinding(finding: Finding): Record<string, unknown> {
    switch (finding.kind) {
        case "static-analysis":
            return {
                kind: finding.kind,
                rule: finding.ruleId,
                severity: finding.severity,
                message: finding.message,
                ...(finding.location !== undefined
                    ? { file: finding.location.file, line: finding.location.line }
                    : {}),
            };
        case "unit-tests":
            return {
                kind: finding.kind,
                test: finding.testName,
                outcome: finding.outcome,
                ...(finding.message !== undefined ? { message: finding.message } : {}),
            };
        case "workload-playback":
            return {
                kind: finding.kind,
                step: finding.stepId,
                regression: finding.regression,
                delta: finding.delta,
                message: finding.message,
            };
        case "connectivity":
            return { kind: finding.kind, outcome: finding.outcome, message: finding.message };
    }
}

/**
 * Projects a run record into the shape the agent reasons over: the rollup
 * status, a pass/total tally, and each gate with its concrete findings. This
 * is what turns "validate" into "validate and report back" — the model gets
 * rule ids, files, and lines it can act on, not prose to scrape.
 */
function summarizeRun(record: RunRecord): Record<string, unknown> {
    const gates = record.validations.map((validation) => ({
        id: validation.validationId,
        name: validation.displayName,
        status: validation.status,
        ...(validation.errorMessage !== undefined && validation.errorMessage.length > 0
            ? { error: validation.errorMessage }
            : {}),
        findings: validation.payload.findings.map(summarizeFinding),
    }));
    const gatesPassed = record.validations.filter(
        (validation) => validation.status === ValidationStatus.Passed,
    ).length;
    return {
        runId: record.runId,
        environmentId: record.environmentId,
        status: record.status,
        gatesPassed,
        gatesTotal: record.validations.length,
        gates,
    };
}

// =============================================================================
// create_environment input parsing (the "ask for missing info" contract)
// =============================================================================

/** A required field the caller omitted, surfaced so the agent can ask for it. */
interface MissingField {
    readonly field: string;
    readonly hint: string;
    readonly options?: readonly string[];
}

/** Returns the trimmed string, or undefined when absent/blank. */
function trimmed(value: string | undefined): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }
    const t = value.trim();
    return t.length > 0 ? t : undefined;
}

/** Maps a validation-type token to its enabled config, or undefined if unknown. */
function toValidationConfig(type: string): ValidationConfig | undefined {
    switch (type) {
        case ValidationType.Connectivity:
            return { type: ValidationType.Connectivity, enabled: true, settings: {} };
        case ValidationType.StaticAnalysis:
            return { type: ValidationType.StaticAnalysis, enabled: true, settings: {} };
        case ValidationType.UnitTests:
            return { type: ValidationType.UnitTests, enabled: true, settings: {} };
        case ValidationType.WorkloadPlayback:
            return { type: ValidationType.WorkloadPlayback, enabled: true, settings: {} };
        default:
            return undefined;
    }
}

/** Builds the validation configs, de-duplicated, defaulting when none named. */
function buildValidationConfigs(types: string[] | undefined): ValidationConfig[] {
    const requested = types !== undefined && types.length > 0 ? types : DEFAULT_VALIDATION_TYPES;
    const configs: ValidationConfig[] = [];
    for (const type of requested) {
        const config = toValidationConfig(type);
        if (config !== undefined && !configs.some((existing) => existing.type === config.type)) {
            configs.push(config);
        }
    }
    return configs;
}

/** Resolves the source-of-truth variant, pushing any gap onto `missing`. */
function parseSourceOfTruth(
    input: CdSourceOfTruthInput | undefined,
    missing: MissingField[],
): SourceOfTruth | undefined {
    const kind = trimmed(input?.kind);
    if (input === undefined || kind === undefined) {
        missing.push({
            field: "sourceOfTruth.kind",
            hint: "Where the schema comes from.",
            options: SOURCE_OF_TRUTH_KINDS,
        });
        return undefined;
    }
    if (kind === SourceOfTruthKind.SqlProj || kind === SourceOfTruthKind.Dacpac) {
        const path = trimmed(input.path);
        if (path === undefined) {
            missing.push({ field: "sourceOfTruth.path", hint: `Path to the .${kind} file.` });
            return undefined;
        }
        return kind === SourceOfTruthKind.Dacpac
            ? { kind: SourceOfTruthKind.Dacpac, path }
            : { kind: SourceOfTruthKind.SqlProj, path };
    }
    if (kind === SourceOfTruthKind.Connection) {
        const connectionProfileId = trimmed(input.connectionProfileId);
        if (connectionProfileId === undefined) {
            missing.push({
                field: "sourceOfTruth.connectionProfileId",
                hint: "Id of a saved connection profile.",
            });
            return undefined;
        }
        return { kind: SourceOfTruthKind.Connection, connectionProfileId };
    }
    missing.push({
        field: "sourceOfTruth.kind",
        hint: `Unrecognized kind '${kind}'.`,
        options: SOURCE_OF_TRUTH_KINDS,
    });
    return undefined;
}

/** Validates create input into an `Environment`, or reports what's missing. */
function parseCreateInput(input: CdCreateEnvironmentParams): {
    environment?: Environment;
    missing: MissingField[];
} {
    const missing: MissingField[] = [];
    const id = trimmed(input.id);
    const name = trimmed(input.name);
    if (id === undefined) {
        missing.push({ field: "id", hint: "Stable slug id, e.g. 'staging'." });
    }
    if (name === undefined) {
        missing.push({ field: "name", hint: "Display name, e.g. 'Staging'." });
    }
    const sourceOfTruth = parseSourceOfTruth(input.sourceOfTruth, missing);
    if (id === undefined || name === undefined || sourceOfTruth === undefined) {
        return { missing };
    }
    const description = trimmed(input.description);
    return {
        missing,
        environment: {
            id,
            name,
            ...(description !== undefined ? { description } : {}),
            sourceOfTruth,
            validations: buildValidationConfigs(input.validations),
        },
    };
}

// =============================================================================
// Tool parameter shapes
// =============================================================================

export type CdListEnvironmentsParams = Record<string, never>;

export interface CdDescribeEnvironmentParams {
    environmentId: string;
}

export interface CdSourceOfTruthInput {
    kind?: string;
    path?: string;
    connectionProfileId?: string;
}

export interface CdCreateEnvironmentParams {
    id?: string;
    name?: string;
    description?: string;
    sourceOfTruth?: CdSourceOfTruthInput;
    validations?: string[];
}

export interface CdValidateEnvironmentParams {
    environmentId: string;
}

// =============================================================================
// Tools
// =============================================================================

/** Lists every Cloud Deploy environment declared in the workspace. */
export class CloudDeployListEnvironmentsTool extends ToolBase<CdListEnvironmentsParams> {
    public readonly toolName = Constants.copilotCloudDeployListEnvironmentsToolName;

    constructor(private readonly _getService: CloudDeployServiceAccessor) {
        super();
    }

    async call(): Promise<string> {
        const store = this._getService().environments;
        if (store === undefined) {
            return JSON.stringify({ success: false, message: loc.CloudDeployNoWorkspaceMessage });
        }
        try {
            const environments = store.list().map((env) => ({
                id: env.id,
                name: env.name,
                ...(env.description !== undefined ? { description: env.description } : {}),
                sourceOfTruth: describeSourceOfTruth(env.sourceOfTruth),
                validations: env.validations.filter((v) => v.enabled).map((v) => v.type),
            }));
            return JSON.stringify({ success: true, count: environments.length, environments });
        } catch (error) {
            return JSON.stringify({ success: false, message: getErrorMessage(error) });
        }
    }

    async prepareInvocation() {
        return { invocationMessage: loc.CloudDeployListEnvironmentsInvocation };
    }
}

/** Returns the full stored configuration for a single environment. */
export class CloudDeployDescribeEnvironmentTool extends ToolBase<CdDescribeEnvironmentParams> {
    public readonly toolName = Constants.copilotCloudDeployDescribeEnvironmentToolName;

    constructor(private readonly _getService: CloudDeployServiceAccessor) {
        super();
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<CdDescribeEnvironmentParams>,
    ): Promise<string> {
        const store = this._getService().environments;
        if (store === undefined) {
            return JSON.stringify({ success: false, message: loc.CloudDeployNoWorkspaceMessage });
        }
        const { environmentId } = options.input;
        try {
            const environment = store.get(environmentId);
            if (environment === undefined) {
                return JSON.stringify({
                    success: false,
                    message: loc.CloudDeployEnvironmentNotFound(environmentId),
                });
            }
            return JSON.stringify({ success: true, environment });
        } catch (error) {
            return JSON.stringify({ success: false, message: getErrorMessage(error) });
        }
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<CdDescribeEnvironmentParams>,
    ) {
        return {
            invocationMessage: loc.CloudDeployDescribeEnvironmentInvocation(
                options.input.environmentId,
            ),
        };
    }
}

/**
 * Creates or updates an environment in `.mssql/environments.json`. When a
 * required field is missing it returns a `needs_input` payload naming the gaps
 * (and valid options) so the agent asks the user instead of guessing.
 */
export class CloudDeployCreateEnvironmentTool extends ToolBase<CdCreateEnvironmentParams> {
    public readonly toolName = Constants.copilotCloudDeployCreateEnvironmentToolName;

    constructor(private readonly _getService: CloudDeployServiceAccessor) {
        super();
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<CdCreateEnvironmentParams>,
    ): Promise<string> {
        const store = this._getService().environments;
        if (store === undefined) {
            return JSON.stringify({ success: false, message: loc.CloudDeployNoWorkspaceMessage });
        }
        const { environment, missing } = parseCreateInput(options.input);
        if (environment === undefined) {
            return JSON.stringify({ status: "needs_input", missing });
        }
        try {
            await store.upsert(environment);
            return JSON.stringify({ status: "created", environment });
        } catch (error) {
            return JSON.stringify({ success: false, message: getErrorMessage(error) });
        }
    }

    async prepareInvocation() {
        return {
            invocationMessage: loc.CloudDeployCreateEnvironmentInvocation,
            confirmationMessages: {
                title: `${Constants.extensionName}: ${loc.CloudDeployCreateEnvironmentConfirmationTitle}`,
                message: new vscode.MarkdownString(
                    loc.CloudDeployCreateEnvironmentConfirmationMessage,
                ),
            },
        };
    }
}

/**
 * Runs every enabled validation on an environment and returns the structured
 * run — rollup status plus each gate's findings — so the agent can report back
 * and propose a fix. Persists the run artifact when a workspace runs directory
 * is available so the dashboard and diff tooling can read it later.
 */
export class CloudDeployValidateEnvironmentTool extends ToolBase<CdValidateEnvironmentParams> {
    public readonly toolName = Constants.copilotCloudDeployValidateEnvironmentToolName;

    constructor(private readonly _getService: CloudDeployServiceAccessor) {
        super();
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<CdValidateEnvironmentParams>,
        token: vscode.CancellationToken,
    ): Promise<string> {
        const service = this._getService();
        const store = service.environments;
        if (store === undefined) {
            return JSON.stringify({ success: false, message: loc.CloudDeployNoWorkspaceMessage });
        }
        const { environmentId } = options.input;
        if (store.get(environmentId) === undefined) {
            return JSON.stringify({
                success: false,
                message: loc.CloudDeployEnvironmentNotFound(environmentId),
            });
        }
        const controller = new AbortController();
        const cancellation = token.onCancellationRequested(() => controller.abort());
        try {
            const artifactDir = service.runs.runsDirectory;
            const result = await service.validation.run(environmentId, {
                signal: controller.signal,
                ...(artifactDir !== undefined ? { persist: true, artifactDir } : {}),
            });
            return JSON.stringify({
                success: true,
                ...(result.runArtifactPath !== undefined
                    ? { runArtifactPath: result.runArtifactPath }
                    : {}),
                ...(result.persistError !== undefined ? { persistError: result.persistError } : {}),
                run: summarizeRun(result.record),
            });
        } catch (error) {
            return JSON.stringify({ success: false, message: getErrorMessage(error) });
        } finally {
            cancellation.dispose();
        }
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<CdValidateEnvironmentParams>,
    ) {
        const { environmentId } = options.input;
        return {
            invocationMessage: loc.CloudDeployValidateEnvironmentInvocation(environmentId),
            confirmationMessages: {
                title: `${Constants.extensionName}: ${loc.CloudDeployValidateEnvironmentConfirmationTitle}`,
                message: new vscode.MarkdownString(
                    loc.CloudDeployValidateEnvironmentConfirmationMessage(environmentId),
                ),
            },
        };
    }
}
