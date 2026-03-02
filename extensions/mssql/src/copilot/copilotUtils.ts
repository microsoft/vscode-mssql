/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as LocConstants from "../constants/locConstants";
import { getErrorMessage } from "../utils/utils";

export interface AddMcpServerResult {
    success: boolean;
    error?: string;
}

/**
 * Thin wrappers around VS Code workspace filesystem APIs.
 * Exported so unit tests can stub these (vscode.workspace.fs properties
 * are non-configurable in the test environment).
 */
export const workspaceFileSystem = {
    readFile: (uri: vscode.Uri): Thenable<Uint8Array> => vscode.workspace.fs.readFile(uri),
    writeFile: (uri: vscode.Uri, content: Uint8Array): Thenable<void> =>
        vscode.workspace.fs.writeFile(uri, content),
};

/**
 * Adds an MCP server definition to the workspace's .vscode/mcp.json file.
 * Creates the file if it doesn't exist, merges into existing file if it does.
 * Skips adding if a server with the same URL already exists.
 *
 * @param serverName Name for the MCP server entry
 * @param serverUrl URL of the MCP server endpoint
 * @returns Result indicating success or failure
 */
export async function addMcpServerToWorkspace(
    serverName: string,
    serverUrl: string,
): Promise<AddMcpServerResult> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        void vscode.window.showErrorMessage(LocConstants.SchemaDesigner.noWorkspaceOpenForMcp);
        return {
            success: false,
            error: LocConstants.SchemaDesigner.noWorkspaceOpenForMcp,
        };
    }

    const mcpJsonRelativePath = ".vscode/mcp.json";

    try {
        const mcpJsonPath = vscode.Uri.joinPath(workspaceFolders[0].uri, ".vscode", "mcp.json");

        // Read existing mcp.json or start fresh
        let mcpConfig: { servers: Record<string, unknown>; [key: string]: unknown };
        try {
            const existing = await workspaceFileSystem.readFile(mcpJsonPath);
            mcpConfig = JSON.parse(new TextDecoder().decode(existing));
            if (!mcpConfig.servers) {
                mcpConfig.servers = {};
            }
        } catch {
            mcpConfig = { servers: {} };
        }

        // Check if a server with the same URL already exists
        const alreadyExists = Object.values(mcpConfig.servers).some(
            (s: unknown) =>
                typeof s === "object" &&
                s !== null &&
                "url" in s &&
                (s as { url: string }).url === serverUrl,
        );
        if (alreadyExists) {
            void vscode.window.showInformationMessage(
                LocConstants.SchemaDesigner.mcpServerAlreadyExists(mcpJsonRelativePath),
            );
            return { success: true };
        }

        // Add the new server entry
        mcpConfig.servers[serverName] = {
            type: "http",
            url: serverUrl,
        };

        // Write the file
        await workspaceFileSystem.writeFile(
            mcpJsonPath,
            new TextEncoder().encode(JSON.stringify(mcpConfig, null, "\t")),
        );

        void vscode.window.showInformationMessage(
            LocConstants.SchemaDesigner.mcpServerAddedToWorkspace(mcpJsonRelativePath),
        );
        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: getErrorMessage(error),
        };
    }
}
