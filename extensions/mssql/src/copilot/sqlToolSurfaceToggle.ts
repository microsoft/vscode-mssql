/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

export const enableNativeToolsConfigKey = "mssql.copilot.enableNativeTools";
export const enableSqlToolsMcpConfigKey = "mssql.copilot.enableSqlToolsMcp";
export const toggleSqlToolSurfaceCommand = "mssql.copilot.toggleSqlToolSurface";

export function areNativeToolsEnabled(): boolean {
    return vscode.workspace.getConfiguration().get<boolean>(enableNativeToolsConfigKey, false);
}

export function isSqlToolsMcpEnabled(): boolean {
    return vscode.workspace.getConfiguration().get<boolean>(enableSqlToolsMcpConfigKey, true);
}

export function registerSqlToolSurfaceToggle(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(toggleSqlToolSurfaceCommand, async () => {
            const nextNativeEnabled = !areNativeToolsEnabled();
            const nextMcpEnabled = !nextNativeEnabled;

            await vscode.workspace
                .getConfiguration()
                .update(
                    enableNativeToolsConfigKey,
                    nextNativeEnabled,
                    vscode.ConfigurationTarget.Global,
                );
            await vscode.workspace
                .getConfiguration()
                .update(
                    enableSqlToolsMcpConfigKey,
                    nextMcpEnabled,
                    vscode.ConfigurationTarget.Global,
                );

            const surface = nextNativeEnabled
                ? "native mssql language model tools"
                : "SQL Tools MCP";
            void vscode.window
                .showInformationMessage(
                    `MSSQL Copilot test tool surface set to ${surface}. Reload the window before measuring.`,
                    "Reload Window",
                )
                .then((choice) => {
                    if (choice === "Reload Window") {
                        void vscode.commands.executeCommand("workbench.action.reloadWindow");
                    }
                });
        }),
    );
}
