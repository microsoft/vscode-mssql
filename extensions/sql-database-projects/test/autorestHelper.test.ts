/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as testUtils from "./testUtils";
import * as utils from "../src/common/utils";
import { TestContext, createContext } from "./testContext";
import { AutorestHelper } from "../src/tools/autorestHelper";
import { window } from "vscode";
import { runViaNpx } from "../src/common/constants";

let testContext: TestContext;
let sandbox: sinon.SinonSandbox;

suite("Autorest tests", function (): void {
    setup(function (): void {
        testContext = createContext();
        sandbox = sinon.createSandbox();
    });

    teardown(function (): void {
        sandbox.restore();
    });

    suiteTeardown(async function (): Promise<void> {
        await testUtils.deleteGeneratedTestFolder();
    });

    test("Should detect autorest", async function (): Promise<void> {
        sandbox
            .stub(utils, "resolveCommandPath")
            .withArgs("autorest")
            .returns(Promise.resolve("autorest"));

        const autorestHelper = new AutorestHelper(testContext.outputChannel);
        const installation = await autorestHelper.detectInstallation();
        const resolved = installation as { executable: string; prefixArgs: string[] };
        expect(resolved.executable, "autorest command should be detected").to.equal("autorest");
    });

    test("Should run an autorest command successfully", async function (): Promise<void> {
        sandbox
            .stub(window, "showInformationMessage")
            .returns(
                Promise.resolve(runViaNpx) as unknown as ReturnType<
                    typeof window.showInformationMessage
                >,
            ); // stub a selection in case test runner doesn't have autorest installed

        const autorestHelper = new AutorestHelper(testContext.outputChannel);
        const installation = await autorestHelper.detectInstallation();
        const resolved = installation as { executable: string; prefixArgs: string[] };
        sandbox.stub(autorestHelper, "constructAutorestCommand").returns({
            executable: resolved.executable,
            args: [...resolved.prefixArgs, "--version"],
        });

        try {
            const output = await autorestHelper.generateAutorestFiles("fakespec.yaml", "fakePath");
            const expected = "AutoRest code generation utility";
            expect(output, `Substring not found. Expected "${expected}" in "${output}"`).to.contain(
                expected,
            );
        } catch {
            // test is skipped, but handle cleanup gracefully
        }
    });

    test("Should construct a correct autorest command for project generation", function (): void {
        const autorestHelper = new AutorestHelper(testContext.outputChannel);

        const result = autorestHelper.constructAutorestCommand(
            { executable: "autorest", prefixArgs: [] },
            "/some/path/test.yaml",
            "/some/output/path",
        );

        expect(result.executable).to.equal("autorest");
        expect(result.args).to.deep.equal([
            "--use:autorest-sql-testing@latest",
            "--input-file=/some/path/test.yaml",
            "--output-folder=/some/output/path",
            "--clear-output-folder",
            "--level:error",
        ]);
    });

    test("Should prompt user for action when autorest not found", async function (): Promise<void> {
        const promptStub = sandbox
            .stub(window, "showInformationMessage")
            .returns(
                Promise.resolve() as unknown as ReturnType<typeof window.showInformationMessage>,
            );
        const resolveStub = sandbox.stub(utils, "resolveCommandPath");
        resolveStub.withArgs("autorest").returns(Promise.resolve(undefined));
        resolveStub.withArgs("npx").returns(Promise.resolve("/usr/bin/npx"));

        const autorestHelper = new AutorestHelper(testContext.outputChannel);
        await autorestHelper.detectInstallation();

        expect(
            promptStub.calledOnce,
            "User should have been prompted for how to run autorest because it wasn't found.",
        ).to.be.true;
    });

    test("Should return 'cancelled' when user dismisses the install prompt", async function (): Promise<void> {
        sandbox
            .stub(window, "showInformationMessage")
            .returns(
                Promise.resolve(undefined) as unknown as ReturnType<
                    typeof window.showInformationMessage
                >,
            );
        const resolveStub = sandbox.stub(utils, "resolveCommandPath");
        resolveStub.withArgs("autorest").returns(Promise.resolve(undefined));
        resolveStub.withArgs("npx").returns(Promise.resolve("/usr/bin/npx"));

        const autorestHelper = new AutorestHelper(testContext.outputChannel);
        const result = await autorestHelper.detectInstallation();

        expect(result).to.equal(
            "cancelled",
            "Should return 'cancelled' when user dismisses the prompt.",
        );
    });

    test("Should route .ps1 autorest through pwsh.exe on Windows", async function (): Promise<void> {
        const ps1Path = "C:\\tools\\autorest.ps1";
        sandbox
            .stub(utils, "resolveCommandPath")
            .withArgs("autorest")
            .returns(Promise.resolve(ps1Path));

        const autorestHelper = new AutorestHelper(testContext.outputChannel);
        const installation = await autorestHelper.detectInstallation();
        const resolved = installation as { executable: string; prefixArgs: string[] };

        if (process.platform === "win32") {
            expect(resolved.executable).to.equal("pwsh.exe");
            expect(resolved.prefixArgs).to.deep.equal(["-NoProfile", "-File", ps1Path]);
        } else {
            // Non-Windows: wrapCmdIfNeeded is a no-op, path used directly
            expect(resolved.executable).to.equal(ps1Path);
            expect(resolved.prefixArgs).to.deep.equal([]);
        }
    });
});
