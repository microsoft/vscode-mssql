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
import {
    decryptData,
    type EncryptedData,
    encryptData,
    generateEncryptionKey,
} from "../../src/utils/encryptionUtils";

chai.use(sinonChai);

suite("QueryHistoryProvider persistence", () => {
    interface PersistedQueryHistoryPayload {
        version: number;
        nodes: Array<{
            queryString: string;
            ownerUri?: string;
            credentials?: Record<string, unknown>;
            timeStamp: number;
            connectionLabel: string;
            isSuccess: boolean;
        }>;
    }

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
    let secretValues: Map<string, string>;
    let persistedFileContents: Uint8Array | undefined;

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

    function waitForPersistedStorageWork(): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, 50));
    }

    function setEncryptedPersistedHistoryContent(
        serializedHistory: string,
        encryptionKey: string = generateEncryptionKey(),
    ): string {
        secretValues.set(Constants.queryHistoryEncryptionKeySecretStorageKey, encryptionKey);
        persistedFileContents = new TextEncoder().encode(
            JSON.stringify(encryptData(serializedHistory, encryptionKey)),
        );

        return encryptionKey;
    }

    function setEncryptedPersistedHistory(
        persistedData: unknown,
        encryptionKey: string = generateEncryptionKey(),
    ): string {
        return setEncryptedPersistedHistoryContent(JSON.stringify(persistedData), encryptionKey);
    }

    function getPersistedHistoryPayload(): PersistedQueryHistoryPayload {
        expect(persistedFileContents).to.not.be.undefined;

        const encryptionKey = secretValues.get(Constants.queryHistoryEncryptionKeySecretStorageKey);
        expect(encryptionKey).to.not.be.undefined;

        const encryptedData = JSON.parse(
            new TextDecoder().decode(persistedFileContents),
        ) as EncryptedData;

        return JSON.parse(
            decryptData(encryptedData, encryptionKey!),
        ) as PersistedQueryHistoryPayload;
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        initializeIconUtils();
        secretValues = new Map<string, string>();
        persistedFileContents = undefined;

        connectionManagerStub = sandbox.createStubInstance(ConnectionManager);
        outputContentProviderStub = sandbox.createStubInstance(SqlOutputContentProvider);
        vscodeWrapperStub = stubVscodeWrapper(sandbox);
        sqlDocumentServiceStub = sandbox.createStubInstance(SqlDocumentService);
        statusViewStub = sandbox.createStubInstance(StatusView);
        prompterStub = sandbox.createStubInstance(CodeAdapter);

        sandbox.stub(vscode.workspace.fs, "createDirectory").resolves();
        sandbox.stub(vscode.workspace.fs, "writeFile").callsFake(async (_uri, content) => {
            persistedFileContents = content;
        });
        sandbox.stub(vscode.workspace.fs, "readFile").callsFake(async () => {
            if (!persistedFileContents) {
                throw vscode.FileSystemError.FileNotFound();
            }

            return persistedFileContents;
        });
        sandbox.stub(vscode.workspace.fs, "delete").callsFake(async () => {
            persistedFileContents = undefined;
        });
        sandbox.stub(vscode.workspace.fs, "stat").callsFake(async () => {
            if (!persistedFileContents) {
                throw vscode.FileSystemError.FileNotFound();
            }

            return {
                type: vscode.FileType.File,
                ctime: 0,
                mtime: 0,
                size: persistedFileContents.length,
            } as vscode.FileStat;
        });

        const config = createWorkspaceConfiguration({
            [Constants.configQueryHistoryLimit]: 10,
        });
        vscodeWrapperStub.getConfiguration.returns(config);

        secretStorage = {
            get: sandbox
                .stub<[string], Promise<string | undefined>>()
                .callsFake(async (key) => secretValues.get(key)),
            store: sandbox.stub<[string, string], Promise<void>>().callsFake(async (key, value) => {
                secretValues.set(key, value);
            }),
            delete: sandbox.stub<[string], Promise<void>>().callsFake(async (key) => {
                secretValues.delete(key);
            }),
        };

        context = {
            secrets: secretStorage as unknown as vscode.SecretStorage,
            subscriptions: [],
            globalStorageUri: vscode.Uri.file("/query-history-tests"),
        } as unknown as vscode.ExtensionContext;
    });

    teardown(() => {
        sandbox.restore();
    });

    test("restores nodes from encrypted global storage", async () => {
        setEncryptedPersistedHistory({
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
        });

        provider = createProvider();
        await waitForPersistedStorageWork();

        const children = provider.getChildren();
        expect(children).to.have.lengthOf(2);
        expect((children[0] as QueryHistoryNode).queryString).to.equal("SELECT * FROM users");
        expect((children[1] as QueryHistoryNode).queryString).to.equal(
            "INSERT INTO logs VALUES(1)",
        );
        expect(secretStorage.store).to.not.have.been.called;
    });

    test("restores persisted credentials", async () => {
        setEncryptedPersistedHistory({
            version: 1,
            nodes: [
                {
                    queryString: "SELECT 1",
                    ownerUri: "file:///test.sql",
                    credentials: {
                        server: "localhost",
                        database: "master",
                        authenticationType: Constants.sqlAuthentication,
                        user: "sa",
                        password: "secret",
                        savePassword: true,
                    },
                    timeStamp: new Date(2025, 0, 15, 10, 30, 0).getTime(),
                    connectionLabel: "(localhost|master) : sa",
                    isSuccess: true,
                },
            ],
        });

        provider = createProvider();
        await waitForPersistedStorageWork();

        const node = provider.getChildren()[0] as QueryHistoryNode;
        expect(node.credentials).to.deep.include({
            server: "localhost",
            database: "master",
            user: "sa",
            password: "secret",
        });
    });

    test("does not overwrite newer history when restore finishes later", async () => {
        setEncryptedPersistedHistory({
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
        });

        let resolveStoredHistory: ((value: Uint8Array) => void) | undefined;
        const encryptedFileContents = persistedFileContents;
        const readFileStub = vscode.workspace.fs.readFile as unknown as sinon.SinonStub;
        readFileStub.callsFake(
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
        resolveStoredHistory?.(encryptedFileContents!);
        await waitForPersistedStorageWork();

        const node = provider.getChildren()[0] as QueryHistoryNode;
        expect(node.queryString).to.equal("fresh query");
        expect(node.ownerUri).to.equal("file:///fresh.sql");
    });

    test("shows EmptyHistoryNode when encrypted storage has invalid JSON", async () => {
        setEncryptedPersistedHistoryContent("not valid json{{{");

        provider = createProvider();
        await waitForPersistedStorageWork();

        const children = provider.getChildren();
        expect(children).to.have.lengthOf(1);
        expect(children[0]).to.be.instanceOf(EmptyHistoryNode);
    });

    test("stores history nodes in encrypted global storage", async () => {
        provider = createProvider();
        await waitForPersistedStorageWork();

        connectionManagerStub.getConnectionInfo.returns({
            credentials: {
                server: "localhost",
                database: "master",
                authenticationType: Constants.sqlAuthentication,
                user: "sa",
                password: "secret",
                savePassword: true,
            } as any,
        } as any);
        outputContentProviderStub.getQueryRunner.returns({
            getQueryString: sandbox.stub().returns("SELECT 1"),
        } as any);

        provider.refresh("file:///test.sql", new Date(2025, 0, 15), false);
        await waitForPersistedStorageWork();

        expect(secretStorage.store).to.have.been.calledOnceWithExactly(
            Constants.queryHistoryEncryptionKeySecretStorageKey,
            sinon.match.string,
        );

        const payload = getPersistedHistoryPayload();
        expect(payload.version).to.equal(1);
        expect(payload.nodes).to.have.lengthOf(1);
        expect(payload.nodes[0].queryString).to.equal("SELECT 1");
        expect(payload.nodes[0].connectionLabel).to.contain("localhost");
        expect(payload.nodes[0].credentials).to.deep.include({
            server: "localhost",
            database: "master",
            user: "sa",
            password: "secret",
        });
    });

    test("does not persist password when savePassword is false", async () => {
        provider = createProvider();
        await waitForPersistedStorageWork();

        connectionManagerStub.getConnectionInfo.returns({
            credentials: {
                server: "localhost",
                database: "master",
                authenticationType: Constants.sqlAuthentication,
                user: "sa",
                password: "secret",
                savePassword: false,
            } as any,
        } as any);
        outputContentProviderStub.getQueryRunner.returns({
            getQueryString: sandbox.stub().returns("SELECT 1"),
        } as any);

        provider.refresh("file:///test.sql", new Date(2025, 0, 15), false);
        await waitForPersistedStorageWork();

        const payload = getPersistedHistoryPayload();
        expect(payload.nodes[0].credentials).to.deep.include({
            server: "localhost",
            database: "master",
            user: "sa",
            password: "",
        });
    });

    test("caps persisted node count and query length", async () => {
        provider = createProvider();
        await waitForPersistedStorageWork();

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

        await queryHistoryProvider.persistQueryHistory();

        const payload = getPersistedHistoryPayload();
        expect(payload.nodes).to.have.lengthOf(250);
        expect(payload.nodes[0].queryString.length).to.equal(20000);
    });

    test("clears persisted file when no history nodes remain", async () => {
        provider = createProvider();
        await waitForPersistedStorageWork();

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

        provider.refresh("file:///test.sql", new Date(2025, 0, 15), false);
        await waitForPersistedStorageWork();
        expect(persistedFileContents).to.not.be.undefined;

        provider.clearAll();
        await waitForPersistedStorageWork();

        expect(persistedFileContents).to.be.undefined;
    });
});
