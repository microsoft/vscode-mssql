/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { sendActionEvent } from "../telemetry/telemetry";
import { getErrorMessage } from "../utils/utils";

const dismissedStateKey = "copilotEnableGuard.dismissed";
const copilotSection = "github.copilot";
const copilotEnableKey = "enable";

type CopilotEnableGuardTrigger = "activation" | "useSchemaContextToggle" | "copilotEnableChange";
type CopilotEnableGuardAction =
    | "alreadyCorrect"
    | "promptShown"
    | "applied"
    | "dismissed"
    | "openedDocs"
    | "applyFailed";
type CopilotEnableGuardWriteTarget = "global" | "workspace" | "workspaceFolder" | "none";
type CopilotEnableInspect = {
    globalValue?: Record<string, boolean> | null;
    workspaceValue?: Record<string, boolean> | null;
    workspaceFolderValue?: Record<string, boolean> | null;
};

export function mergeCopilotEnableMap(
    currentValue: Record<string, boolean> | null | undefined,
): Record<string, boolean> {
    if (!currentValue || Object.keys(currentValue).length === 0) {
        return { "*": true, sql: false };
    }

    return { ...currentValue, sql: false };
}

export function resolveCopilotEnableTarget(inspect: CopilotEnableInspect | undefined): {
    target: vscode.ConfigurationTarget;
    wroteTarget: Exclude<CopilotEnableGuardWriteTarget, "none">;
} {
    if (inspect?.workspaceFolderValue !== undefined) {
        return {
            target: vscode.ConfigurationTarget.WorkspaceFolder,
            wroteTarget: "workspaceFolder",
        };
    }

    if (inspect?.workspaceValue !== undefined) {
        return { target: vscode.ConfigurationTarget.Workspace, wroteTarget: "workspace" };
    }

    return { target: vscode.ConfigurationTarget.Global, wroteTarget: "global" };
}

export class CopilotEnableSettingsGuard implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private _useSchemaContextEnabled = this.isUseSchemaContextEnabled();

    constructor(private readonly _context: vscode.ExtensionContext) {
        this._disposables.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                void this.handleConfigurationChange(e);
            }),
        );

        if (this._useSchemaContextEnabled) {
            void this.checkSettings("activation");
        }
    }

    public dispose(): void {
        this._disposables.forEach((d) => d.dispose());
    }

    private async handleConfigurationChange(e: vscode.ConfigurationChangeEvent): Promise<void> {
        const didUseSchemaContextChange = e.affectsConfiguration(
            Constants.configCopilotInlineCompletionsUseSchemaContext,
        );
        const didCopilotEnableChange = e.affectsConfiguration(
            `${copilotSection}.${copilotEnableKey}`,
        );
        if (!didUseSchemaContextChange && !didCopilotEnableChange) {
            return;
        }

        const wasUseSchemaContextEnabled = this._useSchemaContextEnabled;
        this._useSchemaContextEnabled = this.isUseSchemaContextEnabled();

        if (
            didUseSchemaContextChange &&
            !wasUseSchemaContextEnabled &&
            this._useSchemaContextEnabled
        ) {
            void this.checkSettings("useSchemaContextToggle", true);
            return;
        }

        if (didCopilotEnableChange && this._useSchemaContextEnabled) {
            void this.checkSettings("copilotEnableChange");
        }
    }

    private async checkSettings(
        trigger: CopilotEnableGuardTrigger,
        ignoreDismissed: boolean = false,
    ): Promise<void> {
        const config = this.getCopilotConfiguration();
        const enableMap = config.get<Record<string, boolean> | null>(copilotEnableKey);
        if (enableMap?.sql === false) {
            this.sendTelemetry(trigger, "alreadyCorrect");
            return;
        }

        if (!ignoreDismissed && this._context.globalState.get<boolean>(dismissedStateKey, false)) {
            return;
        }

        this.sendTelemetry(trigger, "promptShown");
        const selection = await vscode.window.showInformationMessage(
            LocalizedConstants.copilotEnableGuardMessage,
            LocalizedConstants.copilotEnableGuardDisableForSql,
            LocalizedConstants.copilotEnableGuardKeepAsIs,
            LocalizedConstants.copilotEnableGuardLearnMore,
        );

        if (selection === LocalizedConstants.copilotEnableGuardDisableForSql) {
            await this.applyDisableForSqlSetting(trigger);
            return;
        }

        if (selection === LocalizedConstants.copilotEnableGuardKeepAsIs) {
            await this._context.globalState.update(dismissedStateKey, true);
            this.sendTelemetry(trigger, "dismissed");
            return;
        }

        if (selection === LocalizedConstants.copilotEnableGuardLearnMore) {
            await vscode.env.openExternal(vscode.Uri.parse(Constants.documentationLink));
            this.sendTelemetry(trigger, "openedDocs");
        }
    }

    private async applyDisableForSqlSetting(trigger: CopilotEnableGuardTrigger): Promise<void> {
        const config = this.getCopilotConfiguration();
        const enableMap = config.get<Record<string, boolean> | null>(copilotEnableKey);
        const { target, wroteTarget } = resolveCopilotEnableTarget(
            config.inspect(copilotEnableKey),
        );

        try {
            await config.update(copilotEnableKey, mergeCopilotEnableMap(enableMap), target);
            void vscode.window.showInformationMessage(LocalizedConstants.copilotEnableGuardApplied);
            this.sendTelemetry(trigger, "applied", wroteTarget);
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            void vscode.window.showErrorMessage(
                LocalizedConstants.copilotEnableGuardApplyFailed(errorMessage),
            );
            this.sendTelemetry(trigger, "applyFailed", wroteTarget);
        }
    }

    private getCopilotConfiguration(): vscode.WorkspaceConfiguration {
        const scope =
            vscode.window.activeTextEditor?.document.uri ??
            vscode.workspace.workspaceFolders?.[0]?.uri;
        return vscode.workspace.getConfiguration(copilotSection, scope);
    }

    private isUseSchemaContextEnabled(): boolean {
        return (
            vscode.workspace
                .getConfiguration()
                .get<boolean>(Constants.configCopilotInlineCompletionsUseSchemaContext, false) ??
            false
        );
    }

    private sendTelemetry(
        trigger: CopilotEnableGuardTrigger,
        action: CopilotEnableGuardAction,
        wroteTarget: CopilotEnableGuardWriteTarget = "none",
    ): void {
        sendActionEvent(TelemetryViews.MssqlCopilot, TelemetryActions.CopilotEnableGuard, {
            trigger,
            action,
            wroteTarget,
        });
    }
}
