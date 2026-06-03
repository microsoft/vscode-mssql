/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tests for `VsCodeMssqlConnectionStrategy` — the host-glue
 * `LiveConnectionStrategy` that bridges Cloud Deploy's connection seam to
 * vscode-mssql's `ConnectionManager`. Covers profile lookup, owner-URI
 * lifecycle, signal cancellation, error mapping, and idempotent dispose.
 *
 * The `ConnectionManager` itself is stubbed via `FakeConnectionManager`:
 * the strategy only touches a tiny public surface (`connectionStore.connectionConfig.getConnectionById`,
 * `connect`, `disconnect`, `client.sendRequest`), so a typed shim suffices.
 */

import { expect } from "chai";

import ConnectionManager from "../../src/controllers/connectionManager";
import { ConnectionError } from "../../src/cloudDeploy/validation/providers/connectionProvider";
import { VsCodeMssqlConnectionStrategy } from "../../src/cloudDeploy/host/vscodeMssqlConnectionStrategy";

interface ProfileRecord {
    readonly id: string;
    readonly server: string;
}

interface ConnectCall {
    readonly ownerUri: string;
    readonly profileId: string;
}

interface SimpleExecuteRow {
    readonly displayValue: string;
    readonly isNull: boolean;
}

class FakeConnectionManager {
    public connectResult: boolean | (() => boolean | Promise<boolean>) = true;
    public connectThrow: Error | undefined;
    public sendRequestImpl:
        | ((sql: string, ownerUri: string) => SimpleExecuteRow[][] | Promise<SimpleExecuteRow[][]>)
        | undefined;
    public sendRequestThrow: Error | undefined;
    public disconnectThrow: Error | undefined;

    public connectCalls: ConnectCall[] = [];
    public disconnectCalls: string[] = [];
    public executeCalls: Array<{ sql: string; ownerUri: string }> = [];

    public constructor(private readonly _profiles: Record<string, ProfileRecord>) {}

    public get connectionStore() {
        return {
            connectionConfig: {
                getConnectionById: async (id: string): Promise<ProfileRecord | undefined> =>
                    this._profiles[id],
            },
        };
    }

    public get client() {
        return {
            sendRequest: async (
                _type: unknown,
                params: { ownerUri: string; queryString: string },
            ) => {
                this.executeCalls.push({ sql: params.queryString, ownerUri: params.ownerUri });
                if (this.sendRequestThrow) {
                    throw this.sendRequestThrow;
                }
                const rows = this.sendRequestImpl
                    ? await this.sendRequestImpl(params.queryString, params.ownerUri)
                    : [];
                return { rowCount: rows.length, columnInfo: [], rows, messages: [] };
            },
        };
    }

    public async connect(
        ownerUri: string,
        profile: ProfileRecord,
        _options: { connectionSource?: string; shouldHandleErrors?: boolean },
    ): Promise<boolean> {
        this.connectCalls.push({ ownerUri, profileId: profile.id });
        if (this.connectThrow) {
            throw this.connectThrow;
        }
        return typeof this.connectResult === "function" ? this.connectResult() : this.connectResult;
    }

    public async disconnect(ownerUri: string): Promise<boolean> {
        this.disconnectCalls.push(ownerUri);
        if (this.disconnectThrow) {
            throw this.disconnectThrow;
        }
        return true;
    }
}

function asConnectionManager(fake: FakeConnectionManager): ConnectionManager {
    return fake as unknown as ConnectionManager;
}

