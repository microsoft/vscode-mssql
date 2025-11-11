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
