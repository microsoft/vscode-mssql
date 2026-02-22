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
    DBProjectConfigurationKey,
    DotnetInstallLocationKey,
} from "../src/tools/netcoreTool";
import { getQuotedPath } from "../src/common/utils";
import { deleteGeneratedTestFolder, generateTestFolderPath } from "./testUtils";
import { createContext, TestContext } from "./testContext";

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
                "echo test > " + getQuotedPath(dummyFile),
                undefined,
            );
            const text = await fs.promises.readFile(dummyFile);
            expect(text.toString().trim()).to.equal("test");
        } finally {
            try {
                await fs.promises.unlink(dummyFile);
            } catch (err) {
                console.warn(`Failed to clean up ${dummyFile}`);
            }
        }
    });
});
