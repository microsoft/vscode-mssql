/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { FileBrowserService } from "../../src/services/fileBrowserService";
import {
    FileBrowserCloseRequest,
    FileBrowserExpandRequest,
    FileBrowserExpandResponse,
    FileBrowserOpenRequest,
    FileBrowserOpenResponse,
    FileTree,
} from "../../src/sharedInterfaces/fileBrowser";
import { Deferred } from "../../src/protocol";
import { FileBrowserCloseResponse } from "azdata";

suite("FileBrowserService Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let fileBrowserService: FileBrowserService;
    let sqlToolsClientStub: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let vscodeWrapperStub: sinon.SinonStubbedInstance<VscodeWrapper>;
    let loggerErrorStub: sinon.SinonStub;
    let mockFileTree: FileTree;

    setup(() => {
        sandbox = sinon.createSandbox();
        sqlToolsClientStub = sandbox.createStubInstance(SqlToolsServiceClient);
        vscodeWrapperStub = sandbox.createStubInstance(VscodeWrapper);

        mockFileTree = {
            rootNode: {
                fullPath: "/",
                isExpanded: false,
                children: [
                    {
                        fullPath: "/folder",
                        isExpanded: false,
                        children: [],
                        isFile: false,
                        name: "folder",
                    },
                ],
                isFile: false,
                name: "/",
            },
            selectedNode: undefined,
        };

        // Stub logger - use defineProperty since logger is a getter
        loggerErrorStub = sandbox.stub();
        Object.defineProperty(sqlToolsClientStub, "logger", {
            get: () => ({ error: loggerErrorStub }),
        });

        fileBrowserService = new FileBrowserService(vscodeWrapperStub, sqlToolsClientStub);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("handleFileBrowserOpenNotification", async () => {
        let ownerUri = "conn";
        let deferred = new Deferred<FileBrowserOpenResponse>();

        fileBrowserService["_pendingFileBrowserOpens"].set(ownerUri, deferred);

        const response: FileBrowserOpenResponse = {
            ownerUri,
            succeeded: true,
            message: "Opened",
            fileTree: mockFileTree,
        };
        fileBrowserService.handleFileBrowserOpenNotification(response);

        const result = await deferred;
        expect(result).to.deep.equal(response);

        ownerUri = "nonexistent";
        const errorResponse: FileBrowserOpenResponse = {
            ownerUri /* plus other required props */,
        } as any;

        // Stub the logger
        const loggerStub = sinon.stub(fileBrowserService["_logger"], "error");

        // Ensure no promise is set for this ownerUri
        fileBrowserService["_pendingFileBrowserOpens"].delete(ownerUri);

        // Call the method
        fileBrowserService.handleFileBrowserOpenNotification(errorResponse);

        // Verify that logger.error was called
        expect(loggerStub.calledOnce).to.be.true;
        expect(loggerStub.firstCall.args[0]).to.include(ownerUri);

        // Restore stub
        loggerStub.restore();
    });

    test("handleFileBrowserExpandNotification", async () => {
        let ownerUri = "conn";
        let deferred = new Deferred<FileBrowserExpandResponse>();

        fileBrowserService["_pendingFileBrowserExpands"].set(ownerUri, deferred);

        const response: FileBrowserExpandResponse = {
            ownerUri,
            succeeded: true,
            message: "Opened",
            expandPath: "/folder",
            children: [
                {
                    fullPath: "/folder/file.txt",
                    isFile: true,
                    name: "file.txt",
                    isExpanded: false,
                    children: [],
                },
            ],
        };
        fileBrowserService.handleFileBrowserExpandNotification(response);

        const result = await deferred;
        expect(result).to.deep.equal(response);

        ownerUri = "nonexistent";
        const errorResponse: FileBrowserExpandResponse = {
            ownerUri /* plus other required props */,
        } as any;

        // Stub the logger
        const loggerStub = sinon.stub(fileBrowserService["_logger"], "error");

        // Ensure no promise is set for this ownerUri
        fileBrowserService["_pendingFileBrowserExpands"].delete(ownerUri);

        // Call the method
        fileBrowserService.handleFileBrowserExpandNotification(errorResponse);

        // Verify that logger.error was called
        expect(loggerStub.calledOnce).to.be.true;
        expect(loggerStub.firstCall.args[0]).to.include(ownerUri);

        // Restore stub
        loggerStub.restore();
    });

    test("openFileBrowser should handle successful open", async () => {
        sqlToolsClientStub.sendRequest
            .withArgs(FileBrowserOpenRequest.type, sinon.match.any)
            .resolves(true);

        // Setup successful session creation result
        const successResult: FileBrowserOpenResponse = {
            ownerUri: "test-owner-uri",
            succeeded: true,
            message: "opened successfully",
            fileTree: mockFileTree,
        };
        // Call the method
        const resultPromise = fileBrowserService.openFileBrowser(
            "test-connection-uri",
            "/",
            [],
            false,
        );

        // Wait a bit for the promise to be set up
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Get the deferred object and resolve it
        const pendingOpen = (fileBrowserService as any)._pendingFileBrowserOpens.get(
            "test-connection-uri",
        );
        expect(pendingOpen, "Pending open should exist").to.exist;
        pendingOpen.resolve(successResult);
        // Wait for the result
        const result = await resultPromise;

        // Verify the result
        expect(result, "Result should match success response").to.equal(successResult);
    });

    test("openFileBrowser should handle failed file browser open", async () => {
        sqlToolsClientStub.sendRequest
            .withArgs(FileBrowserOpenRequest.type, sinon.match.any)
            .resolves(true);

        const failureResult: FileBrowserOpenResponse = {
            ownerUri: "test-owner-uri",
            succeeded: false,
            message: "Failed to open file browser",
            fileTree: undefined,
        };

        const resultPromise = fileBrowserService.openFileBrowser(
            "test-connection-uri",
            "/",
            [],
            false,
        );

        await new Promise((resolve) => setTimeout(resolve, 10));

        const pendingOpen = (fileBrowserService as any)._pendingFileBrowserOpens.get(
            "test-connection-uri",
        );
        expect(pendingOpen).to.exist;
        pendingOpen.resolve(failureResult);

        const result = await resultPromise;

        expect(result).to.deep.equal({
            ownerUri: "test-owner-uri",
            fileTree: undefined,
            succeeded: false,
            message: "Failed to open file browser",
        });
    });

    test("openFileBrowser should return undefined when sendRequest returns undefined", async () => {
        sqlToolsClientStub.sendRequest
            .withArgs(FileBrowserOpenRequest.type, sinon.match.any)
            .resolves(undefined);

        const result = await fileBrowserService.openFileBrowser(
            "test-connection-uri",
            "/",
            [],
            false,
        );

        expect(result).to.be.undefined;
    });

    test("expandFilePath should handle successful expand", async () => {
        sqlToolsClientStub.sendRequest
            .withArgs(FileBrowserExpandRequest.type, sinon.match.any)
            .resolves(true);

        fileBrowserService.fileBrowserState = {
            ownerUri: "test-owner-uri",
            fileTree: mockFileTree,
            fileFilters: [],
            showFoldersOnly: false,
            selectedPath: "/",
        };

        // Setup successful session creation result
        const successResult: FileBrowserExpandResponse = {
            ownerUri: "test-owner-uri",
            succeeded: true,
            message: "expanded successfully",
            expandPath: "/folder",
            children: [
                {
                    fullPath: "/file.txt",
                    isFile: true,
                    name: "file.txt",
                    isExpanded: false,
                    children: [],
                },
            ],
        };
        // Call the method
        const resultPromise = fileBrowserService.expandFilePath("test-connection-uri", "/folder");

        // Wait a bit for the promise to be set up
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Get the deferred object and resolve it
        const pendingExpand = (fileBrowserService as any)._pendingFileBrowserExpands.get(
            "test-connection-uri",
        );
        expect(pendingExpand, "Pending expand should exist").to.exist;
        pendingExpand.resolve(successResult);
        // Wait for the result
        const result = await resultPromise;

        // Verify the result
        expect(result, "Result should match success response").to.equal(successResult);

        expect(
            fileBrowserService.fileBrowserState.fileTree.rootNode.children[0].children,
            "Node children should be updated",
        ).to.deep.equal(successResult.children);
    });

    test("expandFilePath should handle failed file browser expand", async () => {
        sqlToolsClientStub.sendRequest
            .withArgs(FileBrowserExpandRequest.type, sinon.match.any)
            .resolves(true);

        const failureResult: FileBrowserExpandResponse = {
            ownerUri: "test-connection-uri",
            succeeded: false,
            message: "Failed to open file browser",
            expandPath: "/folder",
            children: undefined,
        };

        const resultPromise = fileBrowserService.expandFilePath("test-connection-uri", "/folder");

        await new Promise((resolve) => setTimeout(resolve, 10));

        const pendingExpand = (fileBrowserService as any)._pendingFileBrowserExpands.get(
            "test-connection-uri",
        );
        expect(pendingExpand).to.exist;
        pendingExpand.resolve(failureResult);
        const result = await resultPromise;

        expect(result.children).to.equal(failureResult.children);
        expect(result.ownerUri).to.equal(failureResult.ownerUri);
        expect(result.succeeded).to.equal(failureResult.succeeded);
        expect(result.message).to.equal(failureResult.message);
        expect(result.expandPath).to.equal(failureResult.expandPath);
    });

    test("expandFilePath should return undefined when sendRequest returns undefined", async () => {
        sqlToolsClientStub.sendRequest
            .withArgs(FileBrowserExpandRequest.type, sinon.match.any)
            .resolves(undefined);

        const result = await fileBrowserService.expandFilePath("test-connection-uri", "/folder");

        expect(result).to.be.undefined;
    });

    test("closeFileBrowser", async () => {
        let ownerUri = "conn";

        const response: FileBrowserCloseResponse = {
            succeeded: true,
            message: "Close",
        };
        sqlToolsClientStub.sendRequest
            .withArgs(FileBrowserCloseRequest.type, sinon.match.any)
            .resolves(response);

        let result = await fileBrowserService.closeFileBrowser(ownerUri);

        expect(result).to.deep.equal(response);
        expect(fileBrowserService.fileBrowserState).to.be.undefined;

        // Stub the logger
        const loggerStub = sinon.stub(fileBrowserService["_logger"], "error");
        sqlToolsClientStub.sendRequest
            .withArgs(FileBrowserCloseRequest.type, sinon.match.any)
            .rejects(new Error("Close failed"));
        // Call the method

        try {
            await fileBrowserService.closeFileBrowser(ownerUri);
        } catch (e) {
            expect(e.message).to.equal("Close failed");
        }

        // Restore stub
        loggerStub.restore();
    });
});
