/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import ConnectionManager from "../../../src/controllers/connectionManager";
import { ConnectionStore } from "../../../src/models/connectionStore";
import { ConnectionConfig } from "../../../src/connectionconfig/connectionconfig";
import { IConnectionProfile } from "../../../src/models/interfaces";
import {
    isPythonNotebookReference,
    PythonNotebookConnectionReference,
    PythonNotebookCredentialsProvider,
} from "../../../src/notebooks/pythonNotebookCredentials";
import { PythonNotebooks } from "../../../src/constants/locConstants";
import * as entra from "../../../src/azure/vscodeEntraMfaUtils";
import * as azureUtils from "../../../src/azure/utils";

suite("PythonNotebookCredentials", () => {
    let sandbox: sinon.SinonSandbox;
    let manager: sinon.SinonStubbedInstance<ConnectionManager>;
    let config: sinon.SinonStubbedInstance<ConnectionConfig>;
    let provider: PythonNotebookCredentialsProvider;
    let profile: IConnectionProfile;
    const reference = { version: 1, connectionId: "selected-id", database: "selected-db" } as const;

    setup(() => {
        sandbox = sinon.createSandbox();
        manager = sandbox.createStubInstance(ConnectionManager);
        const store = sandbox.createStubInstance(ConnectionStore);
        config = sandbox.createStubInstance(ConnectionConfig);
        sandbox.stub(manager, "connectionStore").get(() => store);
        sandbox.stub(store, "connectionConfig").get(() => config);
        profile = {
            id: reference.connectionId,
            profileName: "Same name",
            server: "localhost",
            database: "profile-db",
            authenticationType: "SqlLogin",
            user: "user",
            password: "synthetic-secret",
            encrypt: "Mandatory",
            trustServerCertificate: false,
        } as IConnectionProfile;
        config.getConnections.resolves([profile]);
        manager.prepareConnectionInfo.callsFake(async (info) => info);
        approveProfile();
    });

    teardown(() => sandbox.restore());

    function approveProfile(selected: PythonNotebookConnectionReference = reference): void {
        provider = new PythonNotebookCredentialsProvider(manager, profile, selected);
    }

    async function rejects(action: Promise<unknown>, message: string): Promise<void> {
        try {
            await action;
        } catch (error) {
            expect(error).to.be.instanceOf(Error);
            expect((error as Error).message).to.equal(message);
            return;
        }
        expect.fail("Expected rejection");
    }

    test("validates untrusted metadata instead of accepting arbitrary references", () => {
        expect(isPythonNotebookReference(reference)).to.equal(true);
        expect(isPythonNotebookReference({ ...reference, database: undefined })).to.equal(true);
        for (const value of [
            null,
            [],
            {},
            { ...reference, version: 2 },
            { ...reference, connectionId: "" },
            { ...reference, database: 1 },
            { ...reference, database: null },
        ]) {
            expect(isPythonNotebookReference(value)).to.equal(false);
        }
    });

    test("resolves by ID and preserves the selected database and TLS policy", async () => {
        config.getConnections.resolves([
            { ...profile, id: "different-id", server: "wrong-server" },
            profile,
        ]);
        const result = await provider.getConfiguration(reference);
        expect(result.settings).to.include({
            server: "localhost",
            database: "selected-db",
            encrypt: "yes",
            trustServerCertificate: false,
        });
        expect(result.authentication).to.deep.equal({
            kind: "sql",
            username: "user",
            password: "synthetic-secret",
        });
        expect(profile.database).to.equal("profile-db");
    });

    test("does not resolve connections by display name", async () => {
        config.getConnections.resolves([{ ...profile, id: "different-id" }]);
        await rejects(
            provider.getConfiguration(reference),
            PythonNotebooks.errors.connectionMissing,
        );
    });

    test("reuses approved credentials for the actual IntelliSense database", async () => {
        await provider.getConfiguration(reference);
        const result = await provider.getLanguageServiceConnectionInfo(reference, "actual-db");
        expect(result).to.include({
            server: "localhost",
            database: "actual-db",
            user: "user",
            password: "synthetic-secret",
            encrypt: "Mandatory",
            trustServerCertificate: false,
        });
        expect(profile.database).to.equal("profile-db");
        expect(manager.prepareConnectionInfo.calledOnce).to.equal(true);
        result.password = "changed-copy";
        expect((await provider.getConfiguration(reference)).authentication).to.include({
            password: "synthetic-secret",
        });
    });

    test("rejects profile changes and empty databases for IntelliSense", async () => {
        await provider.getConfiguration(reference);
        await rejects(
            provider.getLanguageServiceConnectionInfo(reference, ""),
            PythonNotebooks.errors.initialization,
        );
        profile.server = "unapproved";
        await rejects(
            provider.getLanguageServiceConnectionInfo(reference, "actual-db"),
            PythonNotebooks.errors.profileChanged,
        );
    });

    test("does not silently drop unsupported profile options", async () => {
        profile.columnEncryptionSetting = "Enabled";
        approveProfile();
        await rejects(provider.getConfiguration(reference), PythonNotebooks.errors.unsupported);
        expect(manager.prepareConnectionInfo.called).to.equal(false);
    });

    test("supports ordinary profile defaults and forwards driver retry policy", async () => {
        profile.applicationName = "vscode-mssql";
        profile.applicationIntent = "ReadWrite";
        profile.connectRetryCount = 2;
        profile.connectRetryInterval = 5;
        approveProfile();
        const result = await provider.getConfiguration(reference);
        expect(result.settings).to.include({
            applicationName: "vscode-mssql",
            applicationIntent: "ReadWrite",
            connectRetryCount: 2,
            connectRetryInterval: 5,
        });
    });

    test("does not ignore an explicitly disabled connection pool", async () => {
        profile.pooling = false;
        approveProfile();
        await rejects(provider.getConfiguration(reference), PythonNotebooks.errors.unsupported);
    });

    test("preserves an explicitly unlimited query timeout", async () => {
        profile.commandTimeout = 0;
        approveProfile();
        expect((await provider.getConfiguration(reference)).settings.queryTimeout).to.equal(0);
    });

    test("rejects target changes before the first credential preparation", async () => {
        profile.server = "unapproved-production";
        await rejects(provider.getConfiguration(reference), PythonNotebooks.errors.profileChanged);
        expect(manager.prepareConnectionInfo.called).to.equal(false);
    });

    test("rejects security changes while credentials are being prepared", async () => {
        manager.prepareConnectionInfo.callsFake(async (info) => {
            profile.trustServerCertificate = true;
            return info;
        });
        await rejects(provider.getConfiguration(reference), PythonNotebooks.errors.profileChanged);
    });

    test("preserves the login default when the profile database is omitted or blank", async () => {
        for (const database of [undefined, ""]) {
            profile.database = database;
            const selected = { version: 1, connectionId: reference.connectionId } as const;
            approveProfile(selected);
            const result = await provider.getConfiguration(selected);
            expect(result.settings.database).to.equal(undefined);
            expect(manager.prepareConnectionInfo.calledWithMatch({ database })).to.equal(true);
        }
    });

    test("allows a blank notebook database to override an explicit profile database", async () => {
        const selected = { ...reference, database: "" };
        approveProfile(selected);
        expect((await provider.getConfiguration(selected)).settings.database).to.equal(undefined);
    });

    test("requires reconnect after a target or security policy change", async () => {
        await provider.getConfiguration(reference);
        profile.trustServerCertificate = true;
        await rejects(provider.getConfiguration(reference), PythonNotebooks.errors.profileChanged);
    });

    test("does not change the approved identity on a later request", async () => {
        await provider.getConfiguration(reference);
        profile.authenticationType = "AzureMFA";
        profile.accountId = "other-account";
        await rejects(provider.getSqlToken(reference), PythonNotebooks.errors.profileChanged);
    });

    test("requires explicit authentication modes and a nonempty SQL password", async () => {
        profile.authenticationType = "ActiveDirectoryDefault";
        approveProfile();
        await rejects(provider.getConfiguration(reference), PythonNotebooks.errors.unsupported);
        profile.authenticationType = "SqlLogin";
        profile.password = "";
        approveProfile();
        await rejects(provider.getConfiguration(reference), PythonNotebooks.errors.credentials);
    });

    function configureEntra() {
        profile.authenticationType = "AzureMFA";
        profile.accountId = "approved-account";
        profile.tenantId = "approved-tenant";
        approveProfile();
        sandbox.stub(azureUtils, "getUseMsalEntraMfaAuthConfig").returns(false);
        sandbox.stub(entra, "getCloudResourceEndpoint").returns("https://database.windows.net/");
        const account = { id: profile.accountId, label: "Approved account" };
        const result: entra.VscodeEntraSqlTokenInfo = {
            account,
            tenantId: profile.tenantId,
            session: {
                id: "synthetic-session",
                account,
                accessToken: "synthetic-token",
                scopes: [],
            },
            token: {
                key: "synthetic-key",
                token: "synthetic-token",
                tokenType: "Bearer",
                expiresOn: Math.floor(Date.now() / 1000) + 3600,
            },
        };
        return { result, acquire: sandbox.stub(entra, "acquireTokenFromVscodeAccountForResource") };
    }

    test("refreshes SQL tokens using the approved Entra account and tenant only", async () => {
        const { result, acquire } = configureEntra();
        acquire.resolves(result);
        expect((await provider.getConfiguration(reference)).authentication).to.deep.equal({
            kind: "entra",
        });
        expect((await provider.getSqlToken(reference)).token).to.equal("synthetic-token");
        expect(
            acquire.calledWith(
                "https://database.windows.net/",
                "approved-account",
                "approved-tenant",
            ),
        ).to.equal(true);
    });

    test("rejects compatible-account fallback and tenant mismatch", async () => {
        const { result, acquire } = configureEntra();
        await provider.getConfiguration(reference);
        acquire.resolves({
            ...result,
            account: { ...result.account, id: "approved-account-other" },
        });
        await rejects(provider.getSqlToken(reference), PythonNotebooks.errors.identity);
        acquire.resolves({ ...result, tenantId: "other-tenant" });
        await rejects(provider.getSqlToken(reference), PythonNotebooks.errors.identity);
    });

    test("rejects expired tokens and propagates no raw authentication errors", async () => {
        const { result, acquire } = configureEntra();
        await provider.getConfiguration(reference);
        acquire.resolves({ ...result, token: { ...result.token, expiresOn: 1 } });
        await rejects(provider.getSqlToken(reference), PythonNotebooks.errors.identity);
    });

    test("does not return a token when the approved profile changes during refresh", async () => {
        const { result, acquire } = configureEntra();
        await provider.getConfiguration(reference);
        acquire.callsFake(async () => {
            profile.tenantId = "other-tenant";
            return result;
        });
        await rejects(provider.getSqlToken(reference), PythonNotebooks.errors.profileChanged);
    });
});
