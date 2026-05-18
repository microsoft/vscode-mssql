/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dab } from "../sharedInterfaces/dab";
import { SchemaDesigner } from "../sharedInterfaces/schemaDesigner";
import {
    StateCommandDiagnosticsSink,
    StateCommandSource,
} from "../platform/stateCommands/stateCommandDiagnostics";
import { applyAtomicStateCommands } from "../platform/stateCommands/stateCommandEngine";
import { syncDabConfigWithSchema } from "./dabConfigSync";
import { computeDabVersion } from "./dabVersion";
import {
    buildApplyStatePayload,
    buildDabSummary,
    cloneDabConfig,
    DAB_APPLY_CHANGES_ENTITY_THRESHOLD,
    DAB_GET_STATE_ENTITY_THRESHOLD,
    DabApplyReturnState,
    isApplyReturnState,
} from "./dabSnapshot";
import { applyDabToolChange, validateDabConfig } from "./dabValidation";

export interface GetDabStateEngineResult {
    response: Dab.GetDabToolStateResponse;
    config: Dab.DabConfig;
    changed: boolean;
}

export interface ApplyDabCommandsEngineRequest {
    baseConfig: Dab.DabConfig | null;
    schemaTables: SchemaDesigner.Table[];
    expectedVersion: string;
    commands: Dab.DabToolChange[];
    returnState?: DabApplyReturnState;
    sessionId?: string;
    source?: StateCommandSource;
    diagnostics?: StateCommandDiagnosticsSink;
}

export interface ApplyDabCommandsEngineResult {
    response: Dab.ApplyDabToolChangesResponse;
    config: Dab.DabConfig;
    shouldCommit: boolean;
}

export async function getDabToolStateFromConfig(
    currentConfig: Dab.DabConfig | null,
    schemaTables: SchemaDesigner.Table[],
    diagnostics?: StateCommandDiagnosticsSink,
    sessionId?: string,
    source?: StateCommandSource,
): Promise<GetDabStateEngineResult> {
    diagnostics?.emit({
        feature: "dab",
        source,
        sessionId,
        stage: "get_state",
        status: "started",
    });
    const syncedSnapshot = syncDabConfigWithSchema(currentConfig, schemaTables);
    const summary = buildDabSummary(syncedSnapshot.config);
    const version = await computeDabVersion(syncedSnapshot.config);
    const returnState =
        summary.entityCount > DAB_GET_STATE_ENTITY_THRESHOLD
            ? ("summary" as const)
            : ("full" as const);

    if (returnState === "full") {
        diagnostics?.emit({
            feature: "dab",
            source,
            sessionId,
            stage: "get_state",
            status: "succeeded",
            version,
            measurements: {
                entityCount: summary.entityCount,
                enabledEntityCount: summary.enabledEntityCount,
            },
        });
        return {
            response: {
                returnState,
                version,
                summary,
                config: syncedSnapshot.config,
            },
            config: syncedSnapshot.config,
            changed: syncedSnapshot.changed,
        };
    }

    diagnostics?.emit({
        feature: "dab",
        source,
        sessionId,
        stage: "get_state",
        status: "succeeded",
        version,
        reason: "entity_count_over_threshold",
        measurements: {
            entityCount: summary.entityCount,
            enabledEntityCount: summary.enabledEntityCount,
        },
    });
    return {
        response: {
            returnState,
            stateOmittedReason: "entity_count_over_threshold",
            version,
            summary,
        },
        config: syncedSnapshot.config,
        changed: syncedSnapshot.changed,
    };
}