suite("CloudDeploy VsCodeMssqlConnectionStrategy", () => {
    const profileId = "profile-A";
    const profile: ProfileRecord = { id: profileId, server: "localhost,1433" };

    test("throws ConnectionError(unknown) when profile id is not found", async () => {
        const fake = new FakeConnectionManager({});
        const strategy = new VsCodeMssqlConnectionStrategy(asConnectionManager(fake));

        try {
            await strategy.connectByProfileId("missing", new AbortController().signal);
            expect.fail("expected ConnectionError");
        } catch (err) {
            expect(err).to.be.instanceOf(ConnectionError);
            expect((err as ConnectionError).kind).to.equal("unknown");
            expect((err as ConnectionError).message).to.contain("missing");
        }
        expect(fake.connectCalls).to.have.length(0);
    });

    test("throws ConnectionError(timeout) when signal is pre-aborted; never looks up profile", async () => {
        const fake = new FakeConnectionManager({ [profileId]: profile });
        const strategy = new VsCodeMssqlConnectionStrategy(asConnectionManager(fake));
        const ctrl = new AbortController();
        ctrl.abort();

        try {
            await strategy.connectByProfileId(profileId, ctrl.signal);
            expect.fail("expected ConnectionError");
        } catch (err) {
            expect(err).to.be.instanceOf(ConnectionError);
            expect((err as ConnectionError).kind).to.equal("timeout");
        }
        expect(fake.connectCalls).to.have.length(0);
    });

    test("throws ConnectionError(unknown) when ConnectionManager.connect returns false", async () => {
        const fake = new FakeConnectionManager({ [profileId]: profile });
        fake.connectResult = false;
        const strategy = new VsCodeMssqlConnectionStrategy(asConnectionManager(fake));

        try {
            await strategy.connectByProfileId(profileId, new AbortController().signal);
            expect.fail("expected ConnectionError");
        } catch (err) {
            expect(err).to.be.instanceOf(ConnectionError);
            expect((err as ConnectionError).kind).to.equal("unknown");
        }
        expect(fake.connectCalls).to.have.length(1);
        expect(fake.connectCalls[0].profileId).to.equal(profileId);
    });

    test("wraps connect() exception as ConnectionError(unknown)", async () => {
        const fake = new FakeConnectionManager({ [profileId]: profile });
        fake.connectThrow = new Error("login refused");
        const strategy = new VsCodeMssqlConnectionStrategy(asConnectionManager(fake));

        try {
            await strategy.connectByProfileId(profileId, new AbortController().signal);
            expect.fail("expected ConnectionError");
        } catch (err) {
            expect(err).to.be.instanceOf(ConnectionError);
            expect((err as ConnectionError).kind).to.equal("unknown");
            expect((err as ConnectionError).message).to.contain("login refused");
        }
    });

    test("returns a usable handle on success; execute maps DbCellValue rows to (string|null)[][]", async () => {
        const fake = new FakeConnectionManager({ [profileId]: profile });
        fake.sendRequestImpl = (sql) => {
            expect(sql).to.equal("SELECT @@VERSION");
            return [
                [
                    { displayValue: "Microsoft SQL Server 2022", isNull: false },
                    { displayValue: "", isNull: true },
                ],
            ];
        };
        const strategy = new VsCodeMssqlConnectionStrategy(asConnectionManager(fake));

        const handle = await strategy.connectByProfileId(profileId, new AbortController().signal);
        const rows = await handle.execute("SELECT @@VERSION", new AbortController().signal);

        expect(rows).to.deep.equal([["Microsoft SQL Server 2022", null]]);
        expect(fake.executeCalls).to.have.length(1);
        // Owner URI is reused across connect → execute → dispose.
        expect(fake.executeCalls[0].ownerUri).to.equal(fake.connectCalls[0].ownerUri);
    });

    test("execute() throws ConnectionError(timeout) when signal aborted before send", async () => {
        const fake = new FakeConnectionManager({ [profileId]: profile });
        const strategy = new VsCodeMssqlConnectionStrategy(asConnectionManager(fake));
        const handle = await strategy.connectByProfileId(profileId, new AbortController().signal);

        const ctrl = new AbortController();
        ctrl.abort();
        try {
            await handle.execute("SELECT 1", ctrl.signal);
            expect.fail("expected ConnectionError");
        } catch (err) {
            expect(err).to.be.instanceOf(ConnectionError);
            expect((err as ConnectionError).kind).to.equal("timeout");
        }
        expect(fake.executeCalls).to.have.length(0);
    });

    test("execute() wraps sendRequest errors as ConnectionError(unknown)", async () => {
        const fake = new FakeConnectionManager({ [profileId]: profile });
        fake.sendRequestThrow = new Error("query timed out on server");
        const strategy = new VsCodeMssqlConnectionStrategy(asConnectionManager(fake));
        const handle = await strategy.connectByProfileId(profileId, new AbortController().signal);

        try {
            await handle.execute("SELECT 1", new AbortController().signal);
            expect.fail("expected ConnectionError");
        } catch (err) {
            expect(err).to.be.instanceOf(ConnectionError);
            expect((err as ConnectionError).kind).to.equal("unknown");
            expect((err as ConnectionError).message).to.contain("query timed out on server");
        }
    });

    test("dispose() disconnects exactly once even when called repeatedly", async () => {
        const fake = new FakeConnectionManager({ [profileId]: profile });
        const strategy = new VsCodeMssqlConnectionStrategy(asConnectionManager(fake));
        const handle = await strategy.connectByProfileId(profileId, new AbortController().signal);

        await handle.dispose();
        await handle.dispose();
        await handle.dispose();

        expect(fake.disconnectCalls).to.have.length(1);
        expect(fake.disconnectCalls[0]).to.equal(fake.connectCalls[0].ownerUri);
    });

    test("dispose() swallows disconnect errors", async () => {
        const fake = new FakeConnectionManager({ [profileId]: profile });
        fake.disconnectThrow = new Error("server already gone");
        const strategy = new VsCodeMssqlConnectionStrategy(asConnectionManager(fake));
        const handle = await strategy.connectByProfileId(profileId, new AbortController().signal);

        // Must not throw.
        await handle.dispose();
        expect(fake.disconnectCalls).to.have.length(1);
    });

    test("execute() after dispose() throws ConnectionError(unknown)", async () => {
        const fake = new FakeConnectionManager({ [profileId]: profile });
        const strategy = new VsCodeMssqlConnectionStrategy(asConnectionManager(fake));
        const handle = await strategy.connectByProfileId(profileId, new AbortController().signal);
        await handle.dispose();

        try {
            await handle.execute("SELECT 1", new AbortController().signal);
            expect.fail("expected ConnectionError");
        } catch (err) {
            expect(err).to.be.instanceOf(ConnectionError);
            expect((err as ConnectionError).kind).to.equal("unknown");
        }
        expect(fake.executeCalls).to.have.length(0);
    });

    test("aborts after a successful connect: tears down and throws ConnectionError(timeout)", async () => {
        const ctrl = new AbortController();
        const fake = new FakeConnectionManager({ [profileId]: profile });
        // Abort the signal while connect() is in flight so the post-connect
        // check in `connectByProfileId` observes an aborted signal.
        fake.connectResult = () => {
            ctrl.abort();
            return true;
        };
        const strategy = new VsCodeMssqlConnectionStrategy(asConnectionManager(fake));

        try {
            await strategy.connectByProfileId(profileId, ctrl.signal);
            expect.fail("expected ConnectionError");
        } catch (err) {
            expect(err).to.be.instanceOf(ConnectionError);
            expect((err as ConnectionError).kind).to.equal("timeout");
        }
        expect(fake.connectCalls).to.have.length(1);
        // Cleanup: disconnect should have been called once on the post-abort path.
        expect(fake.disconnectCalls).to.have.length(1);
        expect(fake.disconnectCalls[0]).to.equal(fake.connectCalls[0].ownerUri);
    });

    test("owner URIs are unique per connect attempt", async () => {
        const fake = new FakeConnectionManager({ [profileId]: profile });
        const strategy = new VsCodeMssqlConnectionStrategy(asConnectionManager(fake));

        const h1 = await strategy.connectByProfileId(profileId, new AbortController().signal);
        const h2 = await strategy.connectByProfileId(profileId, new AbortController().signal);
        await h1.dispose();
        await h2.dispose();

        expect(fake.connectCalls).to.have.length(2);
        expect(fake.connectCalls[0].ownerUri).to.not.equal(fake.connectCalls[1].ownerUri);
        expect(fake.connectCalls[0].ownerUri).to.match(/^cloud-deploy:\/\/profile-A\//);
    });
});
