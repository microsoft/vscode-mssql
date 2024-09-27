/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Theme, webLightTheme } from "@fluentui/react-components";

export const saveAsCsv = (theme: Theme) => {
    const saveAsCsvIcon =
        theme === webLightTheme
            ? require("../../media/saveCsv.svg")
            : require("../../media/saveCsv_inverse.svg");
    return saveAsCsvIcon;
};

export const saveAsJson = (theme: Theme) => {
    const saveAsJsonIcon =
        theme === webLightTheme
            ? require("../../media/saveJson.svg")
            : require("../../media/saveJson_inverse.svg");
    return saveAsJsonIcon;
};

export const saveAsExcel = (theme: Theme) => {
    const saveAsExcelIcon =
        theme === webLightTheme
            ? require("../../media/saveExcel.svg")
            : require("../../media/saveExcel_inverse.svg");
    return saveAsExcelIcon;
};
