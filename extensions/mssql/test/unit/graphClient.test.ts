/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import { AzureCliCredential } from "@azure/identity";
import { GraphClient } from "../../src/azure/graphClient";
import * as loggerModule from "../../src/models/logger";
import { ILogger } from "../../src/sharedInterfaces/logger";
import { createStubLogger } from "./utils";

chai.use(sinonChai);

suite("Microsoft Graph client", () => {
    const account: vscode.AuthenticationSessionAccountInformation = {
        id: "account-id",
        label: "Test account",
    };
    const scopes = ["https://graph.microsoft.com/User.Read", "VSCODE_TENANT:tenant-id"];
    const appId = "22222222-2222-2222-2222-222222222222";
    const principal = {
        appId,
        id: "44444444-4444-4444-4444-444444444444",
        displayName: "Container app",
    };
    const principalUrl = `https://graph.microsoft.com/v1.0/servicePrincipals(appId='${appId}')?$select=id,appId,displayName`;
    let sandbox: sinon.SinonSandbox;
    let client: GraphClient;
    let getSession: sinon.SinonStub;
    let cliCredential: sinon.SinonStubbedInstance<AzureCliCredential>;
    let createCliCredential: sinon.SinonStub;
    let fetch: sinon.SinonStub;
    let logger: sinon.SinonStubbedInstance<ILogger>;
    let sessionChangeListener: (event: vscode.AuthenticationSessionsChangeEvent) => unknown;
    let session: vscode.AuthenticationSession;

    setup(() => {
        sandbox = sinon.createSandbox();
        session = { id: "session-id", account, scopes, accessToken: "existing-graph-token" };
        logger = createStubLogger(sandbox);
        sandbox.stub(loggerModule, "getLogger").returns(logger);
        const sessionEvent: vscode.Event<vscode.AuthenticationSessionsChangeEvent> = (listener) => {
            sessionChangeListener = listener;
            return new vscode.Disposable(() => {});
        };
        sandbox.stub(vscode.authentication, "onDidChangeSessions").get(() => sessionEvent);
        getSession = sandbox.stub(vscode.authentication, "getSession").resolves(session);
        cliCredential = sandbox.createStubInstance(AzureCliCredential);
        cliCredential.getToken.resolves({
            token: "azure-cli-graph-token",
            expiresOnTimestamp: Date.now() + 3_600_000,
        });
        createCliCredential = sandbox.stub().returns(cliCredential);
        fetch = sandbox.stub(globalThis, "fetch").callsFake(async () => page([]));
        fetch
            .withArgs("https://graph.microsoft.com/v1.0/me?$select=id", sinon.match.any)
            .callsFake(async () => Response.json({ id: "tenant-user-id" }));
        fetch
            .withArgs(principalUrl, sinon.match.any)
            .callsFake(async () => Response.json(principal));
        client = new GraphClient(createCliCredential);
    });

    teardown(() => {
        client.dispose();
        sandbox.restore();
    });

    function page(value: { id: string; displayName: string }[], nextLink?: string): Response {
        return Response.json({ value, ...(nextLink ? { "@odata.nextLink": nextLink } : {}) });
    }

    function graphError(status: number): Response {
        return Response.json(
            { error: { code: "GraphFailure", message: `Graph returned ${status}` } },
            { status },
        );
    }

    suite("container service principal", () => {
        const appId = "22222222-2222-2222-2222-222222222222";
        const principal = {
            appId,
            id: "44444444-4444-4444-4444-444444444444",
            displayName: "Container app",
        };
        const url = `https://graph.microsoft.com/v1.0/servicePrincipals(appId='${appId}')?$select=id,appId,displayName`;
        const collectionUrl = "https://graph.microsoft.com/v1.0/servicePrincipals";

        test("reuses the existing tenant service principal rather than the application object", async () => {
            fetch.withArgs(url, sinon.match.any).callsFake(async () => Response.json(principal));
            expect(await client.ensureServicePrincipal(appId, account, "tenant-id")).to.deep.equal({
                id: principal.id,
                displayName: principal.displayName,
            });
            expect(fetch).not.to.have.been.calledWith(collectionUrl, sinon.match.any);
        });

        test("creates the enterprise application only when its service principal does not exist", async () => {
            fetch.withArgs(url, sinon.match.any).callsFake(async () => graphError(404));
            fetch
                .withArgs(collectionUrl, sinon.match.any)
                .callsFake(async () => Response.json(principal));
            await client.ensureServicePrincipal(appId, account, "tenant-id");
            expect(fetch).to.have.been.calledWith(
                collectionUrl,
                sinon.match({ method: "POST", body: JSON.stringify({ appId }) }),
            );
        });

        test("surfaces read permission failures without attempting to create a principal", async () => {
            fetch.withArgs(url, sinon.match.any).callsFake(async () => graphError(403));
            await expectFailure(
                client.ensureServicePrincipal(appId, account, "tenant-id"),
                "Graph returned 403",
            );
            expect(fetch).not.to.have.been.calledWith(collectionUrl, sinon.match.any);
        });

        test("rejects a principal for a different application before configuring SQL administration", async () => {
            fetch.withArgs(url, sinon.match.any).callsFake(async () =>
                Response.json({
                    ...principal,
                    appId: "55555555-5555-5555-5555-555555555555",
                }),
            );
            await expectFailure(
                client.ensureServicePrincipal(appId, account, "tenant-id"),
                "valid service principal",
            );
        });
    });

    async function expectFailure(request: Promise<unknown>, message: string): Promise<void> {
        try {
            await request;
            expect.fail("Expected the request to fail");
        } catch (error) {
            expect(error).to.have.property("message").that.includes(message);
        }
    }

    function expectToken(token: string): void {
        expect(fetch).to.have.been.calledWith(
            sinon.match.string,
            sinon.match(
                (options: RequestInit) =>
                    new Headers(options.headers).get("Authorization") === `Bearer ${token}`,
            ),
        );
    }

    async function fireSessionChange(providerId: string): Promise<void> {
        await sessionChangeListener({ provider: { id: providerId, label: providerId } });
    }

    test("silently reuses an existing Graph session and caches it for later requests", async () => {
        await client.fetchUserGroups("user-id", account, "tenant-id");
        await client.fetchUserGroups("user-id", account, "tenant-id");

        expect(getSession).to.have.been.calledWith("microsoft", scopes, {
            account,
            silent: true,
        });
        expect(getSession).not.to.have.been.calledWith(
            sinon.match.any,
            sinon.match.any,
            sinon.match.has("createIfNone"),
        );
        expect(getSession.getCalls()).to.have.lengthOf(1);
        expectToken(session.accessToken);
    });

    test("shares authentication across concurrent requests", async () => {
        const pending = Promise.withResolvers<vscode.AuthenticationSession>();
        getSession.returns(pending.promise);
        const first = client.fetchUserGroups("first-user", account, "tenant-id");
        const second = client.fetchUserGroups("second-user", account, "tenant-id");
        pending.resolve(session);

        await Promise.all([first, second]);

        expect(getSession.getCalls()).to.have.lengthOf(1);
        expectToken(session.accessToken);
    });

    test("allows sign-in only when a silent Graph session is unavailable", async () => {
        getSession.withArgs("microsoft", scopes, { account, silent: true }).resolves(undefined);
        getSession
            .withArgs("microsoft", scopes, { account, createIfNone: true })
            .callsFake(async () => {
                await fireSessionChange("microsoft");
                return session;
            });

        await client.fetchUserGroups("user-id", account, "tenant-id");
        await client.fetchUserGroups("user-id", account, "tenant-id");

        expect(getSession).to.have.been.calledWith("microsoft", scopes, {
            account,
            createIfNone: true,
        });
        expect(getSession).not.to.have.been.calledWith(
            sinon.match.any,
            sinon.match.any,
            sinon.match.has("forceNewSession"),
        );
        expect(getSession.getCalls()).to.have.lengthOf(2);
        expectToken(session.accessToken);
    });

    test("does not cache failed authentication or make an unauthenticated Graph request", async () => {
        getSession.rejects(new Error("Authentication cancelled"));

        await expectFailure(
            client.fetchUserGroups("user-id", account, "tenant-id"),
            "Authentication cancelled",
        );
        expect(fetch).not.to.have.been.called;
        expect(logger.error).to.have.been.calledWith(
            "Error fetching user groups: Authentication cancelled",
        );

        getSession.resolves(session);
        await client.fetchUserGroups("user-id", account, "tenant-id");
        expectToken(session.accessToken);
    });

    test("rejects a session with no token without sending a Graph request", async () => {
        getSession.resolves({ ...session, accessToken: "" });

        await expectFailure(
            client.fetchUserGroups("user-id", account, "tenant-id"),
            "Unable to acquire a Microsoft Entra token",
        );
        expect(fetch).not.to.have.been.called;
    });

    test("logs original broker details before Graph wraps the authentication error without logging credentials", async () => {
        const brokerError = Object.assign(new Error("Native broker failure details"), {
            name: "PlatformBrokerError",
            statusCode: 12345,
            tag: "tag01",
            accessToken: "not-for-logs",
        });
        const authError = Object.assign(new Error("platform_broker_error"), {
            name: "ClientAuthError",
            errorCode: "platform_broker_error",
            errorMessage: "Broker authentication failed",
            subError: "broker-suberror",
            correlationId: "test-correlation-id",
            platformBrokerError: brokerError,
            refreshToken: "not-for-logs",
        });
        getSession.rejects(authError);

        await expectFailure(
            client.fetchUserGroups("user-id", account, "tenant-id"),
            "platform_broker_error",
        );

        expect(logger.error).to.have.been.calledWith(
            "Microsoft Graph authentication failed",
            sinon
                .match({
                    message: authError.message,
                    stack: authError.stack,
                    name: "ClientAuthError",
                    errorCode: "platform_broker_error",
                    errorMessage: "Broker authentication failed",
                    subError: "broker-suberror",
                    correlationId: "test-correlation-id",
                    platformBrokerError: sinon.match({
                        message: brokerError.message,
                        stack: brokerError.stack,
                        statusCode: 12345,
                        tag: "tag01",
                    }),
                })
                .and(
                    sinon.match(
                        (details: Record<string, unknown>) =>
                            !JSON.stringify(details).includes("not-for-logs"),
                    ),
                ),
        );
        expect(fetch).not.to.have.been.called;
    });

    test("keeps authentication separate for different accounts and tenants", async () => {
        const otherAccount = { id: "other-account", label: "Other account" };
        getSession
            .withArgs("microsoft", scopes, { account: otherAccount, silent: true })
            .resolves({ ...session, account: otherAccount, accessToken: "other-account-token" });
        getSession
            .withArgs(
                "microsoft",
                ["https://graph.microsoft.com/User.Read", "VSCODE_TENANT:other-tenant"],
                { account, silent: true },
            )
            .resolves({ ...session, accessToken: "other-tenant-token" });

        await client.fetchUserGroups("user-id", account, "tenant-id");
        await client.fetchUserGroups("other-user", otherAccount, "tenant-id");
        await client.fetchUserGroups("user-id", account, "other-tenant");

        expectToken("existing-graph-token");
        expectToken("other-account-token");
        expectToken("other-tenant-token");
        expect(getSession.getCalls()).to.have.lengthOf(3);
    });

    test("invalidates cached tokens when Microsoft sessions change", async () => {
        await client.fetchUserGroups("user-id", account, "tenant-id");
        await fireSessionChange("microsoft");
        getSession.resolves({ ...session, accessToken: "updated-token" });

        await client.fetchUserGroups("user-id", account, "tenant-id");

        expect(getSession.getCalls()).to.have.lengthOf(2);
        expectToken("updated-token");
    });

    test("does not invalidate Microsoft tokens when another provider changes", async () => {
        await client.fetchUserGroups("user-id", account, "tenant-id");
        await fireSessionChange("github");
        await client.fetchUserGroups("user-id", account, "tenant-id");

        expect(getSession.getCalls()).to.have.lengthOf(1);
    });

    test("reacquires a rejected or expired token silently and retries once", async () => {
        fetch.onFirstCall().resolves(graphError(401));
        getSession.onFirstCall().resolves(session);
        getSession.onSecondCall().resolves({ ...session, accessToken: "refreshed-token" });

        await client.fetchUserGroups("user-id", account, "tenant-id");
        await client.fetchUserGroups("user-id", account, "tenant-id");

        expectToken("existing-graph-token");
        expectToken("refreshed-token");
        expect(getSession.getCalls()).to.have.lengthOf(2);
        expect(getSession).not.to.have.been.calledWith(
            sinon.match.any,
            sinon.match.any,
            sinon.match.has("createIfNone"),
        );
    });

    test("does not loop or repeatedly prompt if the refreshed token is also rejected", async () => {
        fetch.callsFake(async () => graphError(401));

        await expectFailure(
            client.fetchUserGroups("user-id", account, "tenant-id"),
            "Graph returned 401",
        );

        expect(fetch.getCalls()).to.have.lengthOf(2);
        expect(getSession.getCalls()).to.have.lengthOf(2);
        expect(logger.error).to.have.been.calledWith(
            "Error fetching user groups: Graph returned 401",
        );
    });

    test("shares token reacquisition when concurrent requests both return unauthorized", async () => {
        let failures = 2;
        fetch.callsFake(async () => (failures-- > 0 ? graphError(401) : page([])));
        getSession.onFirstCall().resolves(session);
        getSession.onSecondCall().resolves({ ...session, accessToken: "refreshed-token" });

        await Promise.all([
            client.fetchUserGroups("first-user", account, "tenant-id"),
            client.fetchUserGroups("second-user", account, "tenant-id"),
        ]);

        expectToken("refreshed-token");
        expect(getSession.getCalls()).to.have.lengthOf(2);
    });

    test("returns all pages without reacquiring authentication", async () => {
        const nextLink = "https://graph.microsoft.com/v1.0/users/user-id/memberOf?$skiptoken=next";
        const first = { id: "first-group", displayName: "First group" };
        const second = { id: "second-group", displayName: "Second group" };
        fetch.onFirstCall().resolves(page([first], nextLink));
        fetch.onSecondCall().resolves(page([second]));

        const groups = await client.fetchUserGroups("user-id", account, "tenant-id");

        expect(groups).to.deep.equal([first, second]);
        expect(fetch).to.have.been.calledWith(nextLink, sinon.match.any);
        expect(getSession.getCalls()).to.have.lengthOf(1);
    });

    test("logs and rejects a later page failure instead of returning partial memberships", async () => {
        const nextLink = "https://graph.microsoft.com/v1.0/users/user-id/memberOf?$skiptoken=next";
        fetch.onFirstCall().resolves(page([{ id: "group", displayName: "Group" }], nextLink));
        fetch.onSecondCall().resolves(graphError(403));

        await expectFailure(
            client.fetchUserGroups("user-id", account, "tenant-id"),
            "Graph returned 403",
        );

        expect(getSession.getCalls()).to.have.lengthOf(1);
        expect(logger.error).to.have.been.calledWith(
            "Error fetching user groups: Graph returned 403",
        );
    });

    test("does not retain an authentication result completed after disposal", async () => {
        const pending = Promise.withResolvers<vscode.AuthenticationSession>();
        getSession.returns(pending.promise);
        const request = client.fetchUserGroups("user-id", account, "tenant-id");
        client.dispose();
        pending.resolve(session);

        await expectFailure(request, "Unable to acquire a Microsoft Entra token");
        expect(fetch).not.to.have.been.called;
        await expectFailure(
            client.fetchUserGroups("user-id", account, "tenant-id"),
            "Unable to acquire a Microsoft Entra token",
        );
    });

    test("caches concurrent service-principal authentication separately from user-read authentication", async () => {
        await client.fetchUserGroups("user-id", account, "tenant-id");
        await Promise.all([
            client.ensureServicePrincipal(appId, account, "tenant-id"),
            client.ensureServicePrincipal(appId, account, "tenant-id"),
        ]);
        await client.ensureServicePrincipal(appId, account, "tenant-id");
        await client.fetchUserGroups("user-id", account, "tenant-id");

        expectToken("existing-graph-token");
        expectToken("azure-cli-graph-token");
        expect(cliCredential.getToken.getCalls()).to.have.lengthOf(1);
        expect(getSession.getCalls()).to.have.lengthOf(1);
        expect(getSession).not.to.have.been.calledWith(
            "microsoft",
            sinon.match.array.contains(["https://graph.microsoft.com/Application.Read.All"]),
            sinon.match.any,
        );
        expect(getSession).not.to.have.been.calledWith(
            sinon.match.any,
            sinon.match.any,
            sinon.match.has("createIfNone"),
        );
    });

    suite("Container administrator", () => {
        test("uses the selected account's tenant-local Graph identity rather than a home account ID", async () => {
            const user = {
                id: "33333333-3333-3333-3333-333333333333",
                userPrincipalName: "admin@contoso.com",
            };
            fetch
                .withArgs(
                    "https://graph.microsoft.com/v1.0/me?$select=id,userPrincipalName",
                    sinon.match.any,
                )
                .resolves(Response.json(user));
            expect(await client.fetchCurrentUser(account, "tenant-id")).to.deep.equal(user);
            expect(getSession).to.have.been.calledWith("microsoft", scopes, {
                account,
                silent: true,
            });
            expect(cliCredential.getToken).not.to.have.been.called;
        });

        test("rejects malformed Graph user identities instead of using an account label as admin", async () => {
            fetch
                .withArgs(
                    "https://graph.microsoft.com/v1.0/me?$select=id,userPrincipalName",
                    sinon.match.any,
                )
                .resolves(Response.json({ id: account.id, displayName: account.label }));
            await expectFailure(
                client.fetchCurrentUser(account, "tenant-id"),
                "tenant-local user ID",
            );
        });
    });

    test("rejects app requests without an explicit tenant before authenticating", async () => {
        await expectFailure(
            client.ensureServicePrincipal(appId, account, ""),
            "Tenant ID is required",
        );
        expect(cliCredential.getToken).not.to.have.been.called;
        expect(getSession).not.to.have.been.called;
        expect(fetch).not.to.have.been.called;
    });

    test("reports unavailable CLI authentication without leaking command output or caching failure", async () => {
        cliCredential.getToken.rejects(
            new Error("CLI output containing sensitive-token-not-for-logs"),
        );
        await expectFailure(
            client.ensureServicePrincipal(appId, account, "tenant-id"),
            "az login --tenant tenant-id --allow-no-subscriptions",
        );
        expect(fetch).not.to.have.been.called;
        expect(logger.error).to.have.been.calledWith("Azure CLI Graph authentication failed", {
            name: "Error",
        });
        expect(JSON.stringify(logger.error.args)).not.to.include("sensitive-token-not-for-logs");

        cliCredential.getToken.resolves({
            token: "recovered-cli-token",
            expiresOnTimestamp: Date.now() + 3_600_000,
        });
        await client.ensureServicePrincipal(appId, account, "tenant-id");
        expectToken("recovered-cli-token");
    });

    test("rejects a different CLI user before resolving a service principal", async () => {
        fetch
            .withArgs("https://graph.microsoft.com/v1.0/me?$select=id", sinon.match.any)
            .callsFake(async (_url: string, options: RequestInit) =>
                Response.json({
                    id:
                        new Headers(options.headers).get("Authorization") ===
                        "Bearer azure-cli-graph-token"
                            ? "another-tenant-user"
                            : "tenant-user-id",
                }),
            );

        await expectFailure(
            client.ensureServicePrincipal(appId, account, "tenant-id"),
            "different account than the selected VS Code account",
        );
        expect(fetch).not.to.have.been.calledWith(
            sinon.match((url: string) => url.includes("/servicePrincipals")),
            sinon.match.any,
        );
    });

    test("rejects incomplete identity responses before resolving a service principal", async () => {
        fetch
            .withArgs("https://graph.microsoft.com/v1.0/me?$select=id", sinon.match.any)
            .callsFake(async () => Response.json({}));
        await expectFailure(
            client.ensureServicePrincipal(appId, account, "tenant-id"),
            "Unable to verify the Microsoft Graph account",
        );
        expect(fetch).not.to.have.been.calledWith(
            sinon.match((url: string) => url.includes("/servicePrincipals")),
            sinon.match.any,
        );
    });

    test("refreshes CLI tokens before expiry and verifies the refreshed account", async () => {
        const clock = sandbox.useFakeTimers({ toFake: ["Date"] });
        cliCredential.getToken.onFirstCall().resolves({
            token: "initial-cli-token",
            expiresOnTimestamp: Date.now() + 120_000,
        });
        cliCredential.getToken.onSecondCall().resolves({
            token: "refreshed-cli-token",
            expiresOnTimestamp: Date.now() + 3_600_000,
        });

        await client.ensureServicePrincipal(appId, account, "tenant-id");
        clock.tick(70_000);
        await client.ensureServicePrincipal(appId, account, "tenant-id");

        expectToken("initial-cli-token");
        expectToken("refreshed-cli-token");
        expect(cliCredential.getToken.getCalls()).to.have.lengthOf(2);
    });

    test("reacquires CLI authentication once when Graph rejects its token", async () => {
        fetch.withArgs(principalUrl, sinon.match.any).onFirstCall().resolves(graphError(401));
        cliCredential.getToken.onSecondCall().resolves({
            token: "retried-cli-token",
            expiresOnTimestamp: Date.now() + 3_600_000,
        });

        await client.ensureServicePrincipal(appId, account, "tenant-id");
        expect(cliCredential.getToken.getCalls()).to.have.lengthOf(2);
        expectToken("retried-cli-token");
    });
});
