/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Fourslash-style fixture harness (design 05 §17.1). Fixtures embed markers
 * in SQL comments; the harness strips them and records their offsets:
 *
 *   SELECT o./*caret*​/ FROM Sales.Orders AS o;
 *
 * `caret` is the conventional request position; any other name becomes a
 * named marker (definition anchors, range assertions). LS-0 ships parsing +
 * document analysis access; completion/hover/diagnostic expect-helpers land
 * with their features (B9+). Pure: usable from any test lane.
 */

import { LexResult, lex } from "../core/lexer";
import { SegmentResult, segment } from "../core/segmenter";
import { SqlTextPosition, TextSnapshot } from "../core/text/textSnapshot";

const MARKER = /\/\*([A-Za-z_][A-Za-z0-9_]*)\*\//g;

export interface FourslashFixture {
    /** Fixture text with all markers removed. */
    readonly text: string;
    /** Offset of the `caret` marker, when present. */
    readonly caret: number | undefined;
    /** All marker offsets by name (including `caret`). */
    readonly markers: ReadonlyMap<string, number>;
}

export function parseFourslash(source: string): FourslashFixture {
    const markers = new Map<string, number>();
    let text = "";
    let last = 0;
    MARKER.lastIndex = 0;
    for (let match = MARKER.exec(source); match !== null; match = MARKER.exec(source)) {
        text += source.slice(last, match.index);
        if (markers.has(match[1])) {
            throw new Error(`Duplicate fourslash marker: ${match[1]}`);
        }
        markers.set(match[1], text.length);
        last = match.index + match[0].length;
    }
    text += source.slice(last);
    return { text, caret: markers.get("caret"), markers };
}

/** A parsed fixture with the LS-0 analysis layers materialized. */
export class FourslashDocument {
    readonly fixture: FourslashFixture;
    readonly snapshot: TextSnapshot;
    readonly lexed: LexResult;
    readonly segments: SegmentResult;

    constructor(source: string, version: number = 1) {
        this.fixture = parseFourslash(source);
        this.snapshot = new TextSnapshot(this.fixture.text, version);
        this.lexed = lex(this.fixture.text);
        this.segments = segment(this.fixture.text, this.lexed.tokens);
    }

    get caretOffset(): number {
        const caret = this.fixture.caret;
        if (caret === undefined) {
            throw new Error("Fixture has no /*caret*/ marker.");
        }
        return caret;
    }

    get caretPosition(): SqlTextPosition {
        return this.snapshot.positionAt(this.caretOffset);
    }

    markerPosition(name: string): SqlTextPosition {
        const offset = this.fixture.markers.get(name);
        if (offset === undefined) {
            throw new Error(`Fixture has no /*${name}*/ marker.`);
        }
        return this.snapshot.positionAt(offset);
    }
}
