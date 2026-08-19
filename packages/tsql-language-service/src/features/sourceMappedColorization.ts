/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    ColorizationInput,
    ColorizationLegend,
    ColorizationResult,
    ColorizationService,
    ColorizedToken,
    FullColorizationResult,
} from "../coloring/index.js";
import type { DocumentAnalysisSnapshot } from "../runtime/index.js";
import type { TextChange, TextRange } from "../text/index.js";

/**
 * A colorization input that also carries the SQLCMD projection.
 *
 * The runtime's document snapshot already satisfies this, so a caller passes the snapshot it
 * already has. The projection is optional because the coloring layer itself must not depend on the
 * runtime, and a caller colouring a bare syntax/semantic pair still gets projected coordinates.
 */
export type ProjectedColorizationInput = ColorizationInput &
    Partial<Pick<DocumentAnalysisSnapshot, "projection" | "projectedText" | "sourceRangeOf">>;

/**
 * Converts colorization results from projected coordinates back to the host's.
 *
 * Colors are the one feature a host applies to every character of the file, so a document whose
 * projection removed a `:setvar` line would otherwise be coloured a whole line out of step. The
 * identity projection is detected by reference and returned untouched.
 */
export class SourceMappedColorizationService implements ColorizationService {
    public constructor(private readonly _inner: ColorizationService) {}

    public get legend(): ColorizationLegend {
        return this._inner.legend;
    }

    public provideDocumentColors(input: ProjectedColorizationInput): FullColorizationResult {
        return mapFull(this._inner.provideDocumentColors(this.project(input)), input);
    }

    public provideRangeColors(
        input: ProjectedColorizationInput & { readonly range: TextRange },
    ): FullColorizationResult {
        // The requested range arrives in host coordinates and has to be asked for in projected
        // ones, or a viewport request would colour the wrong region of a SQLCMD document.
        const projectedRange = projectRange(input, input.range);
        return mapFull(
            this._inner.provideRangeColors({ ...this.project(input), range: projectedRange }),
            input,
        );
    }

    public provideColorEdits(
        previous: FullColorizationResult,
        input: ProjectedColorizationInput,
        changes: readonly TextChange[],
    ): ColorizationResult {
        const result = this._inner.provideColorEdits(previous, this.project(input), changes);
        if (isIdentity(input)) return result;
        if (result.kind === "full") return mapFull(result, input);
        return {
            ...result,
            edits: result.edits.map((edit) =>
                edit.tokens ? { ...edit, tokens: mapTokens(edit.tokens, input) } : edit,
            ),
        };
    }

    /** The input the inner service sees: unchanged, since analysis already ran on projected text. */
    private project(input: ProjectedColorizationInput): ColorizationInput {
        return input;
    }
}

function isIdentity(input: ProjectedColorizationInput): boolean {
    return (
        input.projectedText === undefined ||
        input.sourceRangeOf === undefined ||
        input.projectedText === input.syntax.document
    );
}

function projectRange(input: ProjectedColorizationInput, range: TextRange): TextRange {
    if (isIdentity(input) || !input.projection) return range;
    const uri = input.syntax.document.uri;
    const start = input.projection.toProjected(uri, range.start);
    const end = input.projection.toProjected(uri, range.end);
    return { start: start ?? range.start, end: end ?? range.end };
}

function mapFull(
    result: FullColorizationResult,
    input: ProjectedColorizationInput,
): FullColorizationResult {
    if (isIdentity(input)) return result;
    return { ...result, tokens: mapTokens(result.tokens, input) };
}

/**
 * Maps each token back to the source.
 *
 * A token whose text came from a substitution maps to the whole `$(name)` reference, and several
 * projected tokens can share it. Emitting the reference once keeps the result non-overlapping,
 * which is the contract a host's token encoder relies on.
 */
function mapTokens(
    tokens: readonly ColorizedToken[],
    input: ProjectedColorizationInput,
): readonly ColorizedToken[] {
    const uri = input.syntax.document.uri;
    const mapped: ColorizedToken[] = [];
    for (const token of tokens) {
        const [source] = input.sourceRangeOf!(token);
        if (!source || source.documentUri !== uri) continue;
        const previous = mapped.at(-1);
        if (previous && previous.start === source.start && previous.end === source.end) continue;
        mapped.push({ ...token, start: source.start, end: source.end });
    }
    return Object.freeze(mapped);
}
