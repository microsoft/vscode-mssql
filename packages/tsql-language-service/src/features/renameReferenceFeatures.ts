/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LanguageServiceRuntime } from "../runtime/index.js";
import type { Location, TextEdit } from "./contracts.js";
import { occurrenceRange } from "./featureSnapshotUtilities.js";
import { preserveIdentifierQuotes } from "./identifierFormatting.js";

/** Reference and rename operations over identities from one published semantic snapshot. */
export class RenameReferenceFeatureProvider {
    public constructor(private readonly _runtime: LanguageServiceRuntime) {}

    public references(uri: string, version: number, offset: number): readonly Location[] {
        const snapshot = this._runtime.snapshot(uri, version);
        const symbol = snapshot.semantics.symbolAt(offset);
        return symbol
            ? [
                  ...(symbol.declaration ? [{ uri, range: symbol.declaration }] : []),
                  ...snapshot.semantics.references(symbol.id).map((reference) => ({
                      uri,
                      range: { start: reference.start, end: reference.end },
                  })),
              ]
            : [];
    }

    public prepareRename(uri: string, version: number, offset: number) {
        const snapshot = this._runtime.snapshot(uri, version);
        const symbol = snapshot.semantics.symbolAt(offset);
        if (!symbol?.declaration) return undefined;
        return occurrenceRange(snapshot, offset) ?? symbol.declaration;
    }

    public rename(
        uri: string,
        version: number,
        offset: number,
        newName: string,
    ): readonly TextEdit[] {
        const snapshot = this._runtime.snapshot(uri, version);
        const symbol = snapshot.semantics.symbolAt(offset);
        if (!symbol?.declaration) return [];
        const ranges = [symbol.declaration, ...snapshot.semantics.references(symbol.id)];
        return ranges.map((range) => ({
            start: range.start,
            end: range.end,
            newText: preserveIdentifierQuotes(
                snapshot.text.text.slice(range.start, range.end),
                newName,
            ),
        }));
    }
}
