/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ColorThemeKind } from "../../common/vscodeWebviewProvider";
import { QueryResultWebviewState } from "../../../sharedInterfaces/queryResult";
import * as qr from "../../../sharedInterfaces/queryResult";

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

export function hasResultsOrMessages(state: QueryResultWebviewState): boolean {
    return (
        Object.keys(state.resultSetSummaries).length > 0 ||
        state.messages.length > 0
    );
}

export const splitMessages = (messages: qr.IMessage[]): qr.IMessage[] => {
    return messages.flatMap((message) => {
        const lines = message.message.split(/\r?\n/);
        return lines.map((line, index) => {
            let newMessage = { ...message };
            newMessage.message = line;
            newMessage.time = index === 0 ? message.time : undefined;
            return newMessage;
        });
    });
};
