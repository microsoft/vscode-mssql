/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import * as vscode from "vscode";
import type { IConnectionInfo } from "vscode-mssql";
import { QueryHistoryProvider } from "../../src/queryHistory/queryHistoryProvider";
import { QueryHistoryNode, EmptyHistoryNode } from "../../src/queryHistory/queryHistoryNode";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import { SqlOutputContentProvider } from "../../src/models/sqlOutputContentProvider";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import SqlDocumentService from "../../src/controllers/sqlDocumentService";
import StatusView from "../../src/views/statusView";
import * as Constants from "../../src/constants/constants";
import type { IConnectionProfile } from "../../src/models/interfaces";
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
    type QueryRunnerStub = Pick<
        ReturnType<SqlOutputContentProvider["getQueryRunner"]>,
        "getQueryString"
    >;
    type TestConnectionCredentials = Pick<
        IConnectionProfile,
        "server" | "database" | "authenticationType" | "user"
    > &
        Partial<Pick<IConnectionProfile, "password" | "savePassword">>;
    type QueryHistoryProviderPrivate = QueryHistoryProvider & {
        readEncryptedPersistedQueryHistory(): Promise<string | undefined>;
        writePersistedQueryHistoryContent(serializedHistory: string): Promise<void>;
        clearPersistedQueryHistoryContent(): Promise<void>;
    };

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
    let readEncryptedPersistedQueryHistoryStub: sinon.SinonStub<[], Promise<string | undefined>>;

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

    function createQueryRunnerStub(
        queryString: string,
    ): ReturnType<SqlOutputContentProvider["getQueryRunner"]> {
        const queryRunner: QueryRunnerStub = {
            getQueryString: sandbox.stub().returns(queryString),
        };

        return queryRunner as ReturnType<SqlOutputContentProvider["getQueryRunner"]>;
    }

    function createConnectionResult(credentials: TestConnectionCredentials): ConnectionInfo {
        const connectionInfo = new ConnectionInfo();
        connectionInfo.credentials = credentials as unknown as IConnectionInfo;
        return connectionInfo;
    }

    async function readPersistedFileContents(): Promise<Uint8Array | undefined> {
        return persistedFileContents;
    }

    async function readEncryptedPersistedHistoryContent(): Promise<string | undefined> {
        const encryptedFileContents = await readPersistedFileContents();
        if (!encryptedFileContents) {
            return undefined;
        }

        const encryptionKey = secretValues.get(Constants.queryHistoryEncryptionKeySecretStorageKey);
        if (!encryptionKey) {
            return undefined;
        }

        const encryptedData = JSON.parse(
            new TextDecoder().decode(encryptedFileContents),
        ) as EncryptedData;

        return decryptData(encryptedData, encryptionKey);
    }

    async function writePersistedHistoryContent(serializedHistory: string): Promise<void> {
        let encryptionKey = secretValues.get(Constants.queryHistoryEncryptionKeySecretStorageKey);
        if (!encryptionKey) {
            encryptionKey = generateEncryptionKey();
            await secretStorage.store(
                Constants.queryHistoryEncryptionKeySecretStorageKey,
                encryptionKey,
            );
        }

        persistedFileContents = new TextEncoder().encode(
            JSON.stringify(encryptData(serializedHistory, encryptionKey)),
        );
    }

    async function clearPersistedHistoryContent(): Promise<void> {
        persistedFileContents = undefined;
    }

    async function setEncryptedPersistedHistoryContent(
        serializedHistory: string,
        encryptionKey: string = generateEncryptionKey(),
    ): Promise<string> {
        secretValues.set(Constants.queryHistoryEncryptionKeySecretStorageKey, encryptionKey);
        persistedFileContents = new TextEncoder().encode(
            JSON.stringify(encryptData(serializedHistory, encryptionKey)),
        );

        return encryptionKey;
    }

    async function setEncryptedPersistedHistory(
        persistedData: unknown,
        encryptionKey: string = generateEncryptionKey(),
    ): Promise<string> {
        return setEncryptedPersistedHistoryContent(JSON.stringify(persistedData), encryptionKey);
    }

    async function getPersistedHistoryPayload(): Promise<PersistedQueryHistoryPayload> {
        const persistedFileContents = await readPersistedFileContents();
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

        const queryHistoryProviderPrototype =
            QueryHistoryProvider.prototype as unknown as QueryHistoryProviderPrivate;
        readEncryptedPersistedQueryHistoryStub = sandbox.stub(
            queryHistoryProviderPrototype,
            "readEncryptedPersistedQueryHistory",
        ) as sinon.SinonStub<[], Promise<string | undefined>>;
        readEncryptedPersistedQueryHistoryStub.callsFake(readEncryptedPersistedHistoryContent);
        sandbox
            .stub(queryHistoryProviderPrototype, "writePersistedQueryHistoryContent")
            .callsFake(async (serializedHistory: string) =>
                writePersistedHistoryContent(serializedHistory),
            );
        sandbox
            .stub(queryHistoryProviderPrototype, "clearPersistedQueryHistoryContent")
            .callsFake(async () => clearPersistedHistoryContent());
    });

    teardown(() => {
        sandbox.restore();
        persistedFileContents = undefined;
    });

    test("restores nodes from encrypted global storage", async () => {
        await setEncryptedPersistedHistory({
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
        await setEncryptedPersistedHistory({
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
                        password: "example-value",
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
            password: "example-value",
        });
    });

    test("does not overwrite newer history when restore finishes later", async () => {
        const persistedHistory = {
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
        readEncryptedPersistedQueryHistoryStub.resetBehavior();
        readEncryptedPersistedQueryHistoryStub.callsFake(
            () =>
                new Promise((resolve) => {
                    resolveStoredHistory = resolve;
                }),
        );

        provider = createProvider();

        outputContentProviderStub.getQueryRunner.returns(createQueryRunnerStub("fresh query"));
        connectionManagerStub.getConnectionInfo.returns(
            createConnectionResult({
                server: "localhost",
                database: "master",
                authenticationType: Constants.sqlAuthentication,
                user: "sa",
            }),
        );

        provider.refresh("file:///fresh.sql", new Date(2025, 0, 20), false);

        expect(resolveStoredHistory).to.not.be.undefined;
        resolveStoredHistory?.(JSON.stringify(persistedHistory));
        await waitForPersistedStorageWork();

        const node = provider.getChildren()[0] as QueryHistoryNode;
        expect(node.queryString).to.equal("fresh query");
        expect(node.ownerUri).to.equal("file:///fresh.sql");
    });

    test("shows EmptyHistoryNode when encrypted storage has invalid JSON", async () => {
        await setEncryptedPersistedHistoryContent("not valid json{{{");

        provider = createProvider();
        await waitForPersistedStorageWork();

        const children = provider.getChildren();
        expect(children).to.have.lengthOf(1);
        expect(children[0]).to.be.instanceOf(EmptyHistoryNode);
    });

    test("stores history nodes in encrypted global storage", async () => {
        provider = createProvider();
        await waitForPersistedStorageWork();

        connectionManagerStub.getConnectionInfo.returns(
            createConnectionResult({
                server: "localhost",
                database: "master",
                authenticationType: Constants.sqlAuthentication,
                user: "sa",
                password: "example-value",
                savePassword: true,
            }),
        );
        outputContentProviderStub.getQueryRunner.returns(createQueryRunnerStub("SELECT 1"));

        provider.refresh("file:///test.sql", new Date(2025, 0, 15), false);
        await waitForPersistedStorageWork();

        expect(secretStorage.store).to.have.been.calledOnceWithExactly(
            Constants.queryHistoryEncryptionKeySecretStorageKey,
            sinon.match.string,
        );

        const payload = await getPersistedHistoryPayload();
        expect(payload.version).to.equal(1);
        expect(payload.nodes).to.have.lengthOf(1);
        expect(payload.nodes[0].queryString).to.equal("SELECT 1");
        expect(payload.nodes[0].connectionLabel).to.contain("localhost");
        expect(payload.nodes[0].credentials).to.deep.include({
            server: "localhost",
            database: "master",
            user: "sa",
            password: "example-value",
        });
    });

    test("does not persist password when savePassword is false", async () => {
        provider = createProvider();
        await waitForPersistedStorageWork();

        connectionManagerStub.getConnectionInfo.returns(
            createConnectionResult({
                server: "localhost",
                database: "master",
                authenticationType: Constants.sqlAuthentication,
                user: "sa",
                password: "example-value",
                savePassword: false,
            }),
        );
        outputContentProviderStub.getQueryRunner.returns(createQueryRunnerStub("SELECT 1"));

        provider.refresh("file:///test.sql", new Date(2025, 0, 15), false);
        await waitForPersistedStorageWork();

        const payload = await getPersistedHistoryPayload();
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

        const payload = await getPersistedHistoryPayload();
        expect(payload.nodes).to.have.lengthOf(250);
        expect(payload.nodes[0].queryString.length).to.equal(20000);
    });

    test("clears persisted file when no history nodes remain", async () => {
        provider = createProvider();
        await waitForPersistedStorageWork();

        connectionManagerStub.getConnectionInfo.returns(
            createConnectionResult({
                server: "localhost",
                database: "master",
                authenticationType: Constants.sqlAuthentication,
                user: "sa",
            }),
        );
        outputContentProviderStub.getQueryRunner.returns(createQueryRunnerStub("SELECT 1"));

        provider.refresh("file:///test.sql", new Date(2025, 0, 15), false);
        await waitForPersistedStorageWork();
        expect(await readPersistedFileContents()).to.not.be.undefined;

        provider.clearAll();
        await waitForPersistedStorageWork();

        expect(await readPersistedFileContents()).to.be.undefined;
    });
});
