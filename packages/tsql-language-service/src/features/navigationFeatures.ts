/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LanguageServiceRuntime } from "../runtime/index.js";
import type { DefinitionTarget, DocumentSymbol, Location } from "./contracts.js";
import { assertDocumentOffset, occurrenceRange } from "./featureSnapshotUtilities.js";

const emptyDefinitionTarget: DefinitionTarget = Object.freeze({ locations: Object.freeze([]) });

/** Definition, document-symbol, and selection operations over one published snapshot. */
export class NavigationFeatureProvider {
    public constructor(private readonly _runtime: LanguageServiceRuntime) {}

    public definition(uri: string, version: number, offset: number): readonly Location[] {
        return this.definitionTarget(uri, version, offset).locations;
    }

    public definitionTarget(uri: string, version: number, offset: number): DefinitionTarget {
        const snapshot = this._runtime.snapshot(uri, version);
        const symbol = snapshot.semantics.symbolAt(offset);
        if (!symbol) return emptyDefinitionTarget;
        const originRange = occurrenceRange(snapshot, offset);
        if (symbol.declaration) {
            return Object.freeze({
                locations: Object.freeze([{ uri, range: symbol.declaration }]),
                ...(originRange ? { originRange } : {}),
            });
        }
        if (!symbol.object) return emptyDefinitionTarget;
        const object = snapshot.metadata.object(symbol.object);
        if (!object) return emptyDefinitionTarget;
        return Object.freeze({
            locations: Object.freeze([]),
            ...(originRange ? { originRange } : {}),
            object: Object.freeze({
                ...(object.database ? { database: object.database } : {}),
                schema: object.schema,
                name: object.name,
                kind: object.kind,
                ...(object.typeCategory ? { typeCategory: object.typeCategory } : {}),
            }),
        });
    }

    public documentSymbols(uri: string, version: number): readonly DocumentSymbol[] {
        const snapshot = this._runtime.snapshot(uri, version);
        return snapshot.semantics.units.flatMap((unit) =>
            unit.symbols.flatMap((symbol) =>
                symbol.declaration
                    ? [
                          {
                              name: symbol.name,
                              kind: symbol.kind,
                              range: symbol.declaration,
                              selectionRange: symbol.declaration,
                          },
                      ]
                    : [],
            ),
        );
    }

    public selectionRanges(uri: string, version: number, offsets: readonly number[]) {
        const snapshot = this._runtime.snapshot(uri, version);
        return offsets.map((offset) => {
            assertDocumentOffset(snapshot, offset);
            const node = snapshot.syntax.nodeAt(offset);
            return { start: node.start, end: node.end };
        });
    }
}
