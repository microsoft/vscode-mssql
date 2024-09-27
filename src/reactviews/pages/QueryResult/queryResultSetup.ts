/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const saveAsCsv = (theme: string) => {
    const saveAsCsvIcon =
        theme === "dark"
            ? require("../../media/saveCsv_inverse.svg")
            : require("../../media/saveCsv.svg");
    return saveAsCsvIcon;
};

export const saveAsJson = (theme: string) => {
    const saveAsJsonIcon =
        theme === "dark"
            ? require("../../media/saveJson_inverse.svg")
            : require("../../media/saveJson.svg");
    return saveAsJsonIcon;
};

export const saveAsExcel = (theme: string) => {
    const saveAsExcelIcon =
        theme === "dark"
            ? require("../../media/saveExcel_inverse.svg")
            : require("../../media/saveExcel.svg");
    return saveAsExcelIcon;
};
