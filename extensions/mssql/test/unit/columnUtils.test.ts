/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { locConstants } from "../../src/reactviews/common/locConstants";
import { columnUtils } from "../../src/reactviews/pages/SchemaDesigner/model";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";

suite("SchemaDesigner column utils", () => {
    function createColumn(overrides: Partial<SchemaDesigner.Column> = {}): SchemaDesigner.Column {
        return {
            id: "c1",
            name: "Column1",
            dataType: "int",
            maxLength: "",
            precision: 10,
            scale: 0,
            isPrimaryKey: false,
            isIdentity: false,
            identitySeed: 0,
            identityIncrement: 0,
            isNullable: true,
            defaultValue: "",
            isComputed: false,
            computedFormula: "",
            computedPersisted: false,
            ...overrides,
        };
    }

    test("isColumnValid returns expected validation errors and passes valid columns", () => {
        const column = createColumn({ id: "c-valid", name: "Id" });

        expect(
            columnUtils.isColumnValid(createColumn({ id: "c-empty", name: "" }), [column]),
        ).to.equal(locConstants.schemaDesigner.columnNameEmptyError);

        const duplicateError = columnUtils.isColumnValid(
            createColumn({ id: "c-dup", name: "Id", dataType: "int" }),
            [column],
        );
        expect(duplicateError).to.equal(locConstants.schemaDesigner.columnNameRepeatedError("Id"));

        expect(
            columnUtils.isColumnValid(
                createColumn({
                    id: "c-pk-null",
                    name: "PkCol",
                    isPrimaryKey: true,
                    isNullable: true,
                }),
                [column],
            ),
        ).to.equal(locConstants.schemaDesigner.columnPKCannotBeNull("PkCol"));

        expect(
            columnUtils.isColumnValid(
                createColumn({ id: "c-varchar", dataType: "varchar", maxLength: "" }),
                [column],
            ),
        ).to.equal(locConstants.schemaDesigner.columnMaxLengthEmptyError);

        expect(
            columnUtils.isColumnValid(
                createColumn({ id: "c-varchar2", dataType: "varchar", maxLength: "-1" }),
                [column],
            ),
        ).to.equal(locConstants.schemaDesigner.columnMaxLengthInvalid("-1"));

        expect(
            columnUtils.isColumnValid(
                createColumn({ id: "c-ok", name: "Name", dataType: "varchar", maxLength: "MAX" }),
                [column],
            ),
        ).to.equal(undefined);
    });

    test("type classification helpers and defaults return expected values", () => {
        expect(columnUtils.isLengthBasedType("nvarchar")).to.equal(true);
        expect(columnUtils.isLengthBasedType("int")).to.equal(false);

        expect(columnUtils.isPrecisionBasedType("decimal")).to.equal(true);
        expect(columnUtils.isPrecisionBasedType("int")).to.equal(false);

        expect(columnUtils.isTimeBasedWithScale("time")).to.equal(true);
        expect(columnUtils.isTimeBasedWithScale("date")).to.equal(false);

        expect(columnUtils.isIdentityBasedType("int", 0)).to.equal(true);
        expect(columnUtils.isIdentityBasedType("decimal", 1)).to.equal(false);

        expect(columnUtils.getDefaultLength("varchar")).to.equal("50");
        expect(columnUtils.getDefaultLength("vector")).to.equal("1");
        expect(columnUtils.getDefaultPrecision("numeric")).to.equal(18);
        expect(columnUtils.getDefaultScale("decimal")).to.equal(0);
    });

    test("fillColumnDefaults applies datatype-specific defaults", () => {
        const varcharCol = columnUtils.fillColumnDefaults(
            createColumn({ dataType: "varchar", maxLength: "", precision: 99, scale: 99 }),
        );
        expect(varcharCol.maxLength).to.equal("50");
        expect(varcharCol.precision).to.equal(0);
        expect(varcharCol.scale).to.equal(0);

        const decimalCol = columnUtils.fillColumnDefaults(
            createColumn({ dataType: "decimal", maxLength: "100" }),
        );
        expect(decimalCol.maxLength).to.equal("");
        expect(decimalCol.precision).to.equal(18);
        expect(decimalCol.scale).to.equal(0);

        const timeCol = columnUtils.fillColumnDefaults(createColumn({ dataType: "time" }));
        expect(timeCol.scale).to.equal(0);
    });

    test("getAdvancedOptions exposes expected options and modifiers mutate fields", () => {
        const column = createColumn({ dataType: "int", isNullable: false, isPrimaryKey: false });
        const options = columnUtils.getAdvancedOptions(column);

        const allowNullOption = options.find((o) => o.columnProperty === "isNullable");
        expect(allowNullOption).to.exist;
        if (allowNullOption) {
            const updated = allowNullOption.columnModifier(
                createColumn({ isNullable: false }),
                true,
            );
            expect(updated.isNullable).to.equal(true);
        }

        const isIdentityOption = options.find((o) => o.columnProperty === "isIdentity");
        expect(isIdentityOption).to.exist;
        if (isIdentityOption) {
            const updated = isIdentityOption.columnModifier(
                createColumn({ isIdentity: false }),
                true,
            );
            expect(updated.isIdentity).to.equal(true);
            expect(updated.identitySeed).to.equal(1);
            expect(updated.identityIncrement).to.equal(1);
        }

        const isComputedOption = options.find((o) => o.columnProperty === "isComputed");
        expect(isComputedOption).to.exist;
        if (isComputedOption) {
            const updated = isComputedOption.columnModifier(
                createColumn({ isPrimaryKey: true, isIdentity: true, isNullable: false }),
                true,
            );
            expect(updated.isComputed).to.equal(true);
            expect(updated.isPrimaryKey).to.equal(false);
            expect(updated.isIdentity).to.equal(false);
            expect(updated.isNullable).to.equal(true);
            expect(updated.computedFormula).to.equal("1");
        }

        const computedOptions = columnUtils.getAdvancedOptions(
            createColumn({ isComputed: true, dataType: "int" }),
        );
        expect(computedOptions.some((o) => o.columnProperty === "computedFormula")).to.equal(true);
        expect(computedOptions.some((o) => o.columnProperty === "computedPersisted")).to.equal(
            true,
        );
    });
});
