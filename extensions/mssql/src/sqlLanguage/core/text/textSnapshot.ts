/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Immutable document text view (language-service design 05 §6.1). One place
 * for UTF-16 offsets, the line map, and offset<->position conversion so
 * Monaco/VS Code coordinate handling is normalized exactly once (§1.3 #8).
 * Positions are ZERO-based line/character in UTF-16 code units.
 */

export interface SqlTextPosition {
    readonly line: number;
    readonly character: number;
}

export interface SqlTextSpan {
    /** Inclusive start offset (UTF-16 code units). */
    readonly start: number;
    /** Exclusive end offset. */
    readonly end: number;
}

export class TextSnapshot {
    readonly text: string;
    readonly version: number;
    /** Offset of each line start; lineStarts[0] === 0. */
    private readonly lineStarts: number[];

    constructor(text: string, version: number = 0) {
        this.text = text;
        this.version = version;
        this.lineStarts = computeLineStarts(text);
    }

    get length(): number {
        return this.text.length;
    }

    get lineCount(): number {
        return this.lineStarts.length;
    }

    /** Start offset of a line (clamped). */
    lineStart(line: number): number {
        if (line <= 0) {
            return 0;
        }
        if (line >= this.lineStarts.length) {
            return this.text.length;
        }
        return this.lineStarts[line];
    }

    /** Line content WITHOUT its terminator. */
    lineContent(line: number): string {
        const start = this.lineStart(line);
        let end = line + 1 < this.lineStarts.length ? this.lineStarts[line + 1] : this.text.length;
        while (end > start && (this.text[end - 1] === "\n" || this.text[end - 1] === "\r")) {
            end--;
        }
        return this.text.slice(start, end);
    }

    /** Binary-search the containing line for an offset (clamped). */
    positionAt(offset: number): SqlTextPosition {
        const clamped = Math.max(0, Math.min(offset, this.text.length));
        let low = 0;
        let high = this.lineStarts.length - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (this.lineStarts[mid] <= clamped) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }
        return { line: low, character: clamped - this.lineStarts[low] };
    }

    /** Offset for a position (clamps line and character; character may not cross the line break). */
    offsetAt(position: SqlTextPosition): number {
        if (position.line < 0) {
            return 0;
        }
        if (position.line >= this.lineStarts.length) {
            return this.text.length;
        }
        const start = this.lineStarts[position.line];
        const nextStart =
            position.line + 1 < this.lineStarts.length
                ? this.lineStarts[position.line + 1]
                : this.text.length;
        let lineEnd = nextStart;
        while (
            lineEnd > start &&
            (this.text[lineEnd - 1] === "\n" || this.text[lineEnd - 1] === "\r")
        ) {
            lineEnd--;
        }
        return Math.min(start + Math.max(0, position.character), lineEnd);
    }

    slice(span: SqlTextSpan): string {
        return this.text.slice(span.start, span.end);
    }
}

function computeLineStarts(text: string): number[] {
    const starts: number[] = [0];
    for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        if (ch === 10 /* \n */) {
            starts.push(i + 1);
        } else if (ch === 13 /* \r */) {
            if (i + 1 < text.length && text.charCodeAt(i + 1) === 10) {
                i++;
            }
            starts.push(i + 1);
        }
    }
    return starts;
}
