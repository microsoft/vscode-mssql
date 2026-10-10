/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import * as vscode from "vscode";
import { ConnectionSharingAuthenticationProvider } from "../../src/connectionSharing/connectionSharingAuthenticationProvider";
import * as Constants from "../../src/constants/constants";
import * as LocalizedConstants from "../../src/constants/locConstants";

chai.use(sinonChai);

const SESSION_STORAGE_KEY = "mssql.connectionSharing.authenticationSession";

suite("ConnectionSharingAuthenticationProvider Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let secretValues: Map<string, string>;
    let secretChangeEmitter: vscode.EventEmitter<vscode.SecretStorageChangeEvent>;
    let secretStorage: vscode.SecretStorage;
    let registerAuthenticationProviderStub: sinon.SinonStub;
    let provider: ConnectionSharingAuthenticationProvider | undefined;

    function createProvider(): ConnectionSharingAuthenticationProvider {
        provider = new ConnectionSharingAuthenticationProvider(secretStorage);
        return provider;
    }

    function captureSessionChanges(
        authenticationProvider: ConnectionSharingAuthenticationProvider,
    ): vscode.AuthenticationProviderAuthenticationSessionsChangeEvent[] {
        const events: vscode.AuthenticationProviderAuthenticationSessionsChangeEvent[] = [];
        authenticationProvider.onDidChangeSessions((event) => events.push(event));
        return events;
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
            Constants.connectionSharingAuthenticationProviderId,
            LocalizedConstants.ConnectionSharing.authenticationProviderLabel,
            authenticationProvider,
            { supportsMultipleAccounts: false },
        );
    });

    test("creates, stores, and validates a session", async () => {
        const authenticationProvider = createProvider();
        const events = captureSessionChanges(authenticationProvider);

        expect(await authenticationProvider.getSessions()).to.deep.equal([]);

        const session = await authenticationProvider.createSession();

        expect(session.accessToken).to.have.length(64);
        expect(await authenticationProvider.getSessions()).to.deep.equal([session]);
        expect(JSON.parse(secretValues.get(SESSION_STORAGE_KEY)!)).to.deep.equal({
            id: session.id,
            accessToken: session.accessToken,
        });
        expect(events).to.deep.equal([{ added: [session], removed: [], changed: [] }]);
        expect(
            await authenticationProvider.getSessionIdForAccessToken(session.accessToken),
        ).to.equal(session.id);
        expect(await authenticationProvider.getSessionIdForAccessToken("not-the-token")).to.be
            .undefined;
    });

    test("loads a session stored by an earlier activation", async () => {
        secretValues.set(
            SESSION_STORAGE_KEY,
            JSON.stringify({ id: "stored-session", accessToken: "stored-token" }),
        );

        const authenticationProvider = createProvider();

        expect(await authenticationProvider.getSessionIdForAccessToken("stored-token")).to.equal(
            "stored-session",
        );
    });

    test("ignores a malformed stored session", async () => {
        secretValues.set(SESSION_STORAGE_KEY, JSON.stringify({ id: "missing-token" }));

        const authenticationProvider = createProvider();

        expect(await authenticationProvider.getSessions()).to.deep.equal([]);
    });

    test("replaces the previous session when a new one is created", async () => {
        const authenticationProvider = createProvider();
        const first = await authenticationProvider.createSession();
        const events = captureSessionChanges(authenticationProvider);

        const second = await authenticationProvider.createSession();

        expect(events).to.deep.equal([{ added: [second], removed: [first], changed: [] }]);
        expect(await authenticationProvider.getSessionIdForAccessToken(first.accessToken)).to.be
            .undefined;
    });

    test("removes the session and revokes its access token", async () => {
        const authenticationProvider = createProvider();
        const session = await authenticationProvider.createSession();
        const events = captureSessionChanges(authenticationProvider);

        await authenticationProvider.removeSession("another-session");
        expect(events).to.be.empty;

        await authenticationProvider.removeSession(session.id);

        expect(secretValues.has(SESSION_STORAGE_KEY)).to.be.false;
        expect(events).to.deep.equal([{ added: [], removed: [session], changed: [] }]);
        expect(await authenticationProvider.getSessionIdForAccessToken(session.accessToken)).to.be
            .undefined;
    });

    test("picks up a session that another window stored", async () => {
        const authenticationProvider = createProvider();
        const events = captureSessionChanges(authenticationProvider);
        expect(await authenticationProvider.getSessions()).to.deep.equal([]);

        secretValues.set(
            SESSION_STORAGE_KEY,
            JSON.stringify({ id: "other-window-session", accessToken: "other-window-token" }),
        );
        secretChangeEmitter.fire({ key: SESSION_STORAGE_KEY });
        await new Promise((resolve) => setImmediate(resolve));

        expect(
            await authenticationProvider.getSessionIdForAccessToken("other-window-token"),
        ).to.equal("other-window-session");
        expect(events).to.have.length(1);
        expect(events[0].added?.map((session) => session.id)).to.deep.equal([
            "other-window-session",
        ]);
    });

    test("doesn't report its own stored session as a change from another window", async () => {
        const authenticationProvider = createProvider();
        await authenticationProvider.createSession();
        const events = captureSessionChanges(authenticationProvider);

        secretChangeEmitter.fire({ key: SESSION_STORAGE_KEY });
        await new Promise((resolve) => setImmediate(resolve));

        expect(events).to.be.empty;
    });
});
