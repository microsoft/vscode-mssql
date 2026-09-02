/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LanguageServiceRuntime } from "../runtime/index.js";
import type { SemanticDiagnostic } from "../semantics/index.js";
import type { SyntaxDiagnostic } from "../syntax/index.js";
import type { TextRange } from "../text/index.js";
import type {
    CompletionItem,
    CompletionResult,
    DefinitionTarget,
    DocumentSymbol,
    FoldingRange,
    HoverResult,
    LanguageFeatureService,
    Location,
    SignatureHelp,
    TextEdit,
} from "./contracts.js";
import { SourceCoordinateMap } from "./sourceCoordinateMap.js";

/**
 * Converts one feature service between source and projected coordinates.
 *
 * Analysis runs on projected SQL, so every offset the parser and binder produced is a projected
 * one. A host holds the file the user is editing. Doing that conversion in each feature is how a
 * completion edit ends up written at the wrong place in a `:setvar` document, so it is done once
 * here instead: offsets go in through the projection, ranges come back out through the source map.
 *
 * A document that uses no SQLCMD syntax projects itself unchanged. The wrapper detects that by
 * reference and returns the inner result untouched, so an ordinary `.sql` file pays nothing.
 */
export class SourceMappedFeatureService implements LanguageFeatureService {
    public constructor(
        private readonly _inner: LanguageFeatureService,
        private readonly _runtime: LanguageServiceRuntime,
    ) {}

    public completion(uri: string, version: number, offset: number): CompletionResult {
        const map = this.mapper(uri, version);
        const projected = map.toProjected(offset);
        if (projected === undefined) return { items: Object.freeze([]), incomplete: false };
        const result = this._inner.completion(uri, version, projected);
        if (map.identity) return result;
        return {
            items: result.items.map((item) => mapCompletionItem(item, map)),
            incomplete: result.incomplete,
        };
    }

    public resolveCompletion(item: CompletionItem): Promise<CompletionItem> {
        // Resolution adds documentation to an item whose edit was already mapped on the way out.
        return this._inner.resolveCompletion(item);
    }

    public hover(uri: string, version: number, offset: number): HoverResult | undefined {
        const map = this.mapper(uri, version);
        const projected = map.toProjected(offset);
        if (projected === undefined) return undefined;
        const result = this._inner.hover(uri, version, projected);
        if (map.identity || !result?.range) return result;
        const range = map.toSource(result.range);
        return range ? { ...result, range } : { markdown: result.markdown };
    }

    public definition(uri: string, version: number, offset: number): readonly Location[] {
        const map = this.mapper(uri, version);
        const projected = map.toProjected(offset);
        if (projected === undefined) return Object.freeze([]);
        const result = this._inner.definition(uri, version, projected);
        return map.identity ? result : mapLocations(result, uri, map);
    }

    public definitionTarget(uri: string, version: number, offset: number): DefinitionTarget {
        const map = this.mapper(uri, version);
        const projected = map.toProjected(offset);
        if (projected === undefined) return { locations: Object.freeze([]) };
        const result = this._inner.definitionTarget(uri, version, projected);
        if (map.identity) return result;
        const origin = result.originRange && map.toSource(result.originRange);
        return {
            ...result,
            locations: mapLocations(result.locations, uri, map),
            ...(origin ? { originRange: origin } : {}),
        };
    }

    public references(uri: string, version: number, offset: number): readonly Location[] {
        const map = this.mapper(uri, version);
        const projected = map.toProjected(offset);
        if (projected === undefined) return Object.freeze([]);
        const result = this._inner.references(uri, version, projected);
        return map.identity ? result : mapLocations(result, uri, map);
    }

    public prepareRename(uri: string, version: number, offset: number): TextRange | undefined {
        const map = this.mapper(uri, version);
        const projected = map.toProjected(offset);
        if (projected === undefined) return undefined;
        const result = this._inner.prepareRename(uri, version, projected);
        if (map.identity || !result) return result;
        return map.toSource(result);
    }

    public rename(
        uri: string,
        version: number,
        offset: number,
        newName: string,
    ): readonly TextEdit[] {
        const map = this.mapper(uri, version);
        const projected = map.toProjected(offset);
        if (projected === undefined) return Object.freeze([]);
        const result = this._inner.rename(uri, version, projected, newName);
        if (map.identity) return result;
        // An edit whose text came from a substitution cannot be rewritten in the source: changing
        // `$(name)` would change every other use of the variable, which is not what rename means.
        return Object.freeze(
            result
                .map((edit) => {
                    const range = map.toSource(edit, true);
                    return range ? { ...range, newText: edit.newText } : undefined;
                })
                .filter((edit): edit is TextEdit => edit !== undefined),
        );
    }

