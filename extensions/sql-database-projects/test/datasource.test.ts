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

    // TODO: Test skipped because dataSources.load() has parsing logic commented out for version "0.0.0"
    test.skip("Should read DataSources from datasource.json", async function (): Promise<void> {
        const dataSourcePath = await testUtils.createTestDataSources(
            this.test,
            baselines.openDataSourcesBaseline,
        );
        const dataSourceList = await dataSources.load(dataSourcePath);

        expect(dataSourceList.length).to.equal(3);

        expect(dataSourceList[0].name).to.equal("Test Data Source 1");
        expect(dataSourceList[0].type).to.equal(sql.SqlConnectionDataSource.type);
        expect((dataSourceList[0] as sql.SqlConnectionDataSource).database).to.equal("testDb");

        expect(dataSourceList[1].name).to.equal("My Other Data Source");
        expect((dataSourceList[1] as sql.SqlConnectionDataSource).integratedSecurity).to.equal(
            false,
        );

        expect(dataSourceList[2].name).to.equal("AAD Interactive Data Source");
        expect((dataSourceList[2] as sql.SqlConnectionDataSource).integratedSecurity).to.equal(
            false,
        );
        expect((dataSourceList[2] as sql.SqlConnectionDataSource).azureMFA).to.equal(true);
    });

    test("Should be able to create sql data source from connection strings with and without ending semicolon", function (): void {
        expect(
            () =>
                new sql.SqlConnectionDataSource(
                    "no ending semicolon",
                    "Data Source=(LOCAL);Initial Catalog=testdb;User id=sa;Password=PLACEHOLDER",
                ),
        ).to.not.throw();
        expect(
            () =>
                new sql.SqlConnectionDataSource(
                    "ending in semicolon",
                    "Data Source=(LOCAL);Initial Catalog=testdb;User id=sa;Password=PLACEHOLDER;",
                ),
        ).to.not.throw();
        expect(
            () =>
                new sql.SqlConnectionDataSource(
                    "invalid extra equals sign",
                    "Data Source=(LOCAL);Initial Catalog=testdb=extra;User id=sa;Password=PLACEHOLDER",
                ),
        ).to.throw();
    });
});
