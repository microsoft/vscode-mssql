/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { isNumericSqlType } from "../../src/webviews/common/sqlTypeUtils";

suite("isNumericSqlType Tests", () => {
    test("returns true for numeric SQL types", () => {
        for (const type of [
            "tinyint",
            "smallint",
            "int",
            "bigint",
            "decimal",
            "numeric",
            "float",
            "real",
            "money",
            "smallmoney",
        ]) {
            expect(isNumericSqlType(type), type).to.be.true;
        }
    });

    test("ignores case, whitespace, and precision/scale", () => {
        expect(isNumericSqlType(" INT ")).to.be.true;
        expect(isNumericSqlType("decimal(18, 2)")).to.be.true;
        expect(isNumericSqlType("Numeric (10,0)")).to.be.true;
    });

    test("returns false for non-numeric SQL types", () => {
        for (const type of ["bit", "varchar", "nvarchar(max)", "datetime2", "uniqueidentifier"]) {
            expect(isNumericSqlType(type), type).to.be.false;
        }
    });

    test("returns false for missing type names", () => {
        expect(isNumericSqlType(undefined)).to.be.false;
        expect(isNumericSqlType("")).to.be.false;
    });
});
