/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import * as vscode from "vscode";
import { QueryHistoryProvider } from "../../src/queryHistory/queryHistoryProvider";
import { QueryHistoryNode, EmptyHistoryNode } from "../../src/queryHistory/queryHistoryNode";
import ConnectionManager from "../../src/controllers/connectionManager";
import { SqlOutputContentProvider } from "../../src/models/sqlOutputContentProvider";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import SqlDocumentService from "../../src/controllers/sqlDocumentService";
import StatusView from "../../src/views/statusView";
import * as Constants from "../../src/constants/constants";
import { stubVscodeWrapper, initializeIconUtils } from "./utils";
import { createWorkspaceConfiguration } from "./stubs";
import { IPrompter } from "../../src/prompts/question";
import CodeAdapter from "../../src/prompts/adapter";

chai.use(sinonChai);

suite("QueryHistoryProvider Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let provider: QueryHistoryProvider;
    let connectionManagerStub: sinon.SinonStubbedInstance<ConnectionManager>;
    let outputContentProviderStub: sinon.SinonStubbedInstance<SqlOutputContentProvider>;
    let vscodeWrapperStub: sinon.SinonStubbedInstance<VscodeWrapper>;
    let sqlDocumentServiceStub: sinon.SinonStubbedInstance<SqlDocumentService>;
    let statusViewStub: sinon.SinonStubbedInstance<StatusView>;
    let prompterStub: sinon.SinonStubbedInstance<IPrompter>;
    let secretStorage: {
        get: sinon.SinonStub<[string], Promise<string | undefined>>;
        store: sinon.SinonStub<[string, string], Promise<void>>;
        delete: sinon.SinonStub<[string], Promise<void>>;
    };
    let context: vscode.ExtensionContext;

    function createProvider(): QueryHistoryProvider {
        return new QueryHistoryProvider(
            connectionManagerStub as unknown as ConnectionManager,
            outputContentProviderStub as unknown as SqlOutputContentProvider,
            vscodeWrapperStub as unknown as VscodeWrapper,
            sqlDocumentServiceStub as unknown as SqlDocumentService,
            statusViewStub as unknown as StatusView,
            prompterStub as unknown as IPrompter,
            context,
        );
    }

    function createTestNode(
        queryString: string = "SELECT 1",
        connectionLabel: string = "(localhost|master)",
        timeStamp: Date = new Date(2025, 0, 15, 10, 30, 0),
        isSuccess: boolean = true,
        ownerUri: string = "file:///test.sql",
    ): QueryHistoryNode {
        const label = `${queryString} : ${connectionLabel}`;
        const tooltip = `${connectionLabel}\n\n${timeStamp.toLocaleString()}\n\n${queryString}`;
        return new QueryHistoryNode(
            label,
            tooltip,
            queryString,
            ownerUri,
            undefined,
            timeStamp,
            connectionLabel,
            isSuccess,
        );
    }

    function waitForAsyncWork(): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        initializeIconUtils();

        connectionManagerStub = sandbox.createStubInstance(ConnectionManager);
        outputContentProviderStub = sandbox.createStubInstance(SqlOutputContentProvider);
        vscodeWrapperStub = stubVscodeWrapper(sandbox);
        sqlDocumentServiceStub = sandbox.createStubInstance(SqlDocumentService);
        statusViewStub = sandbox.createStubInstance(StatusView);
        prompterStub = sandbox.createStubInstance(CodeAdapter);

        const config = createWorkspaceConfiguration({
            [Constants.configQueryHistoryLimit]: 10,
        });
        vscodeWrapperStub.getConfiguration.returns(config);

        secretStorage = {
            get: sandbox.stub<[string], Promise<string | undefined>>(),
            store: sandbox.stub<[string, string], Promise<void>>(),
            delete: sandbox.stub<[string], Promise<void>>(),
        };
        secretStorage.get.resolves(undefined);
        secretStorage.store.resolves();
        secretStorage.delete.resolves();

        context = {
            secrets: secretStorage as unknown as vscode.SecretStorage,
            subscriptions: [],
        } as unknown as vscode.ExtensionContext;
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("constructor", () => {
        test("should call restoreQueryHistory on construction", async () => {
            provider = createProvider();

            // restoreQueryHistory is called in the constructor via void promise;
            // since secretStorage.get resolves undefined, it should not change nodes
            // Wait for the async restore to complete
            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(secretStorage.get).to.have.been.calledOnceWithExactly(
                Constants.queryHistorySecretStorageKey,
            );
        });
    });

    suite("clearAll", () => {
        test("should reset nodes to empty and persist", async () => {
            provider = createProvider();
            await new Promise((resolve) => setTimeout(resolve, 50));

            provider.clearAll();

            const children = provider.getChildren();
            expect(children).to.have.lengthOf(1);
            expect(children[0]).to.be.instanceOf(EmptyHistoryNode);
            expect(secretStorage.delete).to.have.been.calledOnceWithExactly(
                Constants.queryHistorySecretStorageKey,
            );
        });
    });

    suite("refresh", () => {
        test("should add a node and persist", async () => {
            provider = createProvider();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const ownerUri = "file:///test.sql";
            const timeStamp = new Date(2025, 0, 15, 10, 30, 0);

            connectionManagerStub.getConnectionInfo.returns({
                credentials: {
                    server: "localhost",
                    database: "master",
                    authenticationType: Constants.sqlAuthentication,
                    user: "sa",
                } as any,
            } as any);
            outputContentProviderStub.getQueryRunner.returns({
                getQueryString: sandbox.stub().returns("SELECT 1"),
            } as any);

            provider.refresh(ownerUri, timeStamp, false);

            const children = provider.getChildren();
            expect(children).to.have.lengthOf(1);
            expect(children[0]).to.be.instanceOf(QueryHistoryNode);

            const node = children[0] as QueryHistoryNode;
            expect(node.queryString).to.equal("SELECT 1");
            expect(node.isSuccess).to.equal(true);

            // persistQueryHistory should have been called (store called after restore's get)
            expect(secretStorage.store).to.have.been.called;
        });

        test("should ignore refresh when query text is unavailable", async () => {
            provider = createProvider();
            await waitForAsyncWork();

            outputContentProviderStub.getQueryRunner.returns(undefined as any);

            provider.refresh("file:///test.sql", new Date(2025, 0, 15), false);

            const children = provider.getChildren();
            expect(children).to.have.lengthOf(1);
            expect(children[0]).to.be.instanceOf(EmptyHistoryNode);
            expect(secretStorage.store).to.not.have.been.called;
        });

        test("should create a history entry when connection info is unavailable", async () => {
            provider = createProvider();
            await waitForAsyncWork();

            outputContentProviderStub.getQueryRunner.returns({
                getQueryString: sandbox.stub().returns("SELECT 1"),
            } as any);
            connectionManagerStub.getConnectionInfo.returns(undefined as any);

            expect(() => {
                provider.refresh("file:///test.sql", new Date(2025, 0, 15), false);
            }).to.not.throw();

            const children = provider.getChildren();
            expect(children).to.have.lengthOf(1);
            const node = children[0] as QueryHistoryNode;
            expect(node.queryString).to.equal("SELECT 1");
            expect(node.connectionLabel).to.equal("");
            expect(node.historyNodeLabel).to.equal("SELECT 1");
        });

        test("should sort nodes by timestamp descending", async () => {
            provider = createProvider();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const ownerUri = "file:///test.sql";
            const olderTime = new Date(2025, 0, 10);
            const newerTime = new Date(2025, 0, 20);

            connectionManagerStub.getConnectionInfo.returns({
                credentials: {
                    server: "localhost",
                    database: "master",
                    authenticationType: Constants.sqlAuthentication,
                    user: "sa",
                } as any,
            } as any);
            outputContentProviderStub.getQueryRunner.returns({
                getQueryString: sandbox.stub().returns("SELECT 1"),
            } as any);

            provider.refresh(ownerUri, olderTime, false);
            provider.refresh(ownerUri, newerTime, false);

            const children = provider.getChildren();
            expect(children).to.have.lengthOf(2);
            const first = children[0] as QueryHistoryNode;
            const second = children[1] as QueryHistoryNode;
            expect(first.timeStamp.getTime()).to.be.greaterThan(second.timeStamp.getTime());
        });

        test("should respect query history limit", async () => {
            // Set limit to 2
            const config = createWorkspaceConfiguration({
                [Constants.configQueryHistoryLimit]: 2,
            });
            vscodeWrapperStub.getConfiguration.returns(config);

            provider = createProvider();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const ownerUri = "file:///test.sql";

            connectionManagerStub.getConnectionInfo.returns({
                credentials: {
                    server: "localhost",
                    database: "master",
                    authenticationType: Constants.sqlAuthentication,
                    user: "sa",
                } as any,
            } as any);
            outputContentProviderStub.getQueryRunner.returns({
                getQueryString: sandbox.stub().returns("SELECT 1"),
            } as any);

            provider.refresh(ownerUri, new Date(2025, 0, 10), false);
            provider.refresh(ownerUri, new Date(2025, 0, 15), false);
            provider.refresh(ownerUri, new Date(2025, 0, 20), false);

            const children = provider.getChildren();
            expect(children).to.have.lengthOf(2);
        });
    });

    suite("getTreeItem", () => {
        test("should return the same node passed in", async () => {
            provider = createProvider();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const node = createTestNode();
            expect(provider.getTreeItem(node)).to.equal(node);
        });

        test("should return EmptyHistoryNode when passed", async () => {
            provider = createProvider();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const emptyNode = new EmptyHistoryNode();
            expect(provider.getTreeItem(emptyNode)).to.equal(emptyNode);
        });
    });

    suite("getChildren", () => {
        test("should return EmptyHistoryNode when no history exists", async () => {
            provider = createProvider();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const children = provider.getChildren();
            expect(children).to.have.lengthOf(1);
            expect(children[0]).to.be.instanceOf(EmptyHistoryNode);
        });
    });

    suite("deleteQueryHistoryEntry", () => {
        test("should remove the specified node and persist", async () => {
            provider = createProvider();
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Add a node via refresh
            const ownerUri = "file:///test.sql";
            connectionManagerStub.getConnectionInfo.returns({
                credentials: {
                    server: "localhost",
                    database: "master",
                    authenticationType: Constants.sqlAuthentication,
                    user: "sa",
                } as any,
            } as any);
            outputContentProviderStub.getQueryRunner.returns({
                getQueryString: sandbox.stub().returns("SELECT 1"),
            } as any);
            provider.refresh(ownerUri, new Date(), false);

            const children = provider.getChildren();
            expect(children).to.have.lengthOf(1);
            const node = children[0] as QueryHistoryNode;

            // Reset store call count before delete
            secretStorage.store.resetHistory();
            secretStorage.delete.resetHistory();

            provider.deleteQueryHistoryEntry(node);

            const afterDelete = provider.getChildren();
            expect(afterDelete).to.have.lengthOf(1);
            expect(afterDelete[0]).to.be.instanceOf(EmptyHistoryNode);
            // When no nodes remain, persistQueryHistory deletes the key
            expect(secretStorage.delete).to.have.been.calledWithExactly(
                Constants.queryHistorySecretStorageKey,
            );
        });

        test("should do nothing when node is not found", async () => {
            provider = createProvider();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const unknownNode = createTestNode("SELECT unknown");

            // Should not throw
            provider.deleteQueryHistoryEntry(unknownNode);

            const children = provider.getChildren();
            expect(children).to.have.lengthOf(1);
            expect(children[0]).to.be.instanceOf(EmptyHistoryNode);
        });

        test("should add EmptyHistoryNode when last entry is deleted", async () => {
            provider = createProvider();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const ownerUri = "file:///test.sql";
            connectionManagerStub.getConnectionInfo.returns({
                credentials: {
                    server: "localhost",
                    database: "master",
                    authenticationType: Constants.sqlAuthentication,
                    user: "sa",
                } as any,
            } as any);
            outputContentProviderStub.getQueryRunner.returns({
                getQueryString: sandbox.stub().returns("SELECT 1"),
            } as any);
            provider.refresh(ownerUri, new Date(), false);

            const node = provider.getChildren()[0] as QueryHistoryNode;
            provider.deleteQueryHistoryEntry(node);

            const children = provider.getChildren();
            expect(children).to.have.lengthOf(1);
            expect(children[0]).to.be.instanceOf(EmptyHistoryNode);
        });
    });

    suite("restoreQueryHistory", () => {
        test("should restore nodes from secret storage", async () => {
            const persistedData = {
                version: 1,
                nodes: [
                    {
                        queryString: "SELECT * FROM users",
                        ownerUri: "file:///test.sql",
                        timeStamp: new Date(2025, 0, 15, 10, 30, 0).getTime(),
                        connectionLabel: "(localhost|testdb)",
                        isSuccess: true,
                    },
                    {
                        queryString: "INSERT INTO logs VALUES(1)",
                        ownerUri: "file:///test2.sql",
                        timeStamp: new Date(2025, 0, 14, 9, 0, 0).getTime(),
                        connectionLabel: "(localhost|master)",
                        isSuccess: false,
                    },
                ],
            };
            secretStorage.get.resolves(JSON.stringify(persistedData));

            provider = createProvider();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const children = provider.getChildren();
            expect(children).to.have.lengthOf(2);

            const first = children[0] as QueryHistoryNode;
            expect(first.queryString).to.equal("SELECT * FROM users");
            expect(first.isSuccess).to.equal(true);
            expect(first.connectionLabel).to.equal("(localhost|testdb)");

            const second = children[1] as QueryHistoryNode;
            expect(second.queryString).to.equal("INSERT INTO logs VALUES(1)");
            expect(second.isSuccess).to.equal(false);
        });

        test("should not overwrite newer history when restore finishes later", async () => {
            const persistedData = {
                version: 1,
                nodes: [
                    {
                        queryString: "restored query",
                        ownerUri: "file:///restored.sql",
                        timeStamp: new Date(2025, 0, 10).getTime(),
                        connectionLabel: "(localhost|restoreddb)",
                        isSuccess: true,
                    },
                ],
            };

            let resolveStoredHistory: ((value: string | undefined) => void) | undefined;
            secretStorage.get.callsFake(
                () =>
                    new Promise((resolve) => {
                        resolveStoredHistory = resolve;
                    }),
            );

            provider = createProvider();

            outputContentProviderStub.getQueryRunner.returns({
                getQueryString: sandbox.stub().returns("fresh query"),
            } as any);
            connectionManagerStub.getConnectionInfo.returns({
                credentials: {
                    server: "localhost",
                    database: "master",
                    authenticationType: Constants.sqlAuthentication,
                    user: "sa",
                } as any,
            } as any);

            provider.refresh("file:///fresh.sql", new Date(2025, 0, 20), false);

            expect(resolveStoredHistory).to.not.be.undefined;
            resolveStoredHistory?.(JSON.stringify(persistedData));
            await waitForAsyncWork();

            const children = provider.getChildren();
            expect(children).to.have.lengthOf(1);
            const node = children[0] as QueryHistoryNode;
            expect(node.queryString).to.equal("fresh query");
            expect(node.ownerUri).to.equal("file:///fresh.sql");
        });

        test("should sort restored nodes by timestamp descending", async () => {
            const persistedData = {
                version: 1,
                nodes: [
                    {
                        queryString: "older query",
                        ownerUri: "",
                        timeStamp: new Date(2025, 0, 10).getTime(),
                        connectionLabel: "(localhost|db)",
                        isSuccess: true,
                    },
                    {
                        queryString: "newer query",
                        ownerUri: "",
                        timeStamp: new Date(2025, 0, 20).getTime(),
                        connectionLabel: "(localhost|db)",
                        isSuccess: true,
                    },
                ],
            };
            secretStorage.get.resolves(JSON.stringify(persistedData));

            provider = createProvider();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const children = provider.getChildren();
            expect(children).to.have.lengthOf(2);
            const first = children[0] as QueryHistoryNode;
            const second = children[1] as QueryHistoryNode;
            expect(first.queryString).to.equal("newer query");
            expect(second.queryString).to.equal("older query");
        });

        test("should respect query history limit when restoring", async () => {
            const config = createWorkspaceConfiguration({
                [Constants.configQueryHistoryLimit]: 1,
            });
            vscodeWrapperStub.getConfiguration.returns(config);

            const persistedData = {
                version: 1,
                nodes: [
                    {
                        queryString: "query 1",
                        ownerUri: "",
                        timeStamp: new Date(2025, 0, 10).getTime(),
                        connectionLabel: "(localhost|db)",
                        isSuccess: true,
                    },
                    {
                        queryString: "query 2",
                        ownerUri: "",
                        timeStamp: new Date(2025, 0, 20).getTime(),
                        connectionLabel: "(localhost|db)",
                        isSuccess: true,
                    },
                ],
            };
            secretStorage.get.resolves(JSON.stringify(persistedData));

            provider = createProvider();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const children = provider.getChildren();
            expect(children).to.have.lengthOf(1);
            expect((children[0] as QueryHistoryNode).queryString).to.equal("query 2");
        });

        test("should show EmptyHistoryNode when storage is empty", async () => {
            secretStorage.get.resolves(undefined);

            provider = createProvider();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const children = provider.getChildren();
            expect(children).to.have.lengthOf(1);
            expect(children[0]).to.be.instanceOf(EmptyHistoryNode);
        });

        test("should show EmptyHistoryNode when storage has wrong version", async () => {
            const persistedData = {
                version: 999,
                nodes: [
                    {
                        queryString: "SELECT 1",
                        ownerUri: "",
                        timeStamp: Date.now(),
                        connectionLabel: "(localhost|db)",
                        isSuccess: true,
                    },
                ],
            };
            secretStorage.get.resolves(JSON.stringify(persistedData));

            provider = createProvider();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const children = provider.getChildren();
            expect(children).to.have.lengthOf(1);
            expect(children[0]).to.be.instanceOf(EmptyHistoryNode);
        });

        test("should show EmptyHistoryNode when storage has invalid JSON", async () => {
            secretStorage.get.resolves("not valid json{{{");

            provider = createProvider();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const children = provider.getChildren();
            expect(children).to.have.lengthOf(1);
            expect(children[0]).to.be.instanceOf(EmptyHistoryNode);
        });

        test("should skip nodes with missing required fields", async () => {
            const persistedData = {
                version: 1,
                nodes: [
                    {
                        queryString: "valid query",
                        ownerUri: "",
                        timeStamp: new Date(2025, 0, 15).getTime(),
                        connectionLabel: "(localhost|db)",
                        isSuccess: true,
                    },
                    {
                        // missing queryString
                        ownerUri: "",
                        timeStamp: Date.now(),
                        connectionLabel: "(localhost|db)",
                        isSuccess: true,
                    },
                    {
                        queryString: "another valid",
                        ownerUri: "",
                        // missing timeStamp
                        connectionLabel: "(localhost|db)",
                        isSuccess: true,
                    },
                    {
                        queryString: "missing isSuccess",
                        ownerUri: "",
                        timeStamp: Date.now(),
                        connectionLabel: "(localhost|db)",
                        // missing isSuccess
                    },
                ],
            };
            secretStorage.get.resolves(JSON.stringify(persistedData));

            provider = createProvider();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const children = provider.getChildren();
            expect(children).to.have.lengthOf(1);
            expect((children[0] as QueryHistoryNode).queryString).to.equal("valid query");
        });

        test("should skip nodes with invalid timestamp", async () => {
            const persistedData = {
                version: 1,
                nodes: [
                    {
                        queryString: "bad timestamp",
                        ownerUri: "",
                        timeStamp: NaN,
                        connectionLabel: "(localhost|db)",
                        isSuccess: true,
                    },
                ],
            };
            secretStorage.get.resolves(JSON.stringify(persistedData));

            provider = createProvider();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const children = provider.getChildren();
            expect(children).to.have.lengthOf(1);
            expect(children[0]).to.be.instanceOf(EmptyHistoryNode);
        });

        test("should show EmptyHistoryNode when all persisted nodes are invalid", async () => {
            const persistedData = {
                version: 1,
                nodes: [
                    {
                        // all fields wrong type
                        queryString: 123,
                        ownerUri: "",
                        timeStamp: "not a number",
                        connectionLabel: false,
                        isSuccess: "yes",
                    },
                ],
            };
            secretStorage.get.resolves(JSON.stringify(persistedData));

            provider = createProvider();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const children = provider.getChildren();
            expect(children).to.have.lengthOf(1);
            expect(children[0]).to.be.instanceOf(EmptyHistoryNode);
        });

        test("should default ownerUri to empty string when missing", async () => {
            const persistedData = {
                version: 1,
                nodes: [
                    {
                        queryString: "SELECT 1",
                        // ownerUri omitted
                        timeStamp: new Date(2025, 0, 15).getTime(),
                        connectionLabel: "(localhost|db)",
                        isSuccess: true,
                    },
                ],
            };
            secretStorage.get.resolves(JSON.stringify(persistedData));

            provider = createProvider();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const children = provider.getChildren();
            expect(children).to.have.lengthOf(1);
            const node = children[0] as QueryHistoryNode;
            expect(node.ownerUri).to.equal("");
        });

        test("should truncate long query strings on restore", async () => {
            const longQuery = "A".repeat(25000);
            const persistedData = {
                version: 1,
                nodes: [
                    {
                        queryString: longQuery,
                        ownerUri: "",
                        timeStamp: new Date(2025, 0, 15).getTime(),
                        connectionLabel: "(localhost|db)",
                        isSuccess: true,
                    },
                ],
            };
            secretStorage.get.resolves(JSON.stringify(persistedData));

            provider = createProvider();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const children = provider.getChildren();
            const node = children[0] as QueryHistoryNode;
            // maxPersistedQueryLength is 20000
            expect(node.queryString.length).to.equal(20000);
        });
    });

    suite("persistQueryHistory", () => {
        test("should store history nodes in secret storage", async () => {
            provider = createProvider();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const ownerUri = "file:///test.sql";
            connectionManagerStub.getConnectionInfo.returns({
                credentials: {
                    server: "localhost",
                    database: "master",
                    authenticationType: Constants.sqlAuthentication,
                    user: "sa",
                } as any,
            } as any);
            outputContentProviderStub.getQueryRunner.returns({
                getQueryString: sandbox.stub().returns("SELECT 1"),
            } as any);

            secretStorage.store.resetHistory();
            provider.refresh(ownerUri, new Date(2025, 0, 15), false);

            // Wait for async persist
            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(secretStorage.store).to.have.been.called;
            const storeCall = secretStorage.store.lastCall;
            expect(storeCall.args[0]).to.equal(Constants.queryHistorySecretStorageKey);

            const payload = JSON.parse(storeCall.args[1]);
            expect(payload.version).to.equal(1);
            expect(payload.nodes).to.have.lengthOf(1);
            expect(payload.nodes[0].queryString).to.equal("SELECT 1");
            expect(payload.nodes[0].isSuccess).to.equal(true);
            expect(payload.nodes[0].connectionLabel).to.contain("localhost");
        });

        test("should cap persisted node count and query length", async () => {
            provider = createProvider();
            await waitForAsyncWork();

            const longQuery = "A".repeat(25000);
            const queryHistoryProvider = provider as unknown as {
                _queryHistoryNodes: Array<QueryHistoryNode | EmptyHistoryNode>;
                persistQueryHistory: () => Promise<void>;
            };

            queryHistoryProvider._queryHistoryNodes = [
                createTestNode(longQuery, "(localhost|db0)", new Date(2025, 0, 1)),
                ...Array.from({ length: 259 }, (_, index) =>
                    createTestNode(
                        `SELECT ${index + 1}`,
                        `(localhost|db${index + 1})`,
                        new Date(2025, 0, 1, 0, index + 1),
                    ),
                ),
            ];

            secretStorage.store.resetHistory();
            await queryHistoryProvider.persistQueryHistory();

            expect(secretStorage.store).to.have.been.calledOnce;
            const payload = JSON.parse(secretStorage.store.firstCall.args[1]);
            expect(payload.nodes).to.have.lengthOf(250);
            expect(payload.nodes[0].queryString.length).to.equal(20000);
        });

        test("should delete storage key when no history nodes remain", async () => {
            provider = createProvider();
            await new Promise((resolve) => setTimeout(resolve, 50));

            secretStorage.delete.resetHistory();
            provider.clearAll();

            // Wait for async persist
            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(secretStorage.delete).to.have.been.calledWithExactly(
                Constants.queryHistorySecretStorageKey,
            );
        });
    });

    suite("showQueryHistoryCommandPalette", () => {
        test("should filter out EmptyHistoryNode when building quick pick list", async () => {
            provider = createProvider();
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Provider starts with EmptyHistoryNode; calling showQueryHistoryCommandPalette
            // should not pass EmptyHistoryNode to the UI
            prompterStub.promptSingle.resolves(undefined);

            await provider.showQueryHistoryCommandPalette();

            // The prompter should have been called with an empty options array
            // since EmptyHistoryNode is filtered out
            expect(prompterStub.promptSingle).to.have.been.calledOnce;
        });
    });
});

suite("QueryHistoryNode Tests", () => {
    setup(() => {
        initializeIconUtils();
    });

    test("isSuccess getter should return true for successful queries", () => {
        const node = new QueryHistoryNode(
            "SELECT 1 : (localhost|master)",
            "tooltip",
            "SELECT 1",
            "file:///test.sql",
            undefined,
            new Date(),
            "(localhost|master)",
            true,
        );
        expect(node.isSuccess).to.equal(true);
    });

    test("isSuccess getter should return false for failed queries", () => {
        const node = new QueryHistoryNode(
            "SELECT 1 : (localhost|master)",
            "tooltip",
            "SELECT 1",
            "file:///test.sql",
            undefined,
            new Date(),
            "(localhost|master)",
            false,
        );
        expect(node.isSuccess).to.equal(false);
    });
});
