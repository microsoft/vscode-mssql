/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const PROTECTED_TOP_LEVEL_KEYS = new Set(["$schema", "entities"]);
const PROTECTED_ENTITY_KEYS = new Set<string>();
const PROTECTED_DATA_SOURCE_KEYS = new Set(["database-type", "connection-string"]);
const PROTECTED_RUNTIME_API_KEYS = new Set(["enabled"]);
const PROTECTED_ENTITY_SOURCE_KEYS = new Set(["type", "object"]);

const KNOWN_TOP_LEVEL_ADVANCED_KEYS = new Set([
    "data-source",
    "data-source-files",
    "runtime",
    "azure-key-vault",
    "autoentities",
]);

const KNOWN_ENTITY_ADVANCED_KEYS = new Set([
    "source",
    "fields",
    "permissions",
    "rest",
    "graphql",
    "mcp",
    "cache",
    "health",
    "policy",
    "relationships",
    "mappings",
    "description",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateRuntimeAdvancedJson(value: unknown): string | undefined {
    if (!isRecord(value)) {
        return "Advanced DAB JSON property 'runtime' must be an object.";
    }

    for (const apiName of ["rest", "graphql", "mcp"]) {
        const apiConfig = value[apiName];
        if (!isRecord(apiConfig)) {
            continue;
        }

        for (const key of Object.keys(apiConfig)) {
            if (PROTECTED_RUNTIME_API_KEYS.has(key)) {
                return `Advanced DAB JSON cannot override generated runtime.${apiName}.${key}.`;
            }
        }
    }

    return undefined;
}

function validateDataSourceAdvancedJson(value: unknown): string | undefined {
    if (!isRecord(value)) {
        return "Advanced DAB JSON property 'data-source' must be an object.";
    }

    for (const key of Object.keys(value)) {
        if (PROTECTED_DATA_SOURCE_KEYS.has(key)) {
            return `Advanced DAB JSON cannot override generated data-source.${key}.`;
        }
    }

    return undefined;
}

function validateEntitySourceAdvancedJson(value: unknown): string | undefined {
    if (!isRecord(value)) {
        return "Advanced DAB JSON property 'source' must be an object.";
    }

    for (const key of Object.keys(value)) {
        if (PROTECTED_ENTITY_SOURCE_KEYS.has(key)) {
            return `Advanced DAB JSON cannot override generated entity source.${key}.`;
        }
    }

    return undefined;
}

export function validateDabAdvancedJson(
    scope: "top-level" | "entity",
    value: Record<string, unknown> | undefined,
): string | undefined {
    if (!value) {
        return undefined;
    }

    const protectedKeys = scope === "top-level" ? PROTECTED_TOP_LEVEL_KEYS : PROTECTED_ENTITY_KEYS;
    const knownKeys =
        scope === "top-level" ? KNOWN_TOP_LEVEL_ADVANCED_KEYS : KNOWN_ENTITY_ADVANCED_KEYS;

    for (const [key, entry] of Object.entries(value)) {
        if (protectedKeys.has(key)) {
            return `Advanced DAB JSON cannot override generated ${scope} property '${key}'.`;
        }

        if (!knownKeys.has(key)) {
            return `Advanced DAB JSON property '${key}' is not recognized for ${scope} config.`;
        }

        if (entry === undefined) {
            return `Advanced DAB JSON property '${key}' cannot be undefined.`;
        }

        if (scope === "top-level" && key === "runtime") {
            const runtimeError = validateRuntimeAdvancedJson(entry);
            if (runtimeError) {
                return runtimeError;
            }
        }

        if (scope === "top-level" && key === "data-source") {
            const dataSourceError = validateDataSourceAdvancedJson(entry);
            if (dataSourceError) {
                return dataSourceError;
            }
        }

        if (scope === "entity" && key === "source") {
            const sourceError = validateEntitySourceAdvancedJson(entry);
            if (sourceError) {
                return sourceError;
            }
        }
    }

    return undefined;
}
