/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as child_process from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as semver from "semver";
import * as vscode from "vscode";
import axios from "axios";
import { HttpClient } from "../http/httpClient";
import {
    DoNotAskAgain,
    Install,
    DotnetInstallationConfirmation,
    NetCoreSupportedVersionInstallationConfirmation,
    UpdateDotnetLocation,
    loc0ErroredOut1,
    microsoftBuildSqlVersionKey,
    nugetVersionResolutionFallbackWarning,
} from "../common/constants";
import * as utils from "../common/utils";
import { isValidMicrosoftBuildSqlVersion } from "../common/utils";
import { ShellCommandOptions, ShellExecutionHelper } from "./shellExecutionHelper";

export const DBProjectConfigurationKey = "sqlDatabaseProjects";
export const NetCoreInstallLocationKey = "netCoreSDKLocation";
export const DotnetInstallLocationKey = "dotnetSDK Location";
export const NetCoreDoNotAskAgainKey = "netCoreDoNotAsk";
export const NetCoreMacDefaultPath = "/usr/local/share";
export const NetCoreLinuxDefaultPath = "/usr/share";
export const winPlatform = "win32";
export const macPlatform = "darwin";
export const linuxPlatform = "linux";
export const minSupportedNetCoreVersionForBuild = "8.0.0";

/**
 * Default Microsoft.Build.Sql version. Uses a NuGet floating version so that projects and
 * legacy DLL downloads always target the latest 2.x release. To upgrade to 3.x in the future,
 * change only this constant (and the matching default in package.json).
 */
export const FALLBACK_MICROSOFT_BUILD_SQL_VERSION = "2.*";

/**
 * Exact version used when NuGet resolution fails (offline / proxy). Kept in sync with the
 * latest known-good 2.x release so projects created offline are immediately buildable.
 */
export const OFFLINE_FALLBACK_MICROSOFT_BUILD_SQL_VERSION = "2.2.0";

/**
 * Returns the configured Microsoft.Build.Sql version.
 * Accepts both exact semver versions and NuGet floating versions (e.g. "2.*").
 * When a floating version is returned, callers that construct NuGet download URLs must resolve
 * it to an exact version first via the NuGet v3 index API.
 * Falls back to FALLBACK_MICROSOFT_BUILD_SQL_VERSION if the user-configured value is absent or invalid.
 */
export function getMicrosoftBuildSqlVersion(): string {
    const config = vscode.workspace.getConfiguration(DBProjectConfigurationKey);
    const configured = config.get<string>(microsoftBuildSqlVersionKey)?.trim();
    if (configured && (semver.valid(configured) || isValidMicrosoftBuildSqlVersion(configured))) {
        return configured;
    }

    return FALLBACK_MICROSOFT_BUILD_SQL_VERSION;
}

/**
 * Resolves a NuGet floating version (e.g. "2.*", "2.1.*") to the latest matching stable
 * exact version by querying the NuGet v3 flat-container index.
 * If the version is already exact (valid semver), it is returned as-is.
 * If the requested floating version has no matching stable releases on NuGet, falls back to
 * FALLBACK_MICROSOFT_BUILD_SQL_VERSION and shows a VS Code warning.
 * Throws only if the fallback also cannot be resolved.
 */
export async function resolveNugetVersion(packageName: string, version: string): Promise<string> {
    if (semver.valid(version)) {
        return version; // Already exact — nothing to resolve.
    }

    try {
        return await resolveFloatingVersion(packageName, version);
    } catch (e) {
        // The requested version (e.g. "4.*") has no stable matches — fall back to the default.
        if (version !== FALLBACK_MICROSOFT_BUILD_SQL_VERSION) {
            void vscode.window.showWarningMessage(
                nugetVersionResolutionFallbackWarning(
                    packageName,
                    version,
                    FALLBACK_MICROSOFT_BUILD_SQL_VERSION,
                ),
            );
            return resolveFloatingVersion(packageName, FALLBACK_MICROSOFT_BUILD_SQL_VERSION);
        }
        throw e; // Re-throw original error (network failure, parse error, etc.)
    }
}

/**
 * Core NuGet v3 index lookup — resolves a floating version prefix to the latest stable exact
 * version. Uses the extension's HttpClient (proxy + strictSSL aware) with a 10 s timeout.
 * Throws if no match is found or the network call fails.
 */