export async function applyDabCommands(
    request: ApplyDabCommandsEngineRequest,
): Promise<ApplyDabCommandsEngineResult> {
    if (!request.expectedVersion) {
        const config = syncDabConfigWithSchema(request.baseConfig, request.schemaTables).config;
        request.diagnostics?.emit({
            feature: "dab",
            source: request.source,
            sessionId: request.sessionId,
            stage: "apply_batch",
            status: "failed",
            reason: "invalid_request",
            message: "Missing expectedVersion.",
        });
        return {
            response: {
                success: false,
                reason: "invalid_request",
                message: "Missing expectedVersion.",
            },
            config,
            shouldCommit: false,
        };
    }

    if (!Array.isArray(request.commands) || request.commands.length === 0) {
        const config = syncDabConfigWithSchema(request.baseConfig, request.schemaTables).config;
        request.diagnostics?.emit({
            feature: "dab",
            source: request.source,
            sessionId: request.sessionId,
            stage: "apply_batch",
            status: "failed",
            reason: "invalid_request",
            message: "Missing changes (non-empty array).",
        });
        return {
            response: {
                success: false,
                reason: "invalid_request",
                message: "Missing changes (non-empty array).",
            },
            config,
            shouldCommit: false,
        };
    }

    const requestedReturnState = request.returnState ?? "full";
    if (!isApplyReturnState(requestedReturnState)) {
        const config = syncDabConfigWithSchema(request.baseConfig, request.schemaTables).config;
        request.diagnostics?.emit({
            feature: "dab",
            source: request.source,
            sessionId: request.sessionId,
            stage: "apply_batch",
            status: "failed",
            reason: "invalid_request",
            message: `Unsupported returnState: ${String(requestedReturnState)}`,
        });
        return {
            response: {
                success: false,
                reason: "invalid_request",
                message: `Unsupported returnState: ${String(requestedReturnState)}`,
            },
            config,
            shouldCommit: false,
        };
    }

    const baseSnapshot = syncDabConfigWithSchema(request.baseConfig, request.schemaTables).config;
    const baseVersion = await computeDabVersion(baseSnapshot);

    if (request.expectedVersion !== baseVersion) {
        request.diagnostics?.emit({
            feature: "dab",
            source: request.source,
            sessionId: request.sessionId,
            stage: "apply_batch",
            status: "failed",
            reason: "stale_state",
            message: "DAB configuration changed since last read.",
            version: baseVersion,
        });
        const staleState = await buildApplyStatePayload(
            baseSnapshot,
            requestedReturnState,
            computeDabVersion,
            baseVersion,
        );
        return {
            response: {
                success: false,
                reason: "stale_state",
                message: "DAB configuration changed since last read.",
                version: staleState.version,
                summary: staleState.summary,
                returnState: staleState.returnState,
                ...(staleState.stateOmittedReason
                    ? { stateOmittedReason: staleState.stateOmittedReason }
                    : {}),
                ...(staleState.config ? { config: staleState.config } : {}),
            },
            config: baseSnapshot,
            shouldCommit: false,
        };
    }

    const atomicResult = applyAtomicStateCommands({
        feature: "dab",
        source: request.source,
        sessionId: request.sessionId,
        baseState: baseSnapshot,
        commands: request.commands,
        cloneState: cloneDabConfig,
        getCommandType: (command) => command.type,
        applyCommand: applyDabToolChange,
        validateState: validateDabConfig,
        diagnostics: request.diagnostics,
    });

    if (atomicResult.success === false) {
        request.diagnostics?.emit({
            feature: "dab",
            source: request.source,
            sessionId: request.sessionId,
            stage: "commit",
            status: "skipped",
            reason: atomicResult.reason,
            message: atomicResult.message,
            version: baseVersion,
        });
        return {
            response: {
                success: false,
                reason: atomicResult.reason as Extract<
                    Dab.ApplyDabToolChangesResponse,
                    { success: false }
                >["reason"],
                message: atomicResult.message,
                failedChangeIndex: atomicResult.failedCommandIndex,
                appliedChanges: 0,
                version: baseVersion,
                summary: buildDabSummary(baseSnapshot),
            },
            config: baseSnapshot,
            shouldCommit: false,
        };
    }

    const successState = await buildApplyStatePayload(
        atomicResult.state,
        requestedReturnState,
        computeDabVersion,
        undefined,
        DAB_APPLY_CHANGES_ENTITY_THRESHOLD,
    );

    request.diagnostics?.emit({
        feature: "dab",
        source: request.source,
        sessionId: request.sessionId,
        stage: "commit",
        status: "succeeded",
        version: successState.version,
        measurements: {
            appliedCommands: atomicResult.appliedCommands,
        },
    });

    return {
        response: {
            success: true,
            appliedChanges: atomicResult.appliedCommands,
            ...successState,
        },
        config: atomicResult.state,
        shouldCommit: true,
    };
}
