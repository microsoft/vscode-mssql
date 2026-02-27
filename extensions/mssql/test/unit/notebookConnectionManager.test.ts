/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import type { IConnectionInfo, SimpleExecuteResult } from "vscode-mssql";
import { NotebookConnectionManager } from "../../src/notebooks/notebookConnectionManager";
import ConnectionManager from "../../src/controllers/connectionManager";
import { ConnectionSharingService } from "../../src/connectionSharing/connectionSharingService";

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

function makeSimpleResult(overrides?: Partial<SimpleExecuteResult>): SimpleExecuteResult {
    return {
        rowCount: 0,
        columnInfo: [],
        rows: [],
        messages: [],
        ...overrides,
    } as SimpleExecuteResult;
}

suite("NotebookConnectionManager", () => {
    let sandbox: sinon.SinonSandbox;
    let connectionMgr: any;
    let sharingService: any;
    let log: any;
    let mgr: NotebookConnectionManager;

    setup(() => {
        sandbox = sinon.createSandbox();

        connectionMgr = {
            connect: sandbox.stub().resolves(true),
            listDatabases: sandbox.stub().resolves(["master", "TestDB"]),
            createConnectionDetails: sandbox.stub().returns({ serverName: "test-server" }),
            sendRequest: sandbox.stub().resolves(true),
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
            executeSimpleQuery: sandbox.stub().resolves(
                makeSimpleResult({
                    rows: [[{ displayValue: "TestDB", isNull: false }]],
                }),
            ),
            cancelQuery: sandbox.stub().resolves(),
        };

        log = makeLog();

        mgr = new NotebookConnectionManager(
            connectionMgr as unknown as ConnectionManager,
            sharingService as unknown as ConnectionSharingService,
            log,
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

        test("reconnects when database mismatch detected", async () => {
            // First query returns wrong DB, second returns correct
            sharingService.executeSimpleQuery
                .onFirstCall()
                .resolves(
                    makeSimpleResult({
                        rows: [[{ displayValue: "master", isNull: false }]],
                    }),
                )
                .onSecondCall()
                .resolves(
                    makeSimpleResult({
                        rows: [[{ displayValue: "TestDB", isNull: false }]],
                    }),
                );

            const info = makeConnectionInfo({ database: "TestDB" });
            await mgr.connectWith(info);

            // Should have connected twice (initial + reconnect)
            expect(connectionMgr.connect).to.have.been.calledTwice;
            expect(sharingService.disconnect).to.have.been.calledOnce;
        });

        test("uses profile database when DB verification fails", async () => {
            sharingService.executeSimpleQuery.rejects(new Error("query failed"));
            const info = makeConnectionInfo({ database: "MyDB" });
            await mgr.connectWith(info);
            expect(mgr.getConnectionLabel()).to.include("MyDB");
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

    suite("executeQuery", () => {
        test("delegates to connection sharing service", async () => {
            await mgr.connectWith(makeConnectionInfo());
            const expected = makeSimpleResult({ rowCount: 5 });
            sharingService.executeSimpleQuery.resolves(expected);

            const result = await mgr.executeQuery("SELECT 1");
            expect(result).to.equal(expected);
        });

        test("throws when not connected", async () => {
            try {
                await mgr.executeQuery("SELECT 1");
                expect.fail("should have thrown");
            } catch (err: any) {
                expect(err.message).to.include("No active connection");
            }
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

    suite("cancelExecution", () => {
        test("sends cancel request when connected", async () => {
            await mgr.connectWith(makeConnectionInfo());
            await mgr.cancelExecution();
            expect(sharingService.cancelQuery).to.have.been.calledOnce;
        });

        test("does nothing when not connected", async () => {
            await mgr.cancelExecution();
            expect(sharingService.cancelQuery).to.not.have.been.called;
        });

        test("swallows errors from cancel request", async () => {
            await mgr.connectWith(makeConnectionInfo());
            sharingService.cancelQuery.rejects(new Error("cancel failed"));
            await mgr.cancelExecution(); // should not throw
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
