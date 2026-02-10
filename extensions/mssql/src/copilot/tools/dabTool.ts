/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ToolBase } from "./toolBase";
import * as Constants from "../../constants/constants";
import { MssqlChatAgent as loc } from "../../constants/locConstants";
import { SchemaDesignerWebviewManager } from "../../schemaDesigner/schemaDesignerWebviewManager";
import { SchemaDesignerWebviewController } from "../../schemaDesigner/schemaDesignerWebviewController";
import { sendActionEvent } from "../../telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../../sharedInterfaces/telemetry";
import { Dab } from "../../sharedInterfaces/dab";
import { matchesStrictTargetHint } from "./toolsUtils";

interface TargetHint {
    server: string;
    database: string;
}

type DabToolOperation = "get_state" | "apply_changes";

export type DabToolParams =
    | { operation: "get_state" }
    | {
          operation: "apply_changes";
          payload: {
              expectedVersion: string;
              targetHint?: TargetHint;
              changes: Dab.DabToolChange[];
          };
          options?: {
              returnState?: "full" | "summary" | "none";
          };
      };

type DabToolFailureReason =
    | "no_active_designer"
    | "target_mismatch"
    | "stale_state"
    | "not_found"
    | "invalid_request"
    | "validation_error"
    | "internal_error";

interface DabToolChangeCounts {
    set_api_types_count: number;
    set_entity_enabled_count: number;
    set_entity_actions_count: number;
    patch_entity_settings_count: number;
    set_only_enabled_entities_count: number;
    set_all_entities_enabled_count: number;
}

interface DabToolReceipt {
    setApiTypesCount: number;
    setEntityEnabledCount: number;
    setEntityActionsCount: number;
    patchEntitySettingsCount: number;
    setOnlyEnabledEntitiesCount: number;
    setAllEntitiesEnabledCount: number;
}

interface DabToolError {
    success: false;
    reason: DabToolFailureReason;
    message: string;
    server?: string;
    database?: string;
    activeTarget?: {
        server?: string;
        database: string;
    };
    targetHint?: TargetHint;
    failedChangeIndex?: number;
    appliedChanges?: number;
    version?: string;
    summary?: Dab.DabToolSummary;
    returnState?: "full" | "summary" | "none";
    stateOmittedReason?:
        | "entity_count_over_threshold"
        | "caller_requested_summary"
        | "caller_requested_none";
    config?: Dab.DabConfig;
}

export class DabTool extends ToolBase<DabToolParams> {
    public readonly toolName = Constants.copilotDabToolName;

