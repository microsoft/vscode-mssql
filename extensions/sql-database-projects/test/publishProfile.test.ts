/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import should = require("should/as-function");
import * as vscode from "vscode";
import * as sinon from "sinon";
import * as TypeMoq from "typemoq";
import * as baselines from "./baselines/baselines";
import * as testUtils from "./testUtils";
import * as constants from "../src/common/constants";
import { TestContext, createContext, mockDacFxOptionsResult } from "./testContext";
import { load, readPublishProfile } from "../src/models/publishProfile/publishProfile";

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
        testContext.dacFxService
            .setup((x) => x.getOptionsFromProfile(TypeMoq.It.isAny()))
            .returns(async () => {
                return Promise.resolve(mockDacFxOptionsResult);
            });

        const result = await load(vscode.Uri.file(profilePath), testContext.dacFxService.object);
        should(result.databaseName).equal("targetDb");
        should(result.sqlCmdVariables.size).equal(1);
        should(result.sqlCmdVariables.get("ProdDatabaseName")).equal("MyProdDatabase");
        should(result.options).equal(mockDacFxOptionsResult.deploymentOptions);
    });

    test("Should read database name, SQL login connection string, and SQLCMD variables from publish profile", async function (): Promise<void> {
        await baselines.loadBaselines();
        const profilePath = await testUtils.createTestFile(
            this.test,
            baselines.publishProfileSqlLoginBaseline,
            "publishProfile.publish.xml",
        );
        testContext.dacFxService
            .setup((x) => x.getOptionsFromProfile(TypeMoq.It.isAny()))
            .returns(async () => {
                return Promise.resolve(mockDacFxOptionsResult);
            });

        const result = await load(vscode.Uri.file(profilePath), testContext.dacFxService.object);
        should(result.databaseName).equal("targetDb");
        should(result.sqlCmdVariables.size).equal(1);
        should(result.sqlCmdVariables.get("ProdDatabaseName")).equal("MyProdDatabase");
        should(result.options).equal(mockDacFxOptionsResult.deploymentOptions);
    });

    test("Should read SQLCMD variables correctly from publish profile even if DefaultValue is used", async function (): Promise<void> {
        await baselines.loadBaselines();
        const profilePath = await testUtils.createTestFile(
            this.test,
            baselines.publishProfileDefaultValueBaseline,
            "publishProfile.publish.xml",
        );
        testContext.dacFxService
            .setup((x) => x.getOptionsFromProfile(TypeMoq.It.isAny()))
            .returns(async () => {
                return Promise.resolve(mockDacFxOptionsResult);
            });

        const result = await load(vscode.Uri.file(profilePath), testContext.dacFxService.object);
        should(result.sqlCmdVariables.size).equal(1);

        // the profile has both Value and DefaultValue, but Value should be the one used
        should(result.sqlCmdVariables.get("ProdDatabaseName")).equal("MyProdDatabase");
    });

    test.skip("Should throw error when connecting does not work", async function (): Promise<void> {
        // Skip: This test requires azdata.connection API which is not available in VS Code
        await baselines.loadBaselines();
        const profilePath = await testUtils.createTestFile(
            this.test,
            baselines.publishProfileIntegratedSecurityBaseline,
            "publishProfile.publish.xml",
        );

        await testUtils.shouldThrowSpecificError(
            async () => await readPublishProfile(vscode.Uri.file(profilePath)),
            constants.unableToCreatePublishConnection("Could not connect"),
        );
    });
});
