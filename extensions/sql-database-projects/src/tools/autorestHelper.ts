/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as constants from "../common/constants";
import * as utils from "../common/utils";
import * as semver from "semver";
import { DBProjectConfigurationKey } from "./netcoreTool";
import { ShellExecutionHelper } from "./shellExecutionHelper";

const autorestPackageName = "autorest-sql-testing"; // name of AutoRest.Sql package on npm
const nodejsDoNotAskAgainKey = "nodejsDoNotAsk";
const autorestSqlVersionKey = "autorestSqlVersion";

/**
 * On Windows, .cmd/.bat files cannot be executed directly by spawn(shell:false).
 * They must be routed through cmd.exe /c.
 */
function wrapCmdIfNeeded(resolvedPath: string): { executable: string; prefixArgs: string[] } {
    if (process.platform === "win32" && /\.(cmd|bat)$/i.test(resolvedPath)) {
        const cmdExe = process.env.ComSpec ?? "cmd.exe";
        // /d disables AutoRun; /c runs the command and exits.
        // No /s: it triggers quote-stripping that mangles args containing spaces.
        return { executable: cmdExe, prefixArgs: ["/d", "/c", resolvedPath] };
    }
    return { executable: resolvedPath, prefixArgs: [] };
}

/**
 * Helper class for dealing with Autorest generation and detection
 */
export class AutorestHelper extends ShellExecutionHelper {
    constructor(_outputChannel: vscode.OutputChannel) {
        super(_outputChannel);
    }

    /**
     * Checks the workspace configuration to for an AutoRest.Sql override, otherwise latest will be used from NPM
     */
    public get autorestSqlPackageVersion(): string {
        let configVal: string | undefined =
            vscode.workspace.getConfiguration(DBProjectConfigurationKey)[autorestSqlVersionKey];

        if (configVal && semver.valid(configVal.trim())) {
            return configVal.trim();
        } else {
            return "latest";
        }
    }

    /**
     * @returns the executable and prefix args needed to run autorest, or undefined if unavailable.
     */
    public async detectInstallation(): Promise<
        { executable: string; prefixArgs: string[] } | undefined
    > {
        const autorestCommand = "autorest";
        const npxCommand = "npx";

        const resolvedAutorest = await utils.resolveCommandPath(autorestCommand);
        if (resolvedAutorest) {
            return wrapCmdIfNeeded(resolvedAutorest);
        }

        const resolvedNpx = await utils.resolveCommandPath(npxCommand);
        if (resolvedNpx) {
            this._outputChannel.appendLine(constants.nodeButNotAutorestFound);
            const response = await vscode.window.showInformationMessage(
                constants.nodeButNotAutorestFoundPrompt,
                constants.installGlobally,
                constants.runViaNpx,
            );

            if (response === constants.installGlobally) {
                this._outputChannel.appendLine(constants.userSelectionInstallGlobally);
                const resolvedNpm = await utils.resolveCommandPath("npm");
                const { executable: npmExe, prefixArgs: npmArgs } = resolvedNpm
                    ? wrapCmdIfNeeded(resolvedNpm)
                    : { executable: "npm", prefixArgs: [] };
                await this.runStreamedCommand(npmExe, [...npmArgs, "install", "autorest", "-g"]);
                const newResolved = await utils.resolveCommandPath(autorestCommand);
                return newResolved
                    ? wrapCmdIfNeeded(newResolved)
                    : { executable: autorestCommand, prefixArgs: [] };
            } else if (response === constants.runViaNpx) {
                this._outputChannel.appendLine(constants.userSelectionRunNpx);
                const { executable, prefixArgs } = wrapCmdIfNeeded(resolvedNpx);
                return { executable, prefixArgs: [...prefixArgs, autorestCommand] };
            } else {
                this._outputChannel.appendLine(constants.userSelectionCancelled);
            }
        } else {
            this._outputChannel.appendLine(constants.nodeNotFound);
        }

        return undefined;
    }

    /**
     * Calls autorest to generate files from the spec, piping standard and error output to the host console
     * @param specPath path to the OpenAPI spec file
     * @param outputFolder folder in which to generate the .sql script files
     * @returns console output from autorest execution
     */
    public async generateAutorestFiles(
        specPath: string,
        outputFolder: string,
    ): Promise<string | undefined> {
        const commandExecutable = await this.detectInstallation();

        if (!commandExecutable) {
            // unable to find autorest or npx

            if (
                vscode.workspace.getConfiguration(DBProjectConfigurationKey)[
                    nodejsDoNotAskAgainKey
                ] === true
            ) {
                return; // user opted out of being prompted
            }

            // prompt user to install Node.js
            const result = await vscode.window.showErrorMessage(
                constants.nodeNotFound,
                constants.DoNotAskAgain,
                constants.Install,
            );

            if (result === constants.Install) {
                const nodejsInstallationUrl = "https://nodejs.org/en/download";
                await vscode.env.openExternal(vscode.Uri.parse(nodejsInstallationUrl));
            } else if (result === constants.DoNotAskAgain) {
                const config = vscode.workspace.getConfiguration(DBProjectConfigurationKey);
                await config.update(
                    nodejsDoNotAskAgainKey,
                    true,
                    vscode.ConfigurationTarget.Global,
                );
            }

            return;
        }

        const { executable, args } = this.constructAutorestCommand(
            commandExecutable,
            specPath,
            outputFolder,
        );
        const output = await this.runStreamedCommand(executable, args);

        return output;
    }

    /**
     * @param installation resolved executable and any prefix args (e.g. npx prefix)
     * @param specPath path to the OpenAPI spec
     * @param outputFolder folder in which to generate the files
     * @returns ready to pass to runStreamedCommand
     */
    public constructAutorestCommand(
        installation: { executable: string; prefixArgs: string[] },
        specPath: string,
        outputFolder: string,
    ): { executable: string; args: string[] } {
        // TODO: should --clear-output-folder be included? We should always be writing to a folder created just for this, but potentially risky
        return {
            executable: installation.executable,
            args: [
                ...installation.prefixArgs,
                `--use:${autorestPackageName}@${this.autorestSqlPackageVersion}`,
                `--input-file=${specPath}`,
                `--output-folder=${outputFolder}`,
                "--clear-output-folder",
                "--level:error",
            ],
        };
    }
}
