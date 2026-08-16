/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    analyzeSql: analyze,
    createMetadata: metadata,
    messages,
    table,
} = require("../../support/semanticHarness.js");

suite("T-SQL routine invocation diagnostics", () => {
    // A cursor or table-valued parameter is not converted: the supplied argument's declared type
    // has to be that exact type. A scalar parameter converts instead and is never reported here.
    test("validates non-scalar argument types", async () => {
        const procedure = {
            ref: { id: "load", database: "db" },
            database: "db",
            schema: "dbo",
            name: "LoadOrders",
            kind: "procedure",
        };
        const tableType = (id, name) => ({
            ref: { id, database: "db" },
            database: "db",
            schema: "dbo",
            name,
            kind: "type",
            typeCategory: "table",
        });
        const provider = metadata({
            objects: [
                procedure,
                tableType("orderList", "OrderList"),
                tableType("other", "OtherList"),
            ],
            parameters: new Map([
                [
                    "load",
                    [
                        { ordinal: 1, name: "@rows", typeDisplay: "dbo.OrderList" },
                        { ordinal: 2, name: "@count", typeDisplay: "int" },
                    ],
                ],
            ]),
        });

        const positionalSql = "DECLARE @wrong dbo.OtherList; EXEC dbo.LoadOrders @wrong, 1;";
        assert.deepEqual(
            (await analyze(positionalSql, provider))
                .filter(({ code }) => code === "OperandTypeClash")
                .map(({ code, message, range }) => ({
                    code,
                    message,
                    text: positionalSql.slice(range.start, range.end),
                })),
            [
                {
                    code: "OperandTypeClash",
                    message: "Operand type clash: OtherList is incompatible with OrderList",
                    text: "@wrong",
                },
            ],
        );
        // The matching type, and a scalar parameter given any variable, stay silent.
        assert.deepEqual(
            messages(
                await analyze(
                    "DECLARE @rows dbo.OrderList; EXEC dbo.LoadOrders @rows, 1;",
                    provider,
                ),
            ),
            [],
        );
        assert.deepEqual(
            messages(
                await analyze(
                    "DECLARE @rows dbo.OrderList, @n bigint; EXEC dbo.LoadOrders @rows, @n;",
                    provider,
                ),
            ),
            [],
        );
        // The named argument form reaches the same rule.
        assert.deepEqual(
            messages(
                await analyze(
                    "DECLARE @wrong dbo.OtherList; EXEC dbo.LoadOrders @rows = @wrong, @count = 1;",
                    provider,
                ),
            ),
            ["Operand type clash: OtherList is incompatible with OrderList"],
        );
        // An undeclared argument variable has no type to compare, so this rule stays silent and
        // only the undeclared-variable result remains.
        assert.deepEqual(messages(await analyze("EXEC dbo.LoadOrders @unknown, 1;", provider)), [
            'Must declare the scalar variable "@unknown".',
        ]);
    });

    // Authoritative routine metadata supplies required/defaulted parameter counts for scalar and
    // table-valued function calls without executing a metadata query during binding.
    test("validates catalog function arguments", async () => {
        const functionObject = {
            ref: { id: "price-function", database: "db" },
            database: "db",
            schema: "dbo",
            name: "Price",
            kind: "scalarFunction",
        };
        const provider = metadata({
            objects: [functionObject],
            parameters: new Map([
                [
                    "price-function",
                    [
                        {
                            ordinal: 1,
                            name: "@required",
                            typeDisplay: "int",
                            hasDefault: false,
                        },
                        {
                            ordinal: 2,
                            name: "@optional",
                            typeDisplay: "int",
                            hasDefault: true,
                        },
                    ],
                ],
            ]),
        });
        const diagnostics = await analyze(
            "SELECT dbo.Price(), dbo.Price(1), dbo.Price(1, 2, 3);",
            provider,
        );

        assert.deepEqual(
            diagnostics.map(({ code, message }) => ({ code, message })),
            [
                {
                    code: "InsufficientArguments",
                    message:
                        "An insufficient number of arguments were supplied for the procedure or function dbo.Price.",
                },
                {
                    code: "TooManyArguments",
                    message: "Procedure or function 'dbo.Price' has too many arguments specified.",
                },
            ],
        );
    });
    // Procedure metadata drives exact named-argument and arity diagnostics without a query round trip.
    test("validates procedure arguments from the pinned metadata view", async () => {
        const procedure = {
            ref: { id: "save", database: "db" },
            database: "db",
            schema: "dbo",
            name: "SaveCustomer",
            kind: "procedure",
        };
        const provider = metadata({
            objects: [procedure],
            parameters: new Map([
                [
                    "save",
                    [
                        { ordinal: 1, name: "@Id", typeDisplay: "int" },
                        { ordinal: 2, name: "@Name", typeDisplay: "nvarchar(50)", output: true },
                    ],
                ],
            ]),
        });
        const diagnostics = await analyze(
            "EXEC dbo.SaveCustomer @Bad = 1, @Id = 2, @Id = 3, @Name = N'x' OUTPUT, 9;",
            provider,
        );
        assert.ok(
            messages(diagnostics).includes(
                "@Bad is not a parameter for procedure dbo.SaveCustomer.",
            ),
        );
        assert.ok(messages(diagnostics).includes("Parameter '@Id' was supplied multiple times."));
        assert.ok(
            messages(diagnostics).includes(
                "Must pass parameter number 5 and subsequent parameters as '@name = value'. After the form '@name = value' has been used, all subsequent parameters must be passed in the form '@name = value'.",
            ),
        );
    });
    // OUTPUT can write only into a variable; applying it to a constant is rejected independently
    // of the procedure's own output-parameter declaration.
    test("rejects constant EXECUTE OUTPUT arguments", async () => {
        const procedure = {
            ref: { id: "output-procedure", database: "db" },
            database: "db",
            schema: "dbo",
            name: "OutputProcedure",
            kind: "procedure",
        };
        const diagnostics = await analyze(
            `DECLARE @result int;
EXEC dbo.OutputProcedure @value = @result OUTPUT;
EXEC dbo.OutputProcedure @value = 1 OUTPUT;`,
            metadata({
                objects: [procedure],
                parameters: new Map([
                    [
                        "output-procedure",
                        [{ ordinal: 1, name: "@value", typeDisplay: "int", output: true }],
                    ],
                ]),
            }),
        );

        assert.deepEqual(
            diagnostics.map(({ code, message }) => ({ code, message })),
            [
                {
                    code: "InvalidConstantOutput",
                    message:
                        "Cannot use the OUTPUT option when passing a constant to a stored procedure.",
                },
            ],
        );
    });
    // Missing-parameter diagnostics require authoritative default information. The same contract
    // works for catalog routines and procedures declared earlier in the document.
    test("reports required procedure parameters without treating defaults as required", async () => {
        const procedure = {
            ref: { id: "required-procedure", database: "db" },
            database: "db",
            schema: "dbo",
            name: "RequiredProcedure",
            kind: "procedure",
        };
        const diagnostics = await analyze(
            `EXEC dbo.RequiredProcedure @optional = 1;
GO
CREATE PROCEDURE dbo.LocalProcedure @required int, @optional int = 1 AS SELECT 1;
GO
EXEC dbo.LocalProcedure @optional = 1;`,
            metadata({
                objects: [procedure],
                parameters: new Map([
                    [
                        "required-procedure",
                        [
                            {
                                ordinal: 1,
                                name: "@required",
                                typeDisplay: "int",
                                hasDefault: false,
                            },
                            {
                                ordinal: 2,
                                name: "@optional",
                                typeDisplay: "int",
                                hasDefault: true,
                            },
                        ],
                    ],
                ]),
            }),
        );

        assert.deepEqual(
            diagnostics.map(({ code, message }) => ({ code, message })),
            [
                {
                    code: "MissingParameter",
                    message:
                        "Procedure or function 'dbo.RequiredProcedure' expects parameter '@required', which was not supplied.",
                },
                {
                    code: "MissingParameter",
                    message:
                        "Procedure or function 'dbo.LocalProcedure' expects parameter '@required', which was not supplied.",
                },
            ],
        );
    });
});
