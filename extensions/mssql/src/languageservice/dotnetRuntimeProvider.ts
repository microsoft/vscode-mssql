/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ILogger } from "../models/interfaces";
import * as Constants from "../constants/constants";
import { config } from "../configurations/config";
import { DotnetRuntime } from "../constants/locConstants";

/**
 * Resolves a .NET runtime path for running framework-dependent SQL Tools Service binaries.
 *
 * Priority:
 * 1. ms-dotnettools.vscode-dotnet-runtime extension (`dotnet.acquire` command)
 * 2. Error with guidance to install the offline VSIX
 */
export default class DotnetRuntimeProvider {
    constructor(private _logger: ILogger) {}

    /**
     * Acquires a path to a `dotnet` executable suitable for running .NET 8.0 assemblies.
     * @returns The resolved dotnet executable path.
     * @throws If no runtime can be resolved.
     */
    public async acquireDotnetRuntime(): Promise<string> {
        // 1. ms-dotnettools.vscode-dotnet-runtime extension
        try {
            const result = await vscode.commands.executeCommand<{ dotnetPath: string }>(
                Constants.dotnetAcquireCommand,
                {
                    version: config.service.dotnetRuntimeVersion,
                    requestingExtensionId: Constants.extensionId,
                },
            );
            if (result?.dotnetPath) {
                this._logger.appendLine(
                    DotnetRuntime.acquiredDotnetRuntime(
                        Constants.dotnetRuntimeExtensionId,
                        result.dotnetPath,
                    ),
                );
                return result.dotnetPath;
            }
        } catch (err) {
            this._logger.appendLine(
                DotnetRuntime.failedToAcquireDotnetRuntime(
                    Constants.dotnetRuntimeExtensionId,
                    String(err),
                ),
            );
        }
        throw new Error(DotnetRuntime.runtimeNotFoundThrow);
    }
}
