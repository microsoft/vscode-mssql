/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import * as vscode from "vscode";
import {
    ACCESS_TOKEN_LIFETIME_MS,
    SharedConnectionsAuthenticationProvider,
} from "../../src/connectionSharing/sharedConnectionsAuthenticationProvider";
import * as Constants from "../../src/constants/constants";
import * as LocalizedConstants from "../../src/constants/locConstants";
import * as telemetry from "extension-toolkit/vscode/telemetry";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";

chai.use(sinonChai);

const SESSION_STORAGE_KEY = "mssql.sharedConnections.session";

suite("SharedConnectionsAuthenticationProvider Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let secretValues: Map<string, string>;
    let secretChangeEmitter: vscode.EventEmitter<vscode.SecretStorageChangeEvent>;
    let secretStorage: vscode.SecretStorage;
    let registerAuthenticationProviderStub: sinon.SinonStub;
    let sendActionEventStub: sinon.SinonStub;
    let provider: SharedConnectionsAuthenticationProvider | undefined;

    function createProvider(): SharedConnectionsAuthenticationProvider {
        provider = new SharedConnectionsAuthenticationProvider(secretStorage);
        return provider;
    }

    function captureSessionChanges(
        authenticationProvider: SharedConnectionsAuthenticationProvider,
    ): vscode.AuthenticationProviderAuthenticationSessionsChangeEvent[] {
        const events: vscode.AuthenticationProviderAuthenticationSessionsChangeEvent[] = [];
        authenticationProvider.onDidChangeSessions((event) => events.push(event));
        return events;
    }

    async function sessionIdFor(
        authenticationProvider: SharedConnectionsAuthenticationProvider,
        accessToken: string,
    ): Promise<string | undefined> {
        const check = await authenticationProvider.checkAccessToken(accessToken);
        return "sessionId" in check ? check.sessionId : undefined;
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        secretValues = new Map<string, string>();
        secretChangeEmitter = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();
        secretStorage = {
            get: sandbox.stub().callsFake(async (key: string) => secretValues.get(key)),
            store: sandbox.stub().callsFake(async (key: string, value: string) => {
                secretValues.set(key, value);
            }),
            delete: sandbox.stub().callsFake(async (key: string) => {
                secretValues.delete(key);
            }),
            keys: sandbox.stub().callsFake(async () => [...secretValues.keys()]),
            onDidChange: secretChangeEmitter.event,
        } as unknown as vscode.SecretStorage;
        registerAuthenticationProviderStub = sandbox
            .stub(vscode.authentication, "registerAuthenticationProvider")
            .returns({ dispose: sandbox.stub() });
        sendActionEventStub = sandbox.stub(telemetry, "sendActionEvent");
    });

    teardown(() => {
        provider?.dispose();
        provider = undefined;
        secretChangeEmitter.dispose();
        sandbox.restore();
    });

    test("registers with VS Code under the connection-sharing provider ID", () => {
        const authenticationProvider = createProvider();

        expect(registerAuthenticationProviderStub).to.have.been.calledWith(
            Constants.sharedConnectionsAuthenticationProviderId,
            LocalizedConstants.ConnectionSharing.authenticationProviderLabel,
            authenticationProvider,
            { supportsMultipleAccounts: false },
        );
    });

    test("creates a session and stores its ID and creation time, but no access token", async () => {
        const clock = sandbox.useFakeTimers({ now: 1_700_000_000_000, toFake: ["Date"] });
        const authenticationProvider = createProvider();
        const events = captureSessionChanges(authenticationProvider);

        expect(await authenticationProvider.getSessions()).to.deep.equal([]);

        const session = await authenticationProvider.createSession();

        expect(session.accessToken).to.have.length(64);
        expect(JSON.parse(secretValues.get(SESSION_STORAGE_KEY)!)).to.deep.equal({
            id: session.id,
            createdAt: clock.now,
        });
        expect(events).to.deep.equal([
            { added: [{ ...session, accessToken: "" }], removed: [], changed: [] },
        ]);
        expect(await sessionIdFor(authenticationProvider, session.accessToken)).to.equal(
            session.id,
        );
        expect(await sessionIdFor(authenticationProvider, "not-the-token")).to.be.undefined;
    });

    test("issues a new access token each time the session is requested", async () => {
        const authenticationProvider = createProvider();
        const created = await authenticationProvider.createSession();

        const [first] = await authenticationProvider.getSessions();
        const [second] = await authenticationProvider.getSessions();

        expect([first.id, second.id]).to.deep.equal([created.id, created.id]);
        const tokens = [created.accessToken, first.accessToken, second.accessToken];
        expect(new Set(tokens).size).to.equal(3);
        for (const token of tokens) {
            expect(await sessionIdFor(authenticationProvider, token)).to.equal(created.id);
        }
    });

    test("rejects an access token once it expires", async () => {
        const clock = sandbox.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
        const authenticationProvider = createProvider();
        const session = await authenticationProvider.createSession();

        clock.tick(ACCESS_TOKEN_LIFETIME_MS - 1);
        expect(await sessionIdFor(authenticationProvider, session.accessToken)).to.equal(
            session.id,
        );

        clock.tick(1);
        expect(await sessionIdFor(authenticationProvider, session.accessToken)).to.be.undefined;
        expect(await authenticationProvider.isSessionActive(session.id)).to.be.true;
    });

    test("restores a stored session but not an access token stored by an earlier build", async () => {
        secretValues.set(
            SESSION_STORAGE_KEY,
            JSON.stringify({ id: "stored-session", accessToken: "stored-token" }),
        );

        const authenticationProvider = createProvider();
        const [session] = await authenticationProvider.getSessions();

        expect(session.id).to.equal("stored-session");
        expect(session.accessToken).not.to.equal("stored-token");
        expect(await sessionIdFor(authenticationProvider, "stored-token")).to.be.undefined;
        expect(await sessionIdFor(authenticationProvider, session.accessToken)).to.equal(
            "stored-session",
        );
    });

    test("ignores a malformed stored session", async () => {
        secretValues.set(SESSION_STORAGE_KEY, JSON.stringify({ accessToken: "missing-id" }));

        const authenticationProvider = createProvider();

        expect(await authenticationProvider.getSessions()).to.deep.equal([]);
    });

    test("replaces the previous session when a new one is created", async () => {
        const authenticationProvider = createProvider();
        const first = await authenticationProvider.createSession();
        const events = captureSessionChanges(authenticationProvider);

        const second = await authenticationProvider.createSession();

        expect(events).to.deep.equal([
            {
                added: [{ ...second, accessToken: "" }],
                removed: [{ ...first, accessToken: "" }],
                changed: [],
            },
        ]);
        expect(await sessionIdFor(authenticationProvider, first.accessToken)).to.be.undefined;
    });

    test("removes the session and revokes all of its access tokens", async () => {
        const authenticationProvider = createProvider();
        const session = await authenticationProvider.createSession();
        const [requested] = await authenticationProvider.getSessions();
        const events = captureSessionChanges(authenticationProvider);

        await authenticationProvider.removeSession("another-session");
        expect(events).to.be.empty;

        await authenticationProvider.removeSession(session.id);

        expect(secretValues.has(SESSION_STORAGE_KEY)).to.be.false;
        expect(events).to.deep.equal([
            { added: [], removed: [{ ...session, accessToken: "" }], changed: [] },
        ]);
        for (const token of [session.accessToken, requested.accessToken]) {
            expect(await sessionIdFor(authenticationProvider, token)).to.be.undefined;
        }
        expect(await authenticationProvider.isSessionActive(session.id)).to.be.false;
    });

    test("keeps the session and its access tokens when deleting it fails", async () => {
        const authenticationProvider = createProvider();
        const session = await authenticationProvider.createSession();
        const events = captureSessionChanges(authenticationProvider);
        (secretStorage.delete as sinon.SinonStub).rejects(new Error("delete failed"));

        try {
            await authenticationProvider.removeSession(session.id);
            expect.fail("Expected removing the session to fail");
        } catch (error) {
            expect((error as Error).message).to.equal("delete failed");
        }

        expect(events).to.be.empty;
        expect(await authenticationProvider.isSessionActive(session.id)).to.be.true;
        expect(await sessionIdFor(authenticationProvider, session.accessToken)).to.equal(
            session.id,
        );
    });

    test("picks up a session that another window stored", async () => {
        const authenticationProvider = createProvider();
        const events = captureSessionChanges(authenticationProvider);
        expect(await authenticationProvider.getSessions()).to.deep.equal([]);

        secretValues.set(SESSION_STORAGE_KEY, JSON.stringify({ id: "other-window-session" }));
        secretChangeEmitter.fire({ key: SESSION_STORAGE_KEY });
        await new Promise((resolve) => setImmediate(resolve));

        const [session] = await authenticationProvider.getSessions();
        expect(session.id).to.equal("other-window-session");
        expect(await sessionIdFor(authenticationProvider, session.accessToken)).to.equal(
            "other-window-session",
        );
        expect(events).to.have.length(1);
        expect(events[0].added?.map((added) => added.id)).to.deep.equal(["other-window-session"]);
    });

    test("revokes this window's access tokens when another window signs out", async () => {
        const authenticationProvider = createProvider();
        const session = await authenticationProvider.createSession();
        const events = captureSessionChanges(authenticationProvider);

        secretValues.delete(SESSION_STORAGE_KEY);
        secretChangeEmitter.fire({ key: SESSION_STORAGE_KEY });
        await new Promise((resolve) => setImmediate(resolve));

        expect(await sessionIdFor(authenticationProvider, session.accessToken)).to.be.undefined;
        expect(events).to.deep.equal([
            { added: [], removed: [{ ...session, accessToken: "" }], changed: [] },
        ]);
    });

    test("keeps the session when storage can't be read after another window changes it", async () => {
        const authenticationProvider = createProvider();
        const session = await authenticationProvider.createSession();
        const events = captureSessionChanges(authenticationProvider);
        (secretStorage.get as sinon.SinonStub).rejects(new Error("storage unavailable"));

        secretChangeEmitter.fire({ key: SESSION_STORAGE_KEY });
        await new Promise((resolve) => setImmediate(resolve));

        expect(events).to.be.empty;
        expect(await authenticationProvider.isSessionActive(session.id)).to.be.true;
        expect(await sessionIdFor(authenticationProvider, session.accessToken)).to.equal(
            session.id,
        );
    });

    test("doesn't report its own stored session as a change from another window", async () => {
        const authenticationProvider = createProvider();
        await authenticationProvider.createSession();
        const events = captureSessionChanges(authenticationProvider);

        secretChangeEmitter.fire({ key: SESSION_STORAGE_KEY });
        await new Promise((resolve) => setImmediate(resolve));

        expect(events).to.be.empty;
    });
    test("reports why an access token is rejected", async () => {
        const clock = sandbox.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
        const authenticationProvider = createProvider();
        const session = await authenticationProvider.createSession();

        expect(await authenticationProvider.checkAccessToken("never-issued")).to.deep.equal({
            rejection: "unknown",
        });

        // Ending the session waits on secret storage; tokens checked meanwhile belong to a
        // session that has already ended.
        let finishDelete!: () => void;
        (secretStorage.delete as sinon.SinonStub).callsFake(
            () => new Promise<void>((resolve) => (finishDelete = resolve)),
        );
        const removal = authenticationProvider.removeSession(session.id);
        await new Promise((resolve) => setImmediate(resolve));
        expect(await authenticationProvider.checkAccessToken(session.accessToken)).to.deep.equal({
            rejection: "sessionEnded",
        });
        finishDelete();
        await removal;

        const next = await authenticationProvider.createSession();
        clock.tick(ACCESS_TOKEN_LIFETIME_MS);
        expect(await authenticationProvider.checkAccessToken(next.accessToken)).to.deep.equal({
            rejection: "expired",
        });
    });

    test("reports sessions being created and removed", async () => {
        const clock = sandbox.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
        const authenticationProvider = createProvider();

        await authenticationProvider.createSession();
        const session = await authenticationProvider.createSession();
        clock.tick(5000);
        await authenticationProvider.removeSession(session.id);

        for (const payload of [
            {
                additionalProps: {
                    change: "created",
                    outcome: "succeeded",
                    replacedSession: "false",
                },
                additionalMeasurements: {},
            },
            {
                additionalProps: {
                    change: "created",
                    outcome: "succeeded",
                    replacedSession: "true",
                },
                additionalMeasurements: {},
            },
            {
                additionalProps: { change: "removed", outcome: "succeeded" },
                additionalMeasurements: { sessionAgeMs: 5000 },
            },
        ]) {
            expect(sendActionEventStub).to.have.been.calledWith(
                TelemetryViews.Connection,
                TelemetryActions.SharedConnectionsSession,
                payload,
            );
        }
    });

    test("reports a session that couldn't be removed", async () => {
        const authenticationProvider = createProvider();
        const session = await authenticationProvider.createSession();
        (secretStorage.delete as sinon.SinonStub).rejects(new Error("delete failed"));

        await authenticationProvider.removeSession(session.id).catch(() => undefined);

        expect(sendActionEventStub).to.have.been.calledWith(
            TelemetryViews.Connection,
            TelemetryActions.SharedConnectionsSession,
            {
                additionalProps: { change: "removed", outcome: "failed" },
                additionalMeasurements: {},
            },
        );
    });
});
