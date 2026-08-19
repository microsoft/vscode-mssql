/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DocumentAnalysisSnapshot, LanguageServiceRuntime } from "../runtime/index.js";
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
        const result = this._inner.completion(uri, version, map.toProjected(offset));
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
        const result = this._inner.hover(uri, version, map.toProjected(offset));
        if (map.identity || !result?.range) return result;
        const range = map.toSource(result.range);
        return range ? { ...result, range } : { markdown: result.markdown };
    }

    public definition(uri: string, version: number, offset: number): readonly Location[] {
        const map = this.mapper(uri, version);
        const result = this._inner.definition(uri, version, map.toProjected(offset));
        return map.identity ? result : mapLocations(result, uri, map);
    }

    public definitionTarget(uri: string, version: number, offset: number): DefinitionTarget {
        const map = this.mapper(uri, version);
        const result = this._inner.definitionTarget(uri, version, map.toProjected(offset));
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
        const result = this._inner.references(uri, version, map.toProjected(offset));
        return map.identity ? result : mapLocations(result, uri, map);
    }

    public prepareRename(uri: string, version: number, offset: number): TextRange | undefined {
        const map = this.mapper(uri, version);
        const result = this._inner.prepareRename(uri, version, map.toProjected(offset));
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
        const result = this._inner.rename(uri, version, map.toProjected(offset), newName);
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
        const result = this._inner.selectionRanges(
            uri,
            version,
            offsets.map((offset) => map.toProjected(offset)),
        );
        if (map.identity) return result;
        return Object.freeze(
            result
                .map((range) => map.toSource(range))
                .filter((range): range is TextRange => range !== undefined),
        );
    }

    public signatureHelp(uri: string, version: number, offset: number): SignatureHelp | undefined {
        // Signature help carries labels and an active index, not document ranges.
        return this._inner.signatureHelp(
            uri,
            version,
            this.mapper(uri, version).toProjected(offset),
        );
    }

    private mapper(uri: string, version: number): CoordinateMap {
        return new CoordinateMap(this._runtime.snapshot(uri, version), uri);
    }
}

/** Converts between the coordinates a host uses and the coordinates analysis produced. */
class CoordinateMap {
    /** True when projected and source coordinates are the same, so nothing needs converting. */
    public readonly identity: boolean;

    public constructor(
        private readonly _snapshot: DocumentAnalysisSnapshot,
        private readonly _uri: string,
    ) {
        this.identity = _snapshot.projectedText === _snapshot.text;
    }

    public toProjected(offset: number): number {
        if (this.identity) return offset;
        return this._snapshot.projection.toProjected(this._uri, offset) ?? offset;
    }

    /**
     * The source span a projected range came from.
     *
     * Returns nothing when the range came from an included file, because a host asked about this
     * document and a range in another one is not an answer to that question. `exact` additionally
     * rejects an approximate span — one that landed inside a substitution — for callers that
     * produce edits, where writing to the wrong span is worse than producing no edit.
     */
    public toSource(range: TextRange, exact = false): TextRange | undefined {
        if (this.identity) return range;
        for (const candidate of this._snapshot.sourceRangeOf(range)) {
            if (candidate.documentUri !== this._uri) continue;
            if (exact && candidate.approximate) return undefined;
            return { start: candidate.start, end: candidate.end };
        }
        return undefined;
    }
}

function mapCompletionItem(item: CompletionItem, map: CoordinateMap): CompletionItem {
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
    map: CoordinateMap,
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
    map: CoordinateMap,
): T | undefined {
    const range = map.toSource(diagnostic.range);
    return range ? { ...diagnostic, range } : undefined;
}

function mapSymbols(symbols: readonly DocumentSymbol[], map: CoordinateMap): DocumentSymbol[] {
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
