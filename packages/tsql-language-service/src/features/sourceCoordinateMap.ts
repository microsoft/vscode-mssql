/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DocumentAnalysisSnapshot } from "../runtime/index.js";
import type { SqlCmdSourceRange } from "../sqlcmd/index.js";
import type { TextRange } from "../text/index.js";

/** The projection-bearing part of an analysis input needed to translate host coordinates. */
export type SourceCoordinateInput = Partial<
    Pick<DocumentAnalysisSnapshot, "text" | "projection" | "projectedText" | "sourceRangeOf">
>;

/**
 * The sole policy for translating analysis coordinates back to an editable source document.
 *
 * Missing projection fields mean the caller supplied an ordinary syntax/semantic pair, so the
 * map is deliberately the identity. A real analysis snapshot always supplies all fields. Ranges
 * crossing files or a removed source gap are rejected instead of returning a plausible but wrong
 * partial range. Callers producing edits request an exact mapping, which also rejects variable
 * substitutions and other approximate source spans.
 */
export class SourceCoordinateMap {
    public readonly identity: boolean;

    public constructor(
        private readonly _input: SourceCoordinateInput,
        private readonly _uri: string,
    ) {
        this.identity =
            _input.text === undefined ||
            _input.projectedText === undefined ||
            _input.projection === undefined ||
            _input.sourceRangeOf === undefined ||
            _input.projectedText === _input.text;
    }

    /** Maps a host position to analysis coordinates, or nothing for removed/directive text. */
    public toProjected(offset: number): number | undefined {
        return this.identity ? offset : this._input.projection!.toProjected(this._uri, offset);
    }

    /** Maps a host range to analysis coordinates only when both boundaries survive projection. */
    public toProjectedRange(range: TextRange): TextRange | undefined {
        const start = this.toProjected(range.start);
        const end = this.toProjected(range.end);
        return start === undefined || end === undefined ? undefined : { start, end };
    }

    /**
     * Maps one analysis range into this source document.
     *
     * Multiple contiguous pieces are combined. Pieces from an include or separated by removed
     * directive text are not a single source range and therefore have no answer in this document.
     */
    public toSource(range: TextRange, exact = false): TextRange | undefined {
        if (this.identity) return range;
        const candidates = this._input.sourceRangeOf!(range);
        if (candidates.length === 0 || candidates.some((item) => item.documentUri !== this._uri)) {
            return undefined;
        }
        if (exact && (candidates.length !== 1 || candidates[0]!.approximate)) return undefined;
        return combineContiguous(candidates);
    }

    /**
     * Maps sorted analysis ranges, orders them in source coordinates, and coalesces duplicate
     * spans. Substituted text can make several projected tokens refer to the same `$(variable)`.
     */
    public mapOrderedRanges<T extends TextRange>(ranges: readonly T[]): readonly T[] {
        if (this.identity) return ranges;
        const mapped: T[] = [];
        const seen = new Set<string>();
        for (const item of ranges) {
            const range = this.toSource(item);
            if (!range) continue;
            const key = `${range.start}:${range.end}`;
            if (seen.has(key)) continue;
            seen.add(key);
            mapped.push({ ...item, ...range });
        }
        mapped.sort((left, right) => left.start - right.start || left.end - right.end);
        return Object.freeze(mapped);
    }

    /** Keeps a source-coordinate result identity distinct from the projected baseline identity. */
    public sourceResultId(projectedResultId: string): string {
        return this.identity ? projectedResultId : `source:${projectedResultId}`;
    }
}

function combineContiguous(ranges: readonly SqlCmdSourceRange[]): TextRange | undefined {
    const ordered = [...ranges].sort(
        (left, right) => left.start - right.start || left.end - right.end,
    );
    const first = ordered[0];
    if (!first) return undefined;
    let end = first.end;
    for (let index = 1; index < ordered.length; index++) {
        const current = ordered[index]!;
        if (current.start > end) return undefined;
        end = Math.max(end, current.end);
    }
    return { start: first.start, end };
}
