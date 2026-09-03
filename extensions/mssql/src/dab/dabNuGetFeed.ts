/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Finds the NuGet feed to download the DAB CLI package from.
 *
 * Organizations commonly disable nuget.org in NuGet.Config and substitute a
 * mirror, and often block nuget.org on the network as well. That substitution
 * lives in NuGet's own configuration, so a plain HTTPS request — which is what
 * this extension makes, since it unpacks the package rather than installing a
 * tool — would not inherit it and would fail against a blocked host.
 *
 * So the configured package sources are read the way a NuGet client reads them,
 * and each is resolved to its flat container (`PackageBaseAddress/3.0.0`)
 * through its service index. The first source that answers is used.
 *
 * Feeds requiring authentication are not supported: there is no credential
 * provider here, so such a source is skipped like any other that does not
 * answer. Setting `mssql.dab.cliPackageFeedUrl` bypasses all of this.
 */

import * as fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { DOMParser } from "@xmldom/xmldom";
import { VscodeHttpClient } from "extension-toolkit/vscode";
import { ILogger } from "../sharedInterfaces/logger";
import { Dab } from "../sharedInterfaces/dab";
import { getErrorMessage } from "../utils/utils";

/** Resource type naming a v3 feed's flat container in its service index. */
const PACKAGE_BASE_ADDRESS_TYPE = "PackageBaseAddress/3.0.0";

/** How long to wait for a service index before moving to the next source. */
const SERVICE_INDEX_TIMEOUT_MS = 15_000;

/** A package source read from NuGet configuration. */
export interface NuGetPackageSource {
    key: string;
    value: string;
}

interface NuGetConfigContents {
    /** Sources declared by this file, in document order. */
    sources: NuGetPackageSource[];
    /** Keys this file disables. */
    disabledKeys: string[];
    /** Whether this file clears sources inherited from less specific files. */
    clearsSources: boolean;
    /** Whether this file clears inherited disabled entries. */
    clearsDisabled: boolean;
}

/**
 * Config file paths from least to most specific, matching how NuGet layers
 * machine, user, and directory configuration.
 */
export function getNuGetConfigPaths(workspacePath?: string): string[] {
    const paths: string[] = [];

    if (process.platform === "win32") {
        const programFiles = process.env["ProgramFiles(x86)"] ?? process.env.ProgramFiles;
        if (programFiles) {
            paths.push(path.join(programFiles, "NuGet", "Config", "NuGet.Config"));
        }
        const appData = process.env.APPDATA;
        if (appData) {
            paths.push(path.join(appData, "NuGet", "NuGet.Config"));
        }
    } else {
        paths.push(path.join(os.homedir(), ".nuget", "NuGet", "NuGet.Config"));
        paths.push(path.join(os.homedir(), ".config", "NuGet", "NuGet.Config"));
    }

    // Directory configuration applies from the root down, so the closest file
    // to the workspace is considered last and wins.
    if (workspacePath) {
        const directories: string[] = [];
        let current = path.resolve(workspacePath);
        while (true) {
            directories.unshift(current);
            const parent = path.dirname(current);
            if (parent === current) {
                break;
            }
            current = parent;
        }

        for (const directory of directories) {
            paths.push(path.join(directory, "NuGet.Config"));
            paths.push(path.join(directory, "nuget.config"));
        }
    }

    return paths;
}

/** Reads the package source declarations out of one NuGet.Config document. */
export function parseNuGetConfig(xml: string): NuGetConfigContents {
    const document = new DOMParser().parseFromString(xml, "text/xml");
    const readSection = (sectionName: string) => {
        const section = document.getElementsByTagName(sectionName)[0];
        if (!section) {
            return { entries: [] as NuGetPackageSource[], clears: false };
        }

        const entries: NuGetPackageSource[] = [];
        const adds = section.getElementsByTagName("add");
        for (let index = 0; index < adds.length; index++) {
            const key = adds[index].getAttribute("key");
            const value = adds[index].getAttribute("value");
            if (key) {
                entries.push({ key, value: value ?? "" });
            }
        }

        return { entries, clears: section.getElementsByTagName("clear").length > 0 };
    };

    const sources = readSection("packageSources");
    const disabled = readSection("disabledPackageSources");

    return {
        sources: sources.entries,
        clearsSources: sources.clears,
        // A source is disabled when its entry's value is "true"; NuGet writes
        // exactly that, and any other value leaves the source enabled.
        disabledKeys: disabled.entries
            .filter((entry) => entry.value.toLowerCase() === "true")
            .map((entry) => entry.key),
        clearsDisabled: disabled.clears,
    };
}

