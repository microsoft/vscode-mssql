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
import {
    NetCoreTool,
    DotnetInstallLocationKey,
    FALLBACK_MICROSOFT_BUILD_SQL_VERSION,
    getMicrosoftBuildSqlVersion,
} from "../../../src/databaseProjects/tools/netcoreTool";
import { deleteGeneratedTestFolder, generateTestFolderPath } from "./testUtils";
import { createContext, TestContext } from "./testContext";
import * as constants from "../../../src/databaseProjects/common/constants";

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
        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            [DotnetInstallLocationKey]: "test value path",
            get: (key: string) =>
                key === DotnetInstallLocationKey ? "test value path" : undefined,
        } as unknown as vscode.WorkspaceConfiguration);
        const netcoreTool = new NetCoreTool(testContext.outputChannel);
        sandbox.stub(netcoreTool, "showInstallDialog").returns(Promise.resolve());
        expect(netcoreTool.netcoreInstallLocation).to.equal("test value path");
        expect(await netcoreTool.findOrInstallNetCore()).to.equal(false);
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
        test("Should return valid configured value when set", async function (): Promise<void> {
            sandbox.stub(vscode.workspace, "getConfiguration").returns({
                [constants.microsoftBuildSqlVersionKey]: "3.0.0",
                get: () => "3.0.0",
            } as unknown as vscode.WorkspaceConfiguration);

            // Act
            const result = getMicrosoftBuildSqlVersion();

            // Assert
            expect(result).to.equal("3.0.0");
        });

        test("Should fall back to FALLBACK_MICROSOFT_BUILD_SQL_VERSION when configured value is invalid or empty", async function (): Promise<void> {
            let configuredVersion: string | undefined = "not-a-valid-version";
            sandbox.stub(vscode.workspace, "getConfiguration").callsFake(
                () =>
                    ({
                        [constants.microsoftBuildSqlVersionKey]: configuredVersion,
                        get: () => configuredVersion,
                    }) as unknown as vscode.WorkspaceConfiguration,
            );
            let result = getMicrosoftBuildSqlVersion();
            expect(result).to.equal(FALLBACK_MICROSOFT_BUILD_SQL_VERSION);

            configuredVersion = undefined;
            result = getMicrosoftBuildSqlVersion();
            expect(result).to.equal(FALLBACK_MICROSOFT_BUILD_SQL_VERSION);
        });
    });
});
