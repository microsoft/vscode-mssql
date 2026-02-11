/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as baselines from "./baselines/baselines";
import * as testUtils from "./testUtils";
import * as sql from "../src/models/dataSources/sqlConnectionStringSource";
import * as dataSources from "../src/models/dataSources/dataSources";

suite("Data Sources: DataSource operations", function (): void {
    suiteSetup(async function (): Promise<void> {
        await baselines.loadBaselines();
    });

    suiteTeardown(async function (): Promise<void> {
        await testUtils.deleteGeneratedTestFolder();
    });

    test.skip("Should read DataSources from datasource.json", async function (): Promise<void> {
        const dataSourcePath = await testUtils.createTestDataSources(
            this.test,
            baselines.openDataSourcesBaseline,
        );
        const dataSourceList = await dataSources.load(dataSourcePath);

        expect(dataSourceList.length, "Data source list should have 3 entries").to.equal(3);

        expect(dataSourceList[0].name, "First data source name should match").to.equal(
            "Test Data Source 1",
        );
        expect(
            dataSourceList[0].type,
            "First data source type should be SqlConnectionDataSource",
        ).to.equal(sql.SqlConnectionDataSource.type);
        expect(
            (dataSourceList[0] as sql.SqlConnectionDataSource).database,
            "First data source database should be testDb",
        ).to.equal("testDb");

        expect(dataSourceList[1].name, "Second data source name should match").to.equal(
            "My Other Data Source",
        );
        expect(
            (dataSourceList[1] as sql.SqlConnectionDataSource).integratedSecurity,
            "Second data source integratedSecurity should be false",
        ).to.equal(false);

        expect(dataSourceList[2].name, "Third data source name should match").to.equal(
            "AAD Interactive Data Source",
        );
        expect(
            (dataSourceList[2] as sql.SqlConnectionDataSource).integratedSecurity,
            "Third data source integratedSecurity should be false",
        ).to.equal(false);
        expect(
            (dataSourceList[2] as sql.SqlConnectionDataSource).azureMFA,
            "Third data source azureMFA should be true",
        ).to.equal(true);
    });

    test("Should be able to create sql data source from connection strings with and without ending semicolon", function (): void {
        expect(
            () =>
                new sql.SqlConnectionDataSource(
                    "no ending semicolon",
                    "Data Source=(LOCAL);Initial Catalog=testdb;User id=sa;Password=PLACEHOLDER",
                ),
            "Connection string without ending semicolon should not throw",
        ).to.not.throw();
        expect(
            () =>
                new sql.SqlConnectionDataSource(
                    "ending in semicolon",
                    "Data Source=(LOCAL);Initial Catalog=testdb;User id=sa;Password=PLACEHOLDER;",
                ),
            "Connection string ending in semicolon should not throw",
        ).to.not.throw();
        expect(
            () =>
                new sql.SqlConnectionDataSource(
                    "invalid extra equals sign",
                    "Data Source=(LOCAL);Initial Catalog=testdb=extra;User id=sa;Password=PLACEHOLDER",
                ),
            "Connection string with invalid extra equals sign should throw",
        ).to.throw();
    });
});
