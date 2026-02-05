/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import * as vscode from "vscode";
import {
    UriOwnershipCoordinator,
    HIDE_UI_ELEMENTS_CONTEXT_VARIABLE,
    SET_CONTEXT_COMMAND,
} from "../../src/uriOwnership";
import MainController from "../../src/controllers/mainController";

suite("UriOwnershipCoordinator Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let fakeContext: vscode.ExtensionContext;
    let fakeConnectionManager: {
        isConnected: sinon.SinonStub;
        isConnecting: sinon.SinonStub;
        onConnectionsChanged: sinon.SinonStub;
    };
    let fakeMainController: MainController;
    let executeCommandStub: sinon.SinonStub;
    let getExtensionStub: sinon.SinonStub;
    let onDidChangeActiveTextEditorStub: sinon.SinonStub;
    let activeTextEditorChangeCallback: Function;
    let connectionsChangedCallback: Function;

    setup(() => {
        sandbox = sinon.createSandbox();
        fakeContext = {
            subscriptions: [],
        } as unknown as vscode.ExtensionContext;

        // Mock connection manager (MSSQL uses onConnectionsChanged instead of separate events)
        fakeConnectionManager = {
            isConnected: sandbox.stub(),
            isConnecting: sandbox.stub(),
            onConnectionsChanged: sandbox.stub().callsFake((cb: Function) => {
                connectionsChangedCallback = cb;
                return { dispose: () => {} };
            }),
        };

        fakeMainController = {
            connectionManager: fakeConnectionManager,
        } as unknown as MainController;

        // Mock vscode.commands.executeCommand
        executeCommandStub = sandbox.stub(vscode.commands, "executeCommand").resolves();

        // Mock vscode.extensions.getExtension
        getExtensionStub = sandbox.stub(vscode.extensions, "getExtension").returns(undefined);

        // Mock vscode.window.onDidChangeActiveTextEditor
        onDidChangeActiveTextEditorStub = sandbox
            .stub(vscode.window, "onDidChangeActiveTextEditor")
            .callsFake((cb: (e: vscode.TextEditor | undefined) => void) => {
                activeTextEditorChangeCallback = cb;
                return { dispose: () => {} };
            });

        // Mock vscode.window.activeTextEditor as undefined initially
        sandbox.stub(vscode.window, "activeTextEditor").value(undefined);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("Constructor", () => {
        test("should create uriOwnershipApi with ownsUri and onDidChangeUriOwnership", () => {
            const coordinator = new UriOwnershipCoordinator(fakeContext);

            expect(coordinator.uriOwnershipApi).to.not.be.undefined;
            expect(coordinator.uriOwnershipApi.ownsUri).to.be.a("function");
            expect(coordinator.uriOwnershipApi.onDidChangeUriOwnership).to.not.be.undefined;
        });

        test("should register event emitters in context subscriptions", () => {
            const initialSubscriptionCount = fakeContext.subscriptions.length;
            new UriOwnershipCoordinator(fakeContext);

            // Should add 2 event emitters + 1 for active editor listener
            expect(fakeContext.subscriptions.length).to.be.greaterThan(initialSubscriptionCount);
        });

        test("should register active editor change listener", () => {
            new UriOwnershipCoordinator(fakeContext);

            sinon.assert.calledOnce(onDidChangeActiveTextEditorStub);
        });

        test("should set initial context to false when no active editor", () => {
            new UriOwnershipCoordinator(fakeContext);

            sinon.assert.calledWith(
                executeCommandStub,
                SET_CONTEXT_COMMAND,
                HIDE_UI_ELEMENTS_CONTEXT_VARIABLE,
                false,
            );
        });
    });

    suite("initialize", () => {
        test("should set up connection manager event listeners", () => {
            const coordinator = new UriOwnershipCoordinator(fakeContext);
            coordinator.initialize(fakeMainController);

            sinon.assert.calledOnce(fakeConnectionManager.onConnectionsChanged);
        });

        test("should not initialize twice", () => {
            const coordinator = new UriOwnershipCoordinator(fakeContext);
            coordinator.initialize(fakeMainController);
            coordinator.initialize(fakeMainController);

            // Should only be called once
            sinon.assert.calledOnce(fakeConnectionManager.onConnectionsChanged);
        });
    });

    suite("uriOwnershipApi.ownsUri", () => {
        test("should return false when connection manager not initialized", () => {
            const coordinator = new UriOwnershipCoordinator(fakeContext);
            const testUri = vscode.Uri.parse("file:///test.sql");

            const result = coordinator.uriOwnershipApi.ownsUri(testUri);

            expect(result).to.be.false;
        });

        test("should return true when URI is connected", () => {
            const coordinator = new UriOwnershipCoordinator(fakeContext);
            coordinator.initialize(fakeMainController);

            const testUri = vscode.Uri.parse("file:///test.sql");
            fakeConnectionManager.isConnected.returns(true);
            fakeConnectionManager.isConnecting.returns(false);

            const result = coordinator.uriOwnershipApi.ownsUri(testUri);

            expect(result).to.be.true;
        });

        test("should return true when URI is connecting", () => {
            const coordinator = new UriOwnershipCoordinator(fakeContext);
            coordinator.initialize(fakeMainController);

            const testUri = vscode.Uri.parse("file:///test.sql");
            fakeConnectionManager.isConnected.returns(false);
            fakeConnectionManager.isConnecting.returns(true);

            const result = coordinator.uriOwnershipApi.ownsUri(testUri);

            expect(result).to.be.true;
        });

        test("should return false when URI is neither connected nor connecting", () => {
            const coordinator = new UriOwnershipCoordinator(fakeContext);
            coordinator.initialize(fakeMainController);

            const testUri = vscode.Uri.parse("file:///test.sql");
            fakeConnectionManager.isConnected.returns(false);
            fakeConnectionManager.isConnecting.returns(false);

            const result = coordinator.uriOwnershipApi.ownsUri(testUri);

            expect(result).to.be.false;
        });
    });

    suite("isOwnedByCoordinatingExtension", () => {
        test("should return false when no coordinating extensions registered", () => {
            const coordinator = new UriOwnershipCoordinator(fakeContext);
            const testUri = vscode.Uri.parse("file:///test.sql");

            const result = coordinator.isOwnedByCoordinatingExtension(testUri);

            expect(result).to.be.false;
        });

        test("should return true when coordinating extension owns URI", () => {
            // Mock the PostgreSQL extension with an API that owns the URI
            const mockPgsqlApi = {
                uriOwnershipApi: {
                    ownsUri: sandbox.stub().returns(true),
                    onDidChangeUriOwnership: new vscode.EventEmitter<void>().event,
                },
            };
            const mockExtension = {
                isActive: true,
                exports: mockPgsqlApi,
            };
            getExtensionStub.withArgs("ms-ossdata.vscode-pgsql").returns(mockExtension);

            const coordinator = new UriOwnershipCoordinator(fakeContext);
            const testUri = vscode.Uri.parse("file:///test.sql");

            const result = coordinator.isOwnedByCoordinatingExtension(testUri);

            expect(result).to.be.true;
        });

        test("should return false when coordinating extension does not own URI", () => {
            const mockPgsqlApi = {
                uriOwnershipApi: {
                    ownsUri: sandbox.stub().returns(false),
                    onDidChangeUriOwnership: new vscode.EventEmitter<void>().event,
                },
            };
            const mockExtension = {
                isActive: true,
                exports: mockPgsqlApi,
            };
            getExtensionStub.withArgs("ms-ossdata.vscode-pgsql").returns(mockExtension);

            const coordinator = new UriOwnershipCoordinator(fakeContext);
            const testUri = vscode.Uri.parse("file:///test.sql");

            const result = coordinator.isOwnedByCoordinatingExtension(testUri);

            expect(result).to.be.false;
        });
    });

    suite("getOwningCoordinatingExtension", () => {
        test("should return extension ID when coordinating extension owns URI", () => {
            const mockPgsqlApi = {
                uriOwnershipApi: {
                    ownsUri: sandbox.stub().returns(true),
                    onDidChangeUriOwnership: new vscode.EventEmitter<void>().event,
                },
            };
            const mockExtension = {
                isActive: true,
                exports: mockPgsqlApi,
            };
            getExtensionStub.withArgs("ms-ossdata.vscode-pgsql").returns(mockExtension);

            const coordinator = new UriOwnershipCoordinator(fakeContext);
            const testUri = vscode.Uri.parse("file:///test.sql");

            const result = coordinator.getOwningCoordinatingExtension(testUri);

            expect(result).to.equal("ms-ossdata.vscode-pgsql");
        });

        test("should return undefined when no coordinating extension owns URI", () => {
            const coordinator = new UriOwnershipCoordinator(fakeContext);
            const testUri = vscode.Uri.parse("file:///test.sql");

            const result = coordinator.getOwningCoordinatingExtension(testUri);

            expect(result).to.be.undefined;
        });
    });

    suite("isActiveEditorOwnedByOtherExtensionWithWarning", () => {
        test("should return false when no active editor", () => {
            const coordinator = new UriOwnershipCoordinator(fakeContext);

            const result = coordinator.isActiveEditorOwnedByOtherExtensionWithWarning();

            expect(result).to.be.false;
        });

        test("should return false when active editor URI not owned by coordinating extension", () => {
            const testUri = vscode.Uri.parse("file:///test.sql");
            sandbox.stub(vscode.window, "activeTextEditor").value({
                document: { uri: testUri },
            });

            const coordinator = new UriOwnershipCoordinator(fakeContext);

            const result = coordinator.isActiveEditorOwnedByOtherExtensionWithWarning();

            expect(result).to.be.false;
        });

        test("should return true and show warning when active editor URI owned by coordinating extension", () => {
            const testUri = vscode.Uri.parse("file:///test.sql");
            sandbox.stub(vscode.window, "activeTextEditor").value({
                document: { uri: testUri },
            });

            const mockPgsqlApi = {
                uriOwnershipApi: {
                    ownsUri: sandbox.stub().returns(true),
                    onDidChangeUriOwnership: new vscode.EventEmitter<void>().event,
                },
            };
            const mockExtension = {
                isActive: true,
                exports: mockPgsqlApi,
            };
            getExtensionStub.withArgs("ms-ossdata.vscode-pgsql").returns(mockExtension);

            const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage").resolves();

            const coordinator = new UriOwnershipCoordinator(fakeContext);

            const result = coordinator.isActiveEditorOwnedByOtherExtensionWithWarning();

            expect(result).to.be.true;
            sinon.assert.calledOnce(showInfoStub);
        });
    });

    suite("onCoordinatingOwnershipChanged event", () => {
        test("should fire when active editor changes to a file", () => {
            // Need to set up active editor for the event to fire
            // Reset and recreate sandbox to set activeTextEditor
            sandbox.restore();
            sandbox = sinon.createSandbox();

            const testUri = vscode.Uri.parse("file:///test.sql");
            sandbox.stub(vscode.commands, "executeCommand").resolves();
            sandbox.stub(vscode.extensions, "getExtension").returns(undefined);
            sandbox
                .stub(vscode.window, "onDidChangeActiveTextEditor")
                .callsFake((cb: (e: vscode.TextEditor | undefined) => void) => {
                    activeTextEditorChangeCallback = cb;
                    return { dispose: () => {} };
                });
            sandbox.stub(vscode.window, "activeTextEditor").value({
                document: { uri: testUri },
            });

            fakeContext = { subscriptions: [] } as unknown as vscode.ExtensionContext;
            const coordinator = new UriOwnershipCoordinator(fakeContext);

            let eventFired = false;
            coordinator.onCoordinatingOwnershipChanged(() => {
                eventFired = true;
            });

            // Simulate active editor change
            activeTextEditorChangeCallback();

            expect(eventFired).to.be.true;
        });
    });

    suite("Connection events fire ownership changed", () => {
        test("should fire onDidChangeUriOwnership when connections change", () => {
            const coordinator = new UriOwnershipCoordinator(fakeContext);
            coordinator.initialize(fakeMainController);

            let eventFired = false;
            coordinator.uriOwnershipApi.onDidChangeUriOwnership(() => {
                eventFired = true;
            });

            // Simulate connections changed
            connectionsChangedCallback();

            expect(eventFired).to.be.true;
        });
    });

    suite("Context variable updates", () => {
        test("should set hideUIElements to true when active editor owned by coordinating extension", () => {
            const testUri = vscode.Uri.parse("file:///test.sql");

            const mockPgsqlApi = {
                uriOwnershipApi: {
                    ownsUri: sandbox.stub().returns(true),
                    onDidChangeUriOwnership: new vscode.EventEmitter<void>().event,
                },
            };
            const mockExtension = {
                isActive: true,
                exports: mockPgsqlApi,
            };
            getExtensionStub.withArgs("ms-ossdata.vscode-pgsql").returns(mockExtension);

            // Reset to allow setting new value
            sandbox.restore();
            sandbox = sinon.createSandbox();
            executeCommandStub = sandbox.stub(vscode.commands, "executeCommand").resolves();
            sandbox
                .stub(vscode.extensions, "getExtension")
                .withArgs("ms-ossdata.vscode-pgsql")
                .returns(mockExtension as unknown as vscode.Extension<unknown>);
            sandbox
                .stub(vscode.window, "onDidChangeActiveTextEditor")
                .callsFake((cb: (e: vscode.TextEditor | undefined) => void) => {
                    activeTextEditorChangeCallback = cb;
                    return { dispose: () => {} };
                });
            sandbox.stub(vscode.window, "activeTextEditor").value({
                document: { uri: testUri },
            });

            new UriOwnershipCoordinator(fakeContext as vscode.ExtensionContext);

            sinon.assert.calledWith(
                executeCommandStub,
                SET_CONTEXT_COMMAND,
                HIDE_UI_ELEMENTS_CONTEXT_VARIABLE,
                true,
            );
        });
    });

    suite("Coordinating extension activation", () => {
        test("should activate inactive coordinating extension and register API", async () => {
            const mockOwnershipChangeEmitter = new vscode.EventEmitter<void>();
            const mockPgsqlApi = {
                uriOwnershipApi: {
                    ownsUri: sandbox.stub().returns(false),
                    onDidChangeUriOwnership: mockOwnershipChangeEmitter.event,
                },
            };

            const activateStub = sandbox.stub().resolves(mockPgsqlApi);
            const mockExtension = {
                isActive: false,
                activate: activateStub,
                exports: undefined,
            };
            getExtensionStub.withArgs("ms-ossdata.vscode-pgsql").returns(mockExtension);

            new UriOwnershipCoordinator(fakeContext);

            // Wait for async activation
            await new Promise((resolve) => setTimeout(resolve, 10));

            sinon.assert.calledOnce(activateStub);
        });
    });
});
