/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QsMessageRow } from "./queryStudio";

/** Restore/catch-up windows are bounded independently of live notifications. */
export const QS_MESSAGE_WINDOW_MAX_COUNT = 2_048;
export const QS_MESSAGE_WINDOW_MAX_TEXT_CHARACTERS = 1_000_000;

export interface QueryStudioMessageWindow {
    startIndex: number;
    nextIndex: number;
    totalCount: number;
    textCharacters: number;
    hasMore: boolean;
    messages: QsMessageRow[];
}

/** Merge an absolute-positioned notification/window without duplicates. */
export function appendPositionedQueryStudioMessages(
    current: QsMessageRow[],
    startIndex: number,
    incoming: readonly QsMessageRow[],
): QsMessageRow[] {
    const normalizedStart = Number.isFinite(startIndex) ? Math.max(0, Math.trunc(startIndex)) : 0;
    if (normalizedStart > current.length || incoming.length === 0) {
        return current;
    }
    const alreadyPresent = Math.max(0, current.length - normalizedStart);
    const fresh = incoming.slice(alreadyPresent);
    return fresh.length > 0 ? [...current, ...fresh] : current;
}

/**
 * Slice one deterministic catch-up window. At least one message is returned
 * when data remains, even if that individual message exceeds the character
 * budget, so clients always make forward progress.
 */
export function queryStudioMessageWindow(
    allMessages: readonly QsMessageRow[],
    afterIndex: number = 0,
    maxCount: number = QS_MESSAGE_WINDOW_MAX_COUNT,
    maxTextCharacters: number = QS_MESSAGE_WINDOW_MAX_TEXT_CHARACTERS,
): QueryStudioMessageWindow {
    const totalCount = allMessages.length;
    const normalizedIndex = Number.isFinite(afterIndex) ? Math.trunc(afterIndex) : 0;
    const startIndex = Math.min(totalCount, Math.max(0, normalizedIndex));
    const countLimit = Math.max(1, Math.trunc(maxCount) || 1);
    const characterLimit = Math.max(0, Math.trunc(maxTextCharacters) || 0);
    let nextIndex = startIndex;
    let textCharacters = 0;
    while (nextIndex < totalCount && nextIndex - startIndex < countLimit) {
        const nextCharacters = allMessages[nextIndex].text.length;
        if (nextIndex > startIndex && textCharacters + nextCharacters > characterLimit) {
            break;
        }
        textCharacters += nextCharacters;
        nextIndex++;
    }
    return {
        startIndex,
        nextIndex,
        totalCount,
        textCharacters,
        hasMore: nextIndex < totalCount,
        messages: allMessages.slice(startIndex, nextIndex),
    };
}
