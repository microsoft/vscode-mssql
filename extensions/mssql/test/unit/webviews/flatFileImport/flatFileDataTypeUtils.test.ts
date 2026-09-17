/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { getDataTypeOptions } from "../../../../src/webviews/pages/FlatFileImport/flatFileDataTypeUtils";
import { ColumnInfo } from "../../../../src/models/contracts/flatFile";

function createColumn(sqlType: string): ColumnInfo {
    return {
        name: "column",
        sqlType,
        isNullable: true,
    };
}

suite("Flat file data type utilities", () => {
    test("includes bounded maximum and MAX options for variable character types", () => {
        const optionNames = getDataTypeOptions(createColumn("nvarchar(MAX)")).map(
            (option) => option.name,
        );

        expect(optionNames).to.include.members([
            "nvarchar(50)",
            "nvarchar(4000)",
            "nvarchar(MAX)",
            "varchar(50)",
            "varchar(8000)",
            "varchar(MAX)",
        ]);
    });

    test("retains a bounded type inferred by the service", () => {
        const optionNames = getDataTypeOptions(createColumn("nvarchar(100)")).map(
            (option) => option.name,
        );

        expect(optionNames).to.include("nvarchar(100)");
    });
});
