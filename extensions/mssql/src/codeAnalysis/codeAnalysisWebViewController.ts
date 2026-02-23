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
import { DacFxService } from "../services/dacFxService";
import { DialogMessageSpec } from "../sharedInterfaces/dialogMessage";

/**
 * Controller for the Code Analysis dialog webview
 */
export class CodeAnalysisWebViewController extends ReactWebviewPanelController<
    CodeAnalysisState,
    CodeAnalysisReducers
> {
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        projectFilePath: string,
        private dacFxService: DacFxService,
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
                hasChanges: false,
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

        // Send telemetry for dialog opened
        sendActionEvent(TelemetryViews.SqlProjects, TelemetryActions.CodeAnalysisDialogOpened, {
            projectName,
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
            // TODO: Add unsaved-changes confirmation before disposing panel.
            this.panel.dispose();
            return state;
        });
        // Clear message bar
        this.registerReducer("closeMessage", async (state) => {
            return { ...state, message: undefined };
        });
    }

    /**
     * Fetches rules from the DacFx service and maps them to the UI view model.
     * Throws on service failure or mapping errors — caught by loadRules.
     */
    private async fetchRulesFromDacFx(): Promise<SqlCodeAnalysisRule[]> {
        const rulesResult = await this.dacFxService.getCodeAnalysisRules();
        if (!rulesResult.success) {
            throw new Error(rulesResult.errorMessage || Loc.failedToLoadRules);
        }

        try {
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
        } catch {
            throw new Error(Loc.failedToLoadRules);
        }
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
            const rules = await this.fetchRulesFromDacFx();

            this.state.rules = rules;
            this.state.isLoading = false;
            this.updateState();

            sendActionEvent(TelemetryViews.SqlProjects, TelemetryActions.CodeAnalysisRulesLoaded, {
                ruleCount: rules.length.toString(),
                categoryCount: new Set(rules.map((rule) => rule.category || "")).size.toString(),
            });
        } catch (error) {
            this.state.isLoading = false;
            this.state.message = {
                message: getErrorMessage(error),
                intent: "error",
            } as DialogMessageSpec;
            this.updateState();

            sendErrorEvent(
                TelemetryViews.SqlProjects,
                TelemetryActions.CodeAnalysisRulesLoadError,
                error instanceof Error ? error : new Error(getErrorMessage(error)),
                false,
            );
        }
    }
}