/**
 * Merges every readable NuGet.Config into the list of enabled sources, with
 * more specific files overriding and clearing less specific ones.
 */
export async function readEnabledNuGetSources(
    workspacePath?: string,
    logger?: ILogger,
): Promise<NuGetPackageSource[]> {
    const sourcesByKey = new Map<string, string>();
    const disabledKeys = new Set<string>();

    for (const configPath of getNuGetConfigPaths(workspacePath)) {
        let xml: string;
        try {
            xml = await fsPromises.readFile(configPath, "utf8");
        } catch {
            // Most candidate paths will not exist; that is the normal case.
            continue;
        }

        let contents: NuGetConfigContents;
        try {
            contents = parseNuGetConfig(xml);
        } catch (error) {
            logger?.warn(
                `Ignoring unreadable NuGet config ${configPath}: ${getErrorMessage(error)}`,
            );
            continue;
        }

        if (contents.clearsSources) {
            sourcesByKey.clear();
        }
        for (const source of contents.sources) {
            sourcesByKey.set(source.key, source.value);
        }

        if (contents.clearsDisabled) {
            disabledKeys.clear();
        }
        for (const key of contents.disabledKeys) {
            disabledKeys.add(key);
        }
    }

    return [...sourcesByKey.entries()]
        .filter(([key]) => !disabledKeys.has(key))
        .map(([key, value]) => ({ key, value }));
}

/**
 * Resolves a v3 service index to its flat container URL.
 *
 * @param serviceIndexUrl The source's service index
 * @param httpClient Client used to fetch the index
 */
export async function resolveFlatContainerUrl(
    serviceIndexUrl: string,
    httpClient: VscodeHttpClient,
): Promise<string | undefined> {
    const response = await httpClient.get<{
        resources?: { "@id"?: string; "@type"?: string }[];
    }>(serviceIndexUrl, { timeoutMs: SERVICE_INDEX_TIMEOUT_MS });

    if (!response.ok) {
        return undefined;
    }

    const resource = response.data?.resources?.find(
        (candidate) => candidate["@type"] === PACKAGE_BASE_ADDRESS_TYPE,
    );
    return resource?.["@id"]?.replace(/\/+$/, "");
}

/**
 * Determines the flat container to download the CLI package from.
 *
 * An explicitly configured URL wins. Otherwise the enabled NuGet sources are
 * tried in order, so an environment that redirects nuget.org to a mirror is
 * followed automatically. nuget.org is the last resort.
 *
 * @param configuredFeedUrl Value of the feed setting, when the user set one
 * @param logger Logger for discovery diagnostics
 */
export async function resolveDabCliFeedUrl(
    configuredFeedUrl: string | undefined,
    logger: ILogger,
): Promise<string> {
    if (configuredFeedUrl) {
        return configuredFeedUrl.replace(/\/+$/, "");
    }

    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let sources: NuGetPackageSource[];
    try {
        sources = await readEnabledNuGetSources(workspacePath, logger);
    } catch (error) {
        logger.warn(`Could not read NuGet configuration: ${getErrorMessage(error)}`);
        sources = [];
    }

    const httpClient = new VscodeHttpClient({ logger });
    for (const source of sources) {
        // Only v3 sources expose a service index; a v2 feed or local folder has
        // no flat container to resolve.
        if (!/^https?:/i.test(source.value) || !source.value.endsWith(".json")) {
            continue;
        }

        try {
            const flatContainerUrl = await resolveFlatContainerUrl(source.value, httpClient);
            if (flatContainerUrl) {
                logger.info(`Using NuGet source "${source.key}" for the Data API builder CLI.`);
                return flatContainerUrl;
            }
        } catch (error) {
            logger.warn(
                `NuGet source "${source.key}" could not be used: ${getErrorMessage(error)}`,
            );
        }
    }

    logger.info("Falling back to nuget.org for the Data API builder CLI.");
    return Dab.DAB_CLI_DEFAULT_PACKAGE_FEED_URL;
}
