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
import { DOMParser } from "@xmldom/xmldom";
import { VscodeHttpClient } from "extension-toolkit/vscode";
import { ILogger } from "../sharedInterfaces/logger";
import { configDabCliPackageFeedUrl } from "../constants/constants";
import { Dab } from "../sharedInterfaces/dab";
import { resolveDabCliFeedUrl } from "./dabNuGetFeed";
import { getErrorMessage } from "../utils/utils";
import { extractZipArchive } from "./dabCliArchive";

/** Assembly name of the CLI inside the package. */
const DAB_CLI_ASSEMBLY_NAME = "Microsoft.DataApiBuilder.dll";
const DAB_CLI_RUNTIME_CONFIG_NAME = "Microsoft.DataApiBuilder.runtimeconfig.json";

/** Tool manifest naming the runtime-specific packages that carry the binaries. */
const DOTNET_TOOL_SETTINGS_NAME = "DotnetToolSettings.xml";

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
 * @param packageIdentifier Package to download; the runtime-specific packages
 * share the CLI's version but not its id
 */
export function getDabCliPackageUrl(
    version: string,
    feedUrl: string = Dab.DAB_CLI_DEFAULT_PACKAGE_FEED_URL,
    packageIdentifier: string = Dab.DAB_CLI_PACKAGE_ID,
): string {
    const packageId = packageIdentifier.toLowerCase();
    const packageVersion = version.toLowerCase();
    const base = feedUrl.replace(/\/+$/, "");
    return `${base}/${packageId}/${packageVersion}/${packageId}.${packageVersion}.nupkg`;
}

/**
 * Reads the feed setting, or undefined when the user has not set one and the
 * feed should be discovered from NuGet configuration instead.
 */
export function getConfiguredDabCliFeedUrl(): string | undefined {
    return (
        vscode.workspace.getConfiguration().get<string>(configDabCliPackageFeedUrl)?.trim() ||
        undefined
    );
}

/** Directory a given CLI version is unpacked into. */
export function getDabCliInstallPath(rootPath: string, version: string): string {
    return path.join(rootPath, "dab-cli", version);
}

/**
 * Runtime identifier for this machine, in the form the tool manifest uses.
 */
export function getCurrentRuntimeIdentifier(): string {
    const os =
        process.platform === "win32" ? "win" : process.platform === "darwin" ? "osx" : "linux";
    const architecture = process.arch === "arm64" ? "arm64" : "x64";
    return `${os}-${architecture}`;
}

/**
 * Walks an unpacked package for a file, whatever target framework or runtime
 * folder it landed in. Those folder names change between releases, so they are
 * discovered rather than assumed.
 */
async function findFile(rootPath: string, fileName: string): Promise<string | undefined> {
    let entries: string[];
    try {
        entries = await fsPromises.readdir(rootPath);
    } catch {
        return undefined;
    }

    for (const entry of entries) {
        const entryPath = path.join(rootPath, entry);
        const stat = await fsPromises.stat(entryPath).catch(() => undefined);
        if (!stat) {
            continue;
        }

        if (stat.isDirectory()) {
            const found = await findFile(entryPath, fileName);
            if (found) {
                return found;
            }
        } else if (entry === fileName) {
            return entryPath;
        }
    }

    return undefined;
}

/**
 * Reads the runtime-specific package the tool manifest names for a runtime
 * identifier.
 *
 * The CLI package is a stub: the binaries live in per-runtime packages listed
 * in its DotnetToolSettings.xml, which is what `dotnet tool install` resolves
 * behind the scenes.
 *
 * @param settingsXml Contents of the tool manifest
 * @param runtimeIdentifier Runtime to look up
 */
export function readRuntimePackageId(
    settingsXml: string,
    runtimeIdentifier: string,
): string | undefined {
    const document = new DOMParser().parseFromString(settingsXml, "text/xml");
    const packages = document.getElementsByTagName("RuntimeIdentifierPackage");

    for (let index = 0; index < packages.length; index++) {
        if (packages[index].getAttribute("RuntimeIdentifier") === runtimeIdentifier) {
            return packages[index].getAttribute("Id") ?? undefined;
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

    const assemblyPath = await findFile(installPath, DAB_CLI_ASSEMBLY_NAME);
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
 * Downloads a package into a directory and unpacks its tool payload.
 *
 * @param packageId Package to download
 * @param version Version to download
 * @param feedUrl Flat container to download from
 * @param destination Directory to unpack into
 * @param logger Logger for download diagnostics
 */
async function downloadAndUnpack(
    packageId: string,
    version: string,
    feedUrl: string,
    destination: string,
    logger: ILogger,
): Promise<void> {
    const packageUrl = getDabCliPackageUrl(version, feedUrl, packageId);
    const packagePath = path.join(destination, `${packageId}.${version}.nupkg`);

    logger.info(`Downloading ${packageId} ${version} from ${packageUrl}`);
    try {
        // The VS Code client so the download honors the user's proxy settings.
        const httpClient = new VscodeHttpClient({ logger });
        const result = await httpClient.downloadToPath(packageUrl, packagePath);
        if (!result.ok) {
            throw new Error(`${result.status} ${result.statusText}`);
        }
    } catch (error) {
        throw new Error(`Failed to download ${packageId}: ${getErrorMessage(error)}`);
    }

    try {
        // A .nupkg is a zip; only the tool payload is needed.
        await extractZipArchive(packagePath, destination, (entryName) =>
            entryName.startsWith("tools/"),
        );
    } catch (error) {
        throw new Error(`Failed to unpack ${packageId}: ${getErrorMessage(error)}`);
    } finally {
        await fsPromises.unlink(packagePath).catch(() => {});
    }
}

/**
 * Downloads and unpacks the pinned DAB CLI, or returns the existing
 * installation when that version is already unpacked.
 *
 * The CLI package is a stub whose tool manifest names a separate package per
 * runtime identifier; the binaries live there. Both are fetched, which is what
 * `dotnet tool install` does internally.
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

    const feedUrl = await resolveDabCliFeedUrl(getConfiguredDabCliFeedUrl(), logger);
    await downloadAndUnpack(Dab.DAB_CLI_PACKAGE_ID, version, feedUrl, installPath, logger);

    const settingsPath = await findFile(installPath, DOTNET_TOOL_SETTINGS_NAME);
    if (!settingsPath) {
        throw new Error(
            `The Data API builder CLI package did not contain ${DOTNET_TOOL_SETTINGS_NAME}.`,
        );
    }

    const runtimeIdentifier = getCurrentRuntimeIdentifier();
    const runtimePackageId = readRuntimePackageId(
        await fsPromises.readFile(settingsPath, "utf8"),
        runtimeIdentifier,
    );
    if (!runtimePackageId) {
        // Data API builder publishes x64 runtimes only, so an arm64 host has
        // nothing to run. Saying which runtime is missing beats a later failure
        // about an assembly that was never going to be there.
        throw new Error(
            `The Data API builder CLI does not publish a build for ${runtimeIdentifier}.`,
        );
    }

    await downloadAndUnpack(runtimePackageId, version, feedUrl, installPath, logger);

    const assemblyPath = await findFile(installPath, DAB_CLI_ASSEMBLY_NAME);
    if (!assemblyPath) {
        throw new Error(`${runtimePackageId} did not contain ${DAB_CLI_ASSEMBLY_NAME}.`);
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
