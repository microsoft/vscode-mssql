/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TextDocument } from "./langiumRuntime.mjs";

interface TextPosition {
    readonly line: number;
    readonly character: number;
}

interface TextRange {
    readonly start: TextPosition;
    readonly end: TextPosition;
}

/** Dependency-free, immutable implementation of Langium's TextDocument contract. */
export class TsqlTextDocumentSnapshot implements TextDocument {
    private readonly lineOffsets: number[];
    private readonly lineEndings: string[];
    public readonly lineCount: number;

    public constructor(
        public readonly uri: string,
        public readonly languageId: string,
        public readonly version: number,
        private readonly text: string,
    ) {
        const lines = computeLines(text);
        this.lineOffsets = lines.offsets;
        this.lineEndings = lines.endings;
        this.lineCount = this.lineOffsets.length;
    }

    public getText(range?: TextRange): string {
        if (!range) {
            return this.text;
        }
        const first = this.offsetAt(range.start);
        const second = this.offsetAt(range.end);
        return this.text.slice(Math.min(first, second), Math.max(first, second));
    }

    public positionAt(offset: number): TextPosition {
        const target = Math.max(0, Math.min(offset, this.text.length));
        let low = 0;
        let high = this.lineOffsets.length;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (this.lineOffsets[middle] > target) {
                high = middle;
            } else {
                low = middle + 1;
            }
        }
        const line = Math.max(0, low - 1);
        return {
            line,
            character: Math.min(target, this.lineEndOffset(line)) - this.lineOffsets[line],
        };
    }

    public offsetAt(position: TextPosition): number {
        if (position.line < 0) {
            return 0;
        }
        if (position.line >= this.lineOffsets.length) {
            return this.text.length;
        }
        const lineStart = this.lineOffsets[position.line];
        const lineEnd = this.lineEndOffset(position.line);
        return Math.max(lineStart, Math.min(lineStart + Math.max(0, position.character), lineEnd));
    }

    public getLineRange(line: number): TextRange {
        const normalized = Math.max(0, Math.min(line, this.lineOffsets.length - 1));
        return {
            start: { line: normalized, character: 0 },
            end: {
                line: normalized,
                character: this.lineEndOffset(normalized) - this.lineOffsets[normalized],
            },
        };
    }

    public getEOLCharacters(line: number): string {
        return line >= 0 && line < this.lineEndings.length ? this.lineEndings[line] : "";
    }

    private lineEndOffset(line: number): number {
        const next =
            line + 1 < this.lineOffsets.length ? this.lineOffsets[line + 1] : this.text.length;
        return next - this.lineEndings[line].length;
    }
}

function computeLines(text: string): { offsets: number[]; endings: string[] } {
    const offsets = [0];
    const endings: string[] = [];
    for (let index = 0; index < text.length; index++) {
        const character = text.charCodeAt(index);
        if (character === 13) {
            if (text.charCodeAt(index + 1) === 10) {
                index++;
                endings.push("\r\n");
            } else {
                endings.push("\r");
            }
            offsets.push(index + 1);
        } else if (character === 10) {
            endings.push("\n");
            offsets.push(index + 1);
        }
    }
    endings.push("");
    return { offsets, endings };
}