    async call(
        options: vscode.LanguageModelToolInvocationOptions<DabToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const json = (obj: unknown) => JSON.stringify(obj);
        const schemaDesignerManager = SchemaDesignerWebviewManager.getInstance();
        const { operation } = options.input;

        const sendToolTelemetry = (params: {
            operation: DabToolOperation;
            success: boolean;
            reason?: DabToolFailureReason;
            measurements?: Record<string, number>;
        }) => {
            try {
                sendActionEvent(
                    TelemetryViews.MssqlCopilot,
                    TelemetryActions.DabTool,
                    {
                        operation: params.operation,
                        success: String(params.success),
                        ...(params.reason ? { reason: params.reason } : {}),
                    },
                    params.measurements ?? {},
                );
            } catch {
                // Telemetry must never block tool execution.
            }
        };

        const withTarget = (obj: any, designer: SchemaDesignerWebviewController | undefined) => {
            if (!designer) {
                return obj;
            }
            return {
                ...obj,
                server: designer.server,
                database: designer.database,
            };
        };

        const countChanges = (changes: Dab.DabToolChange[]): DabToolChangeCounts => {
            const counts: DabToolChangeCounts = {
                set_api_types_count: 0,
                set_entity_enabled_count: 0,
                set_entity_actions_count: 0,
                patch_entity_settings_count: 0,
                set_only_enabled_entities_count: 0,
                set_all_entities_enabled_count: 0,
            };

            for (const change of changes) {
                switch (change.type) {
                    case "set_api_types":
                        counts.set_api_types_count++;
                        break;
                    case "set_entity_enabled":
                        counts.set_entity_enabled_count++;
                        break;
                    case "set_entity_actions":
                        counts.set_entity_actions_count++;
                        break;
                    case "patch_entity_settings":
                        counts.patch_entity_settings_count++;
                        break;
                    case "set_only_enabled_entities":
                        counts.set_only_enabled_entities_count++;
                        break;
                    case "set_all_entities_enabled":
                        counts.set_all_entities_enabled_count++;
                        break;
                }
            }

            return counts;
        };

        const toReceipt = (counts: DabToolChangeCounts): DabToolReceipt => ({
            setApiTypesCount: counts.set_api_types_count,
            setEntityEnabledCount: counts.set_entity_enabled_count,
            setEntityActionsCount: counts.set_entity_actions_count,
            patchEntitySettingsCount: counts.patch_entity_settings_count,
            setOnlyEnabledEntitiesCount: counts.set_only_enabled_entities_count,
            setAllEntitiesEnabledCount: counts.set_all_entities_enabled_count,
        });

        try {
            const activeDesigner = schemaDesignerManager.getActiveDesigner();
            if (!activeDesigner) {
                const err: DabToolError = {
                    success: false,
                    reason: "no_active_designer",
                    message:
                        "No active schema designer found. Please open a schema designer first.",
                };
                sendToolTelemetry({ operation, success: false, reason: err.reason });
                return json(err);
            }

            if (operation === "get_state") {
                const state = await activeDesigner.getDabToolState();
                sendToolTelemetry({
                    operation,
                    success: true,
                    measurements: {
                        stateOmitted: state.config ? 0 : 1,
                    },
                });

                return json(
                    withTarget(
                        {
                            success: true,
                            ...state,
                        },
                        activeDesigner,
                    ),
                );
            }

            if (operation !== "apply_changes") {
                const err: DabToolError = withTarget(
                    {
                        success: false,
                        reason: "invalid_request",
                        message: `Unknown operation: ${String(operation)}`,
                    },
                    activeDesigner,
                );
                sendToolTelemetry({ operation, success: false, reason: err.reason });
                return json(err);
            }

            const expectedVersion = options.input.payload?.expectedVersion;
            if (!expectedVersion) {
                const err: DabToolError = withTarget(
                    {
                        success: false,
                        reason: "invalid_request",
                        message: "Missing payload.expectedVersion.",
                    },
                    activeDesigner,
                );
                sendToolTelemetry({ operation, success: false, reason: err.reason });
                return json(err);
            }

            const changes = options.input.payload?.changes;
            if (!Array.isArray(changes) || changes.length === 0) {
                const err: DabToolError = withTarget(
                    {
                        success: false,
                        reason: "invalid_request",
                        message: "Missing payload.changes (non-empty array).",
                    },
                    activeDesigner,
                );
                sendToolTelemetry({ operation, success: false, reason: err.reason });
                return json(err);
            }

            const changeCounts = countChanges(changes);
            const targetHint = options.input.payload?.targetHint;
            if (
                targetHint &&
                !matchesStrictTargetHint(
                    { server: activeDesigner.server, database: activeDesigner.database },
                    targetHint,
                )
            ) {
                const err: DabToolError = {
                    success: false,
                    reason: "target_mismatch",
                    message: "Active schema designer does not match targetHint.",
                    activeTarget: {
                        server: activeDesigner.server,
                        database: activeDesigner.database,
                    },
                    targetHint,
                    server: activeDesigner.server,
                    database: activeDesigner.database,
                };
                sendToolTelemetry({
                    operation,
                    success: false,
                    reason: err.reason,
                    measurements: {
                        changesCount: changes.length,
                        appliedChanges: 0,
                        stateOmitted: 1,
                        ...changeCounts,
                    },
                });
                return json(err);
            }

            activeDesigner.revealToForeground();
            activeDesigner.showDabView();
            const applyResult = await activeDesigner.applyDabToolChanges({
                expectedVersion,
                changes,
                options: options.input.options,
            });

            if (applyResult.success === false) {
                const failedResult = applyResult;
                const err: DabToolError = withTarget(
                    {
                        success: false,
                        reason: failedResult.reason,
                        message: failedResult.message,
                        failedChangeIndex: failedResult.failedChangeIndex,
                        appliedChanges: failedResult.appliedChanges,
                        version: failedResult.version,
                        summary: failedResult.summary,
                        ...(failedResult.returnState
                            ? { returnState: failedResult.returnState }
                            : {}),
                        ...(failedResult.stateOmittedReason
                            ? { stateOmittedReason: failedResult.stateOmittedReason }
                            : {}),
                        ...(failedResult.config ? { config: failedResult.config } : {}),
                    },
                    activeDesigner,
                );
                sendToolTelemetry({
                    operation,
                    success: false,
                    reason: err.reason,
                    measurements: {
                        changesCount: changes.length,
                        appliedChanges: failedResult.appliedChanges ?? 0,
                        stateOmitted: failedResult.config ? 0 : 1,
                        ...changeCounts,
                    },
                });
                return json(err);
            }

            const successResult = applyResult;
            sendToolTelemetry({
                operation,
                success: true,
                measurements: {
                    changesCount: changes.length,
                    appliedChanges: successResult.appliedChanges,
                    stateOmitted: successResult.config ? 0 : 1,
                    ...changeCounts,
                },
            });

            return json(
                withTarget(
                    {
                        success: true,
                        ...successResult,
                        receipt: toReceipt(changeCounts),
                    },
                    activeDesigner,
                ),
            );
        } catch (error) {
            const payload: DabToolError = {
                success: false,
                reason: "internal_error",
                message: error instanceof Error ? error.message : String(error),
            };
            sendToolTelemetry({ operation, success: false, reason: payload.reason });
            return json(withTarget(payload, schemaDesignerManager.getActiveDesigner()));
        }
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<DabToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { operation } = options.input;
        const confirmationMessages = {
            title: `${Constants.extensionName}: ${loc.dabToolConfirmationTitle}`,
            message: new vscode.MarkdownString(loc.dabToolConfirmationMessage(operation)),
        };
        const invocationMessage = loc.dabToolInvocationMessage(operation);
        return { invocationMessage, confirmationMessages };
    }
}
