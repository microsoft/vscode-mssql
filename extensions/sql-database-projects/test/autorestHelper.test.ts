/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import should = require("should/as-function");
import * as sinon from "sinon";
import * as testUtils from "./testUtils";
import * as utils from "../src/common/utils";
import { TestContext, createContext } from "./testContext";
import { AutorestHelper } from "../src/tools/autorestHelper";
import { window } from "vscode";
import { runViaNpx } from "../src/common/constants";

let testContext: TestContext;

suite("Autorest tests", function (): void {
    setup(function (): void {
        testContext = createContext();
    });

    teardown(function (): void {
        sinon.restore();
    });

    suiteTeardown(async function (): Promise<void> {
        await testUtils.deleteGeneratedTestFolder();
    });

    test("Should detect autorest", async function (): Promise<void> {
        sinon.stub(window, "showInformationMessage").returns(<any>Promise.resolve(runViaNpx)); // stub a selection in case test runner doesn't have autorest installed

        const autorestHelper = new AutorestHelper(testContext.outputChannel);
        const executable = await autorestHelper.detectInstallation();
        should(executable === "autorest" || executable === "npx autorest").equal(
            true,
            "autorest command should be found in default path during unit tests",
        );
    });

    test.skip("Should run an autorest command successfully", async function (): Promise<void> {
        sinon.stub(window, "showInformationMessage").returns(<any>Promise.resolve(runViaNpx)); // stub a selection in case test runner doesn't have autorest installed

        const autorestHelper = new AutorestHelper(testContext.outputChannel);
        const executable = await autorestHelper.detectInstallation();
        sinon.stub(autorestHelper, "constructAutorestCommand").returns({
            executable: executable!,
            args: ["--version"],
        });

        try {
            const output = await autorestHelper.generateAutorestFiles("fakespec.yaml", "fakePath");
            const expected = "AutoRest code generation utility";
            should(output !== undefined && output.includes(expected)).equal(
                true,
                `Substring not found.  Expected "${expected}" in "${output}"`,
            );
        } catch (err) {
            // test is skipped, but handle cleanup gracefully
        }
    });

    test("Should construct a correct autorest command for project generation", async function (): Promise<void> {
        const autorestHelper = new AutorestHelper(testContext.outputChannel);
        sinon.stub(window, "showInformationMessage").returns(<any>Promise.resolve(runViaNpx)); // stub a selection in case test runner doesn't have autorest installed
        sinon.stub(autorestHelper, "detectInstallation").returns(Promise.resolve("autorest"));

        const result = autorestHelper.constructAutorestCommand(
            (await autorestHelper.detectInstallation())!,
            "/some/path/test.yaml",
            "/some/output/path",
        );

        should(result.executable).equal("autorest");
        should(result.args).deepEqual([
            "--use:autorest-sql-testing@latest",
            "--input-file=/some/path/test.yaml",
            "--output-folder=/some/output/path",
            "--clear-output-folder",
            "--verbose",
        ]);
    });

    test("Should prompt user for action when autorest not found", async function (): Promise<void> {
        const promptStub = sinon
            .stub(window, "showInformationMessage")
            .returns(<any>Promise.resolve());
        const detectStub = sinon.stub(utils, "detectCommandInstallation");
        detectStub.withArgs("autorest").returns(Promise.resolve(false));
        detectStub.withArgs("npx").returns(Promise.resolve(true));

        const autorestHelper = new AutorestHelper(testContext.outputChannel);
        await autorestHelper.detectInstallation();

        should(promptStub.calledOnce).be.true(
            "User should have been prompted for how to run autorest because it wasn't found.",
        );
    });
});
