/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import * as sinon from "sinon";
import * as baselines from "./baselines/baselines";
import * as testUtils from "./testUtils";
import * as utils from "../src/common/utils";
import { TestContext, createContext, mockDacFxOptionsResult } from "./testContext";
import { load, readPublishProfile } from "../src/models/publishProfile/publishProfile";

chai.use(sinonChai);

let testContext: TestContext;

suite("Publish profile tests", function (): void {
    suiteSetup(async function (): Promise<void> {
        await baselines.loadBaselines();
    });

    setup(function (): void {
        testContext = createContext();
    });

    teardown(function (): void {
        sinon.restore();
    });

    suiteTeardown(async function (): Promise<void> {
        await testUtils.deleteGeneratedTestFolder();
    });

    test("Should read database name, integrated security connection string, and SQLCMD variables from publish profile", async function (): Promise<void> {
        await baselines.loadBaselines();
        const profilePath = await testUtils.createTestFile(
            this.test,
            baselines.publishProfileIntegratedSecurityBaseline,
            "publishProfile.publish.xml",
        );

        const result = await load(vscode.Uri.file(profilePath), testContext.dacFxService);
        expect(result.databaseName, "Database name should be targetDb").to.equal("targetDb");
        expect(result.sqlCmdVariables.size, "Should have 1 SQLCMD variable").to.equal(1);
        expect(
            result.sqlCmdVariables.get("ProdDatabaseName"),
            "ProdDatabaseName should be MyProdDatabase",
        ).to.equal("MyProdDatabase");
        expect(result.connection, "Connection should contain server and default user").to.equal(
            "testserver (default)",
        );
        expect(result.options, "Options should match deployment options").to.deep.equal(
            mockDacFxOptionsResult.deploymentOptions,
        );
    });

    test("Should read database name, SQL login connection string, and SQLCMD variables from publish profile", async function (): Promise<void> {
        await baselines.loadBaselines();
        const profilePath = await testUtils.createTestFile(
            this.test,
            baselines.publishProfileSqlLoginBaseline,
            "publishProfile.publish.xml",
        );

        const result = await load(vscode.Uri.file(profilePath), testContext.dacFxService);
        expect(result.databaseName, "Database name should be targetDb").to.equal("targetDb");
        expect(result.sqlCmdVariables.size, "Should have 1 SQLCMD variable").to.equal(1);
        expect(
            result.sqlCmdVariables.get("ProdDatabaseName"),
            "ProdDatabaseName should be MyProdDatabase",
        ).to.equal("MyProdDatabase");
        expect(result.options, "Options should match deployment options").to.deep.equal(
            mockDacFxOptionsResult.deploymentOptions,
        );
    });

    test("Should read SQLCMD variables correctly from publish profile even if DefaultValue is used", async function (): Promise<void> {
        await baselines.loadBaselines();
        const profilePath = await testUtils.createTestFile(
            this.test,
            baselines.publishProfileDefaultValueBaseline,
            "publishProfile.publish.xml",
        );

        const result = await load(vscode.Uri.file(profilePath), testContext.dacFxService);
        expect(result.sqlCmdVariables.size, "Should have 1 SQLCMD variable").to.equal(1);

        // the profile has both Value and DefaultValue, but Value should be the one used
        expect(
            result.sqlCmdVariables.get("ProdDatabaseName"),
            "ProdDatabaseName should use Value, not DefaultValue",
        ).to.equal("MyProdDatabase");
    });

    test("Should throw error when getDacFxService fails", async function (): Promise<void> {
        await baselines.loadBaselines();
        const profilePath = await testUtils.createTestFile(
            this.test,
            baselines.publishProfileIntegratedSecurityBaseline,
            "publishProfile.publish.xml",
        );

        // Stub getDacFxService to throw an error simulating service unavailability
        sinon.stub(utils, "getDacFxService").rejects(new Error("Service unavailable"));

        let threwError = false;
        try {
            await readPublishProfile(vscode.Uri.file(profilePath));
        } catch (err) {
            threwError = true;
            expect(err.message, "Error message should indicate service failure").to.equal(
                "Service unavailable",
            );
        }
        expect(threwError, "readPublishProfile should have thrown an error").to.be.true;
    });
});
