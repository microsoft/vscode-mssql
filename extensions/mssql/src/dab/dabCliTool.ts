/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Acquires the Data API builder CLI so it can be run without a .NET SDK.
 *
 * `dotnet tool install` is an SDK command, and most users of this extension
 * have only a runtime — often only the one this extension acquires for SQL
 * Tools Service. So instead of installing a tool, the pinned NuGet package is
 * downloaded and unpacked directly:
 *
 *   <globalStorage>/dab-cli/<version>/tools/<tfm>/any/Microsoft.DataApiBuilder.dll
 *
 * The unpacked tool carries its own `.runtimeconfig.json`, which names the
 * framework version it needs. That file is handed to the same runtime
 * acquisition path SQL Tools Service uses, so the engine runs on a runtime the
 * extension manages rather than whatever happens to be on PATH.
 */

import * as vscode from "vscode";
import * as fsPromises from "fs/promises";
import * as path from "path";
import { VscodeHttpClient } from "extension-toolkit/vscode";
import { ILogger } from "../sharedInterfaces/logger";
import { configDabCliPackageFeedUrl } from "../constants/constants";
import { Dab } from "../sharedInterfaces/dab";
import { getErrorMessage } from "../utils/utils";
import { extractZipArchive } from "./dabCliArchive";

/** Assembly name of the CLI inside the package. */
const DAB_CLI_ASSEMBLY_NAME = "Microsoft.DataApiBuilder.dll";
const DAB_CLI_RUNTIME_CONFIG_NAME = "Microsoft.DataApiBuilder.runtimeconfig.json";

/** Marker written once a package has been fully unpacked. */
const INSTALL_COMPLETE_MARKER = ".installed";

/** The unpacked CLI, ready to run. */
export interface DabCliInstallation {
    /** Directory the package was unpacked into. */
    installPath: string;
    /** Full path of the CLI assembly to pass to `dotnet`. */
    assemblyPath: string;
    /** Full path of the assembly's runtimeconfig, naming the framework it needs. */
    runtimeConfigPath: string;
    /** Version that was acquired. */
    version: string;
}

/**
 * Builds the download URL for a package version. NuGet requires the id and
 * version to be lower-cased in flat container URLs.
 *
 * @param version Package version to download
 * @param feedUrl Flat container base URL, so an environment that mirrors or
 * blocks nuget.org can point at the feed it actually has
 */
export function getDabCliPackageUrl(
    version: string,
    feedUrl: string = Dab.DAB_CLI_DEFAULT_PACKAGE_FEED_URL,
): string {
    const packageId = Dab.DAB_CLI_PACKAGE_ID.toLowerCase();
    const packageVersion = version.toLowerCase();
    const base = feedUrl.replace(/\/+$/, "");
    return `${base}/${packageId}/${packageVersion}/${packageId}.${packageVersion}.nupkg`;
}

/**
 * Reads the configured package feed, falling back to nuget.org when the
 * setting is unset or blank.
 */
export function getConfiguredDabCliFeedUrl(): string {
    const configured = vscode.workspace
        .getConfiguration()
        .get<string>(configDabCliPackageFeedUrl)
        ?.trim();
    return configured || Dab.DAB_CLI_DEFAULT_PACKAGE_FEED_URL;
}

/** Directory a given CLI version is unpacked into. */
export function getDabCliInstallPath(rootPath: string, version: string): string {
    return path.join(rootPath, "dab-cli", version);
}

/**
 * Finds the CLI assembly inside an unpacked package. The target framework
 * folder changes between DAB releases, so it is discovered rather than assumed.
 */
