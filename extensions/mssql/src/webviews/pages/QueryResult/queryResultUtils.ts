/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as qr from "../../../sharedInterfaces/queryResult";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";

export const saveAsCsvIcon = (theme: ColorThemeKind) => {
    return theme === ColorThemeKind.Light
        ? require("../../media/saveCsv.svg")
        : require("../../media/saveCsv_inverse.svg");
};

export const saveAsJsonIcon = (theme: ColorThemeKind) => {
    return theme === ColorThemeKind.Light
        ? require("../../media/saveJson.svg")
        : require("../../media/saveJson_inverse.svg");
};

export const saveAsExcelIcon = (theme: ColorThemeKind) => {
    return theme === ColorThemeKind.Light
        ? require("../../media/saveExcel.svg")
        : require("../../media/saveExcel_inverse.svg");
};

export const saveAsInsertIcon = (theme: ColorThemeKind) => {
    return theme === ColorThemeKind.Light
        ? require("../../media/saveInsert.svg")
        : require("../../media/saveInsert_inverse.svg");
};

export function hasResultsOrMessages(
    resultSetSummaries: Record<number, Record<number, qr.ResultSetSummary>>,
    messages: qr.IMessage[],
): boolean {
    return Object.keys(resultSetSummaries).length > 0 || messages.length > 0;
}

/**
 * Splits messages containing newline characters into separate messages while preserving original properties.
 * @param messages - Array messages to process
 * @returns Array of messages with newline characters split into separate messages
 */
export const splitMessages = (messages: qr.IMessage[] | undefined | null): qr.IMessage[] => {
    if (!messages || messages.length === 0) {
        return [];
    }
    return messages.flatMap((message) => {
        const lines = message.message.split(/\r?\n/);
        return lines.map((line) => {
            let newMessage = { ...message };
            newMessage.message = line;
            return newMessage;
        });
    });
};

export function getTotalResultSetRowCount(
    summaries: Record<number, Record<number, qr.ResultSetSummary>>,
): number | undefined {
    let total = 0;
    let hasRowCount = false;

    for (const batch of Object.values(summaries ?? {})) {
        for (const result of Object.values(batch ?? {})) {
            if (typeof result?.rowCount === "number") {
                total += result.rowCount;
                hasRowCount = true;
            }
        }
    }

    return hasRowCount ? total : undefined;
}

function getActiveResultSetRowCount(
    summaries: Record<number, Record<number, qr.ResultSetSummary>>,
    selectionSummary?: qr.SelectionSummary,
): number | undefined {
    if (
        selectionSummary?.batchId !== undefined &&
        selectionSummary?.resultId !== undefined &&
        typeof summaries?.[selectionSummary.batchId]?.[selectionSummary.resultId]?.rowCount ===
            "number"
    ) {
        return summaries[selectionSummary.batchId][selectionSummary.resultId].rowCount;
    }

    return undefined;
}

function getRowsAffectedFromMessages(messages: qr.IMessage[]): number | undefined {
    const rowsAffectedRegex = /\(?\s*(\d+)\s+rows?\s+affected\s*\)?/i;
    for (let i = messages.length - 1; i >= 0; i--) {
        const text = messages[i]?.message;
        if (!text) {
            continue;
        }
        const match = text.match(rowsAffectedRegex);
        if (match && match[1] !== undefined) {
            const parsed = Number(match[1]);
            if (!Number.isNaN(parsed)) {
                return parsed;
            }
        }
    }
    return undefined;
}

export function getDisplayedRowsCount(
    summaries: Record<number, Record<number, qr.ResultSetSummary>>,
    selectionSummary: qr.SelectionSummary | undefined,
    messages: qr.IMessage[],
): number | undefined {
    const activeResultRowCount = getActiveResultSetRowCount(summaries, selectionSummary);
    if (typeof activeResultRowCount === "number") {
        return activeResultRowCount;
    }

    const totalResultRowCount = getTotalResultSetRowCount(summaries);
    if (typeof totalResultRowCount === "number") {
        return totalResultRowCount;
    }

    return getRowsAffectedFromMessages(messages);
}
