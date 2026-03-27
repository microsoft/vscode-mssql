/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { UriOwnershipCoordinator } from "../../src/uriOwnership/uriOwnershipCore";

chai.use(sinonChai);

suite("UriOwnershipCoordinator Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let activeEditor: vscode.TextEditor | undefined;
    let onDidChangeActiveTextEditorHandler:
        | ((e: vscode.TextEditor | undefined) => void)
        | undefined;
    let executeCommandStub: sinon.SinonStub;
    let showInformationMessageStub: sinon.SinonStub;
    let extensionsAll: vscode.Extension<unknown>[];
    let extensionById: Map<string, vscode.Extension<unknown>>;

    function createContext(): vscode.ExtensionContext {
        return {
            extension: { id: "mssql.test", packageJSON: {} },
            subscriptions: [],
        } as unknown as vscode.ExtensionContext;
    }

    function createEditor(uri: vscode.Uri): vscode.TextEditor {
        return {
            document: { uri },
        } as unknown as vscode.TextEditor;
    }

    function createCoordinatingExtension(options: {
        id: string;
        displayName?: string;
        active?: boolean;
        contributesUriOwnershipApi?: boolean;
        ownsUri?: (uri: vscode.Uri) => boolean;
    }): {
        extension: vscode.Extension<unknown>;
        ownsUriStub?: sinon.SinonStub;
        ownershipChangedEmitter?: vscode.EventEmitter<void>;
        activateStub?: sinon.SinonStub;
    } {
        const contributesUriOwnershipApi = options.contributesUriOwnershipApi ?? true;
        const ownsUriStub = contributesUriOwnershipApi
            ? sandbox.stub().callsFake(options.ownsUri ?? (() => false))
            : undefined;
        const ownershipChangedEmitter = contributesUriOwnershipApi
            ? new vscode.EventEmitter<void>()
            : undefined;

        const extensionExports = contributesUriOwnershipApi
            ? {
                  uriOwnershipApi: {
                      ownsUri: ownsUriStub as (uri: vscode.Uri) => boolean,
                      onDidChangeUriOwnership: ownershipChangedEmitter!.event,
                  },
              }
            : {};

        const activateStub = sandbox.stub().resolves(extensionExports);

        const extension = {
            id: options.id,
            packageJSON: {
                displayName: options.displayName ?? options.id,
                contributes: contributesUriOwnershipApi
                    ? {
                          "vscode-sql-common-features": {
                              uriOwnershipApi: true,
                          },
                      }
                    : {},
            },
            isActive: options.active ?? true,
            exports: extensionExports,
            activate: activateStub,
        } as unknown as vscode.Extension<unknown>;

        return {
            extension,
            ownsUriStub,
            ownershipChangedEmitter,
            activateStub,
        };
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        activeEditor = undefined;
        onDidChangeActiveTextEditorHandler = undefined;
        extensionsAll = [];
        extensionById = new Map<string, vscode.Extension<unknown>>();

        executeCommandStub = sandbox.stub(vscode.commands, "executeCommand").resolves(undefined);
        showInformationMessageStub = sandbox
            .stub(vscode.window, "showInformationMessage")
            .resolves(undefined);

        sandbox.stub(vscode.extensions, "all").get(() => extensionsAll);
        sandbox
            .stub(vscode.extensions, "getExtension")
            .callsFake((extensionId: string) => extensionById.get(extensionId));
        sandbox
            .stub(vscode.extensions, "onDidChange")
            .callsFake((_listener: () => void) => new vscode.Disposable(() => {}));

        sandbox
            .stub(vscode.window, "onDidChangeActiveTextEditor")
            .callsFake((listener: (e: vscode.TextEditor | undefined) => void) => {
                onDidChangeActiveTextEditorHandler = listener;
                return new vscode.Disposable(() => {});
            });

        sandbox.stub(vscode.window, "activeTextEditor").get(() => activeEditor);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("discovers coordinating extensions and updates coordinating-extensions context", () => {
        const coordinating = createCoordinatingExtension({
            id: "ext.pgsql",
            displayName: "PostgreSQL",
            active: true,
        });
        const notParticipating = createCoordinatingExtension({
            id: "ext.other",
            contributesUriOwnershipApi: false,
            active: true,
        });
        const selfExtension = createCoordinatingExtension({
            id: "mssql.test",
            displayName: "MSSQL",
            active: true,
        });

        extensionsAll = [
            coordinating.extension,
            notParticipating.extension,
            selfExtension.extension,
        ];
        extensionById.set(coordinating.extension.id, coordinating.extension);
        extensionById.set(notParticipating.extension.id, notParticipating.extension);
        extensionById.set(selfExtension.extension.id, selfExtension.extension);

        const coordinator = new UriOwnershipCoordinator(createContext(), {
            hideUiContextKey: "mssql.hideUIElements",
            hasCoordinatingExtensionsContextKey: "mssql.hasCoordinatingExtensions",
        });

        const discovered = coordinator.getCoordinatingExtensions();
        expect(discovered).to.have.lengthOf(1);
        expect(discovered[0].extensionId).to.equal("ext.pgsql");
        expect(discovered[0].displayName).to.equal("PostgreSQL");
        expect(executeCommandStub).to.have.been.calledWith(
            "setContext",
            "mssql.hasCoordinatingExtensions",
            true,
        );
    });

    test("uriOwnershipApi ownsUri uses canonical uri.toString() after deferred initialize", () => {
        const ownershipChanged = new vscode.EventEmitter<void>();
        const coordinator = new UriOwnershipCoordinator(createContext(), {
            hideUiContextKey: "mssql.hideUIElements",
        });

        const encodedUri = vscode.Uri.parse("file:///tmp/space%20hash%23name.sql");
        expect(coordinator.uriOwnershipApi.ownsUri(encodedUri)).to.equal(false);

        const ownsUri = sandbox.stub().returns(true);
        coordinator.initialize({
            ownsUri,
            onDidChangeOwnership: ownershipChanged.event,
        });

        expect(coordinator.uriOwnershipApi.ownsUri(encodedUri)).to.equal(true);
        expect(ownsUri).to.have.been.calledWith(encodedUri.toString());

        const ownershipChangedListener = sandbox.spy();
        coordinator.uriOwnershipApi.onDidChangeUriOwnership(ownershipChangedListener);
        ownershipChanged.fire();
        expect(ownershipChangedListener).to.have.been.called;
    });

    test("initialize only applies the first deferred configuration", () => {
        const coordinator = new UriOwnershipCoordinator(createContext(), {
            hideUiContextKey: "mssql.hideUIElements",
        });
        const uri = vscode.Uri.parse("file:///tmp/test.sql");

        const firstOwns = sandbox.stub().returns(false);
        const secondOwns = sandbox.stub().returns(true);

        coordinator.initialize({
            ownsUri: firstOwns,
            onDidChangeOwnership: new vscode.EventEmitter<void>().event,
        });
        coordinator.initialize({
            ownsUri: secondOwns,
            onDidChangeOwnership: new vscode.EventEmitter<void>().event,
        });

        expect(coordinator.uriOwnershipApi.ownsUri(uri)).to.equal(false);
        expect(firstOwns).to.have.been.calledWith(uri.toString());
        expect(secondOwns).to.not.have.been.called;
    });

    test("returns owning coordinating extension for a URI", () => {
        const ownedUri = vscode.Uri.parse("file:///tmp/owned.sql");
        const coordinating = createCoordinatingExtension({
            id: "ext.pgsql",
            displayName: "PostgreSQL",
            active: true,
            ownsUri: (uri) => uri.toString() === ownedUri.toString(),
        });

        extensionsAll = [coordinating.extension];
        extensionById.set(coordinating.extension.id, coordinating.extension);

        const coordinator = new UriOwnershipCoordinator(createContext(), {
            hideUiContextKey: "mssql.hideUIElements",
        });

        expect(coordinator.getOwningCoordinatingExtension(ownedUri)).to.equal("ext.pgsql");
        expect(coordinator.isOwnedByCoordinatingExtension(ownedUri)).to.equal(true);
        expect(
            coordinator.isOwnedByCoordinatingExtension(vscode.Uri.parse("file:///tmp/other.sql")),
        ).to.equal(false);
    });

    test("shows warning using custom message formatter when active editor is owned by another extension", () => {
        const ownedUri = vscode.Uri.parse("file:///tmp/owned.sql");
        activeEditor = createEditor(ownedUri);

        const coordinating = createCoordinatingExtension({
            id: "ext.pgsql",
            displayName: "PostgreSQL",
            active: true,
            ownsUri: () => true,
        });
        extensionsAll = [coordinating.extension];
        extensionById.set(coordinating.extension.id, coordinating.extension);

        const messageFormatter = sandbox.stub().returns("Custom warning");
        const coordinator = new UriOwnershipCoordinator(createContext(), {
            hideUiContextKey: "mssql.hideUIElements",
            fileOwnedByOtherExtensionMessage: messageFormatter,
        });

        expect(coordinator.isActiveEditorOwnedByOtherExtensionWithWarning()).to.equal(true);
        expect(messageFormatter).to.have.been.calledWith("PostgreSQL");
        expect(showInformationMessageStub).to.have.been.calledWith("Custom warning");
    });

    test("shows default warning message when active editor is owned by another extension", () => {
        const ownedUri = vscode.Uri.parse("file:///tmp/owned.sql");
        activeEditor = createEditor(ownedUri);

        const coordinating = createCoordinatingExtension({
            id: "ext.pgsql",
            displayName: "PostgreSQL",
            active: true,
            ownsUri: () => true,
        });
        extensionsAll = [coordinating.extension];
        extensionById.set(coordinating.extension.id, coordinating.extension);

        const coordinator = new UriOwnershipCoordinator(createContext(), {
            hideUiContextKey: "mssql.hideUIElements",
        });

        expect(coordinator.isActiveEditorOwnedByOtherExtensionWithWarning()).to.equal(true);
        expect(showInformationMessageStub).to.have.been.calledWith(
            "This file is connected to PostgreSQL. Please use PostgreSQL commands for this file.",
        );
    });

    test("releases URI when both self and coordinating extension own the active editor", () => {
        const uri = vscode.Uri.parse("file:///tmp/owned.sql");
        activeEditor = undefined;

        const coordinating = createCoordinatingExtension({
            id: "ext.pgsql",
            displayName: "PostgreSQL",
            active: true,
            ownsUri: (ownedUri) => ownedUri.toString() === uri.toString(),
        });
        extensionsAll = [coordinating.extension];
        extensionById.set(coordinating.extension.id, coordinating.extension);

        const releaseUri = sandbox.stub();
        new UriOwnershipCoordinator(createContext(), {
            hideUiContextKey: "mssql.hideUIElements",
            ownsUri: (ownedUri) => ownedUri === uri.toString(),
            onDidChangeOwnership: new vscode.EventEmitter<void>().event,
            releaseUri,
        });

        activeEditor = createEditor(uri);
        onDidChangeActiveTextEditorHandler?.(activeEditor);

        expect(releaseUri).to.have.been.calledWith(uri.toString());
        expect(executeCommandStub).to.have.been.calledWith(
            "setContext",
            "mssql.hideUIElements",
            true,
        );
    });

    test("fires coordinating ownership event only when ownership state changes", () => {
        activeEditor = createEditor(vscode.Uri.parse("file:///tmp/test.sql"));

        const coordinator = new UriOwnershipCoordinator(createContext(), {
            hideUiContextKey: "mssql.hideUIElements",
        });

        const ownsByOtherStub = sandbox.stub(coordinator, "isOwnedByCoordinatingExtension");
        ownsByOtherStub.returns(false);

        const listener = sandbox.spy();
        coordinator.onCoordinatingOwnershipChanged(listener);

        onDidChangeActiveTextEditorHandler?.(activeEditor);
        expect(listener).to.not.have.been.called;

        ownsByOtherStub.returns(true);
        onDidChangeActiveTextEditorHandler?.(activeEditor);
        expect(listener).to.have.been.calledOnce;

        onDidChangeActiveTextEditorHandler?.(activeEditor);
        expect(listener).to.have.been.calledOnce;

        ownsByOtherStub.returns(false);
        onDidChangeActiveTextEditorHandler?.(activeEditor);
        expect(listener).to.have.been.calledTwice;

        activeEditor = undefined;
        onDidChangeActiveTextEditorHandler?.(activeEditor);
        expect(listener).to.have.been.calledTwice;

        onDidChangeActiveTextEditorHandler?.(activeEditor);
        expect(listener).to.have.been.calledTwice;
    });

    test("refreshes coordinating extensions on extension change and updates context", () => {
        const coordinator = new UriOwnershipCoordinator(createContext(), {
            hideUiContextKey: "mssql.hideUIElements",
            hasCoordinatingExtensionsContextKey: "mssql.hasCoordinatingExtensions",
        });

        expect(coordinator.getCoordinatingExtensions()).to.have.lengthOf(0);

        const newlyDiscovered = createCoordinatingExtension({
            id: "ext.mysql",
            displayName: "MySQL",
            active: true,
        });
        extensionsAll = [newlyDiscovered.extension];
        extensionById.set(newlyDiscovered.extension.id, newlyDiscovered.extension);

        (
            coordinator as unknown as { _refreshCoordinatingExtensions: () => void }
        )._refreshCoordinatingExtensions();

        const discovered = coordinator.getCoordinatingExtensions();
        expect(discovered).to.have.lengthOf(1);
        expect(discovered[0].extensionId).to.equal("ext.mysql");
        expect(executeCommandStub).to.have.been.calledWith(
            "setContext",
            "mssql.hasCoordinatingExtensions",
            true,
        );
    });

    test("registers URI ownership API for inactive coordinating extensions after activation", async () => {
        const uri = vscode.Uri.parse("file:///tmp/owned.sql");
        let coordinatingOwnsUri = false;

        const inactiveCoordinating = createCoordinatingExtension({
            id: "ext.pgsql",
            displayName: "PostgreSQL",
            active: false,
            ownsUri: (ownedUri) => coordinatingOwnsUri && ownedUri.toString() === uri.toString(),
        });
        extensionsAll = [inactiveCoordinating.extension];
        extensionById.set(inactiveCoordinating.extension.id, inactiveCoordinating.extension);

        new UriOwnershipCoordinator(createContext(), {
            hideUiContextKey: "mssql.hideUIElements",
        });

        await Promise.resolve();

        activeEditor = createEditor(uri);
        onDidChangeActiveTextEditorHandler?.(activeEditor);
        expect(executeCommandStub).to.have.been.calledWith(
            "setContext",
            "mssql.hideUIElements",
            false,
        );

        coordinatingOwnsUri = true;
        inactiveCoordinating.ownershipChangedEmitter?.fire();
        expect(executeCommandStub).to.have.been.calledWith(
            "setContext",
            "mssql.hideUIElements",
            true,
        );
    });

    test("returns false and does not show warning when active editor is undefined", () => {
        const coordinator = new UriOwnershipCoordinator(createContext(), {
            hideUiContextKey: "mssql.hideUIElements",
        });

        expect(coordinator.isActiveEditorOwnedByOtherExtensionWithWarning()).to.equal(false);
        expect(showInformationMessageStub).to.not.have.been.called;
    });

    test("uses canonical uri.toString() for ownsUri and releaseUri", () => {
        const ownershipChanged = new vscode.EventEmitter<void>();
        const encodedUri = vscode.Uri.parse("file:///tmp/space%20hash%23name.sql");
        const ownsUri = sandbox.stub().callsFake((uri: string) => uri === encodedUri.toString());
        const releaseUri = sandbox.stub();

        const coordinator = new UriOwnershipCoordinator(createContext(), {
            hideUiContextKey: "mssql.hideUIElements",
            ownsUri,
            onDidChangeOwnership: ownershipChanged.event,
            releaseUri,
        });

        sandbox.stub(coordinator, "isOwnedByCoordinatingExtension").returns(true);

        activeEditor = {
            document: { uri: encodedUri },
        } as unknown as vscode.TextEditor;

        onDidChangeActiveTextEditorHandler?.(activeEditor);

        expect(ownsUri).to.have.been.calledWith(encodedUri.toString());
        expect(releaseUri).to.have.been.calledWith(encodedUri.toString());
    });
});
