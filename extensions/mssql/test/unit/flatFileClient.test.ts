/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { FlatFileClient } from "../../src/flatFile/flatFileClient";
import { LanguageClient } from "vscode-languageclient";
import { stubExtensionContext, stubVscodeWrapper } from "./utils";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import ServerProvider from "../../src/languageservice/server";
import { PlatformInformation } from "../../src/models/platform";
import * as path from "path";

suite("FlatFileClient", () => {
    let sandbox: sinon.SinonSandbox;
    let client: FlatFileClient;
    let mockContext: vscode.ExtensionContext;
    let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;

    setup(() => {
        sandbox = sinon.createSandbox();

        mockVscodeWrapper = stubVscodeWrapper(sandbox);

        client = new FlatFileClient(mockVscodeWrapper);

        mockContext = stubExtensionContext(sandbox);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("should call downloadBinaries and start client successfully", async () => {
        // stub PlatformInformation.getCurrent
        const mockPlatformInfo = {
            runtimeId: "win-x64",
        } as unknown as PlatformInformation;
        sandbox.stub(PlatformInformation, "getCurrent").resolves(mockPlatformInfo);

        // stub ServerProvider methods
        const mockServerPath = "/mock/bin/server.exe";
        sandbox.stub(ServerProvider.prototype, "getServerPath").resolves(mockServerPath);

        // stub LanguageClient
        const startStub = sandbox
            .stub(LanguageClient.prototype, "start")
            .returns({ dispose: () => {} });
        const onReadyStub = sandbox.stub(LanguageClient.prototype, "onReady").resolves();
        const registerFeaturesStub = sandbox.stub(LanguageClient.prototype, "registerFeatures");

        const result = await client.startFlatFileService(mockContext);

        expect(result).to.be.instanceOf(LanguageClient);
        expect(startStub.calledOnce).to.be.true;
        expect(registerFeaturesStub.calledOnce).to.be.true;
        expect(onReadyStub.calledOnce).to.be.true;
    });

    test("should download server files when server path is undefined", async () => {
        // stub PlatformInformation.getCurrent
        const mockPlatformInfo = {
            runtimeId: "win-x64",
        } as unknown as PlatformInformation;
        sandbox.stub(PlatformInformation, "getCurrent").resolves(mockPlatformInfo);

        // stub ServerProvider methods
        const mockInstalledPath = "/mock/bin/installed/server.exe";
        sandbox.stub(ServerProvider.prototype, "getServerPath").resolves(undefined);
        const downloadStub = sandbox
            .stub(ServerProvider.prototype, "downloadServerFiles")
            .resolves(mockInstalledPath);

        // stub LanguageClient
        sandbox.stub(LanguageClient.prototype, "start").returns({ dispose: () => {} });
        sandbox.stub(LanguageClient.prototype, "onReady").resolves();
        sandbox.stub(LanguageClient.prototype, "registerFeatures");

        const result = await client.startFlatFileService(mockContext);

        expect(result).to.be.instanceOf(LanguageClient);
        expect(downloadStub.calledOnce).to.be.true;
    });

    test("should handle downloadBinaries failure gracefully", async () => {
        // stub PlatformInformation.getCurrent
        const mockPlatformInfo = {
            runtimeId: "win-x64",
        } as unknown as PlatformInformation;
        sandbox.stub(PlatformInformation, "getCurrent").resolves(mockPlatformInfo);

        sandbox.stub(ServerProvider.prototype, "getServerPath").rejects(new Error("Failed"));

        const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage");

        const result = await client.startFlatFileService(mockContext);

        expect(result).to.be.undefined;
        expect(showErrorStub.calledOnce).to.be.true;
    });

    test("should generate correct server options", () => {
        const serverPath = "/mock/bin/server.exe";
        const spyConfig = sandbox.stub(vscode.workspace, "getConfiguration").returns({
            configLogDebugInfo: true,
        } as any);

        const method = (client as any).generateServerOptions.bind(client);
        const opts = method(serverPath, mockContext);

        expect(opts.command).to.equal(serverPath);
        expect(opts.args).to.include("--log-dir");
        expect(opts.args).to.include(path.sep);
        expect(opts.transport).to.exist;
        expect(spyConfig.calledWith("mssql")).to.be.true;
    });
});
