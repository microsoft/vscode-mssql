/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import * as childProcess from "child_process";
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
import { dotnetRuntimeExtensionId, extensionId } from "../../../src/constants/constants";
import { SqlProjects } from "../../../src/constants/locConstants";

chai.use(sinonChai);

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

    suite("SDK acquisition", () => {
        let executeCommand: sinon.SinonStub;
        let execFile: sinon.SinonStub;
        let getExtension: sinon.SinonStub;
        let tool: NetCoreTool;
        let configuredLocation: string | undefined;

        setup(() => {
            configuredLocation = undefined;
            sandbox.stub(vscode.workspace, "getConfiguration").returns({
                get: sandbox.stub().callsFake(() => configuredLocation),
                has: sandbox.stub(),
                inspect: sandbox.stub(),
                update: sandbox.stub().resolves(),
            });
            getExtension = sandbox.stub(vscode.extensions, "getExtension");
            getExtension.withArgs(dotnetRuntimeExtensionId).returns({
                id: dotnetRuntimeExtensionId,
                extensionUri: vscode.Uri.file("dotnet-runtime-extension"),
                extensionPath: "dotnet-runtime-extension",
                isActive: true,
                packageJSON: {},
                exports: undefined,
                extensionKind: vscode.ExtensionKind.Workspace,
                activate: sandbox.stub().resolves(),
            });
            executeCommand = sandbox.stub(vscode.commands, "executeCommand");
            execFile = sandbox
                .stub(childProcess, "execFile")
                .callsArgWith(3, Object.assign(new Error("not found"), { code: "ENOENT" }), "", "")
                .returns(new childProcess.ChildProcess());
            sandbox.stub(fs.promises, "access").resolves();
            tool = new NetCoreTool(testContext.outputChannel);
        });

        test("uses an SDK on PATH even without the acquisition extension", async () => {
            const executable = os.platform() === "win32" ? "dotnet.exe" : "dotnet";
            execFile.withArgs(executable).callsArgWith(3, undefined, "10.0.402 [sdk]\r\n", "");
            getExtension.withArgs(dotnetRuntimeExtensionId).returns(undefined);
            expect(await tool.acquireNetCoreSdk()).to.equal(executable);
            expect(getExtension).not.to.have.been.called;
            expect(executeCommand).not.to.have.been.called;
        });

        test("reuses a supported SDK without installing another", async () => {
            const executable = path.join("existing-sdk", "dotnet");
            executeCommand.withArgs("dotnet.findPath").resolves(executable);
            expect(await tool.acquireNetCoreSdk()).to.equal(executable);
            expect(executeCommand).to.have.been.calledWith("dotnet.findPath", {
                acquireContext: { version: "8.0", requestingExtensionId: extensionId, mode: "sdk" },
                versionSpecRequirement: "greater_than_or_equal",
                rejectPreviews: true,
            });
            expect(executeCommand).not.to.have.been.calledWith("dotnet.acquireGlobalSDK");
        });

        test("honors a configured supported SDK outside PATH", async () => {
            configuredLocation = path.join("custom", "sdk");
            const executable = path.join(
                configuredLocation,
                os.platform() === "win32" ? "dotnet.exe" : "dotnet",
            );
            execFile.withArgs(executable).callsArgWith(3, undefined, "8.0.412 [custom sdk]\n", "");
            expect(await tool.acquireNetCoreSdk()).to.equal(executable);
            expect(getExtension).not.to.have.been.called;
            expect(executeCommand).not.to.have.been.called;
        });

        for (const [description, installs] of [
            ["only a runtime is installed", ""],
            ["the SDK is too old", "7.0.410 [sdk]\n"],
        ] as const) {
            test(`acquires an SDK when ${description}`, async () => {
                configuredLocation = path.join("custom", "sdk");
                execFile.callsArgWith(3, undefined, installs, "");
                const executable = path.join("acquired-sdk", "dotnet");
                executeCommand
                    .withArgs("dotnet.acquireGlobalSDK")
                    .resolves({ dotnetPath: executable });
                expect(await tool.acquireNetCoreSdk()).to.equal(executable);
                expect(executeCommand).to.have.been.calledWith("dotnet.acquireGlobalSDK", {
                    version: "10.0",
                    requestingExtensionId: extensionId,
                    mode: "sdk",
                });
            });
        }

        test("acquires an SDK when .NET is completely absent", async () => {
            const executable = path.join("new-sdk", "dotnet");
            executeCommand.withArgs("dotnet.acquireGlobalSDK").resolves({ dotnetPath: executable });
            expect(await tool.acquireNetCoreSdk()).to.equal(executable);
        });

        test("reports an acquisition that does not return an executable", async () => {
            let failure: unknown;
            try {
                await tool.acquireNetCoreSdk();
            } catch (error) {
                failure = error;
            }
            expect(failure)
                .to.be.instanceOf(Error)
                .with.property("message", SqlProjects.DotnetSdkAcquisitionFailed);
        });

        test("propagates acquisition failures instead of starting a build", async () => {
            const failure = new Error("SDK download failed");
            executeCommand.withArgs("dotnet.acquireGlobalSDK").rejects(failure);
            let actual: unknown;
            try {
                await tool.acquireNetCoreSdk();
            } catch (error) {
                actual = error;
            }
            expect(actual).to.equal(failure);
        });

        test("does not mistake SDK inspection failures for a missing SDK", async () => {
            const failure = Object.assign(new Error("access denied"), { code: "EACCES" });
            execFile.callsArgWith(3, failure, "", "");
            let actual: unknown;
            try {
                await tool.acquireNetCoreSdk();
            } catch (error) {
                actual = error;
            }
            expect(actual).to.equal(failure);
            expect(executeCommand).not.to.have.been.called;
        });
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