async function findCliAssembly(installPath: string): Promise<string | undefined> {
    const toolsPath = path.join(installPath, "tools");
    let frameworkDirs: string[];
    try {
        frameworkDirs = await fsPromises.readdir(toolsPath);
    } catch {
        return undefined;
    }

    for (const frameworkDir of frameworkDirs) {
        // Tool packages lay out as tools/<tfm>/<rid>/, with "any" as the rid for
        // framework-dependent tools.
        const frameworkPath = path.join(toolsPath, frameworkDir);
        let ridDirs: string[];
        try {
            ridDirs = await fsPromises.readdir(frameworkPath);
        } catch {
            continue;
        }

        for (const ridDir of ridDirs) {
            const candidate = path.join(frameworkPath, ridDir, DAB_CLI_ASSEMBLY_NAME);
            try {
                await fsPromises.access(candidate);
                return candidate;
            } catch {
                // Keep looking; another framework folder may hold the assembly.
            }
        }
    }

    return undefined;
}

/** Resolves an already-unpacked installation, or undefined when there is none. */
async function resolveExistingInstallation(
    installPath: string,
    version: string,
): Promise<DabCliInstallation | undefined> {
    try {
        // Only trust a directory that finished unpacking: an interrupted
        // download leaves a partial tree that would fail in confusing ways.
        await fsPromises.access(path.join(installPath, INSTALL_COMPLETE_MARKER));
    } catch {
        return undefined;
    }

    const assemblyPath = await findCliAssembly(installPath);
    if (!assemblyPath) {
        return undefined;
    }

    return {
        installPath,
        assemblyPath,
        runtimeConfigPath: path.join(path.dirname(assemblyPath), DAB_CLI_RUNTIME_CONFIG_NAME),
        version,
    };
}

/**
 * Downloads and unpacks the pinned DAB CLI, or returns the existing
 * installation when that version is already unpacked.
 *
 * @param rootPath Extension global storage path to install under
 * @param logger Logger for download and extraction diagnostics
 * @param version CLI version to acquire
 */
export async function acquireDabCli(
    rootPath: string,
    logger: ILogger,
    version: string = Dab.DAB_CLI_VERSION,
): Promise<DabCliInstallation> {
    const installPath = getDabCliInstallPath(rootPath, version);

    const existing = await resolveExistingInstallation(installPath, version);
    if (existing) {
        logger.debug(`Using cached DAB CLI ${version} at ${installPath}`);
        return existing;
    }

    // Start clean so a previous partial unpack cannot be mistaken for content.
    await fsPromises.rm(installPath, { recursive: true, force: true });
    await fsPromises.mkdir(installPath, { recursive: true });

    const packageUrl = getDabCliPackageUrl(version, getConfiguredDabCliFeedUrl());
    const packagePath = path.join(installPath, `${Dab.DAB_CLI_PACKAGE_ID}.${version}.nupkg`);

    logger.info(`Downloading DAB CLI ${version} from ${packageUrl}`);
    try {
        // The VS Code client so the download honors the user's proxy settings.
        const httpClient = new VscodeHttpClient({ logger });
        const result = await httpClient.downloadToPath(packageUrl, packagePath);
        if (!result.ok) {
            throw new Error(`${result.status} ${result.statusText}`);
        }
    } catch (error) {
        throw new Error(`Failed to download the Data API builder CLI: ${getErrorMessage(error)}`);
    }

    try {
        // A .nupkg is a zip; only the tool payload is needed.
        await extractZipArchive(packagePath, installPath, (entryName) =>
            entryName.startsWith("tools/"),
        );
    } catch (error) {
        throw new Error(`Failed to unpack the Data API builder CLI: ${getErrorMessage(error)}`);
    } finally {
        await fsPromises.unlink(packagePath).catch(() => {});
    }

    const assemblyPath = await findCliAssembly(installPath);
    if (!assemblyPath) {
        throw new Error(
            `The Data API builder CLI package did not contain ${DAB_CLI_ASSEMBLY_NAME}.`,
        );
    }

    await fsPromises.writeFile(path.join(installPath, INSTALL_COMPLETE_MARKER), version, "utf8");
    logger.info(`DAB CLI ${version} ready at ${assemblyPath}`);

    return {
        installPath,
        assemblyPath,
        runtimeConfigPath: path.join(path.dirname(assemblyPath), DAB_CLI_RUNTIME_CONFIG_NAME),
        version,
    };
}
