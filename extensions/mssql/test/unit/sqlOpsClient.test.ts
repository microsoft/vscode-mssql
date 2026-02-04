/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as fs from "fs/promises";
import { ServerProvider } from "@microsoft/ads-service-downloader";
import { SqlOpsDataClient } from "../../src/sqlOps/clientInterfaces";
import { SqlOpsClient } from "../../src/sqlOps/sqlOpsClient";
import * as Loc from "../../src/constants/locConstants";

suite("SqlOpsClient", () => {
    let sandbox: sinon.SinonSandbox;
    let mockOutputChannel: vscode.OutputChannel;
    let client: SqlOpsClient;
    let mockContext: vscode.ExtensionContext;

    setup(() => {
        sandbox = sinon.createSandbox();

        mockOutputChannel = {
            append: sandbox.stub(),
            appendLine: sandbox.stub(),
            clear: sandbox.stub(),
            show: sandbox.stub(),
            hide: sandbox.stub(),
        } as unknown as vscode.OutputChannel;

        client = new SqlOpsClient(mockOutputChannel);

        mockContext = {
            extensionPath: "/mock/extension",
            subscriptions: [],
            logUri: { fsPath: "/mock/log" } as vscode.Uri,
        } as unknown as vscode.ExtensionContext;
    });

    teardown(() => {
        sandbox.restore();
    });

    test("should call downloadBinaries and start client successfully", async () => {
        // stub fs.readFile
        sandbox
            .stub(fs, "readFile")
            .resolves(Buffer.from(JSON.stringify({ installDirectory: "bin" })));

        // stub ServerProvider.getOrDownloadServer
        const mockServerPath = "/mock/bin/server.exe";
        const serverProviderStub = sandbox
            .stub(ServerProvider.prototype, "getOrDownloadServer")
            .resolves(mockServerPath);

        // stub SqlOpsDataClient
        const startStub = sandbox
            .stub(SqlOpsDataClient.prototype, "start")
            .returns({ dispose: () => {} });
        const onReadyStub = sandbox.stub(SqlOpsDataClient.prototype, "onReady").resolves();
        const registerFeaturesStub = sandbox.stub(SqlOpsDataClient.prototype, "registerFeatures");

        const result = await client.startFlatFileService(mockContext);

        expect(result).to.be.instanceOf(SqlOpsDataClient);
        expect(serverProviderStub.calledOnce).to.be.true;
        expect(startStub.calledOnce).to.be.true;
        expect(registerFeaturesStub.calledOnce).to.be.true;
        expect(onReadyStub.calledOnce).to.be.true;
    });

    test("should handle downloadBinaries failure gracefully", async () => {
        sandbox
            .stub(fs, "readFile")
            .resolves(Buffer.from(JSON.stringify({ installDirectory: "bin" })));
        sandbox.stub(ServerProvider.prototype, "getOrDownloadServer").rejects(new Error("Failed"));

        const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage");

        const result = await client.startFlatFileService(mockContext);

        expect(result).to.be.undefined;
        expect(showErrorStub.calledOnce).to.be.true;
    });

    test("should generate correct server options", () => {
        const serverPath = "/mock/bin/server.exe";
        const spyConfig = sandbox.stub(vscode.workspace, "getConfiguration").returns({
            ["configLogDebugInfo"]: true,
        } as any);

        const method = (client as any).generateServerOptions.bind(client);
        const opts = method(serverPath, mockContext);

        expect(opts.command).to.equal(serverPath);
        expect(opts.args).to.include("--log-dir");
        expect(opts.args).to.include("/mock/log");
        expect(opts.transport).to.exist;
        expect(spyConfig.calledWith("mssql")).to.be.true;
    });

    test("generateHandleServerProviderEvent triggers correct outputChannel and statusView behavior", () => {
        const handler = (client as any).generateHandleServerProviderEvent();

        // INSTALL_START
        handler("install_start", "path/to/service");
        expect(
            (mockOutputChannel.appendLine as sinon.SinonStub).calledOnceWith(
                "Installing SQLOpsService...",
            ),
        );

        // INSTALL_END
        handler("install_end");

        expect(
            (mockOutputChannel.appendLine as sinon.SinonStub).calledWithMatch(
                Loc.SqlOps.serviceInstalled("SQLOpsService"),
            ),
        ).to.be.true;

        // DOWNLOAD_START
        handler("download_start", null, 2048); // size argument
        expect(
            (mockOutputChannel.appendLine as sinon.SinonStub).calledWithMatch(
                Loc.SqlOps.downloadingService("SQLOpsService"),
            ),
        ).to.be.true;
        expect(mockOutputChannel.appendLine as sinon.SinonStub).called;

        // DOWNLOAD_END
        handler("download_end");
        expect(
            (mockOutputChannel.appendLine as sinon.SinonStub).calledWithMatch(
                Loc.SqlOps.downloadComplete("SQLOpsService"),
            ),
        ).to.be.true;
        // ENTRY_EXTRACTED
        handler("entry_extracted", "entry.zip", "/dest/path", "entryName");
        expect(mockOutputChannel.appendLine as sinon.SinonStub).called;

        // LOG_EMITTED (simulate warning)
        handler("log_emitted", 3, "This is a warning message");
        expect(
            (mockOutputChannel.appendLine as sinon.SinonStub).calledWithMatch(
                /This is a warning message/,
            ),
        ).to.be.true;
        // LOG_EMITTED (simulate info, should not append)
        (mockOutputChannel.appendLine as sinon.SinonStub).resetHistory();
        handler("log_emitted", 1, "This is info message");
        expect((mockOutputChannel.appendLine as sinon.SinonStub).called).to.be.false;
    });
});