async function resolveFloatingVersion(packageName: string, version: string): Promise<string> {
    // "2.*" → prefix "2."   |   "2.1.*" → prefix "2.1."
    const prefix = version.slice(0, version.lastIndexOf("*"));
    const indexUrl = `https://api.nuget.org/v3-flatcontainer/${packageName.toLowerCase()}/index.json`;

    // Use HttpClient.setupRequest to pick up VS Code proxy + strictSSL configuration.
    const { config } = new HttpClient().setupRequest(indexUrl);
    config.timeout = 10_000;

    const response = await axios.get<{ versions: string[] }>(indexUrl, config);
    if (response.status !== 200) {
        throw new Error(`Failed to fetch NuGet index for ${packageName}: HTTP ${response.status}`);
    }

    // Stable versions only (no pre-release), matching the prefix, pick the last (highest).
    const matching = response.data.versions.filter((v) => v.startsWith(prefix) && !v.includes("-"));

    if (matching.length > 0) {
        return matching[matching.length - 1];
    }

    throw new Error(`No stable versions of ${packageName} found matching ${version}`);
}

export const enum netCoreInstallState {
    netCoreNotPresent,
    netCoreVersionNotSupported,
    netCoreVersionSupported,
}

const dotnet = os.platform() === "win32" ? "dotnet.exe" : "dotnet";

export class NetCoreTool extends ShellExecutionHelper {
    private osPlatform: string = os.platform();
    private netCoreSdkInstalledVersion: string | undefined;
    private netCoreInstallState: netCoreInstallState = netCoreInstallState.netCoreVersionSupported;

    /**
     * This method presents the installation dialog for .NET Core, if not already present/supported
     * @param skipVersionSupportedCheck If true then skip the check to determine whether the .NET version is supported (for commands that work on all versions)
     * @returns True if .NET version was found and is supported
     * 			False if .NET version isn't present or present but not supported
     */
    public async findOrInstallNetCore(skipVersionSupportedCheck = false): Promise<boolean> {
        if (
            !this.isNetCoreInstallationPresent ||
            (this.isNetCoreInstallationPresent && !skipVersionSupportedCheck)
        ) {
            if (
                !this.isNetCoreInstallationPresent ||
                !(await this.isNetCoreVersionSupportedForBuild())
            ) {
                if (
                    vscode.workspace.getConfiguration(DBProjectConfigurationKey)[
                        NetCoreDoNotAskAgainKey
                    ] !== true
                ) {
                    void this.showInstallDialog(); // Removing await so that Build and extension load process doesn't wait on user input
                }
                return false;
            }
        }

        this.netCoreInstallState = netCoreInstallState.netCoreVersionSupported;
        return true;
    }

    constructor(_outputChannel: vscode.OutputChannel) {
        super(_outputChannel);
    }

    public async showInstallDialog(): Promise<void> {
        let result;
        if (this.netCoreInstallState === netCoreInstallState.netCoreNotPresent) {
            result = await vscode.window.showErrorMessage(
                DotnetInstallationConfirmation,
                UpdateDotnetLocation,
                Install,
                DoNotAskAgain,
            );
        } else {
            result = await vscode.window.showErrorMessage(
                NetCoreSupportedVersionInstallationConfirmation(this.netCoreSdkInstalledVersion!),
                UpdateDotnetLocation,
                Install,
                DoNotAskAgain,
            );
        }

        if (result === UpdateDotnetLocation) {
            //open settings
            await vscode.commands.executeCommand("workbench.action.openGlobalSettings");
        } else if (result === Install) {
            //open install link
            const dotnetSdkUrl = "https://aka.ms/sqlprojects-dotnet";
            await vscode.env.openExternal(vscode.Uri.parse(dotnetSdkUrl));
        } else if (result === DoNotAskAgain) {
            const config = vscode.workspace.getConfiguration(DBProjectConfigurationKey);
            await config.update(NetCoreDoNotAskAgainKey, true, vscode.ConfigurationTarget.Global);
        }
    }

    private get isNetCoreInstallationPresent(): boolean {
        const netCoreInstallationPresent =
            !!this.netcoreInstallLocation && fs.existsSync(this.netcoreInstallLocation);
        if (!netCoreInstallationPresent) {
            this.netCoreInstallState = netCoreInstallState.netCoreNotPresent;
        }
        return netCoreInstallationPresent;
    }

    public get netcoreInstallLocation(): string {
        return (
            vscode.workspace.getConfiguration(DBProjectConfigurationKey)[
                DotnetInstallLocationKey
            ] || this.defaultLocalInstallLocationByDistribution
        );
    }

    private get defaultLocalInstallLocationByDistribution(): string | undefined {
        switch (this.osPlatform) {
            case winPlatform:
                return this.defaultWindowsLocation;
            case macPlatform:
                return this.defaultMacLocation;
            case linuxPlatform:
                return this.defaultLinuxLocation;
            default:
                return undefined;
        }
    }

    private get defaultMacLocation(): string | undefined {
        return (
            this.getDotnetPathIfPresent(NetCoreMacDefaultPath) || //default folder for net core sdk on Mac
            this.getDotnetPathIfPresent(os.homedir()) ||
            undefined
        );
    }

