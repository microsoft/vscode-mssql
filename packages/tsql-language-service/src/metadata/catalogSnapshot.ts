/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SqlMetadataCatalog, SqlMetadataLoadResult, SqlMetadataObject } from "./contracts.js";

/** Immutable catalog value object shared safely by concurrent document generations. */
export class MetadataCatalogSnapshot implements SqlMetadataCatalog {
    private readonly byQualifiedName: ReadonlyMap<string, SqlMetadataObject>;

    public readonly database: string;
    public readonly objects: readonly SqlMetadataObject[];

    public constructor(
        public readonly version: string | number,
        result: SqlMetadataLoadResult,
    ) {
        this.database = result.database;
        this.objects = Object.freeze(
            result.objects.map((object) =>
                Object.freeze({
                    ...object,
                    columns: Object.freeze([...object.columns]),
                    parameters: Object.freeze([...object.parameters]),
                    synonymTarget: object.synonymTarget
                        ? Object.freeze([...object.synonymTarget])
                        : undefined,
                }),
            ),
        );
        const byQualifiedName = new Map<string, SqlMetadataObject>();
        for (const object of this.objects) {
            const key = qualifiedKey(object.database, object.schema, object.name);
            const existing = byQualifiedName.get(key);
            if (!existing || (existing.kind === "type" && object.kind !== "type")) {
                byQualifiedName.set(key, object);
            }
        }
        this.byQualifiedName = byQualifiedName;
    }

    public resolve(parts: readonly string[]): SqlMetadataObject | undefined {
        const normalized = parts.map(normalizeIdentifier);
        if (normalized.length === 1) {
            const matches = this.objects.filter(
                (object) => normalizeIdentifier(object.name) === normalized[0],
            );
            const dboMatches = matches.filter(
                (object) => normalizeIdentifier(object.schema) === "dbo",
            );
            return (
                dboMatches.find((object) => object.kind !== "type") ??
                dboMatches[0] ??
                matches.find((object) => object.kind !== "type") ??
                (matches.length === 1 ? matches[0] : undefined)
            );
        }
        if (normalized.length === 2) {
            return this.byQualifiedName.get(
                qualifiedKey(this.database, normalized[0]!, normalized[1]!),
            );
        }
        return this.byQualifiedName.get(
            qualifiedKey(
                normalized.at(-3) ?? this.database,
                normalized.at(-2) ?? "dbo",
                normalized.at(-1) ?? "",
            ),
        );
    }

    public search(prefix: readonly string[], limit = 200): readonly SqlMetadataObject[] {
        const normalizedPrefix = prefix.map(normalizeIdentifier);
        return this.objects
            .filter((object) => matchesPrefix(object, normalizedPrefix))
            .slice(0, Math.max(0, limit));
    }

    public children(prefix: readonly string[]): readonly SqlMetadataObject[] {
        if (prefix.length === 0) {
            return this.objects;
        }
        const normalized = prefix.map(normalizeIdentifier);
        return this.objects.filter((object) => {
            const parts = [object.database, object.schema].map(normalizeIdentifier);
            return normalized.every((part, index) => parts[index] === part);
        });
    }
}

export function normalizeIdentifier(value: string): string {
    const unquoted =
        (value.startsWith("[") && value.endsWith("]")) ||
        (value.startsWith('"') && value.endsWith('"'))
            ? value.slice(1, -1)
            : value;
    return unquoted.replaceAll("]]", "]").replaceAll('""', '"').toLocaleLowerCase("en-US");
}

function qualifiedKey(database: string, schema: string, object: string): string {
    return [database, schema, object].map(normalizeIdentifier).join(".");
}

function matchesPrefix(object: SqlMetadataObject, prefix: readonly string[]): boolean {
    if (prefix.length === 0) {
        return true;
    }
    const name = normalizeIdentifier(object.name);
    const schema = normalizeIdentifier(object.schema);
    const database = normalizeIdentifier(object.database);
    if (prefix.length === 1) {
        return name.startsWith(prefix[0]!) || schema.startsWith(prefix[0]!);
    }
    if (prefix.length === 2) {
        return schema === prefix[0] && name.startsWith(prefix[1]!);
    }
    return (
        database === prefix.at(-3) &&
        schema === prefix.at(-2) &&
        name.startsWith(prefix.at(-1) ?? "")
    );
}
