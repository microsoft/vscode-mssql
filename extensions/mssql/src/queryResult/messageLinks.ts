/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISelectionData } from "../models/interfaces";

/**
 * Matches the header SQL Server puts in front of an execution error and captures the line it
 * reports, for example "Msg 102, Level 15, State 1, Line 11". The header may name a procedure
 * before the line, and may be followed by "[Batch Start Line N]", so the line is taken from the
 * first "Line" after the state.
 *
 * Only the English header is matched. A server running under another language reports a
 * translated header, and those messages are left without a link rather than guessed at.
 */
const sqlErrorHeader = /^Msg\s+\d+,\s*Level\s+\d+,\s*State\s+\d+,.*?\b(Line\s+(\d+))/;

export interface ParsedErrorLine {
    /**
     * The matched text, for example "Line 11". Used verbatim as the link label so that it lines
     * up with the text already in the message.
     */
    text: string;
    /** The line the server reported: 1-based, and relative to the batch rather than the file. */
    batchLine: number;
}

/**
 * Reads the line number out of a SQL Server error message, or returns undefined when the message
 * is not an error header this can understand.
 */
export function parseErrorLine(message: string | undefined): ParsedErrorLine | undefined {
    if (!message) {
        return undefined;
    }

    const match = sqlErrorHeader.exec(message);
    if (!match) {
        return undefined;
    }

    const batchLine = Number(match[2]);
    if (!Number.isSafeInteger(batchLine) || batchLine < 1) {
        return undefined;
    }

    return { text: match[1], batchLine };
}

/**
 * Turns a line the server reported into a position in the document. The server counts from the
 * start of the batch it was given, so the batch's own position in the document is added back.
 * @param batchSelection Where the executed batch sits in the document.
 * @param batchLine The 1-based line reported by the server, relative to the batch.
 */
export function toDocumentSelection(
    batchSelection: ISelectionData,
    batchLine: number,
): ISelectionData {
    const line = batchSelection.startLine + batchLine - 1;
    return {
        startLine: line,
        startColumn: 0,
        endLine: line,
        endColumn: 0,
    };
}

/**
 * Builds the link and target for an error message, when the message names a line and the batch it
 * came from is known. Returns undefined when the message should stay as plain text.
 */
export function createErrorLineLink(
    message: string | undefined,
    batchSelection: ISelectionData | undefined,
): { text: string; selection: ISelectionData } | undefined {
    if (!batchSelection) {
        return undefined;
    }

    const parsed = parseErrorLine(message);
    if (!parsed) {
        return undefined;
    }

    const selection = toDocumentSelection(batchSelection, parsed.batchLine);
    if (selection.startLine < 0) {
        return undefined;
    }

    return { text: parsed.text, selection };
}

/**
 * Whether a rendered message line should carry the link. A message can span several lines once it
 * is split for display, and the link belongs on the line whose text it was taken from.
 */
export function lineOwnsLink(lineText: string, linkText: string | undefined): boolean {
    return !!linkText && lineText.includes(linkText);
}
