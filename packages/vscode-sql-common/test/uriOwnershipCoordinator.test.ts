/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import * as vscode from "vscode";
import {
    UriOwnershipCoordinator,
    SET_CONTEXT_COMMAND,
    UriOwnershipConfig,
} from "../src/index";

describe("UriOwnershipCoordinator Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let fakeContext: vscode.ExtensionContext;
    let fakeConfig: UriOwnershipConfig;
    let executeCommandStub: sinon.SinonStub;
    let ownershipChangedEmitter: vscode.EventEmitter<void>;

    beforeEach(() => {
        sandbox = sinon.createSandbox();

        ownershipChangedEmitter = new vscode.EventEmitter<void>();

        fakeContext = {
            subscriptions: [],
            extension: {
                id: "ms-mssql.mssql",
            },
        } as unknown as vscode.ExtensionContext;

        // Mock config with callback captures
        fakeConfig = {
            hideUiContextKey: "mssql.hideUIElements",
            ownsUri: sandbox.stub().returns(false),
            onDidChangeOwnership: ownershipChangedEmitter.event,
            releaseUri: sandbox.stub(),
        };

        // Mock vscode.commands.executeCommand
        executeCommandStub = sandbox.stub(vscode.commands, "executeCommand").resolves();

        // Mock vscode.extensions.getExtension
        sandbox.stub(vscode.extensions, "getExtension").returns(undefined);

        // Mock vscode.extensions.all to return empty array (no coordinating extensions found)
        sandbox.stub(vscode.extensions, "all").value([]);

        // Mock vscode.extensions.onDidChange
        sandbox.stub(vscode.extensions, "onDidChange").returns({ dispose: () => {} });

        // Mock vscode.window.onDidChangeActiveTextEditor
        sandbox
            .stub(vscode.window, "onDidChangeActiveTextEditor")
            .returns({ dispose: () => {} });

        // Mock vscode.window.activeTextEditor as undefined initially
        sandbox.stub(vscode.window, "activeTextEditor").value(undefined);
    });

    afterEach(() => {
        sandbox.restore();
        ownershipChangedEmitter.dispose();
    });

    describe("Constructor", () => {
        it("should create uriOwnershipApi with ownsUri and onDidChangeUriOwnership", () => {
            const coordinator = new UriOwnershipCoordinator(fakeContext, fakeConfig);

            expect(coordinator.uriOwnershipApi).to.not.be.undefined;
            expect(coordinator.uriOwnershipApi.ownsUri).to.be.a("function");
            expect(coordinator.uriOwnershipApi.onDidChangeUriOwnership).to.not.be.undefined;
        });

        it("should register event emitters in context subscriptions", () => {
            const initialSubscriptionCount = fakeContext.subscriptions.length;
            new UriOwnershipCoordinator(fakeContext, fakeConfig);

            // Should add emitters + listeners
            expect(fakeContext.subscriptions.length).to.be.greaterThan(initialSubscriptionCount);
        });

        it("should set initial context to false when no active editor", () => {
            new UriOwnershipCoordinator(fakeContext, fakeConfig);

            sinon.assert.calledWith(
                executeCommandStub,
                SET_CONTEXT_COMMAND,
                "mssql.hideUIElements",
                false,
            );
        });
    });

    describe("uriOwnershipApi.ownsUri", () => {
        it("should delegate to config.ownsUri", () => {
            const coordinator = new UriOwnershipCoordinator(fakeContext, fakeConfig);
            const testUri = vscode.Uri.parse("file:///test.sql");

            (fakeConfig.ownsUri as sinon.SinonStub).returns(true);

            const result = coordinator.uriOwnershipApi.ownsUri(testUri);

            expect(result).to.be.true;
            sinon.assert.calledWith(
                fakeConfig.ownsUri as sinon.SinonStub,
                testUri.toString(true),
            );
        });

        it("should return false when config.ownsUri returns false", () => {
            const coordinator = new UriOwnershipCoordinator(fakeContext, fakeConfig);
            const testUri = vscode.Uri.parse("file:///test.sql");

            (fakeConfig.ownsUri as sinon.SinonStub).returns(false);

            const result = coordinator.uriOwnershipApi.ownsUri(testUri);

            expect(result).to.be.false;
        });
    });

    describe("isOwnedByCoordinatingExtension", () => {
        it("should return false when no coordinating extensions registered", () => {
            const coordinator = new UriOwnershipCoordinator(fakeContext, fakeConfig);
            const testUri = vscode.Uri.parse("file:///test.sql");

            const result = coordinator.isOwnedByCoordinatingExtension(testUri);

            expect(result).to.be.false;
        });
    });

    describe("getOwningCoordinatingExtension", () => {
        it("should return undefined when no coordinating extension owns URI", () => {
            const coordinator = new UriOwnershipCoordinator(fakeContext, fakeConfig);
            const testUri = vscode.Uri.parse("file:///test.sql");

            const result = coordinator.getOwningCoordinatingExtension(testUri);

            expect(result).to.be.undefined;
        });
    });

    describe("isActiveEditorOwnedByOtherExtensionWithWarning", () => {
        it("should return false when no active editor", () => {
            const coordinator = new UriOwnershipCoordinator(fakeContext, fakeConfig);

            const result = coordinator.isActiveEditorOwnedByOtherExtensionWithWarning();

            expect(result).to.be.false;
        });
    });

    describe("Ownership change events", () => {
        it("should fire onDidChangeUriOwnership when config.onDidChangeOwnership fires", () => {
            const coordinator = new UriOwnershipCoordinator(fakeContext, fakeConfig);

            let eventFired = false;
            coordinator.uriOwnershipApi.onDidChangeUriOwnership(() => {
                eventFired = true;
            });

            // Fire the config's ownership changed event
            ownershipChangedEmitter.fire();

            expect(eventFired).to.be.true;
        });
    });

    describe("getCoordinatingExtensions", () => {
        it("should return empty array when no coordinating extensions", () => {
            const coordinator = new UriOwnershipCoordinator(fakeContext, fakeConfig);

            const extensions = coordinator.getCoordinatingExtensions();

            expect(extensions).to.have.lengthOf(0);
        });
    });

    describe("Deferred initialization", () => {
        it("should work with deferred initialization", () => {
            // Create with only hideUiContextKey (deferred mode)
            const deferredConfig: UriOwnershipConfig = {
                hideUiContextKey: "mssql.hideUIElements",
            };

            const coordinator = new UriOwnershipCoordinator(fakeContext, deferredConfig);

            // API should exist but ownsUri should return false before initialization
            expect(coordinator.uriOwnershipApi).to.not.be.undefined;
            const testUri = vscode.Uri.parse("file:///test.sql");
            expect(coordinator.uriOwnershipApi.ownsUri(testUri)).to.be.false;

            // Now initialize
            const ownsUriStub = sandbox.stub().returns(true);
            coordinator.initialize({
                ownsUri: ownsUriStub,
                onDidChangeOwnership: ownershipChangedEmitter.event,
            });

            // Should now delegate to the provided ownsUri
            expect(coordinator.uriOwnershipApi.ownsUri(testUri)).to.be.true;
            sinon.assert.calledOnce(ownsUriStub);
        });

        it("should not initialize twice", () => {
            const deferredConfig: UriOwnershipConfig = {
                hideUiContextKey: "mssql.hideUIElements",
            };

            const coordinator = new UriOwnershipCoordinator(fakeContext, deferredConfig);

            const ownsUriStub1 = sandbox.stub().returns(true);
            const ownsUriStub2 = sandbox.stub().returns(false);

            coordinator.initialize({
                ownsUri: ownsUriStub1,
                onDidChangeOwnership: ownershipChangedEmitter.event,
            });

            // Second initialization should be ignored
            coordinator.initialize({
                ownsUri: ownsUriStub2,
                onDidChangeOwnership: ownershipChangedEmitter.event,
            });

            const testUri = vscode.Uri.parse("file:///test.sql");
            coordinator.uriOwnershipApi.ownsUri(testUri);

            // Should use the first stub
            sinon.assert.calledOnce(ownsUriStub1);
            sinon.assert.notCalled(ownsUriStub2);
        });
    });
});
