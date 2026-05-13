/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import { getErrorMessage } from "../utils/utils";
import { KeybindingsService } from "../keybindings/keybindingsService";
import {
    getQuickQueryCommandId,
    ShortcutsConfigurationReducers,
    ShortcutsConfigurationWebviewState,
    normalizeQuickQueries,
    quickQueryCount,
} from "../sharedInterfaces/shortcutsConfiguration";
import { WebviewPanelController } from "./webviewPanelController";
import VscodeWrapper from "./vscodeWrapper";

export class ShortcutsConfigurationWebviewController extends WebviewPanelController<
    ShortcutsConfigurationWebviewState,
    ShortcutsConfigurationReducers,
    void
> {
    private readonly keybindingsService: KeybindingsService;

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
                quickQueries: normalizeQuickQueries(undefined),
                quickQueryKeybindings: {},
                webviewShortcuts: {},
                focusedQuickQuerySlot,
            },
            {
                title: "Shortcuts Configuration",
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

        this.keybindingsService = new KeybindingsService(context);
        this.registerRpcHandlers();
        this.registerDisposable(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration("mssql")) {
                    void this.refreshState();
                }
            }),
        );
        void this.refreshState(undefined, undefined, focusedQuickQuerySlot);
    }

    private registerRpcHandlers(): void {
        this.registerReducer("closeDialog", async (state) => {
            this.panel.dispose();
            return state;
        });

        this.registerReducer("reloadConfiguration", async () => {
            return await this.getConfigurationState("Configuration reloaded.");
        });

        this.registerReducer("saveConfiguration", async (state, payload) => {
            this.state = { ...state, isSaving: true, message: undefined, errorMessage: undefined };
            const quickQueries = normalizeQuickQueries(payload.quickQueries);
            const webviewShortcuts = payload.webviewShortcuts ?? {};

            try {
                try {
                    await this.keybindingsService.updateCommandKeybindings(
                        this.getQuickQueryCommandIds().map((command) => ({
                            command,
                            key: payload.quickQueryKeybindings?.[command] ?? "",
                        })),
                    );
                } catch (error) {
                    await this.keybindingsService.openKeybindingsFile();
                    throw new Error(
                        `${getErrorMessage(error)} The keybindings file has been opened for manual editing.`,
                    );
                }

                await vscode.workspace
                    .getConfiguration()
                    .update(
                        Constants.configQuickQueries,
                        quickQueries,
                        vscode.ConfigurationTarget.Global,
                    );
                await vscode.workspace
                    .getConfiguration()
                    .update(
                        Constants.configShortcuts,
                        webviewShortcuts,
                        vscode.ConfigurationTarget.Global,
                    );

                return await this.getConfigurationState("Configuration saved.");
            } catch (error) {
                return {
                    ...state,
                    quickQueries,
                    webviewShortcuts,
                    quickQueryKeybindings: payload.quickQueryKeybindings ?? {},
                    isSaving: false,
                    message: undefined,
                    errorMessage: getErrorMessage(error),
                };
            }
        });
    }

    private async refreshState(
        message?: string,
        errorMessage?: string,
        focusedQuickQuerySlot?: number,
    ): Promise<void> {
        this.state = await this.getConfigurationState(message, errorMessage, focusedQuickQuerySlot);
    }

    public focusQuickQuerySlot(focusedQuickQuerySlot?: number): void {
        this.state = { ...this.state, focusedQuickQuerySlot };
    }

    private async getConfigurationState(
        message?: string,
        errorMessage?: string,
        focusedQuickQuerySlot?: number,
    ): Promise<ShortcutsConfigurationWebviewState> {
        let keybindings: Record<string, string> = {};
        let stateErrorMessage = errorMessage;

        try {
            keybindings = await this.keybindingsService.getCommandKeybindings(
                this.getQuickQueryCommandIds(),
            );
        } catch (error) {
            stateErrorMessage = getErrorMessage(error);
        }

        return {
            quickQueries: normalizeQuickQueries(
                vscode.workspace.getConfiguration().get(Constants.configQuickQueries),
            ),
            quickQueryKeybindings: keybindings,
            webviewShortcuts:
                vscode.workspace
                    .getConfiguration()
                    .get<Record<string, string>>(Constants.configShortcuts) ?? {},
            focusedQuickQuerySlot,
            message,
            errorMessage: stateErrorMessage,
            isSaving: false,
        };
    }

    private getQuickQueryCommandIds(): string[] {
        return Array.from({ length: quickQueryCount }, (_unused, index) =>
            getQuickQueryCommandId(index + 1),
        );
    }
}
