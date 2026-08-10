/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    SqlCatalogChild,
    SqlCatalogColumn,
    SqlCatalogObject,
    SqlCatalogProvider,
} from "../analysis/contracts.js";
import { normalizeIdentifier } from "./catalogSnapshot.js";

export interface SqlCatalogColumnDescriptor {
    readonly type?: string;
    readonly nullable?: boolean;
}

export type SqlCatalogMappingLeaf = string | SqlCatalogColumnDescriptor;

export interface SqlCatalogMapping {
    [name: string]: SqlCatalogMapping | SqlCatalogMappingLeaf;
}

/**
 * Immutable catalog adapter for the compact nested mapping used by editor metadata caches.
 * Namespace depth is unrestricted, and object lookup is case-insensitive with a `dbo` preference
 * for otherwise unqualified names.
 */
export class MappingCatalogProvider implements SqlCatalogProvider {
    private readonly relations: readonly MappingRelation[];

    public constructor(
        mapping: SqlCatalogMapping,
        public readonly version: string | number = 0,
        public readonly world: "open" | "closed" = "open",
    ) {
        this.relations = Object.freeze(collectRelations(mapping));
    }

    public columnsFor(parts: readonly string[]): readonly SqlCatalogColumn[] | undefined {
        return this.resolve(parts)?.columns;
    }

    public objectFor(parts: readonly string[]): SqlCatalogObject | undefined {
        const relation = this.resolve(parts);
        return relation
            ? {
                  parts: relation.parts,
                  kind: "table",
                  columns: relation.columns,
              }
            : undefined;
    }

    public tableCandidates(parts: readonly string[]): readonly (readonly string[])[] {
        const folded = parts.map(normalizeIdentifier);
        return this.relations
            .filter((relation) => suffixMatches(relation.parts, folded))
            .map((relation) => relation.parts);
    }

    public childrenOf(prefixParts: readonly string[]): readonly SqlCatalogChild[] {
        const foldedPrefix = prefixParts.map(normalizeIdentifier);
        const children = new Map<string, SqlCatalogChild>();
        for (const relation of this.relations) {
            const foldedParts = relation.parts.map(normalizeIdentifier);
            const prefixStart = findPrefixStart(foldedParts, foldedPrefix);
            if (prefixStart < 0) {
                continue;
            }
            const childIndex = prefixStart + foldedPrefix.length;
            const name = relation.parts[childIndex];
            if (!name) {
                continue;
            }
            const child: SqlCatalogChild = {
                name,
                kind: childIndex === relation.parts.length - 1 ? "table" : "namespace",
            };
            children.set(`${child.kind}:${normalizeIdentifier(name)}`, child);
        }
        return [...children.values()];
    }

    public tables(): readonly string[] {
        return this.relations.map((relation) => relation.parts.join("."));
    }

    private resolve(parts: readonly string[]): MappingRelation | undefined {
        const folded = parts.map(normalizeIdentifier);
        const matches = this.relations.filter((relation) => suffixMatches(relation.parts, folded));
        if (matches.length === 0) {
            return undefined;
        }
        if (folded.length === 1) {
            return (
                matches.find(
                    (relation) => normalizeIdentifier(relation.parts.at(-2) ?? "") === "dbo",
                ) ?? (matches.length === 1 ? matches[0] : undefined)
            );
        }
        return matches.length === 1 ? matches[0] : undefined;
    }
}

interface MappingRelation {
    readonly parts: readonly string[];
    readonly columns: readonly SqlCatalogColumn[];
}

function collectRelations(mapping: SqlCatalogMapping): MappingRelation[] {
    const relations: MappingRelation[] = [];
    const visit = (node: SqlCatalogMapping, path: readonly string[]): void => {
        const entries = Object.entries(node);
        if (entries.length === 0 && path.length > 0) {
            relations.push({ parts: Object.freeze([...path]), columns: Object.freeze([]) });
            return;
        }
        const columnEntries = entries.filter(([, value]) => isLeaf(value));
        if (columnEntries.length > 0) {
            relations.push({
                parts: Object.freeze([...path]),
                columns: Object.freeze(
                    columnEntries.map(([name, rawValue]) => {
                        const value = rawValue as SqlCatalogMappingLeaf;
                        return {
                            name,
                            type: typeof value === "string" ? value : value.type,
                            nullable: typeof value === "string" ? undefined : value.nullable,
                        };
                    }),
                ),
            });
            return;
        }
        for (const [name, value] of entries) {
            if (!isLeaf(value)) {
                visit(value, [...path, name]);
            }
        }
    };
    visit(mapping, []);
    return relations;
}

function isLeaf(value: SqlCatalogMapping | SqlCatalogMappingLeaf): value is SqlCatalogMappingLeaf {
    if (typeof value === "string") {
        return true;
    }
    const keys = Object.keys(value);
    return (
        keys.length > 0 &&
        keys.every((key) => key === "type" || key === "nullable") &&
        (value.type === undefined || typeof value.type === "string") &&
        (value.nullable === undefined || typeof value.nullable === "boolean")
    );
}

function suffixMatches(parts: readonly string[], foldedSuffix: readonly string[]): boolean {
    if (foldedSuffix.length > parts.length) {
        return false;
    }
    const offset = parts.length - foldedSuffix.length;
    return foldedSuffix.every(
        (part, index) => normalizeIdentifier(parts[offset + index] ?? "") === part,
    );
}

function findPrefixStart(parts: readonly string[], prefix: readonly string[]): number {
    if (prefix.length === 0) {
        return 0;
    }
    for (let start = 0; start + prefix.length <= parts.length; start++) {
        if (prefix.every((part, index) => parts[start + index] === part)) {
            return start;
        }
    }
    return -1;
}