    public diagnostics(
        uri: string,
        version: number,
    ): {
        readonly syntax: readonly SyntaxDiagnostic[];
        readonly semantic: readonly SemanticDiagnostic[];
    } {
        const map = this.mapper(uri, version);
        const result = this._inner.diagnostics(uri, version);
        if (map.identity) return result;
        return {
            syntax: Object.freeze(
                result.syntax
                    .map((diagnostic) => mapDiagnostic(diagnostic, map))
                    .filter(
                        (diagnostic): diagnostic is SyntaxDiagnostic => diagnostic !== undefined,
                    ),
            ),
            semantic: Object.freeze(
                result.semantic
                    .map((diagnostic) => mapDiagnostic(diagnostic, map))
                    .filter(
                        (diagnostic): diagnostic is SemanticDiagnostic => diagnostic !== undefined,
                    ),
            ),
        };
    }

    public documentSymbols(uri: string, version: number): readonly DocumentSymbol[] {
        const map = this.mapper(uri, version);
        const result = this._inner.documentSymbols(uri, version);
        return map.identity ? result : Object.freeze(mapSymbols(result, map));
    }

    public foldingRanges(
        uri: string,
        version: number,
        options?: Parameters<LanguageFeatureService["foldingRanges"]>[2],
    ): readonly FoldingRange[] {
        const map = this.mapper(uri, version);
        const result = this._inner.foldingRanges(uri, version, options);
        if (map.identity) return result;
        return Object.freeze(
            result
                .map((range) => {
                    const source = map.toSource(range);
                    return source ? { ...range, ...source } : undefined;
                })
                .filter((range): range is FoldingRange => range !== undefined),
        );
    }

    public selectionRanges(
        uri: string,
        version: number,
        offsets: readonly number[],
    ): readonly TextRange[] {
        const map = this.mapper(uri, version);
        const projectedOffsets = offsets
            .map((offset) => map.toProjected(offset))
            .filter((offset): offset is number => offset !== undefined);
        if (projectedOffsets.length === 0) return Object.freeze([]);
        const result = this._inner.selectionRanges(uri, version, projectedOffsets);
        if (map.identity) return result;
        return Object.freeze(
            result
                .map((range) => map.toSource(range))
                .filter((range): range is TextRange => range !== undefined),
        );
    }

    public signatureHelp(uri: string, version: number, offset: number): SignatureHelp | undefined {
        // Signature help carries labels and an active index, not document ranges.
        const projected = this.mapper(uri, version).toProjected(offset);
        return projected === undefined
            ? undefined
            : this._inner.signatureHelp(uri, version, projected);
    }

    private mapper(uri: string, version: number): SourceCoordinateMap {
        return new SourceCoordinateMap(this._runtime.snapshot(uri, version), uri);
    }
}

function mapCompletionItem(item: CompletionItem, map: SourceCoordinateMap): CompletionItem {
    if (!item.edit) return item;
    const range = map.toSource(item.edit, true);
    if (!range) {
        const { edit: _edit, ...rest } = item;
        return rest;
    }
    return { ...item, edit: { ...range, newText: item.edit.newText } };
}

function mapLocations(
    locations: readonly Location[],
    uri: string,
    map: SourceCoordinateMap,
): readonly Location[] {
    return Object.freeze(
        locations
            .map((location) => {
                if (location.uri !== uri) return location;
                const range = map.toSource(location.range);
                return range ? { ...location, range } : undefined;
            })
            .filter((location): location is Location => location !== undefined),
    );
}

function mapDiagnostic<T extends { readonly range: TextRange }>(
    diagnostic: T,
    map: SourceCoordinateMap,
): T | undefined {
    const range = map.toSource(diagnostic.range);
    return range ? { ...diagnostic, range } : undefined;
}

function mapSymbols(
    symbols: readonly DocumentSymbol[],
    map: SourceCoordinateMap,
): DocumentSymbol[] {
    const result: DocumentSymbol[] = [];
    for (const symbol of symbols) {
        const range = map.toSource(symbol.range);
        const selectionRange = map.toSource(symbol.selectionRange);
        if (!range || !selectionRange) continue;
        result.push({
            ...symbol,
            range,
            selectionRange,
            ...(symbol.children ? { children: mapSymbols(symbol.children, map) } : {}),
        });
    }
    return result;
}
