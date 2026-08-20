/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TextRange } from "../text/index.js";
import type {
    SqlCmdConnectionRegion,
    SqlCmdDiagnostic,
    SqlCmdDirective,
    SqlCmdDocumentSnapshot,
    SqlCmdIncludeDependency,
    SqlCmdMapping,
    SqlCmdSourceLocation,
    SqlCmdSourceRange,
    SqlCmdStatistics,
    SqlCmdVariableDefinition,
    SqlCmdVariableReference,
} from "./contracts.js";
import type { FoldCheckpoint, FoldState } from "./foldState.js";
import type { ScannedLine } from "./sqlCmdScanner.js";

export class ImmutableSqlCmdSnapshot implements SqlCmdDocumentSnapshot {
    public readonly usesSqlCmd: boolean;
    public readonly projectedSql: string;
    public readonly parts: readonly string[];
    public readonly directives: readonly SqlCmdDirective[];
    public readonly variableDefinitions: readonly SqlCmdVariableDefinition[];
    public readonly variableReferences: readonly SqlCmdVariableReference[];
    public readonly variables: ReadonlyMap<string, string>;
    public readonly connectionRegions: readonly SqlCmdConnectionRegion[];
    public readonly includes: readonly SqlCmdIncludeDependency[];
    public readonly diagnostics: readonly SqlCmdDiagnostic[];
    public readonly mappings: readonly SqlCmdMapping[];
    public readonly statistics: SqlCmdStatistics;
    private _projectedStarts: readonly number[] | undefined;
    private _byDocument: Map<string, readonly SqlCmdMapping[]> | undefined;

    public constructor(
        public readonly uri: string,
        public readonly version: number,
        public readonly text: string,
        state: FoldState,
        public readonly lines: readonly ScannedLine[],
        public readonly checkpoints: readonly FoldCheckpoint[],
        mode: "full" | "incremental",
        rescannedLines: number,
    ) {
        this.parts = Object.freeze([...state.parts]);
        this.projectedSql = state.parts.join("");
        this.directives = Object.freeze(state.directives);
        this.variableDefinitions = Object.freeze(state.definitions);
        this.variableReferences = Object.freeze(state.references);
        this.variables = immutableReadonlyMap(state.variables);
        this.connectionRegions = Object.freeze(state.regions);
        this.includes = Object.freeze(state.includes);
        this.diagnostics = Object.freeze(state.diagnostics);
        this.mappings = Object.freeze(state.mappings);
        this.usesSqlCmd = state.directives.length > 0 || state.references.length > 0;
        this.statistics = Object.freeze({
            directiveCount: state.directives.length,
            variableReferenceCount: state.references.length,
            unresolvedVariableCount: state.references.filter((reference) => !reference.resolved)
                .length,
            includeCount: state.includes.length,
            connectionRegionCount: state.regions.length,
            projectedCharacters: this.projectedSql.length,
            rescannedLines,
            mode,
        });
    }

    public toSource(projectedOffset: number): SqlCmdSourceLocation | undefined {
        const mapping = this.mappingAt(projectedOffset);
        if (!mapping) return undefined;
        if (mapping.substituted) {
            return {
                documentUri: mapping.documentUri,
                offset: mapping.sourceStart,
                approximate: true,
            };
        }
        return {
            documentUri: mapping.documentUri,
            offset: mapping.sourceStart + (projectedOffset - mapping.projectedStart),
            approximate: false,
        };
    }

    public toSourceRanges(range: TextRange): readonly SqlCmdSourceRange[] {
        if (range.start === range.end) {
            const mapping = this.mappingAt(range.start);
            if (!mapping) return Object.freeze([]);
            const offset = mapping.substituted
                ? mapping.sourceStart
                : Math.min(
                      mapping.sourceEnd,
                      mapping.sourceStart + Math.max(0, range.start - mapping.projectedStart),
                  );
            return Object.freeze([
                {
                    documentUri: mapping.documentUri,
                    start: offset,
                    end: offset,
                    approximate: mapping.substituted,
                },
            ]);
        }
        const result: SqlCmdSourceRange[] = [];
        for (const mapping of this.mappings) {
            const overlaps =
                mapping.projectedStart < range.end && mapping.projectedEnd > range.start;
            if (!overlaps) continue;
            const width = mapping.sourceEnd - mapping.sourceStart;
            const start = mapping.substituted
                ? mapping.sourceStart
                : mapping.sourceStart + Math.max(0, range.start - mapping.projectedStart);
            const end = mapping.substituted
                ? mapping.sourceEnd
                : mapping.sourceStart +
                  Math.min(width, Math.max(0, range.end - mapping.projectedStart));
            const previous = result.at(-1);
            if (
                previous &&
                previous.documentUri === mapping.documentUri &&
                previous.end === start
            ) {
                result[result.length - 1] = {
                    documentUri: previous.documentUri,
                    start: previous.start,
                    end,
                    approximate: previous.approximate || mapping.substituted,
                };
                continue;
            }
            result.push({
                documentUri: mapping.documentUri,
                start,
                end,
                approximate: mapping.substituted,
            });
        }
        return Object.freeze(result);
    }

