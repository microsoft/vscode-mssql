/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ColorThemeKind } from "../../common/vscodeWebviewProvider";
import { QueryResultWebviewState } from "../../../sharedInterfaces/queryResult";

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
