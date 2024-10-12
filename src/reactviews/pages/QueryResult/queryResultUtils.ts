/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Theme, webLightTheme } from "@fluentui/react-components";
import { QueryResultWebviewState } from "../../../sharedInterfaces/queryResult";

export const saveAsCsvIcon = (theme: Theme) => {
    return theme === webLightTheme
        ? require("../../media/saveCsv.svg")
        : require("../../media/saveCsv_inverse.svg");
};

export const saveAsJsonIcon = (theme: Theme) => {
    return theme === webLightTheme
        ? require("../../media/saveJson.svg")
        : require("../../media/saveJson_inverse.svg");
};

export const saveAsExcelIcon = (theme: Theme) => {
    return theme === webLightTheme
        ? require("../../media/saveExcel.svg")
        : require("../../media/saveExcel_inverse.svg");
};

export function hasResultsOrMessages(state: QueryResultWebviewState): boolean {
    return (
        Object.keys(state.resultSetSummaries).length > 0 ||
        state.messages.length > 0
    );
}
