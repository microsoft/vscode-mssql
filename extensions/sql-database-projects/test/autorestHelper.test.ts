/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import * as testUtils from "./testUtils";
import * as utils from "../src/common/utils";
import * as path from "path";
import { TestContext, createContext } from "./testContext";
import { AutorestHelper } from "../src/tools/autorestHelper";
import { promises as fs } from "fs";
import { window } from "vscode";
import { runViaNpx } from "../src/common/constants";

chai.use(sinonChai);

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
        expect(
            executable === "autorest" || executable === "npx autorest",
            "autorest command should be found in default path during unit tests",
        ).to.equal(true);
    });

    test.skip("Should run an autorest command successfully", async function (): Promise<void> {
        sinon.stub(window, "showInformationMessage").returns(<any>Promise.resolve(runViaNpx)); // stub a selection in case test runner doesn't have autorest installed

        const autorestHelper = new AutorestHelper(testContext.outputChannel);
        const dummyFile = path.join(
            await testUtils.generateTestFolderPath(this.test),
            "testoutput.log",
        );
        sinon
            .stub(autorestHelper, "constructAutorestCommand")
            .returns(`${await autorestHelper.detectInstallation()} --version > ${dummyFile}`);

        try {
            await autorestHelper.generateAutorestFiles("fakespec.yaml", "fakePath");
            const text = (await fs.readFile(dummyFile)).toString().trim();
            const expected = "AutoRest code generation utility";
            expect(
                text.includes(expected),
                `Substring not found.  Expected "${expected}" in "${text}"`,
            ).to.equal(true);
        } finally {
            if (await utils.exists(dummyFile)) {
                await fs.unlink(dummyFile);
            }
        }
    });

    test("Should construct a correct autorest command for project generation", async function (): Promise<void> {
        const autorestHelper = new AutorestHelper(testContext.outputChannel);
        sinon.stub(window, "showInformationMessage").returns(<any>Promise.resolve(runViaNpx)); // stub a selection in case test runner doesn't have autorest installed
        sinon.stub(autorestHelper, "detectInstallation").returns(Promise.resolve("autorest"));

        const expectedOutput =
            'autorest --use:autorest-sql-testing@latest --input-file="/some/path/test.yaml" --output-folder="/some/output/path" --clear-output-folder --verbose';

        const constructedCommand = autorestHelper.constructAutorestCommand(
            (await autorestHelper.detectInstallation())!,
            "/some/path/test.yaml",
            "/some/output/path",
        );

        // depending on whether the machine running the test has autorest installed or just node, the expected output may differ by just the prefix, hence matching against two options
        expect(
            constructedCommand === expectedOutput,
            `Constructed autorest command not formatting as expected:\nActual:\n\t${constructedCommand}\nExpected:\n\t${expectedOutput}`,
        ).to.equal(true);
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

        expect(
            promptStub,
            "User should have been prompted for how to run autorest because it wasn't found.",
        ).to.have.been.calledOnce;
    });
});
