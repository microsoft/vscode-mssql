/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    GrammarCompletionContext,
    SemanticCatalogProvider,
    SemanticColumn,
    SemanticObject,
    SemanticObjectKind,
    SemanticParserSnapshot,
    SemanticSpan,
    SemanticVisibleSource,
} from "./contracts.js";
import { DocumentSchemaEvolution } from "./documentSchema.js";
import { normalizeSemanticIdentifier, splitMultipartIdentifier } from "./names.js";

export type SemanticCompletionKind =
    | "keyword"
    | "column"
    | "table"
    | "view"
    | "procedure"
    | "function"
    | "namespace"
    | "type"
    | "alias";

export interface SemanticCompletionItem {
    readonly label: string;
    readonly kind: SemanticCompletionKind;
    readonly detail?: string;
    /** Text an editor should filter against when it differs from the label, e.g. `dbo.Orders`. */
    readonly filterText?: string;
}

export interface SemanticCompletionResult {
    readonly items: readonly SemanticCompletionItem[];
    readonly replaceSpan: SemanticSpan;
}

export interface SemanticCompletionRequest {
    readonly parser: SemanticParserSnapshot;
    readonly offset: number;
    readonly document?: DocumentSchemaEvolution;
    readonly catalog?: SemanticCatalogProvider;
}

/** Resolution order is intentional: script-local DDL shadows server metadata. */
export class SemanticObjectResolver {
    public constructor(
        private readonly document?: DocumentSchemaEvolution,
        private readonly catalog?: SemanticCatalogProvider,
    ) {}

    public resolve(parts: readonly string[]): SemanticObject | undefined {
        const local = this.document?.resolve(parts);
        if (local) {
            return local;
        }
        const remote = this.catalog?.objectFor?.(parts);
        if (!remote) {
            return undefined;
        }
        return Object.freeze({
            identity: {
                kind: remote.kind,
                parts: Object.freeze([...remote.parts]),
                key: `${remote.kind}:${remote.parts.map(normalizeSemanticIdentifier).join(".")}`,
            },
            parts: Object.freeze([...remote.parts]),
            name: remote.parts.at(-1) ?? "",
            kind: remote.kind,
            columns: remote.columns,
            parameters: remote.parameters,
            returnType: remote.returnType,
            batch: -1,
        });
    }

    public columnsFor(parts: readonly string[]): readonly SemanticColumn[] | undefined {
        return this.document?.columnsFor(parts) ?? this.catalog?.columnsFor(parts);
    }

    public objectsForCompletion(prefix: readonly string[]): readonly SemanticObject[] {
        const local = this.document?.objects ?? [];
        const matches = local.filter((object) => matchesObjectPrefix(object.parts, prefix));
        const remoteNames = this.catalog?.tableCandidates?.(prefix) ?? [];
        const remote = remoteNames
            .map((parts) => this.resolve(parts))
            .filter((object): object is SemanticObject => !!object);
        return distinctObjects([...matches, ...remote]);
    }

