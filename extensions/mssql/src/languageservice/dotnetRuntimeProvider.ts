/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as fs from "fs/promises";
import { ILogger } from "../models/interfaces";
import * as Constants from "../constants/constants";
import { ServiceClient } from "../constants/locConstants";
import { getErrorMessage } from "../utils/utils";

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
     * Acquires a path to a `dotnet` executable suitable for running service assemblies.
     * @returns The resolved dotnet executable path.
     * @throws If no runtime can be resolved.
     */
    public async acquireDotnetRuntime(runtimeConfigPath: string): Promise<string> {
        try {
            const runtimeVersion = await this.getRuntimeVersion(runtimeConfigPath);
            const extension = vscode.extensions.getExtension(Constants.dotnetRuntimeExtensionId);
            if (!extension) {
                this._logger.error("The .NET runtime extension is not installed");
                throw new Error(ServiceClient.runtimeNotFoundError);
            }
            await extension.activate();
            const result = await vscode.commands.executeCommand<{ dotnetPath: string }>(
                Constants.dotnetAcquireCommand,
                {
                    version: runtimeVersion,
                    requestingExtensionId: Constants.extensionId,
                    mode: "runtime",
                    forceUpdate: true,
                },
            );
            if (result?.dotnetPath) {
                await fs.access(result.dotnetPath);
                this._logger.verbose("Acquired .NET runtime via command: " + result.dotnetPath);
                return result.dotnetPath;
            }
        } catch (err) {
            this._logger.error("Error acquiring .NET runtime", getErrorMessage(err));
        }
        this._logger.error("No .NET runtime found");
        throw new Error(ServiceClient.runtimeNotFoundError);
    }

    private async getRuntimeVersion(runtimeConfigPath: string): Promise<string> {
        try {
            const runtimeConfig = JSON.parse(await fs.readFile(runtimeConfigPath, "utf-8")) as {
                runtimeOptions?: {
                    framework?: {
                        name?: string;
                        version?: string;
                    };
                };
            };
            const framework = runtimeConfig.runtimeOptions?.framework;
            if (framework?.name === "Microsoft.NETCore.App" && framework.version) {
                return framework.version;
            }
        } catch (err) {
            this._logger.error(
                `Unable to read .NET runtime version from ${runtimeConfigPath}`,
                getErrorMessage(err),
            );
            throw err;
        }

        throw new Error(
            `Unable to find Microsoft.NETCore.App version in runtime config: ${runtimeConfigPath}`,
        );
    }
}
