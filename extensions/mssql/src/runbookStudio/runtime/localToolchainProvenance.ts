/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Secret-safe, deterministic toolchain identity for local run evidence. */

import * as fs from "fs";
import * as path from "path";

const MAX_DEPENDENCY_MANIFEST_BYTES = 2 * 1024 * 1024;
const SAFE_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

export type LocalToolchainComponentId =
    | "vscode"
    | "mssqlExtension"
    | "sqlDatabaseProjectsExtension"
    | "sqlToolsService"
    | "dacFx"
    | "dockerEngine";

export interface LocalToolchainComponent {
    id: LocalToolchainComponentId;
    version: string | null;
    status: "resolved" | "unavailable" | "unverified";
    versionSource:
        | "host"
        | "extensionManifest"
        | "runtimeRequest"
        | "packagedConfiguration"
        | "serviceDependencyManifest"
        | "none";
    configuredVersion?: string;
    hostComponent?: LocalToolchainComponentId;
}

export interface LocalToolchainProvenance {
    complete: boolean;
    components: LocalToolchainComponent[];
}

export interface LocalToolchainProvenanceInput {
    vscodeVersion: unknown;
    mssqlExtensionVersion: unknown;
    sqlDatabaseProjectsExtensionVersion: unknown;
    sqlToolsServiceRuntimeVersion: unknown;
    sqlToolsServiceConfiguredVersion: unknown;
    sqlToolsServiceRoot?: string;
    dockerEngineVersion?: unknown;
}

export function buildLocalToolchainProvenance(
    input: LocalToolchainProvenanceInput,
): LocalToolchainProvenance {
    const vscodeVersion = safeVersion(input.vscodeVersion);
    const mssqlExtensionVersion = safeVersion(input.mssqlExtensionVersion);
    const projectsVersion = safeVersion(input.sqlDatabaseProjectsExtensionVersion);
    const stsRuntimeVersion = safeVersion(input.sqlToolsServiceRuntimeVersion);
    const stsConfiguredVersion = safeVersion(input.sqlToolsServiceConfiguredVersion);
    const dacFxVersion = readDacFxVersionFromServiceRoot(input.sqlToolsServiceRoot);
    const dockerEngineVersion = safeVersion(input.dockerEngineVersion);
    const components: LocalToolchainComponent[] = [
        component("vscode", vscodeVersion, "host"),
        component("mssqlExtension", mssqlExtensionVersion, "extensionManifest"),
        component("sqlDatabaseProjectsExtension", projectsVersion, "extensionManifest"),
        {
            id: "sqlToolsService",
            version: stsRuntimeVersion ?? stsConfiguredVersion,
            status: stsRuntimeVersion
                ? "resolved"
                : stsConfiguredVersion
                  ? "unverified"
                  : "unavailable",
            versionSource: stsRuntimeVersion
                ? "runtimeRequest"
                : stsConfiguredVersion
                  ? "packagedConfiguration"
                  : "none",
            ...(stsConfiguredVersion ? { configuredVersion: stsConfiguredVersion } : {}),
        },
        {
            id: "dacFx",
            version: dacFxVersion,
            status: dacFxVersion ? "resolved" : "unavailable",
            versionSource: dacFxVersion ? "serviceDependencyManifest" : "none",
            hostComponent: "sqlToolsService",
        },
        component("dockerEngine", dockerEngineVersion, "runtimeRequest"),
    ];
    return {
        complete: components.every((entry) => entry.status === "resolved"),
        components,
    };
}

export function readDacFxVersionFromServiceRoot(serviceRoot: string | undefined): string | null {
    if (!serviceRoot) {
        return null;
    }
    const manifestPath = path.join(
        path.resolve(serviceRoot),
        "MicrosoftSqlToolsServiceLayer.deps.json",
    );
    try {
        const stat = fs.statSync(manifestPath);
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_DEPENDENCY_MANIFEST_BYTES) {
            return null;
        }
        const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
            libraries?: Record<string, unknown>;
        };
        const prefix = "Microsoft.SqlServer.DacFx/";
        const versions = Object.keys(parsed.libraries ?? {})
            .filter((key) => key.startsWith(prefix))
            .map((key) => safeVersion(key.slice(prefix.length)))
            .filter((value): value is string => value !== null)
            .sort((left, right) => left.localeCompare(right));
        return versions.at(-1) ?? null;
    } catch {
        return null;
    }
}

function component(
    id: LocalToolchainComponentId,
    version: string | null,
    versionSource: LocalToolchainComponent["versionSource"],
): LocalToolchainComponent {
    return {
        id,
        version,
        status: version ? "resolved" : "unavailable",
        versionSource: version ? versionSource : "none",
    };
}

function safeVersion(value: unknown): string | null {
    return typeof value === "string" && SAFE_VERSION_PATTERN.test(value) ? value : null;
}