    public childrenOf(prefix: readonly string[]) {
        const localChildren = childObjects(this.document?.objects ?? [], prefix);
        const remoteChildren = this.catalog?.childrenOf?.(prefix) ?? [];
        const seen = new Set<string>();
        return [...localChildren, ...remoteChildren].filter((child) => {
            const key = `${child.kind}:${normalizeSemanticIdentifier(child.name)}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
}

export interface CompletionStrategy {
    readonly contextKinds: readonly GrammarCompletionContext["kind"][];
    complete(
        context: GrammarCompletionContext,
        resolver: SemanticObjectResolver,
    ): readonly SemanticCompletionItem[];
}

/**
 * Composes small strategies over grammar evidence from the active parser snapshot. It never
 * reparses document text and the first matching strategy owns the SQL-specific candidates.
 */
export class GrammarCompletionService {
    private readonly strategies: readonly CompletionStrategy[];

    public constructor(strategies: readonly CompletionStrategy[] = defaultCompletionStrategies) {
        this.strategies = Object.freeze([...strategies]);
    }

    public complete(request: SemanticCompletionRequest): SemanticCompletionResult {
        const context = request.parser.completionContextAt(request.offset);
        if (!context) {
            return {
                items: Object.freeze([]),
                replaceSpan: { start: request.offset, end: request.offset },
            };
        }
        const resolver = new SemanticObjectResolver(request.document, request.catalog);
        const candidates: SemanticCompletionItem[] = [
            ...keywordItems(context),
            ...this.strategies
                .filter((strategy) => strategy.contextKinds.includes(context.kind))
                .flatMap((strategy) => strategy.complete(context, resolver)),
        ];
        return {
            items: Object.freeze(filterAndSort(candidates, completionFilter(context))),
            replaceSpan: context.replaceSpan,
        };
    }
}

export class QualifiedMemberCompletionStrategy implements CompletionStrategy {
    public readonly contextKinds = ["qualifiedMember"] as const;

    public complete(
        context: GrammarCompletionContext,
        resolver: SemanticObjectResolver,
    ): readonly SemanticCompletionItem[] {
        const qualifier = context.qualifier ?? qualifiedPrefix(context.prefix).qualifier;
        if (!qualifier) {
            return [];
        }
        const visible = (context.visibleSources ?? []).find(
            (source) =>
                normalizeSemanticIdentifier(source.alias ?? source.name) ===
                normalizeSemanticIdentifier(qualifier),
        );
        const columns =
            sourceColumns(visible, resolver) ??
            resolver.columnsFor(splitMultipartIdentifier(qualifier));
        return (columns ?? []).map(columnItem);
    }
}

export class ObjectCompletionStrategy implements CompletionStrategy {
    public readonly contextKinds = ["object", "execute", "type"] as const;

    public complete(
        context: GrammarCompletionContext,
        resolver: SemanticObjectResolver,
    ): readonly SemanticCompletionItem[] {
        const prefix = completionNamespacePrefix(context.prefix);
        return resolver
            .objectsForCompletion(prefix)
            .filter((object) => isAllowedKind(context.kind, object.kind))
            .map(objectItem);
    }
}

export class NamespaceCompletionStrategy implements CompletionStrategy {
    public readonly contextKinds = ["namespace"] as const;

    public complete(
        context: GrammarCompletionContext,
        resolver: SemanticObjectResolver,
    ): readonly SemanticCompletionItem[] {
        const prefix = completionNamespacePrefix(context.prefix);
        return resolver.childrenOf(prefix).map((child) => ({
            label: child.name,
            kind: child.kind === "namespace" ? "namespace" : "table",
        }));
    }
}

export class ColumnCompletionStrategy implements CompletionStrategy {
    public readonly contextKinds = ["column", "expression"] as const;

    public complete(
        context: GrammarCompletionContext,
        resolver: SemanticObjectResolver,
    ): readonly SemanticCompletionItem[] {
        return (context.visibleSources ?? []).flatMap((source) => {
            const columns = sourceColumns(source, resolver) ?? [];
            return [
                ...(source.alias ? [{ label: source.alias, kind: "alias" as const }] : []),
                ...columns.map(columnItem),
            ];
        });
    }
}

export const defaultCompletionStrategies: readonly CompletionStrategy[] = Object.freeze([
    new QualifiedMemberCompletionStrategy(),
    new ObjectCompletionStrategy(),
    new NamespaceCompletionStrategy(),
    new ColumnCompletionStrategy(),
]);

function keywordItems(context: GrammarCompletionContext): readonly SemanticCompletionItem[] {
    return (context.expectedKeywords ?? []).map((label) => ({ label, kind: "keyword" }));
}

function sourceColumns(
    source: SemanticVisibleSource | undefined,
    resolver: SemanticObjectResolver,
): readonly SemanticColumn[] | undefined {
    return (
        source?.columns ??
        (source?.objectParts ? resolver.columnsFor(source.objectParts) : undefined)
    );
}

function columnItem(column: SemanticColumn): SemanticCompletionItem {
    return { label: column.name, kind: "column", detail: displayColumnType(column) };
}

function objectItem(object: SemanticObject): SemanticCompletionItem {
    const label = object.parts.join(".");
    return {
        label,
        kind: completionKind(object.kind),
        detail: object.kind,
        // The unqualified name is what the user types, so an editor must filter on it too.
        filterText: object.name && object.name !== label ? object.name : undefined,
    };
}

function completionKind(kind: SemanticObjectKind): SemanticCompletionKind {
    switch (kind) {
        case "view":
            return "view";
        case "procedure":
            return "procedure";
        case "scalarFunction":
        case "tableFunction":
            return "function";
        case "type":
            return "type";
        default:
            return "table";
    }
}

function isAllowedKind(
    context: GrammarCompletionContext["kind"],
    kind: SemanticObjectKind,
): boolean {
    if (context === "execute") return kind === "procedure" || kind.endsWith("Function");
    if (context === "type") return kind === "type";
    return kind !== "procedure" || context === "object";
}

function displayColumnType(column: SemanticColumn): string | undefined {
    if (!column.type) return undefined;
    if (column.nullable === undefined) return column.type;
    return `${column.type}${column.nullable ? " NULL" : " NOT NULL"}`;
}

function completionFilter(context: GrammarCompletionContext): string {
    if (context.kind === "qualifiedMember") {
        return qualifiedPrefix(context.prefix).filter;
    }
    if (context.prefix.trimEnd().endsWith(".")) {
        return "";
    }
    return splitMultipartIdentifier(context.prefix).at(-1) ?? context.prefix;
}

function qualifiedPrefix(value: string): { readonly qualifier?: string; readonly filter: string } {
    const parts = splitMultipartIdentifier(value);
    if (value.trimEnd().endsWith(".")) {
        return parts.length > 0 ? { qualifier: parts.join("."), filter: "" } : { filter: "" };
    }
    return parts.length > 1
        ? { qualifier: parts.slice(0, -1).join("."), filter: parts.at(-1) ?? "" }
        : { filter: value };
}

function completionNamespacePrefix(value: string): readonly string[] {
    const parts = splitMultipartIdentifier(value);
    return value.trimEnd().endsWith(".") ? parts : parts.slice(0, -1);
}

function filterAndSort(
    items: readonly SemanticCompletionItem[],
    filter: string,
): readonly SemanticCompletionItem[] {
    const seen = new Set<string>();
    return items
        .filter((item) => completionLabelMatches(item, filter))
        .filter((item) => {
            const key = `${item.kind}:${normalizeSemanticIdentifier(item.label)}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort(
            (left, right) =>
                left.label.localeCompare(right.label) || left.kind.localeCompare(right.kind),
        );
}

function completionLabelMatches(item: SemanticCompletionItem, filter: string): boolean {
    if (!filter) {
        return true;
    }
    const candidate =
        item.kind === "table" ||
        item.kind === "view" ||
        item.kind === "procedure" ||
        item.kind === "function" ||
        item.kind === "type"
            ? (item.label.split(".").at(-1) ?? item.label)
            : item.label;
    // Subsequence rather than prefix: a strict prefix test drops candidates the editor would rank.
    return isSubsequence(
        normalizeSemanticIdentifier(candidate),
        normalizeSemanticIdentifier(filter),
    );
}

function isSubsequence(candidate: string, needle: string): boolean {
    let index = 0;
    for (const character of candidate) {
        if (character === needle[index] && ++index === needle.length) {
            return true;
        }
    }
    return needle.length === 0;
}

function matchesObjectPrefix(parts: readonly string[], prefix: readonly string[]): boolean {
    if (prefix.length === 0) return true;
    if (prefix.length > parts.length) return false;
    return prefix.every(
        (part, index) =>
            normalizeSemanticIdentifier(part) ===
            normalizeSemanticIdentifier(parts[parts.length - prefix.length + index] ?? ""),
    );
}

function childObjects(objects: readonly SemanticObject[], prefix: readonly string[]) {
    const matches = new Map<string, { name: string; kind: "namespace" | "table" }>();
    for (const object of objects) {
        const prefixStart = findPrefixStart(object.parts, prefix);
        if (prefixStart < 0) continue;
        const index = prefixStart + prefix.length;
        const name = object.parts[index];
        if (!name) continue;
        const kind = index === object.parts.length - 1 ? "table" : "namespace";
        matches.set(`${kind}:${normalizeSemanticIdentifier(name)}`, { name, kind });
    }
    return [...matches.values()];
}

function findPrefixStart(parts: readonly string[], prefix: readonly string[]): number {
    if (prefix.length === 0) return 0;
    for (let start = 0; start + prefix.length < parts.length; start++) {
        if (
            prefix.every(
                (part, index) =>
                    normalizeSemanticIdentifier(part) ===
                    normalizeSemanticIdentifier(parts[start + index] ?? ""),
            )
        ) {
            return start;
        }
    }
    return -1;
}

function distinctObjects(objects: readonly SemanticObject[]): readonly SemanticObject[] {
    return [...new Map(objects.map((object) => [object.identity.key, object])).values()];
}
