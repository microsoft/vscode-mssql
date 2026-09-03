/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { applyColumnChanges } from "../../src/webviews/pages/FlatFileImport/flatFileColumnSettingsUtils";

suite("FlatFile Column Settings Utils", () => {
    const inferredColumn = {
        name: "OriginalName",
        sqlType: "nvarchar(50)",
        isNullable: true,
        isInPrimaryKey: false,
    };

    test("applies saved column settings over inferred values", () => {
        const result = applyColumnChanges(inferredColumn, {
            index: 0,
            newName: "ModifiedName",
            newDataType: "nvarchar(MAX)",
            newNullable: false,
            newInPrimaryKey: true,
        });

        expect(result).to.deep.equal({
            name: "ModifiedName",
            sqlType: "nvarchar(MAX)",
            isNullable: false,
            isInPrimaryKey: true,
        });
    });

    test("uses inferred values when no settings were modified", () => {
        expect(applyColumnChanges(inferredColumn, undefined)).to.deep.equal(inferredColumn);
    });
});
