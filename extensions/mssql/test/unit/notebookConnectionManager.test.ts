/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import type { IConnectionInfo } from "vscode-mssql";

chai.use(sinonChai);
import { NotebookConnectionManager } from "../../src/notebooks/notebookConnectionManager";
import ConnectionManager from "../../src/controllers/connectionManager";
import { ConnectionSharingService } from "../../src/connectionSharing/connectionSharingService";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { QueryNotificationHandler } from "../../src/controllers/queryNotificationHandler";

function makeLog(): any {
    return {
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
        debug: sinon.stub(),
        trace: sinon.stub(),
    };
}

function makeConnectionInfo(overrides?: Partial<IConnectionInfo>): IConnectionInfo {
    return {
        server: "test-server",
        database: "TestDB",
        user: "sa",
        password: "password",
        authenticationType: "SqlLogin",
        ...overrides,
    } as IConnectionInfo;
}

suite("NotebookConnectionManager", () => {
    let sandbox: sinon.SinonSandbox;
    let connectionMgr: any;
    let sharingService: any;
    let mockClient: any;
    let mockNotificationHandler: any;
    let log: any;
    let mgr: NotebookConnectionManager;

    setup(() => {
        sandbox = sinon.createSandbox();

        connectionMgr = {
            connect: sandbox.stub().resolves(true),
            listDatabases: sandbox.stub().resolves(["master", "TestDB"]),
            createConnectionDetails: sandbox.stub().returns({ serverName: "test-server" }),
            sendRequest: sandbox.stub().resolves(true),
            getConnectionInfoFromUri: sandbox
                .stub()
                .returns(makeConnectionInfo({ database: "TestDB" })),
            connectionStore: {
                getPickListItems: sandbox.stub().resolves([]),
            },
            connectionUI: {
                promptForConnection: sandbox.stub().resolves(makeConnectionInfo()),
            },
        };

        sharingService = {
            isConnected: sandbox.stub().returns(false),
            disconnect: sandbox.stub(),
            cancelQuery: sandbox.stub().resolves(),
        };

        mockClient = {
            sendRequest: sandbox.stub().resolves({}),
        };

        mockNotificationHandler = {
            registerRunner: sandbox.stub(),
            unregisterRunner: sandbox.stub(),
        };

        log = makeLog();

        mgr = new NotebookConnectionManager(
            connectionMgr as unknown as ConnectionManager,
            sharingService as unknown as ConnectionSharingService,
            log,
            mockClient as unknown as SqlToolsServiceClient,
            mockNotificationHandler as unknown as QueryNotificationHandler,
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("ensureConnection", () => {
        test("returns existing URI when connection is alive", async () => {
            // Set up an existing connection by connecting first
            const uri = await mgr.promptAndConnect();
            sharingService.isConnected.returns(true);

            const result = await mgr.ensureConnection();
            expect(result).to.equal(uri);
        });

        test("prompts when no connection exists", async () => {
            await mgr.ensureConnection();
            expect(connectionMgr.connectionUI.promptForConnection).to.have.been.calledOnce;
        });

        test("prompts when existing connection is stale", async () => {
            // Connect first
            await mgr.promptAndConnect();
            sharingService.isConnected.returns(false);

            // Reset to count only the second call
            connectionMgr.connectionUI.promptForConnection.resetHistory();
            await mgr.ensureConnection();
            expect(connectionMgr.connectionUI.promptForConnection).to.have.been.calledOnce;
        });
    });

    suite("promptAndConnect", () => {
        test("connects with user-selected profile", async () => {
            const uri = await mgr.promptAndConnect();
            expect(uri).to.be.a("string");
            expect(connectionMgr.connect).to.have.been.calledOnce;
        });

        test("throws when user cancels connection dialog", async () => {
            connectionMgr.connectionUI.promptForConnection.resolves(undefined);
            try {
                await mgr.promptAndConnect();
                expect.fail("should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("No connection selected");
            }
        });

        test("throws when connect fails", async () => {
            connectionMgr.connect.resolves(false);
            try {
                await mgr.promptAndConnect();
                expect.fail("should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("Connection failed");
            }
        });

        test("sets connection label after connect", async () => {
            await mgr.promptAndConnect();
            const label = mgr.getConnectionLabel();
            expect(label).to.include("test-server");
        });
    });

    suite("connectWith", () => {
        test("connects and sets label", async () => {
            const info = makeConnectionInfo();
            const uri = await mgr.connectWith(info);
            expect(uri).to.be.a("string");
            expect(mgr.getConnectionLabel()).to.include("test-server");
        });

        test("uses actual database from STS in connection info", async () => {
            // STS reports the actual database the server opened
            connectionMgr.getConnectionInfoFromUri.returns(
                makeConnectionInfo({ database: "ActualDB" }),
            );

            const info = makeConnectionInfo({ database: "RequestedDB" });
            await mgr.connectWith(info);

            expect(connectionMgr.connect).to.have.been.calledOnce;
            expect(mgr.getConnectionInfo().database).to.equal("ActualDB");
        });
    });

    suite("changeDatabase", () => {
        test("disconnects and reconnects with new database", async () => {
            // First connect
            await mgr.connectWith(makeConnectionInfo());
            sharingService.disconnect.resetHistory();
            connectionMgr.connect.resetHistory();

            await mgr.changeDatabase("NewDB");
            expect(sharingService.disconnect).to.have.been.calledOnce;
            expect(connectionMgr.connect).to.have.been.calledOnce;
        });

        test("throws when not connected", async () => {
            try {
                await mgr.changeDatabase("NewDB");
                expect.fail("should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("No active connection");
            }
        });
    });

    suite("disconnect", () => {
        test("disconnects and clears state", async () => {
            await mgr.connectWith(makeConnectionInfo());
            mgr.disconnect();

            expect(mgr.isConnected()).to.be.false;
            expect(mgr.getConnectionUri()).to.be.undefined;
            expect(mgr.getConnectionInfo()).to.be.undefined;
        });

        test("is safe to call when not connected", () => {
            expect(() => mgr.disconnect()).to.not.throw();
        });
    });

    suite("executeQueryString", () => {
        test("throws when not connected", async () => {
            try {
                await mgr.executeQueryString("SELECT 1");
                expect.fail("should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("No active connection");
            }
        });

        test("delegates to query executor when connected", async () => {
            await mgr.connectWith(makeConnectionInfo());

            // The executor registers a handler, sends executeString, then waits.
            // For this test, simulate immediate query/complete by capturing the handler
            // and calling handleQueryComplete on it.
            mockClient.sendRequest.callsFake((_type: any, _params: any) => {
                // When executeString is sent, simulate completion
                const handler = mockNotificationHandler.registerRunner.lastCall?.args[0];
                if (handler?.handleQueryComplete) {
                    // Simulate batch lifecycle
                    handler.handleBatchStart({
                        batchSummary: {
                            id: 0,
                            hasError: false,
                            selection: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
                            resultSetSummaries: [],
                            executionElapsed: "00:00:00",
                            executionEnd: "",
                            executionStart: "",
                        },
                        ownerUri: "test",
                    });
                    handler.handleBatchComplete({
                        batchSummary: {
                            id: 0,
                            hasError: false,
                            selection: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
                            resultSetSummaries: [],
                            executionElapsed: "00:00:00",
                            executionEnd: "",
                            executionStart: "",
                        },
                        ownerUri: "test",
                    });
                    handler.handleQueryComplete({
                        ownerUri: "test",
                        batchSummaries: [],
                    });
                }
                return Promise.resolve({});
            });

            const result = await mgr.executeQueryString("SELECT 1");
            expect(result).to.have.property("batches");
            expect(result).to.have.property("canceled", false);
        });
    });

    suite("listDatabases", () => {
        test("returns databases from connection manager", async () => {
            await mgr.connectWith(makeConnectionInfo());
            const databases = await mgr.listDatabases();
            expect(databases).to.deep.equal(["master", "TestDB"]);
        });

        test("throws when not connected", async () => {
            try {
                await mgr.listDatabases();
                expect.fail("should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("No active connection");
            }
        });
    });

    suite("getCurrentDatabase", () => {
        test("returns database from label", async () => {
            await mgr.connectWith(makeConnectionInfo());
            expect(mgr.getCurrentDatabase()).to.equal("TestDB");
        });

        test("returns empty string when not connected", () => {
            expect(mgr.getCurrentDatabase()).to.equal("");
        });
    });

    suite("connectCellForIntellisense", () => {
        test("sends connect request for cell URI", async () => {
            await mgr.connectWith(makeConnectionInfo());
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            expect(connectionMgr.sendRequest).to.have.been.called;
        });

        test("does nothing when not connected", async () => {
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            expect(connectionMgr.sendRequest).to.not.have.been.called;
        });

        test("handles createConnectionDetails failure gracefully", async () => {
            await mgr.connectWith(makeConnectionInfo());
            connectionMgr.createConnectionDetails.throws(new Error("bad details"));
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            // Should not throw, should log a warning
            expect(log.warn).to.have.been.called;
        });

        test("handles sendRequest failure gracefully", async () => {
            await mgr.connectWith(makeConnectionInfo());
            connectionMgr.sendRequest.rejects(new Error("request failed"));
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            expect(log.warn).to.have.been.called;
        });
    });

    suite("dispose", () => {
        test("disconnects on dispose", async () => {
            await mgr.connectWith(makeConnectionInfo());
            mgr.dispose();
            expect(mgr.isConnected()).to.be.false;
        });
    });
});
