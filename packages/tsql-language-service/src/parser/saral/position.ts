/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import { type NodeLocation } from "./ast/types.js";

export interface Position {
    line: number;
    character: number;
}

export interface Range {
    start: Position;
    end: Position;
}

export class LineIndex {
    private readonly lineStarts: number[];

    constructor(private readonly text: string) {
        this.lineStarts = buildLineStarts(text);
    }

    offsetToPosition(offset: number): Position {
        const clampedOffset = clamp(offset, 0, this.text.length);
        const line = findLine(this.lineStarts, clampedOffset);
        const lineStart = this.lineStarts[line];
        const lineEnd = this.getLineEnd(line);

        return {
            line,
            character: clamp(clampedOffset, lineStart, lineEnd) - lineStart,
        };
    }

    positionToOffset(position: Position): number {
        const line = clamp(Math.trunc(position.line), 0, this.lineStarts.length - 1);

        const lineStart = this.lineStarts[line];
        const lineEnd = this.getLineEnd(line);
        const character = Math.max(0, Math.trunc(position.character));

        return clamp(lineStart + character, lineStart, lineEnd);
    }

    locationToRange(location: NodeLocation): Range {
        return {
            start: this.offsetToPosition(location.start),
            end: this.offsetToPosition(location.end),
        };
    }

    private getLineEnd(line: number): number {
        if (line + 1 >= this.lineStarts.length) {
            return this.text.length;
        }

        let end = this.lineStarts[line + 1];

        if (this.text[end - 1] === "\n") {
            end--;
        }

        if (this.text[end - 1] === "\r") {
            end--;
        }

        return end;
    }
}

export function createLineIndex(text: string): LineIndex {
    return new LineIndex(text);
}

export function offsetToPosition(text: string, offset: number): Position {
    return new LineIndex(text).offsetToPosition(offset);
}

export function positionToOffset(text: string, position: Position): number {
    return new LineIndex(text).positionToOffset(position);
}

export function locationToRange(text: string, location: NodeLocation): Range {
    return new LineIndex(text).locationToRange(location);
}

function buildLineStarts(text: string): number[] {
    const starts = [0];

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (char === "\r") {
            if (text[i + 1] === "\n") {
                i++;
            }

            starts.push(i + 1);
            continue;
        }

        if (char === "\n") {
            starts.push(i + 1);
        }
    }

    return starts;
}

function findLine(lineStarts: number[], offset: number): number {
    let low = 0;
    let high = lineStarts.length - 1;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const start = lineStarts[mid];
        const nextStart = lineStarts[mid + 1] ?? Number.POSITIVE_INFINITY;

        if (offset < start) {
            high = mid - 1;
        } else if (offset >= nextStart) {
            low = mid + 1;
        } else {
            return mid;
        }
    }

    return lineStarts.length - 1;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}
