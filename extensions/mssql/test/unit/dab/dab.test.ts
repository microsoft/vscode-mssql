/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { Dab } from "../../../src/sharedInterfaces/dab";
import { SchemaDesigner } from "../../../src/sharedInterfaces/schemaDesigner";

function createColumn(overrides?: Partial<SchemaDesigner.Column>): SchemaDesigner.Column {
    return {
        id: "col-1",
        name: "Id",
        dataType: "int",
        maxLength: "4",
        precision: 10,
        scale: 0,
        isPrimaryKey: true,
        isIdentity: false,
        identitySeed: 0,
        identityIncrement: 0,
        isNullable: false,
        defaultValue: "",
        isComputed: false,
        computedFormula: "",
        computedPersisted: false,
        ...overrides,
    };
}

function createTable(overrides?: Partial<SchemaDesigner.Table>): SchemaDesigner.Table {
    return {
        id: "table-1",
        name: "Users",
        schema: "dbo",
        columns: [createColumn()],
        foreignKeys: [],
        ...overrides,
    };
}

suite("Dab.validateTableForDab", () => {
    test("should return isSupported true for a table with a primary key and supported types", () => {
        const table = createTable({
            columns: [
                createColumn({ id: "col-1", name: "Id", dataType: "int", isPrimaryKey: true }),
                createColumn({
                    id: "col-2",
                    name: "Name",
                    dataType: "nvarchar",
                    isPrimaryKey: false,
                }),
            ],
        });

        const result = Dab.validateTableForDab(table);

        expect(result.isSupported).to.be.true;
        expect(result.reasons).to.be.undefined;
    });

    test("should return isSupported false when table has no primary key", () => {
        const table = createTable({
            columns: [
                createColumn({
                    id: "col-1",
                    name: "Name",
                    dataType: "nvarchar",
                    isPrimaryKey: false,
                }),
            ],
        });

        const result = Dab.validateTableForDab(table);

        expect(result.isSupported).to.be.false;
        expect(result.reasons).to.have.lengthOf(1);
        expect(result.reasons![0]).to.deep.equal({ type: "noPrimaryKey" });
    });

    test("should return isSupported false when table has unsupported data types", () => {
        const table = createTable({
            columns: [
                createColumn({ id: "col-1", name: "Id", dataType: "int", isPrimaryKey: true }),
                createColumn({
                    id: "col-2",
                    name: "Location",
                    dataType: "sys.geography",
                    isPrimaryKey: false,
                }),
            ],
        });

        const result = Dab.validateTableForDab(table);

        expect(result.isSupported).to.be.false;
        expect(result.reasons).to.have.lengthOf(1);
        expect(result.reasons![0]).to.deep.equal({
            type: "unsupportedDataTypes",
            columns: "Location (sys.geography)",
        });
    });

    test("should return both reasons when table has no primary key and unsupported types", () => {
        const table = createTable({
            columns: [
                createColumn({
                    id: "col-1",
                    name: "Data",
                    dataType: "xml",
                    isPrimaryKey: false,
                }),
            ],
        });

        const result = Dab.validateTableForDab(table);

        expect(result.isSupported).to.be.false;
        expect(result.reasons).to.have.lengthOf(2);
        expect(result.reasons![0]).to.deep.equal({ type: "noPrimaryKey" });
        expect(result.reasons![1]).to.deep.equal({
            type: "unsupportedDataTypes",
            columns: "Data (xml)",
        });
    });

    test("should return noPrimaryKey for a table with empty columns", () => {
        const table = createTable({ columns: [] });

        const result = Dab.validateTableForDab(table);

        expect(result.isSupported).to.be.false;
        expect(result.reasons).to.have.lengthOf(1);
        expect(result.reasons![0]).to.deep.equal({ type: "noPrimaryKey" });
    });

    test("should handle table with undefined columns defensively", () => {
        const table = createTable();
        // Force undefined to simulate missing data from STS backend
        (table as any).columns = undefined;

        const result = Dab.validateTableForDab(table);

        expect(result.isSupported).to.be.false;
        expect(result.reasons).to.have.lengthOf(1);
        expect(result.reasons![0]).to.deep.equal({ type: "noPrimaryKey" });
    });

    test("should detect multiple unsupported columns in a single reason", () => {
        const table = createTable({
            columns: [
                createColumn({ id: "col-1", name: "Id", dataType: "int", isPrimaryKey: true }),
                createColumn({
                    id: "col-2",
                    name: "Location",
                    dataType: "sys.geography",
                    isPrimaryKey: false,
                }),
                createColumn({
                    id: "col-3",
                    name: "Shape",
                    dataType: "sys.geometry",
                    isPrimaryKey: false,
                }),
            ],
        });

        const result = Dab.validateTableForDab(table);

        expect(result.isSupported).to.be.false;
        expect(result.reasons).to.have.lengthOf(1);
        expect(result.reasons![0]).to.deep.equal({
            type: "unsupportedDataTypes",
            columns: "Location (sys.geography), Shape (sys.geometry)",
        });
    });

    test("should match data types case-insensitively", () => {
        const table = createTable({
            columns: [
                createColumn({ id: "col-1", name: "Id", dataType: "int", isPrimaryKey: true }),
                createColumn({
                    id: "col-2",
                    name: "Data",
                    dataType: "XML",
                    isPrimaryKey: false,
                }),
            ],
        });

        const result = Dab.validateTableForDab(table);

        expect(result.isSupported).to.be.false;
        expect(result.reasons).to.have.lengthOf(1);
        expect(result.reasons![0].type).to.equal("unsupportedDataTypes");
    });

    suite("should detect each unsupported data type", () => {
        for (const dataType of Dab.DAB_UNSUPPORTED_DATA_TYPES) {
            test(`should detect ${dataType} as unsupported`, () => {
                const table = createTable({
                    columns: [
                        createColumn({
                            id: "col-1",
                            name: "Id",
                            dataType: "int",
                            isPrimaryKey: true,
                        }),
                        createColumn({
                            id: "col-2",
                            name: "TestCol",
                            dataType,
                            isPrimaryKey: false,
                        }),
                    ],
                });

                const result = Dab.validateTableForDab(table);

                expect(result.isSupported).to.be.false;
                expect(result.reasons).to.have.lengthOf(1);
                expect(result.reasons![0]).to.deep.equal({
                    type: "unsupportedDataTypes",
                    columns: `TestCol (${dataType})`,
                });
            });
        }
    });

    test("should skip columns with undefined dataType", () => {
        const table = createTable({
            columns: [
                createColumn({ id: "col-1", name: "Id", dataType: "int", isPrimaryKey: true }),
                createColumn({ id: "col-2", name: "Unknown", isPrimaryKey: false }),
            ],
        });
        // Force undefined dataType to simulate missing data
        (table.columns[1] as any).dataType = undefined;

        const result = Dab.validateTableForDab(table);

        expect(result.isSupported).to.be.true;
        expect(result.reasons).to.be.undefined;
    });
});
