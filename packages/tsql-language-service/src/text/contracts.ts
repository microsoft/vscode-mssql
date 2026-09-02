/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface Position {
    readonly line: number;
    readonly character: number;
}

export interface TextRange {
    readonly start: number;
    readonly end: number;
}

/** UTF-16 offsets are interpreted sequentially, matching LSP incremental changes. */
export interface TextChange extends TextRange {
    readonly text: string;
}

export interface TextSnapshot {
    readonly uri: string;
    readonly version: number;
    readonly text: string;
    readonly length: number;

    positionAt(offset: number): Position;
    offsetAt(position: Position): number;
    slice(range: TextRange): string;
}
