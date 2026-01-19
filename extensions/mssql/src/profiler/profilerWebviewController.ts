/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as profiler from "../sharedInterfaces/profiler";
import * as vscode from "vscode";
import { ApiStatus } from "../sharedInterfaces/webview";
import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import VscodeWrapper from "../controllers/vscodeWrapper";

export class ProfilerWebviewController extends ReactWebviewPanelController<
    profiler.ProfilerWebviewState,
    profiler.ProfilerReducers
> {
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        sessionName: string,
        initialEvents: profiler.ProfilerEvent[] = [],
    ) {
        super(
            context,
            vscodeWrapper,
            "sqlProfiler",
            "sqlProfiler",
            {
                profilerState: {
                    loadState: ApiStatus.Loaded,
                    events: initialEvents,
                    detailsPanelVisible: false,
                    detailsPanelMaximized: false,
                    activeTab: "text",
                },
            },
            {
                title: `SQL Profiler - ${sessionName}`,
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(context.extensionUri, "media", "profiler_dark.svg"),
                    light: vscode.Uri.joinPath(context.extensionUri, "media", "profiler_light.svg"),
                },
            },
        );
        void this.initialize();
    }

    private async initialize() {
        this.registerRpcHandlers();
    }

    private registerRpcHandlers() {
        this.registerReducer("initializeProfiler", async (state, payload) => {
            return {
                ...state,
                profilerState: {
                    ...state.profilerState,
                    events: payload.events,
                    loadState: ApiStatus.Loaded,
                },
            };
        });

        this.registerReducer("selectEvent", async (state, payload) => {
            return {
                ...state,
                profilerState: {
                    ...state.profilerState,
                    selectedEvent: payload.event,
                    detailsPanelVisible: true,
                },
            };
        });

        this.registerReducer("closeDetailsPanel", async (state, _payload) => {
            return {
                ...state,
                profilerState: {
                    ...state.profilerState,
                    detailsPanelVisible: false,
                },
            };
        });

        this.registerReducer("toggleMaximize", async (state, _payload) => {
            return {
                ...state,
                profilerState: {
                    ...state.profilerState,
                    detailsPanelMaximized: !state.profilerState.detailsPanelMaximized,
                },
            };
        });

        this.registerReducer("switchTab", async (state, payload) => {
            return {
                ...state,
                profilerState: {
                    ...state.profilerState,
                    activeTab: payload.tab,
                },
            };
        });

        this.registerReducer("openInEditor", async (state, payload) => {
            await this.openTextInEditor(payload.textData, payload.language || "sql");
            return state;
        });

        this.registerReducer("copyTextData", async (state, payload) => {
            await this.copyToClipboard(payload.textData);
            return state;
        });

        this.registerReducer("addEvents", async (state, payload) => {
            return {
                ...state,
                profilerState: {
                    ...state.profilerState,
                    events: [...state.profilerState.events, ...payload.events],
                },
            };
        });
    }

    private async openTextInEditor(textData: string, language: string): Promise<void> {
        const document = await vscode.workspace.openTextDocument({
            content: textData,
            language: language,
        });
        await vscode.window.showTextDocument(document, {
            viewColumn: vscode.ViewColumn.Beside,
            preserveFocus: false,
        });
    }

    private async copyToClipboard(text: string): Promise<void> {
        await vscode.env.clipboard.writeText(text);
        await vscode.window.showInformationMessage("Text copied to clipboard");
    }

    /**
     * Add new events to the profiler (for streaming updates)
     */
    public addEvents(events: profiler.ProfilerEvent[]): void {
        this.state.profilerState.events.push(...events);
        this.updateState();
    }
}
