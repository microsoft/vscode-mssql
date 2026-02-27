/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import VscodeWrapper from "../controllers/vscodeWrapper";
import {
    CodeAnalysisState,
    CodeAnalysisReducers,
    SqlCodeAnalysisRule,
    CodeAnalysisRuleSeverity,
} from "../sharedInterfaces/codeAnalysis";
import * as constants from "../constants/constants";
import { CodeAnalysis as Loc } from "../constants/locConstants";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { TelemetryViews, TelemetryActions } from "../sharedInterfaces/telemetry";
import { getErrorMessage } from "../utils/utils";
import { generateOperationId } from "../schemaCompare/schemaCompareUtils";
import { DacFxService } from "../services/dacFxService";
import { SqlProjectsService } from "../services/sqlProjectsService";
import { DialogMessageSpec } from "../sharedInterfaces/dialogMessage";
import { parseSqlprojRuleOverrides } from "../publishProject/projectUtils";

/**
 * Controller for the Code Analysis dialog webview
 */
export class CodeAnalysisWebViewController extends ReactWebviewPanelController<
    CodeAnalysisState,
    CodeAnalysisReducers
> {
    private readonly _operationId: string;

    /**
     * Sends a telemetry error event scoped to this dialog's operationId.
     */
    private sendError(action: TelemetryActions, error: Error): void {
        sendErrorEvent(TelemetryViews.SqlProjects, action, error, false, undefined, undefined, {
            operationId: this._operationId,
        });
    }

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        projectFilePath: string,
        private dacFxService: DacFxService,
        private sqlProjectsService: SqlProjectsService,
    ) {
        const projectName = path.basename(projectFilePath, path.extname(projectFilePath));

        super(
            context,
            vscodeWrapper,
            constants.codeAnalysisViewId,
            constants.codeAnalysisViewId,
            {
                projectFilePath,
                projectName,
                isLoading: true,
                rules: [],
                dacfxStaticRules: [],
            } as CodeAnalysisState,
            {
                title: Loc.Title,
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "codeAnalysis_dark.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "codeAnalysis_light.svg",
                    ),
                },
            },
        );

        this._operationId = generateOperationId();

        // Send telemetry for dialog opened
        sendActionEvent(TelemetryViews.SqlProjects, TelemetryActions.CodeAnalysisDialogOpened, {
            operationId: this._operationId,
        });

        this.registerRpcHandlers();

        // Load rules on initialization
        void this.loadRules();
    }

    private normalizeSeverity(severity: string | undefined): string {
        switch (severity?.toLowerCase()) {
            case "error":
                return CodeAnalysisRuleSeverity.Error;
            case "none":
                return CodeAnalysisRuleSeverity.Disabled;
            default:
                return CodeAnalysisRuleSeverity.Warning;
        }
    }

    /**
     * Register RPC handlers for webview actions
     */
    private registerRpcHandlers(): void {
        // Close dialog
        this.registerReducer("close", async (state) => {
            this.panel.dispose();
            return state;
        });
        // Clear message bar
        this.registerReducer("closeMessage", async (state) => {
            return { ...state, message: undefined };
        });
        // Save rule overrides to the .sqlproj
        this.registerReducer("saveRules", async (state, payload) => {
            try {
                const overrides = payload.rules.map((r) => ({
                    ruleId: r.ruleId,
                    severity: r.severity,
                }));
                const result = await this.sqlProjectsService.updateCodeAnalysisRules({
                    projectUri: state.projectFilePath,
                    rules: overrides,
                });
                if (!result.success) {
                    const errorMsg = result.errorMessage || Loc.failedToSaveRules;
                    this.logger.error(`Failed to save code analysis rules: ${errorMsg}`);
                    this.sendError(
                        TelemetryActions.CodeAnalysisRulesSaveError,
                        new Error(errorMsg),
                    );
                    return {
                        ...state,
                        message: {
                            message: errorMsg,
                            intent: "error",
                        } as DialogMessageSpec,
                    };
                }
                sendActionEvent(
                    TelemetryViews.SqlProjects,
                    TelemetryActions.CodeAnalysisRulesSaved,
                    {
                        operationId: this._operationId,
                        ruleCount: overrides.length.toString(),
                    },
                );
                if (payload.closeAfterSave) {
                    this.vscodeWrapper.logToOutputChannel(Loc.rulesSaved);
                    this.vscodeWrapper.outputChannel.show();
                    this.panel.dispose();
                }
                // Update the baseline rules so the component's useEffect resets isDirty
                return {
                    ...state,
                    rules: payload.rules,
                    message: payload.closeAfterSave
                        ? undefined
                        : ({ message: Loc.rulesSaved, intent: "success" } as DialogMessageSpec),
                };
            } catch (error) {
                this.logger.error(`Failed to save code analysis rules: ${getErrorMessage(error)}`);
                this.sendError(
                    TelemetryActions.CodeAnalysisRulesSaveError,
                    error instanceof Error ? error : new Error(getErrorMessage(error)),
                );
                return {
                    ...state,
                    message: {
                        message: getErrorMessage(error),
                        intent: "error",
                    } as DialogMessageSpec,
                };
            }
        });
    }

    /**
     * Reads saved overrides from the .sqlproj and merges them into this.state.rules.
     * On failure, falls back to dacfxStaticRules and shows a non-blocking warning.
     */
    private async applyProjectOverrides(dacfxStaticRules: SqlCodeAnalysisRule[]): Promise<void> {
        try {
            const projectProps = await this.sqlProjectsService.getProjectProperties(
                this.state.projectFilePath,
            );

            if (projectProps?.success && projectProps.sqlCodeAnalysisRules) {
                const overrides = parseSqlprojRuleOverrides(projectProps.sqlCodeAnalysisRules);
                this.state.rules = dacfxStaticRules.map((rule) => {
                    const overrideSeverity = overrides.get(rule.shortRuleId);
                    if (overrideSeverity === undefined) {
                        return rule;
                    }
                    return {
                        ...rule,
                        severity: overrideSeverity,
                        enabled: overrideSeverity !== CodeAnalysisRuleSeverity.Disabled,
                    };
                });
            } else if (projectProps?.success === false) {
                // Retrieval failed — fall back to DacFx defaults and surface a warning
                // so the user understands why their saved overrides weren't applied.
                this.state.rules = dacfxStaticRules;
                const detail = projectProps.errorMessage;
                const overridesMsg = detail
                    ? `${Loc.failedToLoadOverrides}: ${detail}`
                    : Loc.failedToLoadOverrides;
                this.logger.error(
                    `Failed to load code analysis rule overrides: ${detail ?? Loc.failedToLoadOverrides}`,
                );
                this.state.message = {
                    message: overridesMsg,
                    intent: "warning",
                } as DialogMessageSpec;
                this.sendError(
                    TelemetryActions.CodeAnalysisRulesLoadError,
                    new Error(detail ?? Loc.failedToLoadOverrides),
                );
            } else {
                // success: true but no sqlCodeAnalysisRules — no overrides saved, use DacFx defaults.
                this.state.rules = dacfxStaticRules;
            }
        } catch (propsError) {
            // Fall back to DacFx defaults and show a non-blocking warning so the
            // dialog is still usable even if the .sqlproj can't be read.
            this.state.rules = dacfxStaticRules;
            this.logger.error(
                `Failed to load code analysis rule overrides: ${getErrorMessage(propsError)}`,
            );
            this.state.message = {
                message: `${Loc.failedToLoadOverrides}: ${getErrorMessage(propsError)}`,
                intent: "warning",
            } as DialogMessageSpec;
            this.sendError(
                TelemetryActions.CodeAnalysisRulesLoadError,
                propsError instanceof Error ? propsError : new Error(getErrorMessage(propsError)),
            );
        }
    }

    /**
     * Fetches rules from the DacFx service and maps them to the UI view model.
     * Throws on service failure or mapping errors — caught by loadRules.
     */
    private async fetchRulesFromDacFx(): Promise<SqlCodeAnalysisRule[]> {
        const rulesResult = await this.dacFxService.getCodeAnalysisRules();
        if (!rulesResult.success) {
            const detail = rulesResult.errorMessage;
            throw new Error(detail ? `${Loc.failedToLoadRules}: ${detail}` : Loc.failedToLoadRules);
        }

        return (rulesResult.rules ?? []).map((rule) => {
            const severity = this.normalizeSeverity(rule.severity);
            return {
                ruleId: rule.ruleId,
                shortRuleId: rule.shortRuleId,
                displayName: rule.displayName,
                severity,
                enabled: severity !== CodeAnalysisRuleSeverity.Disabled,
                category: rule.category,
                description: rule.description,
                ruleScope: rule.ruleScope,
            };
        });
    }

    /**
     * Load code analysis rules from the DacFx service
     */
    private async loadRules(): Promise<void> {
        try {
            this.state.isLoading = true;
            this.state.message = undefined;
            this.updateState();

            // Get the static code analysis rules from dacfx
            const dacfxStaticRules = await this.fetchRulesFromDacFx();

            // Store DacFx factory defaults once — never overwritten, used for Reset.
            this.state.dacfxStaticRules = dacfxStaticRules;

            // Load saved overrides from the .sqlproj and apply them.
            // Isolated in its own method so a failure here doesn't discard the DacFx rules.
            await this.applyProjectOverrides(dacfxStaticRules);

            this.state.isLoading = false;
            this.updateState();

            sendActionEvent(TelemetryViews.SqlProjects, TelemetryActions.CodeAnalysisRulesLoaded, {
                operationId: this._operationId,
                ruleCount: dacfxStaticRules.length.toString(),
                categoryCount: new Set(
                    dacfxStaticRules.filter((rule) => rule.category).map((rule) => rule.category),
                ).size.toString(),
            });
        } catch (error) {
            this.state.isLoading = false;
            this.logger.error(`Failed to load code analysis rules: ${getErrorMessage(error)}`);
            this.state.message = {
                message: getErrorMessage(error),
                intent: "error",
            } as DialogMessageSpec;
            this.updateState();

            this.sendError(
                TelemetryActions.CodeAnalysisRulesLoadError,
                error instanceof Error ? error : new Error(getErrorMessage(error)),
            );
        }
    }
}
