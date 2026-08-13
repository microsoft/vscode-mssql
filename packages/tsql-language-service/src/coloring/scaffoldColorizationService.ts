/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TextChange } from "../text/index.js";
import {
    sqlColorizationLegend,
    type ColorizationInput,
    type ColorizationLegend,
    type ColorizationResult,
    type ColorizationService,
    type FullColorizationResult,
} from "./contracts.js";

/** Empty implementation used until lexical and semantic classifiers are implemented. */
export class ScaffoldColorizationService implements ColorizationService {
    public readonly legend: ColorizationLegend = sqlColorizationLegend;

    public provideDocumentColors(input: ColorizationInput): FullColorizationResult {
        validateInput(input);
        return fullResult(input);
    }

    public provideRangeColors(
        input: ColorizationInput & {
            readonly range: { readonly start: number; readonly end: number };
        },
    ): FullColorizationResult {
        validateInput(input);
        if (input.range.start < 0 || input.range.end > input.syntax.document.length) {
            throw new RangeError("Colorization range is outside the document");
        }
        return fullResult(input);
    }

    public provideColorEdits(
        previous: FullColorizationResult,
        input: ColorizationInput,
        _changes: readonly TextChange[],
    ): ColorizationResult {
        validateInput(input);
        return Object.freeze({
            kind: "delta",
            previousResultId: previous.resultId,
            resultId: resultId(input),
            documentVersion: input.syntax.document.version,
            metadataGeneration: input.semantics.metadataGeneration,
            edits: Object.freeze([]),
        });
    }
}

function validateInput(input: ColorizationInput): void {
    if (input.syntax.document.version !== input.semantics.documentVersion) {
        throw new Error(
            `Colorization snapshot mismatch: syntax ${input.syntax.document.version}, semantics ${input.semantics.documentVersion}`,
        );
    }
}

function fullResult(input: ColorizationInput): FullColorizationResult {
    return Object.freeze({
        kind: "full",
        resultId: resultId(input),
        documentVersion: input.syntax.document.version,
        metadataGeneration: input.semantics.metadataGeneration,
        tokens: Object.freeze([]),
    });
}

function resultId(input: ColorizationInput): string {
    const range = input.range
        ? `${input.range.start}-${input.range.end}`
        : `0-${input.syntax.document.length}`;
    return `${input.syntax.document.version}:${input.semantics.metadataGeneration}:${range}`;
}
