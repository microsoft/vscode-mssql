/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    BindInput,
    BoundReference,
    SemanticBinder,
    SemanticSnapshot,
    SemanticSymbol,
    SymbolId,
} from "./contracts.js";
import { emptySemanticModel } from "./model/semanticModel.js";

/** Empty binder used to exercise document, worker, metadata, and stale-result plumbing. */
export class ScaffoldSemanticBinder implements SemanticBinder {
    public bind(input: BindInput): SemanticSnapshot {
        return new EmptySemanticSnapshot(
            input.syntax.document.version,
            input.metadata.generation,
            input.syntax.profileGeneration,
        );
    }

    public update(_previous: SemanticSnapshot, input: BindInput): SemanticSnapshot {
        return this.bind(input);
    }
}

class EmptySemanticSnapshot implements SemanticSnapshot {
    public readonly units = [];
    public readonly diagnostics = [];
    public readonly model = emptySemanticModel;
    public readonly statistics = Object.freeze({
        unitsExamined: 0,
        unitsReused: 0,
        unitsRebound: 0,
        elapsedMs: 0,
    });

    public constructor(
        public readonly documentVersion: number,
        public readonly metadataGeneration: number,
        public readonly profileGeneration: string,
    ) {}

    public symbolAt(_offset: number): SemanticSymbol | undefined {
        return undefined;
    }

    public references(_symbol: SymbolId): readonly BoundReference[] {
        return [];
    }

    public visibleSymbols(_offset: number): readonly SemanticSymbol[] {
        return [];
    }
}
