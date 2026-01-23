/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewViewController } from "../controllers/reactWebviewViewController";
import VscodeWrapper from "../controllers/vscodeWrapper";
import {
    ProfilerDetailsPanelState,
    ProfilerDetailsPanelReducers,
    ProfilerSelectedEventDetails,
} from "../sharedInterfaces/profiler";
import { ProfilerTelemetry } from "./profilerTelemetry";

/**
 * View ID for the profiler details panel (must match package.json contribution)
 */
export const PROFILER_DETAILS_VIEW_ID = "profilerDetails";

/**
 * Controller for the profiler details panel that displays selected event information.
 * This is a VS Code WebviewView that appears in the Panel area (alongside Terminal, Output, etc.).
 *
 * State updates are handled via the base controller's state management, which automatically
 * syncs with the webview via useSyncExternalStore (following the query result pattern).
 */
export class ProfilerDetailsPanelViewController extends ReactWebviewViewController<
    ProfilerDetailsPanelState,
    ProfilerDetailsPanelReducers
> {
    private static _instance: ProfilerDetailsPanelViewController | undefined;

    constructor(context: vscode.ExtensionContext, vscodeWrapper: VscodeWrapper) {
        super(context, vscodeWrapper, "profilerDetails", PROFILER_DETAILS_VIEW_ID, {
            selectedEvent: undefined,
            sessionName: undefined,
        });

        this.registerReducers();

        // Set context variable so the panel view becomes visible in VS Code
        void vscode.commands.executeCommand("setContext", "mssql.profilerDetailsVisible", true);
    }

    /**
     * Get the singleton instance of the controller
     */
    public static getInstance(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
    ): ProfilerDetailsPanelViewController {
        if (!ProfilerDetailsPanelViewController._instance) {
            ProfilerDetailsPanelViewController._instance = new ProfilerDetailsPanelViewController(
                context,
                vscodeWrapper,
            );
        }
        return ProfilerDetailsPanelViewController._instance;
    }

    /**
     * Reset the singleton instance (for testing purposes)
     */
    public static resetInstance(): void {
        ProfilerDetailsPanelViewController._instance = undefined;
    }

    /**
     * Register the view provider with VS Code
     */
    public static register(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
    ): vscode.Disposable {
        const instance = ProfilerDetailsPanelViewController.getInstance(context, vscodeWrapper);
        return vscode.window.registerWebviewViewProvider(PROFILER_DETAILS_VIEW_ID, instance);
    }

    /**
     * Register reducers for webview actions
     */
    private registerReducers(): void {
        // Handle Open in Editor request
        this.registerReducer(
            "openInEditor",
            async (state, payload: { textData: string; eventName?: string }) => {
                ProfilerTelemetry.sendOpenInEditor();
                await this.openTextInEditor(payload.textData);
                return state;
            },
        );

        // Handle Copy to Clipboard request
        this.registerReducer("copyToClipboard", async (state, payload: { text: string }) => {
            ProfilerTelemetry.sendCopyToClipboard("textData");
            await vscode.env.clipboard.writeText(payload.text);
            void vscode.window.showInformationMessage("Copied to clipboard");
            return state;
        });
    }

    /**
     * Open the provided text in a new VS Code editor
     */
    private async openTextInEditor(textData: string): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument({
                content: textData,
                language: "sql",
            });

            await vscode.window.showTextDocument(document, {
                viewColumn: vscode.ViewColumn.One,
                preview: true,
            });
        } catch (error) {
            void vscode.window.showErrorMessage(
                `Failed to open in editor: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    /**
     * Update the selected event details displayed in the panel.
     * Called by the main profiler controller when grid selection changes.
     * State change automatically syncs to webview via useSyncExternalStore.
     */
    public updateSelectedEvent(event: ProfilerSelectedEventDetails | undefined): void {
        this.state = {
            ...this.state,
            selectedEvent: event,
        };
    }

    /**
     * Update the session name for context
     */
    public updateSessionName(sessionName: string | undefined): void {
        this.state = {
            ...this.state,
            sessionName,
        };
    }

    /**
     * Clear the selected event (called when session stops or clears)
     */
    public clearSelection(): void {
        this.updateSelectedEvent(undefined);
    }

    /**
     * Reveal the details panel and bring it to focus
     */
    public async reveal(): Promise<void> {
        await this.revealToForeground();
    }
}
