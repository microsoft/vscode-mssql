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
} from "../sharedInterfaces/codeAnalysis";
import * as constants from "../constants/constants";
import { CodeAnalysis as Loc } from "../constants/locConstants";
import { RuleSeverity } from "../enums";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { TelemetryViews, TelemetryActions } from "../sharedInterfaces/telemetry";
import { getErrorMessage } from "../utils/utils";

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
    }

    /**
     * Load code analysis rules from the DacFx service
     */
    private async loadRules(): Promise<void> {
        try {
            this.state.isLoading = true;
            this.state.errorMessage = undefined;
            this.updateState();

            // Placeholder data until code analysis rules are loaded from the service.
            const rules: SqlCodeAnalysisRule[] = [
                {
                    ruleId: "Microsoft.Rules.Data.SR0001",
                    shortRuleId: "SR0001",
                    displayName: "Avoid SELECT *",
                    severity: RuleSeverity.Warning,
                    enabled: true,
                },
            ];

            this.state.rules = rules;
            this.state.isLoading = false;
            this.updateState();

            sendActionEvent(TelemetryViews.SqlProjects, TelemetryActions.CodeAnalysisRulesLoaded, {
                ruleCount: rules.length.toString(),
                categoryCount: "0",
            });
        } catch (error) {
            this.state.isLoading = false;
            this.state.errorMessage = getErrorMessage(error);
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
