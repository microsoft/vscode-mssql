/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Position, TextChange, TextRange, TextSnapshot } from "./contracts.js";

export class ImmutableTextSnapshot implements TextSnapshot {
    private readonly _lineStarts: readonly number[];

    public constructor(
        public readonly uri: string,
        public readonly version: number,
        public readonly text: string,
    ) {
        this._lineStarts = computeLineStarts(text);
    }

    public get length(): number {
        return this.text.length;
    }

    public positionAt(offset: number): Position {
        const safeOffset = Math.max(0, Math.min(offset, this.length));
        let low = 0;
        let high = this._lineStarts.length;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (this._lineStarts[middle]! > safeOffset) high = middle;
            else low = middle + 1;
        }
        const line = Math.max(0, low - 1);
        return { line, character: safeOffset - this._lineStarts[line]! };
    }

    public offsetAt(position: Position): number {
        if (!Number.isInteger(position.line) || !Number.isInteger(position.character)) {
            throw new RangeError("Positions must use integer line and character values");
        }
        const line = Math.max(0, Math.min(position.line, this._lineStarts.length - 1));
        const start = this._lineStarts[line]!;
        const end = line + 1 < this._lineStarts.length ? this._lineStarts[line + 1]! : this.length;
        return Math.max(start, Math.min(start + Math.max(0, position.character), end));
    }

    public slice(range: TextRange): string {
        validateRange(range, this.length);
        return this.text.slice(range.start, range.end);
    }
}

export function applyTextChanges(
    previous: TextSnapshot,
    version: number,
    changes: readonly TextChange[],
): ImmutableTextSnapshot {
    if (version <= previous.version) {
        throw new RangeError(`Document version must increase (${version} <= ${previous.version})`);
    }
    let text = previous.text;
    for (const change of changes) {
        validateRange(change, text.length);
        text = text.slice(0, change.start) + change.text + text.slice(change.end);
    }
    return new ImmutableTextSnapshot(previous.uri, version, text);
}

function validateRange(range: TextRange, length: number): void {
    if (
        !Number.isInteger(range.start) ||
        !Number.isInteger(range.end) ||
        range.start < 0 ||
        range.end < range.start ||
        range.end > length
    ) {
        throw new RangeError(`Invalid UTF-16 range [${range.start}, ${range.end}) for ${length}`);
    }
}

function computeLineStarts(text: string): readonly number[] {
    const starts = [0];
    for (let offset = 0; offset < text.length; offset++) {
        if (text.charCodeAt(offset) === 10) starts.push(offset + 1);
    }
    return starts;
}