    private get defaultLinuxLocation(): string | undefined {
        return (
            this.getDotnetPathIfPresent(NetCoreLinuxDefaultPath) || //default folder for net core sdk on Linux
            this.getDotnetPathIfPresent(os.homedir()) ||
            undefined
        );
    }

    private get defaultWindowsLocation(): string | undefined {
        return (
            this.getDotnetPathIfPresent(process.env["ProgramW6432"]) ||
            this.getDotnetPathIfPresent(process.env["ProgramFiles(x86)"]) ||
            this.getDotnetPathIfPresent(process.env["ProgramFiles"])
        );
    }

    private getDotnetPathIfPresent(folderPath: string | undefined): string | undefined {
        if (folderPath && fs.existsSync(path.join(folderPath, "dotnet"))) {
            return path.join(folderPath, "dotnet");
        }
        return undefined;
    }

    /**
     * This function checks if the installed dotnet version is at least minSupportedNetCoreVersionForBuild.
     * Versions lower than minSupportedNetCoreVersionForBuild aren't supported for building projects.
     * Returns: True if installed dotnet version is supported, false otherwise.
     * 			Undefined if dotnet isn't installed.
     */
    private async isNetCoreVersionSupportedForBuild(): Promise<boolean | undefined> {
        try {
            const spawn = child_process.spawn;
            let child: child_process.ChildProcessWithoutNullStreams;
            let isSupported = false;
            const stdoutBuffers: Buffer[] = [];

            child = spawn("dotnet", ["--version"]);

            child.stdout.on("data", (b: Buffer) => stdoutBuffers.push(b));

            await new Promise((resolve, reject) => {
                child.on("exit", () => {
                    this.netCoreSdkInstalledVersion = Buffer.concat(stdoutBuffers)
                        .toString("utf8")
                        .trim();

                    try {
                        if (
                            semver.gte(
                                this.netCoreSdkInstalledVersion,
                                minSupportedNetCoreVersionForBuild,
                            )
                        ) {
                            // Net core version greater than or equal to minSupportedNetCoreVersion are supported for Build
                            isSupported = true;
                        } else {
                            isSupported = false;
                        }
                        resolve({ stdout: this.netCoreSdkInstalledVersion });
                    } catch (err) {
                        console.log(err);
                        reject(err);
                    }
                });
                child.on("error", (err) => {
                    console.log(err);
                    this.netCoreInstallState = netCoreInstallState.netCoreNotPresent;
                    reject(err);
                });
            });

            if (isSupported) {
                this.netCoreInstallState = netCoreInstallState.netCoreVersionSupported;
            } else {
                this.netCoreInstallState = netCoreInstallState.netCoreVersionNotSupported;
            }

            return isSupported;
        } catch (err) {
            console.log(err);
            this.netCoreInstallState = netCoreInstallState.netCoreNotPresent;
            return undefined;
        }
    }

    /**
     * Runs the specified dotnet command
     * @param options The options to use when launching the process
     * @param skipVersionSupportedCheck If true then skip the check to determine whether the .NET version is supported (for commands that work on all versions)
     * @returns
     */
    public async runDotnetCommand(
        options: ShellCommandOptions,
        skipVersionSupportedCheck = false,
    ): Promise<string> {
        if (options && options.commandTitle !== undefined && options.commandTitle !== null) {
            this._outputChannel.appendLine(`\t[ ${options.commandTitle} ]`);
        }

        await this.verifyNetCoreInstallation(skipVersionSupportedCheck);

        const dotnetPath = path.join(this.netcoreInstallLocation, dotnet);
        const args = options.argument ? options.argument.split(/\s+/) : [];

        try {
            return await this.runStreamedCommand(dotnetPath, args, options);
        } catch (error) {
            this._outputChannel.append(
                loc0ErroredOut1([dotnetPath, ...args].join(" "), utils.getErrorMessage(error)),
            ); //errors are localized in our code where emitted, other errors are pass through from external components that are not easily localized
            throw error;
        }
    }

    /**
     * Assesses whether the .NET Core installation is present and supported.
     * If not, it will prompt the user to install or update .NET Core.
     * @param skipVersionSupportedCheck
     */
    public async verifyNetCoreInstallation(skipVersionSupportedCheck = false): Promise<void> {
        if (!(await this.findOrInstallNetCore(skipVersionSupportedCheck))) {
            if (this.netCoreInstallState === netCoreInstallState.netCoreNotPresent) {
                throw new DotNetError(DotnetInstallationConfirmation);
            } else {
                throw new DotNetError(
                    NetCoreSupportedVersionInstallationConfirmation(
                        this.netCoreSdkInstalledVersion!,
                    ),
                );
            }
        }
    }
}

export class DotNetError extends Error {}
