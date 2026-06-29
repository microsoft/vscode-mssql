/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — service entry point.
 *
 * Single seam between cloudDeploy internals and the rest of the extension.
 * Commands, MCP tools, and webviews all reach the env model (and future
 * subsystems: validations, publishing, etc.) through this object.
 *
 * `environments` is `undefined` when no workspace folder is open — Cloud
 * Deploy is a folder-scoped feature, so the rest of the extension still works
 * without it.
 */

import * as vscode from "vscode";

import { EnvironmentStore } from "./environments/environmentStore";

export class CloudDeployService implements vscode.Disposable {
    public readonly environments: EnvironmentStore | undefined;

    public constructor(
        workspaceFolder: vscode.WorkspaceFolder | undefined,
        workspaceState: vscode.Memento,
    ) {
        if (workspaceFolder !== undefined) {
            this.environments = new EnvironmentStore(workspaceFolder, workspaceState);
        }
    }

    /** Loads on-disk state. Safe to call when no folder is open (resolves immediately). */
    public async init(): Promise<void> {
        if (this.environments !== undefined) {
            await this.environments.init();
        }
    }

    public dispose(): void {
        this.environments?.dispose();
    }
}
