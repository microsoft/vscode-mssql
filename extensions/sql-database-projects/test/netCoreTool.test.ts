/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as sinon from "sinon";
import axios from "axios";
import {
    NetCoreTool,
    DBProjectConfigurationKey,
    DotnetInstallLocationKey,
    FALLBACK_MICROSOFT_BUILD_SQL_VERSION,
    getMicrosoftBuildSqlVersion,
    resolveNugetVersion,
} from "../src/tools/netcoreTool";
import { deleteGeneratedTestFolder, generateTestFolderPath } from "./testUtils";
import { createContext, TestContext } from "./testContext";
import * as constants from "../src/common/constants";

let testContext: TestContext;
let sandbox: sinon.SinonSandbox;

suite("NetCoreTool: Net core tests", function (): void {
    teardown(function (): void {
        sandbox.restore();
    });

    setup(function (): void {
        testContext = createContext();
        sandbox = sinon.createSandbox();
    });

    suiteTeardown(async function (): Promise<void> {
        await deleteGeneratedTestFolder();
    });

    test("Should override dotnet default value with settings", async function (): Promise<void> {
        try {
            // update settings and validate
            await vscode.workspace
                .getConfiguration(DBProjectConfigurationKey)
                .update(DotnetInstallLocationKey, "test value path", true);
            const netcoreTool = new NetCoreTool(testContext.outputChannel);
            sandbox.stub(netcoreTool, "showInstallDialog").returns(Promise.resolve());
            expect(netcoreTool.netcoreInstallLocation).to.equal("test value path"); // the path in settings should be taken
            expect(await netcoreTool.findOrInstallNetCore()).to.equal(false); // dotnet can not be present at dummy path in settings
        } finally {
            // clean again
            await vscode.workspace
                .getConfiguration(DBProjectConfigurationKey)
                .update(DotnetInstallLocationKey, "", true);
        }
    });

    test("Should find right dotnet default paths", async function (): Promise<void> {
        const netcoreTool = new NetCoreTool(testContext.outputChannel);
        sandbox.stub(netcoreTool, "showInstallDialog").returns(Promise.resolve());
        await netcoreTool.findOrInstallNetCore();

        if (os.platform() === "win32") {
            // check that path should start with c:\program files
            let result =
                !netcoreTool.netcoreInstallLocation ||
                netcoreTool.netcoreInstallLocation.toLowerCase().startsWith("c:\\program files");
            expect(result, "dotnet not present in programfiles by default").to.be.true;
        }

        if (os.platform() === "linux") {
            //check that path should start with /usr/share
            let result =
                !netcoreTool.netcoreInstallLocation ||
                netcoreTool.netcoreInstallLocation.toLowerCase() === "/usr/share/dotnet";
            expect(result, "dotnet not present in /usr/share").to.be.true;
        }

        if (os.platform() === "darwin") {
            //check that path should start with /usr/local/share
            let result =
                !netcoreTool.netcoreInstallLocation ||
                netcoreTool.netcoreInstallLocation.toLowerCase() === "/usr/local/share/dotnet";
            expect(result, "dotnet not present in /usr/local/share").to.be.true;
        }
    });

    test("should run a command successfully", async function (): Promise<void> {
        const netcoreTool = new NetCoreTool(testContext.outputChannel);
        const dummyFile = path.join(await generateTestFolderPath(this.test), "dummy.dacpac");

        try {
            await netcoreTool.runStreamedCommand(
                process.execPath,
                ["-e", `require("fs").writeFileSync(${JSON.stringify(dummyFile)}, "test")`],
                undefined,
            );
            const text = await fs.promises.readFile(dummyFile);
            expect(text.toString().trim()).to.equal("test");
        } finally {
            try {
                await fs.promises.unlink(dummyFile);
            } catch {
                console.warn(`Failed to clean up ${dummyFile}`);
            }
        }
    });

    suite("getMicrosoftBuildSqlVersion tests", function (): void {
        teardown(async function (): Promise<void> {
            // Clean up configuration after each test
            await vscode.workspace
                .getConfiguration(DBProjectConfigurationKey)
                .update(
                    constants.microsoftBuildSqlVersionKey,
                    undefined,
                    vscode.ConfigurationTarget.Global,
                );
        });

        test("Should return valid configured value when set", async function (): Promise<void> {
            // Arrange: Set a valid semver version
            await vscode.workspace
                .getConfiguration(DBProjectConfigurationKey)
                .update(
                    constants.microsoftBuildSqlVersionKey,
                    "3.0.0",
                    vscode.ConfigurationTarget.Global,
                );

            // Act
            const result = getMicrosoftBuildSqlVersion();

            // Assert
            expect(result).to.equal("3.0.0");
        });

        test("Should fall back to FALLBACK_MICROSOFT_BUILD_SQL_VERSION when configured value is invalid or empty", async function (): Promise<void> {
            // Test with invalid semver
            await vscode.workspace
                .getConfiguration(DBProjectConfigurationKey)
                .update(
                    constants.microsoftBuildSqlVersionKey,
                    "not-a-valid-version",
                    vscode.ConfigurationTarget.Global,
                );
            let result = getMicrosoftBuildSqlVersion();
            expect(result).to.equal(FALLBACK_MICROSOFT_BUILD_SQL_VERSION);

            // Test with empty config
            await vscode.workspace
                .getConfiguration(DBProjectConfigurationKey)
                .update(
                    constants.microsoftBuildSqlVersionKey,
                    undefined,
                    vscode.ConfigurationTarget.Global,
                );
            result = getMicrosoftBuildSqlVersion();
            expect(result).to.equal(FALLBACK_MICROSOFT_BUILD_SQL_VERSION);
        });
    });

    suite("resolveNugetVersion tests", function (): void {
        let axiosGetStub: sinon.SinonStub;

        setup(function (): void {
            axiosGetStub = sandbox.stub(axios, "get");
        });

        function stubNugetResponse(versions: string[]): void {
            axiosGetStub.resolves({ status: 200, data: { versions } });
        }

        test("Should return exact version unchanged", async function (): Promise<void> {
            // No network call expected for exact versions
            const result = await resolveNugetVersion("Microsoft.Build.Sql", "2.1.0");
            expect(result).to.equal("2.1.0");
            expect(axiosGetStub.callCount).to.equal(0);
        });

        test("Should resolve floating version to latest matching stable", async function (): Promise<void> {
            stubNugetResponse(["2.0.0", "2.1.0", "2.1.1", "2.1.1-preview", "3.0.0"]);
            const result = await resolveNugetVersion("Microsoft.Build.Sql", "2.*");
            expect(result).to.equal("2.1.1");
        });

        test("Should resolve floating minor version to latest matching stable", async function (): Promise<void> {
            stubNugetResponse(["2.1.0", "2.1.1", "2.2.0"]);
            const result = await resolveNugetVersion("Microsoft.Build.Sql", "2.1.*");
            expect(result).to.equal("2.1.1");
        });

        test("Should fall back to FALLBACK version when no match found for requested version", async function (): Promise<void> {
            // First call returns no matching versions (for "4.*")
            // Second call (fallback to "2.*") returns matching versions
            let callCount = 0;
            axiosGetStub.callsFake(async () => {
                callCount++;
                const versions = callCount === 1 ? ["3.0.0"] : ["2.0.0", "2.1.0"];
                return { status: 200, data: { versions } };
            });
            const showWarnStub = sandbox.stub(vscode.window, "showWarningMessage");
            const result = await resolveNugetVersion("Microsoft.Build.Sql", "4.*");
            expect(result).to.equal("2.1.0");
            expect(showWarnStub.calledOnce).to.be.true;
        });

        test("Should throw when network error occurs and no fallback available", async function (): Promise<void> {
            axiosGetStub.rejects(new Error("network failure"));
            // Use FALLBACK version so no second fallback attempt
            try {
                await resolveNugetVersion(
                    "Microsoft.Build.Sql",
                    FALLBACK_MICROSOFT_BUILD_SQL_VERSION,
                );
                expect.fail("Should have thrown");
            } catch (e: unknown) {
                expect((e as Error).message).to.include("network failure");
            }
        });
    });
});