    public toProjected(documentUri: string, offset: number): number | undefined {
        // Directive source is intentionally absent from executable SQL. Its preservation mapping
        // only represents the projected newline and is not a valid caret destination: routing a
        // request there would answer about the first unrelated SQL token after the directive.
        if (
            this.directives.some(
                (directive) =>
                    directive.documentUri === documentUri &&
                    directive.range.start <= offset &&
                    offset < directive.range.end,
            )
        ) {
            return undefined;
        }
        this._byDocument ??= groupByDocument(this.mappings);
        const mappings = this._byDocument.get(documentUri) ?? [];
        for (const mapping of mappings) {
            if (offset < mapping.sourceStart || offset >= mapping.sourceEnd) continue;
            if (mapping.substituted) return mapping.projectedStart;
            return mapping.projectedStart + (offset - mapping.sourceStart);
        }
        const last = mappings.at(-1);
        if (last && offset === last.sourceEnd) return last.projectedEnd;
        return undefined;
    }

    public connectionRegionAt(projectedOffset: number): SqlCmdConnectionRegion | undefined {
        const region = this.connectionRegions.find(
            (candidate) =>
                candidate.range.start <= projectedOffset && projectedOffset < candidate.range.end,
        );
        if (region) return region;
        const last = this.connectionRegions.at(-1);
        return last && projectedOffset === last.range.end ? last : undefined;
    }

    private mappingAt(projectedOffset: number): SqlCmdMapping | undefined {
        if (this.mappings.length === 0) return undefined;
        this._projectedStarts ??= this.mappings.map((mapping) => mapping.projectedStart);
        const starts = this._projectedStarts;
        let low = 0;
        let high = starts.length - 1;
        let found = -1;
        while (low <= high) {
            const middle = (low + high) >> 1;
            if (starts[middle]! <= projectedOffset) {
                found = middle;
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }
        if (found < 0) return this.mappings[0];
        // Zero-width substitutions share a start with the mapping that follows them; prefer the
        // one that actually contains the offset so a position never resolves into dropped text.
        for (let index = found; index >= 0; index--) {
            const mapping = this.mappings[index]!;
            if (
                mapping.projectedStart <= projectedOffset &&
                projectedOffset < mapping.projectedEnd
            ) {
                return mapping;
            }
            if (mapping.projectedEnd < projectedOffset) break;
        }
        return this.mappings[found];
    }
}

/** A runtime-immutable ReadonlyMap facade; Object.freeze(new Map()) still permits Map#set. */
function immutableReadonlyMap<K, V>(source: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
    const values = new Map(source);
    return Object.freeze({
        get size() {
            return values.size;
        },
        get: (key: K) => values.get(key),
        has: (key: K) => values.has(key),
        entries: () => values.entries(),
        keys: () => values.keys(),
        values: () => values.values(),
        forEach: (
            callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
            thisArg?: unknown,
        ) => {
            const view = immutableReadonlyMap(values);
            values.forEach((value, key) => callback.call(thisArg, value, key, view));
        },
        [Symbol.iterator]: () => values[Symbol.iterator](),
        [Symbol.toStringTag]: "Map",
    });
}

function groupByDocument(
    mappings: readonly SqlCmdMapping[],
): Map<string, readonly SqlCmdMapping[]> {
    const result = new Map<string, SqlCmdMapping[]>();
    for (const mapping of mappings) {
        const bucket = result.get(mapping.documentUri);
        if (bucket) bucket.push(mapping);
        else result.set(mapping.documentUri, [mapping]);
    }
    return result;
}
