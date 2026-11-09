/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import { DabMetadataService } from "../../../src/dab/dabMetadataService";
import SqlToolsServiceClient from "../../../src/languageservice/serviceclient";

chai.use(sinonChai);

suite("DAB Metadata Service Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let dabMetadataService: DabMetadataService;

    const ownerUri = "dab-owner-uri";
    const cell = (displayValue: string, isNull = false) => ({ displayValue, isNull });

    setup(() => {
        sandbox = sinon.createSandbox();
        mockClient = sandbox.createStubInstance(SqlToolsServiceClient);

        dabMetadataService = new DabMetadataService(mockClient);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("should list DAB views using simple execute", async () => {
        mockClient.sendRequest.callsFake(async (_type: any, _params: any) => ({
            rows: [
                [cell("dbo"), cell("ActiveUsers"), cell("view:dbo.ActiveUsers")],
                [cell("sales"), cell("OpenOrders"), cell("view:sales.OpenOrders")],
            ],
        }));

        const result = await dabMetadataService.listDabViews(ownerUri);

        expect(result).to.deep.equal([
            { schema: "dbo", name: "ActiveUsers", id: "view:dbo.ActiveUsers" },
            { schema: "sales", name: "OpenOrders", id: "view:sales.OpenOrders" },
        ]);
        expect(mockClient.sendRequest).to.have.been.calledWithMatch(
            sinon.match.any,
            sinon.match.has(
                "queryString",
                sinon.match((queryString: unknown) => String(queryString).includes("sys.views")),
            ),
        );
    });

    test("should add NOLOCK hints to DAB metadata queries when requested", async () => {
        const sentQueries: string[] = [];
        mockClient.sendRequest.callsFake(async (_type: any, params: any) => {
            sentQueries.push(params.queryString);
            return { rows: [] };
        });

        const options = { useNoLock: true };
        await dabMetadataService.listDabViews(ownerUri, undefined, options);
        await dabMetadataService.listDabStoredProcedures(ownerUri, undefined, options);
        await dabMetadataService.getDabViewColumnsByView(ownerUri, undefined, options);
        await dabMetadataService.getDabViewColumns(
            ownerUri,
            "dbo",
            "ActiveUsers",
            undefined,
            options,
        );
        await dabMetadataService.getDabStoredProcedureParametersByProcedure(
            ownerUri,
            undefined,
            options,
        );
        await dabMetadataService.getDabStoredProcedureParameters(
            ownerUri,
            "dbo",
            "GetUsers",
            undefined,
            options,
        );
        await dabMetadataService.getDabViewSourceKeysByView(ownerUri, undefined, options);
        await dabMetadataService.getDabStoredProcedureResultColumnsByProcedure(
            ownerUri,
            undefined,
            options,
        );

        expect(sentQueries).to.have.length(8);
        expect(sentQueries.every((query) => query.includes("WITH (NOLOCK)"))).to.be.true;
    });

    test("should omit NOLOCK hints from DAB metadata queries when not supported", async () => {
        let sentQuery = "";
        mockClient.sendRequest.callsFake(async (_type: any, params: any) => {
            sentQuery = params.queryString;
            return { rows: [] };
        });

        await dabMetadataService.listDabViews(ownerUri, undefined, { useNoLock: false });

        expect(sentQuery).to.not.include("WITH (NOLOCK)");
    });

    test("should run DAB metadata queries in the requested database context", async () => {
        mockClient.sendRequest.callsFake(async (_type: any, _params: any) => ({
            rows: [],
        }));

        await dabMetadataService.listDabViews(ownerUri, "Sales DB");

        expect(mockClient.sendRequest).to.have.been.calledWithMatch(
            sinon.match.any,
            sinon.match.has(
                "queryString",
                sinon.match((queryString: unknown) =>
                    String(queryString).includes("USE [Sales DB];"),
                ),
            ),
        );
    });

    test("should escape closing brackets in DAB database context", async () => {
        mockClient.sendRequest.callsFake(async (_type: any, _params: any) => ({
            rows: [],
        }));

        await dabMetadataService.listDabViews(ownerUri, "Sales]DB");

        expect(mockClient.sendRequest).to.have.been.calledWithMatch(
            sinon.match.any,
            sinon.match.has(
                "queryString",
                sinon.match((queryString: unknown) =>
                    String(queryString).includes("USE [Sales]]DB];"),
                ),
            ),
        );
    });

    test("should list DAB stored procedures using simple execute", async () => {
        mockClient.sendRequest.callsFake(async (_type: any, _params: any) => ({
            rows: [[cell("dbo"), cell("GetUsers"), cell("stored-procedure:dbo.GetUsers")]],
        }));

        const result = await dabMetadataService.listDabStoredProcedures(ownerUri);

        expect(result).to.deep.equal([
            { schema: "dbo", name: "GetUsers", id: "stored-procedure:dbo.GetUsers" },
        ]);
        expect(mockClient.sendRequest).to.have.been.calledWithMatch(
            sinon.match.any,
            sinon.match.has(
                "queryString",
                sinon.match((queryString: unknown) =>
                    String(queryString).includes("sys.procedures"),
                ),
            ),
        );
    });

    test("should parse DAB view columns and inferred keys", async () => {
        mockClient.sendRequest.callsFake(async (_type: any, _params: any) => ({
            rows: [
                [cell("view:dbo.ActiveUsers:Id"), cell("Id"), cell("int"), cell("1"), cell("1")],
                [
                    cell("view:dbo.ActiveUsers:Name"),
                    cell("Name"),
                    cell("nvarchar"),
                    cell("2"),
                    cell("0"),
                ],
            ],
        }));

        const result = await dabMetadataService.getDabViewColumns(ownerUri, "dbo", "ActiveUsers");

        expect(result).to.deep.equal([
            {
                id: "view:dbo.ActiveUsers:Id",
                name: "Id",
                dataType: "int",
                ordinal: 1,
                isPrimaryKey: true,
            },
            {
                id: "view:dbo.ActiveUsers:Name",
                name: "Name",
                dataType: "nvarchar",
                ordinal: 2,
                isPrimaryKey: false,
            },
        ]);
    });

    test("should skip DAB view columns with invalid ordinals", async () => {
        mockClient.sendRequest.callsFake(async (_type: any, _params: any) => ({
            rows: [
                [cell("view:dbo.ActiveUsers:Id"), cell("Id"), cell("int"), cell("1"), cell("1")],
                [
                    cell("view:dbo.ActiveUsers:Name"),
                    cell("Name"),
                    cell("nvarchar"),
                    cell("not-a-number"),
                    cell("0"),
                ],
                [
                    cell("view:dbo.ActiveUsers:Status"),
                    cell("Status"),
                    cell("nvarchar"),
                    cell("0"),
                    cell("0"),
                ],
            ],
        }));

        const result = await dabMetadataService.getDabViewColumns(ownerUri, "dbo", "ActiveUsers");

        expect(result).to.deep.equal([
            {
                id: "view:dbo.ActiveUsers:Id",
                name: "Id",
                dataType: "int",
                ordinal: 1,
                isPrimaryKey: true,
            },
        ]);
    });

    test("should group DAB view columns by object and skip malformed rows", async () => {
        mockClient.sendRequest.callsFake(async (_type: any, _params: any) => ({
            rows: [
                [
                    cell("view:dbo.ActiveUsers"),
                    cell("view:dbo.ActiveUsers:Id"),
                    cell("Id"),
                    cell("int"),
                    cell("1"),
                    cell("true"),
                ],
                [
                    cell("view:dbo.ActiveUsers"),
                    cell("view:dbo.ActiveUsers:Name"),
                    cell("Name"),
                    cell("nvarchar"),
                    cell("2"),
                    cell("false"),
                ],
                [cell("view:dbo.Broken"), cell("", true), cell("Name"), cell("int")],
                [
                    cell("view:dbo.ActiveUsers"),
                    cell("view:dbo.ActiveUsers:Broken"),
                    cell("Broken"),
                    cell("int"),
                    cell("bad-ordinal"),
                    cell("false"),
                ],
            ],
        }));

        const result = await dabMetadataService.getDabViewColumnsByView(ownerUri);

        expect([...result.keys()]).to.deep.equal(["view:dbo.ActiveUsers"]);
        expect(result.get("view:dbo.ActiveUsers")).to.deep.equal([
            {
                id: "view:dbo.ActiveUsers:Id",
                name: "Id",
                dataType: "int",
                ordinal: 1,
                isPrimaryKey: true,
            },
            {
                id: "view:dbo.ActiveUsers:Name",
                name: "Name",
                dataType: "nvarchar",
                ordinal: 2,
                isPrimaryKey: false,
            },
        ]);
    });

    test("should parse stored procedure parameters", async () => {
        mockClient.sendRequest.callsFake(async (_type: any, _params: any) => ({
            rows: [
                [cell("@userId"), cell("int"), cell("1")],
                [cell("@includeInactive"), cell("bit"), cell("2")],
            ],
        }));

        const result = await dabMetadataService.getDabStoredProcedureParameters(
            ownerUri,
            "dbo",
            "GetUsers",
        );

        expect(result).to.deep.equal([
            { name: "@userId", dataType: "int", ordinal: 1 },
            { name: "@includeInactive", dataType: "bit", ordinal: 2 },
        ]);
    });

    test("should skip stored procedure parameters with invalid ordinals", async () => {
        mockClient.sendRequest.callsFake(async (_type: any, _params: any) => ({
            rows: [
                [cell("@userId"), cell("int"), cell("1")],
                [cell("@invalid"), cell("bit"), cell("not-a-number")],
                [cell("@zero"), cell("bit"), cell("0")],
            ],
        }));

        const result = await dabMetadataService.getDabStoredProcedureParameters(
            ownerUri,
            "dbo",
            "GetUsers",
        );

        expect(result).to.deep.equal([{ name: "@userId", dataType: "int", ordinal: 1 }]);
    });

    test("should group stored procedure parameters by procedure and skip malformed rows", async () => {
        mockClient.sendRequest.callsFake(async (_type: any, _params: any) => ({
            rows: [
                [cell("stored-procedure:dbo.GetUsers"), cell("@userId"), cell("int"), cell("1")],
                [
                    cell("stored-procedure:dbo.GetUsers"),
                    cell("@includeInactive"),
                    cell("bit"),
                    cell("2"),
                ],
                [cell("stored-procedure:dbo.Broken"), cell("", true), cell("int"), cell("1")],
                [
                    cell("stored-procedure:dbo.GetUsers"),
                    cell("@invalid"),
                    cell("int"),
                    cell("bad-ordinal"),
                ],
            ],
        }));

        const result =
            await dabMetadataService.getDabStoredProcedureParametersByProcedure(ownerUri);

        expect([...result.keys()]).to.deep.equal(["stored-procedure:dbo.GetUsers"]);
        expect(result.get("stored-procedure:dbo.GetUsers")).to.deep.equal([
            { name: "@userId", dataType: "int", ordinal: 1 },
            { name: "@includeInactive", dataType: "bit", ordinal: 2 },
        ]);
    });

    test("should report table-valued parameters as table type", async () => {
        const sentQueries: string[] = [];
        mockClient.sendRequest.callsFake(async (_type: any, params: any) => {
            sentQueries.push(params.queryString);
            return { rows: [] };
        });

        await dabMetadataService.getDabStoredProcedureParametersByProcedure(ownerUri);
        await dabMetadataService.getDabStoredProcedureParameters(ownerUri, "dbo", "GetUsers");

        expect(sentQueries).to.have.length(2);
        for (const query of sentQueries) {
            expect(query).to.include("t.is_table_type = 1 THEN N'table type'");
        }
    });

    test("should trace view keys to base table keys with browse information", async () => {
        let sentQuery = "";
        const sourceKey = (view: string, name: string, isHidden: boolean, table: string) => [
            cell(view),
            cell(name),
            cell(isHidden ? "1" : "0"),
            cell(table),
        ];
        mockClient.sendRequest.callsFake(async (_type: any, params: any) => {
            sentQuery = params.queryString;
            return {
                rows: [
                    // Every key is shown: the combined key identifies each row.
                    sourceKey("view:dbo.OrderLines", "OrderId", false, "Db.dbo.OrderLines"),
                    sourceKey("view:dbo.OrderLines", "LineNumber", false, "Db.dbo.OrderLines"),
                    sourceKey("view:dbo.OrderLines", "ProductId", false, "Db.dbo.Products"),
                    // Customers key is hidden, so only the Orders key is used.
                    sourceKey("view:dbo.OrderSummary", "OrderKey", false, "Db.dbo.Orders"),
                    sourceKey("view:dbo.OrderSummary", "CustomerId", true, "Db.dbo.Customers"),
                    // Part of a composite key is hidden, so the visible part is not a key.
                    sourceKey("view:dbo.LineNames", "OrderId", false, "Db.dbo.OrderLines"),
                    sourceKey("view:dbo.LineNames", "LineNumber", true, "Db.dbo.OrderLines"),
                    [cell("view:dbo.Broken"), cell("", true), cell("0"), cell("Db.dbo.T")],
                ],
            };
        });

        const result = await dabMetadataService.getDabViewSourceKeysByView(ownerUri);

        expect(sentQuery).to.include("sys.dm_exec_describe_first_result_set(");
        expect(sentQuery).to.include("r.is_part_of_unique_key = 1");
        expect([...result.entries()]).to.deep.equal([
            ["view:dbo.OrderLines", ["OrderId", "LineNumber", "ProductId"]],
            ["view:dbo.OrderSummary", ["OrderKey"]],
        ]);
    });

    test("should group stored procedure result columns and keep unnamed columns", async () => {
        let sentQuery = "";
        mockClient.sendRequest.callsFake(async (_type: any, params: any) => {
            sentQuery = params.queryString;
            return {
                rows: [
                    [cell("stored-procedure:dbo.GetUsers"), cell("Id"), cell("int"), cell("1")],
                    [cell("stored-procedure:dbo.GetUsers"), cell("", true), cell("int"), cell("2")],
                    [
                        cell("stored-procedure:dbo.GetUsers"),
                        cell("Broken"),
                        cell("int"),
                        cell("bad-ordinal"),
                    ],
                ],
            };
        });

        const result =
            await dabMetadataService.getDabStoredProcedureResultColumnsByProcedure(ownerUri);

        expect(sentQuery).to.include("sys.dm_exec_describe_first_result_set_for_object");
        expect(result.get("stored-procedure:dbo.GetUsers")).to.deep.equal([
            { name: "Id", dataType: "int", ordinal: 1 },
            { dataType: "int", ordinal: 2 },
        ]);
    });
});
