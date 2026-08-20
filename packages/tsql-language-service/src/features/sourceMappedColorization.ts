/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    ColorizationInput,
    ColorizationLegend,
    ColorizationResult,
    ColorizationService,
    FullColorizationResult,
} from "../coloring/index.js";
import type { TextChange, TextRange } from "../text/index.js";
import { SourceCoordinateMap, type SourceCoordinateInput } from "./sourceCoordinateMap.js";

/**
 * A colorization input that also carries the SQLCMD projection.
 *
 * The runtime's document snapshot already satisfies this, so a caller passes the snapshot it
 * already has. The projection is optional because the coloring layer itself must not depend on the
 * runtime, and a caller colouring a bare syntax/semantic pair still gets projected coordinates.
 */
export type ProjectedColorizationInput = ColorizationInput & SourceCoordinateInput;

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
        const map = coordinateMap(input);
        return mapFull(this._inner.provideDocumentColors(this.project(input)), map);
    }

    public provideRangeColors(
        input: ProjectedColorizationInput & { readonly range: TextRange },
    ): FullColorizationResult {
        // The requested range arrives in host coordinates and has to be asked for in projected
        // ones, or a viewport request would colour the wrong region of a SQLCMD document.
        const map = coordinateMap(input);
        const projectedRange = map.toProjectedRange(input.range);
        if (!projectedRange) return emptyFull(input, input.range, map);
        return mapFull(
            this._inner.provideRangeColors({ ...this.project(input), range: projectedRange }),
            map,
        );
    }

    public provideColorEdits(
        previous: FullColorizationResult,
        input: ProjectedColorizationInput,
        changes: readonly TextChange[],
    ): ColorizationResult {
        const map = coordinateMap(input);
        if (map.identity) {
            return this._inner.provideColorEdits(previous, this.project(input), changes);
        }

        // `previous` is in source coordinates, while the inner service diffs projected tokens.
        // Mapping may drop included-file tokens or coalesce substitutions, so it is not possible
        // to reconstruct the projected baseline from the source result. Publish a complete mapped
        // result until projected baselines have an explicit opaque identity of their own.
        return mapFull(this._inner.provideDocumentColors(this.project(input)), map);
    }

    /** The input the inner service sees: unchanged, since analysis already ran on projected text. */
    private project(input: ProjectedColorizationInput): ColorizationInput {
        return input;
    }
}

function coordinateMap(input: ProjectedColorizationInput): SourceCoordinateMap {
    return new SourceCoordinateMap(input, input.syntax.document.uri);
}

function emptyFull(
    input: ProjectedColorizationInput,
    range: TextRange,
    map: SourceCoordinateMap,
): FullColorizationResult {
    const projectedId = `${input.syntax.document.version}:${input.semantics.metadataGeneration}:unmapped:${range.start}-${range.end}`;
    return Object.freeze({
        kind: "full",
        resultId: map.sourceResultId(projectedId),
        documentVersion: input.syntax.document.version,
        metadataGeneration: input.semantics.metadataGeneration,
        tokens: Object.freeze([]),
    });
}

function mapFull(result: FullColorizationResult, map: SourceCoordinateMap): FullColorizationResult {
    if (map.identity) return result;
    return {
        ...result,
        resultId: map.sourceResultId(result.resultId),
        tokens: map.mapOrderedRanges(result.tokens),
    };
}
