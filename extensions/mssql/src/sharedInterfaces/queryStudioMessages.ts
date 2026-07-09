/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure Query Studio message display formatting (QO-7): shared by the webview
 * MessagesView (visible rows only — the pane is virtualized) and the host's
 * Copy All text builder, so clipboard output is byte-identical to the pane
 * without the webview ever materializing every row.
 */

import { QsMessageRow } from "./queryStudio";

/** Classic-editor group header time, e.g. "9:21:55 PM". */
export function messageTimeLabel(epochMs: number): string {
    return new Date(epochMs).toLocaleTimeString();
}

export function messageGetsTimestamp(message: QsMessageRow): boolean {
    return !/^\(\d+\s+rows?\s+affected\)$/i.test(message.text.trim());
}

export const MESSAGE_TIME_COLUMN_WIDTH = 12;
export const MESSAGE_SEPARATOR = "  ";

export function formatMessageForDisplay(message: QsMessageRow): string {
    const time = messageGetsTimestamp(message)
        ? messageTimeLabel(message.epochMs).padEnd(MESSAGE_TIME_COLUMN_WIDTH, " ")
        : " ".repeat(MESSAGE_TIME_COLUMN_WIDTH);
    const prefix = `${time}${MESSAGE_SEPARATOR}`;
    const continuationPrefix = " ".repeat(prefix.length);
    return prefix + message.text.replace(/\r\n?/g, "\n").replace(/\n/g, `\n${continuationPrefix}`);
}

/** Display line count for one message (virtualization height math). */
export function messageLineCount(message: QsMessageRow): number {
    let lines = 1;
    for (let i = 0; i < message.text.length; i++) {
        if (message.text.charCodeAt(i) === 10) {
            lines++;
        }
    }
    return lines;
}

/** The Copy All payload — one formatted row per line, pane-identical. */
export function buildMessagesText(messages: readonly QsMessageRow[]): string {
    return messages.map(formatMessageForDisplay).join("\n");
}
