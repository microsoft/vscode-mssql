/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SemanticSnapshot, SemanticSymbol, SymbolId } from "../semantics/index.js";
import type { TextRange } from "../text/index.js";
import {
    classification,
    normalizeModifiers,
    rangeKey,
    type Classification,
} from "./classificationModel.js";
import type { SqlColorTokenModifier, SqlColorTokenType } from "./contracts.js";
import type { SyntacticClassification } from "./syntacticClassification.js";

/** Bound-symbol kinds mapped onto the published legend. Unlisted kinds keep their syntactic role. */
const symbolTokenTypes: ReadonlyMap<string, SqlColorTokenType> = new Map([
    ["column", "column"],
    ["variable", "variable"],
    ["cte", "commonTableExpression"],
    ["tempTable", "temporaryTable"],
    ["localTable", "table"],
    ["alias", "alias"],
    ["rowset", "alias"],
    ["table", "table"],
    ["view", "view"],
    ["procedure", "procedure"],
    ["scalarFunction", "function"],
    ["tableFunction", "function"],
    ["synonym", "table"],
    ["type", "type"],
]);

/**
 * Projects bound declarations and references onto the identifier token that carries each name.
 * Nothing here consults metadata: it reads only the semantic snapshot the runtime already published,
 * so an unresolved or still-loading name simply keeps the classification the syntax tree produced.
 */
export function collectSemanticClassification(
    semantics: SemanticSnapshot,
    syntactic: SyntacticClassification,
    range: TextRange,
): ReadonlyMap<string, Classification> {
    const result = new Map<string, Classification>();
    const symbols = new Map<SymbolId, SemanticSymbol>();
    for (const unit of semantics.units) {
        for (const symbol of unit.symbols) symbols.set(symbol.id, symbol);
    }

    const apply = (
        range: TextRange,
        symbol: SemanticSymbol,
        extra: readonly SqlColorTokenModifier[],
    ): void => {
        const type = symbolTokenTypes.get(symbol.kind);
        if (!type) return;
        const target = resolveTarget(range, syntactic);
        if (!target) return;
        const key = rangeKey(target);
        const existing = result.get(key);
        const modifiers = [...(existing?.modifiers ?? symbolModifiers(symbol)), ...extra];
        result.set(
            key,
            existing
                ? { type: existing.type, modifiers: normalizeModifiers(modifiers) }
                : classification(type, modifiers),
        );
    };

    // Only names that reach into the requested range can place a token inside it, so a viewport
    // request stays proportional to the viewport rather than to the whole bound document.
    for (const unit of semantics.units) {
        if (!intersects(unit.range, range)) continue;
        for (const symbol of unit.symbols) {
            if (!symbol.declaration || !intersects(symbol.declaration, range)) continue;
            apply(symbol.declaration, symbol, ["declaration"]);
        }
        for (const reference of unit.references) {
            if (!reference.symbol || !intersects(reference, range)) continue;
            const symbol = symbols.get(reference.symbol);
            if (symbol) apply(reference, symbol, reference.write ? ["write"] : []);
        }
    }
    // A construct written as a keyword but resolved as a call — CAST, CONVERT, TOP — keeps its
    // keyword colour and gains the library modifier, so coloring and signature help describe the
    // same construct instead of disagreeing about whether it is a keyword or a routine.
    for (const call of semantics.model.calls) {
        if (!call.keywordRange || !intersects(call.keywordRange, range)) continue;
        if (call.target.kind !== "builtin" && call.target.kind !== "operator") continue;
        const key = rangeKey(call.keywordRange);
        const existing = result.get(key);
        result.set(
            key,
            classification(existing?.type ?? "keyword", [
                ...(existing?.modifiers ?? []),
                "defaultLibrary",
            ]),
        );
    }
    // A construct the connected engine cannot run is marked, so the editor can show it as
    // unusable rather than leaving the author to discover it from a squiggle alone. The decision
    // is the published one — coloring does not reapply an engine rule of its own.
    for (const decision of semantics.model.availability) {
        if (decision.status !== "unavailable") continue;
        if (!intersects(decision.range, range)) continue;
        const target = resolveTarget(decision.range, syntactic) ?? decision.range;
        const key = rangeKey(target);
        const existing = result.get(key) ?? syntactic.roles.get(key);
        if (!existing) continue;
        result.set(key, classification(existing.type, [...existing.modifiers, "deprecated"]));
    }
    return result;
}

function intersects(candidate: TextRange, range: TextRange): boolean {
    return candidate.end >= range.start && candidate.start <= range.end;
}

function symbolModifiers(symbol: SemanticSymbol): readonly SqlColorTokenModifier[] {
    return symbol.kind === "tempTable" ? ["temporary"] : [];
}

/**
 * A bound range covers a whole name, so the classification lands on the part that names the symbol
 * and the qualifiers keep their syntactic roles. Resolution never depends on the requested
 * colorization range, which keeps full and range results identical.
 */
function resolveTarget(
    range: TextRange,
    syntactic: SyntacticClassification,
): TextRange | undefined {
    const key = rangeKey(range);
    const last = syntactic.lastParts.get(key);
    if (last) return last;
    if (syntactic.roles.has(key)) return range;
    return lastPartWithin(syntactic.parts, range);
}

function lastPartWithin(parts: readonly TextRange[], range: TextRange): TextRange | undefined {
    let low = 0;
    let high = parts.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (parts[middle]!.start <= range.end) low = middle + 1;
        else high = middle;
    }
    for (let index = low - 1; index >= 0 && parts[index]!.start >= range.start; index--) {
        if (parts[index]!.end <= range.end) return parts[index];
    }
    return undefined;
}
