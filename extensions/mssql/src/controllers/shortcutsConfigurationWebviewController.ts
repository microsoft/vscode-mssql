/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import * as Loc from "../constants/locConstants";
import { getErrorMessage } from "../utils/utils";
import { WebviewAction } from "../sharedInterfaces/webview";
import {
    CloseShortcutsConfigurationRequest,
    getQuickQueryCommandId,
    quickQueryCommandPrefix,
    OpenQuickQueryKeybindingRequest,
    OpenQuickQueryKeybindingsRequest,
    ReadClipboardTextRequest,
    ReadShortcutsConfigurationRequest,
    SaveAndCloseShortcutsConfigurationRequest,
    SaveShortcutsConfigurationResult,
    SaveShortcutsConfigurationPayload,
    SaveShortcutsConfigurationRequest,
    ShortcutsConfigurationData,
    ShortcutsConfigurationReducers,
    ShortcutsConfigurationWebviewState,
    normalizeQuickQueries,
    quickQueryCount,
    WriteClipboardTextRequest,
} from "../sharedInterfaces/shortcutsConfiguration";
import { WebviewPanelController } from "./webviewPanelController";
import VscodeWrapper from "./vscodeWrapper";

export class ShortcutsConfigurationWebviewController extends WebviewPanelController<
    ShortcutsConfigurationWebviewState,
    ShortcutsConfigurationReducers,
    void
> {
    private focusNonce = 1;

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        focusedQuickQuerySlot?: number,
    ) {
        super(
            context,
            vscodeWrapper,
            "shortcutsConfiguration",
            "shortcutsConfiguration",
            {
                focusedQuickQuerySlot,
                focusNonce: focusedQuickQuerySlot ? 1 : undefined,
            },
            {
                title: Loc.shortcutsConfigurationTitle,
                viewColumn: vscode.ViewColumn.One,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "settingsGear_dark.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "settingsGear_light.svg",
                    ),
                },
            },
        );

        this.registerRpcHandlers();
    }

    private registerRpcHandlers(): void {
        this.onRequest(ReadShortcutsConfigurationRequest.type, async () => {
            return await this.readConfiguration();
        });

        this.onRequest(SaveShortcutsConfigurationRequest.type, async (payload) => {
            return await this.saveConfiguration(payload);
        });

        this.onRequest(SaveAndCloseShortcutsConfigurationRequest.type, async (payload) => {
            return await this.saveAndCloseConfiguration(payload);
        });

        this.onRequest(CloseShortcutsConfigurationRequest.type, async () => {
            this.panel.dispose();
        });

        this.onRequest(ReadClipboardTextRequest.type, async () => {
            return await vscode.env.clipboard.readText();
        });

        this.onRequest(WriteClipboardTextRequest.type, async (text) => {
            await vscode.env.clipboard.writeText(text);
        });

        this.onRequest(OpenQuickQueryKeybindingRequest.type, async (commandId) => {
            await this.openQuickQueryKeybinding(commandId);
        });

        this.onRequest(OpenQuickQueryKeybindingsRequest.type, async () => {
            await this.openQuickQueryKeybindings();
        });
    }

    private async saveAndCloseConfiguration(
        payload: SaveShortcutsConfigurationPayload,
    ): Promise<SaveShortcutsConfigurationResult> {
        const result = await this.saveConfiguration(payload);
        if (!result.errorMessage) {
            this.panel.dispose();
        }
        return result;
    }

    private async saveConfiguration(
        payload: SaveShortcutsConfigurationPayload,
    ): Promise<SaveShortcutsConfigurationResult> {
        this.state = { ...this.state, errorMessage: undefined };
        const quickQueries = normalizeQuickQueries(payload.quickQueries);
        const webviewShortcuts = sanitizeWebviewShortcuts(payload.webviewShortcuts ?? {});
        const changedSections = payload.changedSections ?? {
            quickQueries: true,
            webviewShortcuts: true,
        };

        try {
            if (changedSections.quickQueries) {
                await vscode.workspace
                    .getConfiguration()
                    .update(
                        Constants.configQuickQueries,
                        quickQueries,
                        vscode.ConfigurationTarget.Global,
                    );
            }
            if (changedSections.webviewShortcuts) {
                await vscode.workspace
                    .getConfiguration()
                    .update(
                        Constants.configShortcuts,
                        webviewShortcuts,
                        getConfigurationTarget(Constants.configShortcuts),
                    );
            }

            return { message: Loc.shortcutsConfigurationSaved };
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            this.state = { ...this.state, errorMessage };
            return {
                errorMessage,
            };
        }
    }

    public focusQuickQuerySlot(focusedQuickQuerySlot?: number): void {
        this.state = { ...this.state, focusedQuickQuerySlot, focusNonce: this.nextFocusNonce() };
    }

    private async readConfiguration(): Promise<ShortcutsConfigurationData> {
        return {
            quickQueries: normalizeQuickQueries(
                vscode.workspace.getConfiguration().get(Constants.configQuickQueries),
            ),
            webviewShortcuts:
                vscode.workspace
                    .getConfiguration()
                    .get<Record<string, string>>(Constants.configShortcuts) ?? {},
        };
    }

    private getQuickQueryCommandIds(): string[] {
        return Array.from({ length: quickQueryCount }, (_unused, index) =>
            getQuickQueryCommandId(index + 1),
        );
    }

    private async openQuickQueryKeybinding(commandId: string): Promise<void> {
        if (!this.getQuickQueryCommandIds().includes(commandId)) {
            return;
        }

        await vscode.commands.executeCommand(
            "workbench.action.openGlobalKeybindings",
            `@command:${commandId}`,
        );
    }

    private async openQuickQueryKeybindings(): Promise<void> {
        await vscode.commands.executeCommand(
            "workbench.action.openGlobalKeybindings",
            quickQueryCommandPrefix,
        );
    }

    private nextFocusNonce(): number {
        this.focusNonce += 1;
        return this.focusNonce;
    }
}

function sanitizeWebviewShortcuts(value: Record<string, string>): Record<string, string> {
    const allowedActions = new Set<string>(Object.values(WebviewAction));
    return Object.entries(value).reduce<Record<string, string>>((result, [action, shortcut]) => {
        if (allowedActions.has(action) && typeof shortcut === "string") {
            result[action] = shortcut;
        }
        return result;
    }, {});
}

function getConfigurationTarget(section: string): vscode.ConfigurationTarget {
    const inspected = vscode.workspace.getConfiguration().inspect(section);
    if (inspected?.workspaceFolderValue !== undefined) {
        return vscode.ConfigurationTarget.WorkspaceFolder;
    }
    if (inspected?.workspaceValue !== undefined) {
        return vscode.ConfigurationTarget.Workspace;
    }
    return vscode.ConfigurationTarget.Global;
}
