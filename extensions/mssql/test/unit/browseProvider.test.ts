/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import { expect } from "chai";

import {
    AzureBrowseProvider,
    BrowseProviderHost,
    FabricBrowseProvider,
} from "../../src/connectionconfig/browseProvider";
import {
    AzureSqlServerInfo,
    ConnectionDialogWebviewState,
    ConnectionInputMode,
} from "../../src/sharedInterfaces/connectionDialog";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import { SqlCollectionInfo, SqlDbInfo } from "../../src/sharedInterfaces/fabric";
import * as AzureHelpers from "../../src/connectionconfig/azureHelpers";
import { FabricHelper } from "../../src/fabric/fabricHelper";
import { configSelectedAzureSubscriptions } from "../../src/constants/constants";
import { createStubLogger } from "./utils";
import {
    mockAccounts,
    mockSubscriptions,
    mockTenants,
    stubFetchServersFromAzure,
    stubVscodeAzureSignIn,
} from "./azureHelperStubs";

function createState(overrides: Partial<ConnectionDialogWebviewState> = {}) {
    const state = new ConnectionDialogWebviewState();
    Object.assign(state, overrides);
    return state;
}

function createHost(state: ConnectionDialogWebviewState): {
    host: BrowseProviderHost;
    updateState: sinon.SinonSpy;
    refreshUnauthenticatedTenants: sinon.SinonStub;
} {
    const updateState = sinon.spy();
    const refreshUnauthenticatedTenants = sinon.stub().resolves();
    const host: BrowseProviderHost = {
        get state() {
            return state;
        },
        logger: createStubLogger(),
        updateState,
        refreshUnauthenticatedTenants,
    };
    return { host, updateState, refreshUnauthenticatedTenants };
}

function createFakeWorkspaceConfig(): {
    config: vscode.WorkspaceConfiguration;
    values: Record<string, unknown>;
} {
    const values: Record<string, unknown> = {};
    const config = {
        get: (key: string, defaultValue: unknown) => values[key] ?? defaultValue,
        update: (key: string, value: unknown) => {
            values[key] = value;
            return Promise.resolve();
        },
        has: () => true,
        inspect: () => undefined,
    } as unknown as vscode.WorkspaceConfiguration;
    return { config, values };
}

suite("BrowseProvider", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("AzureBrowseProvider", () => {
        suite("parseFavoriteEntry", () => {
            test("strips legacy `tenantId/subscriptionId` prefix", () => {
                const state = createState();
                const provider = new AzureBrowseProvider(createHost(state).host);

                expect(provider["parseFavoriteEntry"]("tenant-1/sub-1")).to.equal("sub-1");
                expect(provider["parseFavoriteEntry"]("sub-1")).to.equal("sub-1");
                expect(provider["parseFavoriteEntry"]("")).to.equal("");
            });
        });

        suite("loadCollections", () => {
            test("populates subscriptions for the requested tenant and reports Loaded", async () => {
                stubVscodeAzureSignIn(sandbox);
                const state = createState({
                    selectedAccountId: mockAccounts.signedInAccount.id,
                    selectedTenantId: mockTenants[0].tenantId,
                });
                const { host, updateState } = createHost(state);
                const provider = new AzureBrowseProvider(host);

                await provider.loadCollections(
                    state,
                    mockAccounts.signedInAccount.id,
                    mockTenants[0].tenantId,
                );

                expect(state.azureSubscriptionsLoadStatus.status).to.equal(ApiStatus.Loaded);
                expect(state.azureSubscriptions).to.have.lengthOf(1);
                expect(state.azureSubscriptions[0].tenantId).to.equal(mockTenants[0].tenantId);
                expect(updateState.called).to.be.true;
            });

            test("discards results if the selected account or tenant changes mid-load", async () => {
                stubVscodeAzureSignIn(sandbox);
                const state = createState({
                    selectedAccountId: mockAccounts.signedInAccount.id,
                    selectedTenantId: mockTenants[0].tenantId,
                });
                const { host } = createHost(state);
                const provider = new AzureBrowseProvider(host);

                const loadPromise = provider.loadCollections(
                    state,
                    mockAccounts.signedInAccount.id,
                    mockTenants[0].tenantId,
                );

                // Simulate the user changing the selected tenant before the load completes
                state.selectedTenantId = mockTenants[1].tenantId;
                await loadPromise;

                // Results were dropped — no subscriptions were committed
                expect(state.azureSubscriptions).to.be.empty;
            });

            test("reuses the cached subscription list on subsequent calls", async () => {
                const signIn = stubVscodeAzureSignIn(sandbox);
                const state = createState({
                    selectedAccountId: mockAccounts.signedInAccount.id,
                    selectedTenantId: mockTenants[0].tenantId,
                });
                const { host } = createHost(state);
                const provider = new AzureBrowseProvider(host);

                await provider.loadCollections(
                    state,
                    mockAccounts.signedInAccount.id,
                    mockTenants[0].tenantId,
                );
                await provider.loadCollections(
                    state,
                    mockAccounts.signedInAccount.id,
                    mockTenants[0].tenantId,
                );

                // signIn returns a fresh auth provider on each call, but the subscription cache
                // means we only consume it once.
                expect(signIn.callCount).to.equal(2);
                expect(state.azureSubscriptions).to.have.lengthOf(1);
            });
        });

        suite("loadCollectionContents", () => {
            test("populates databases on the subscription via fetchServersFromAzure", async () => {
                stubFetchServersFromAzure(sandbox);
                const state = createState();
                const { host } = createHost(state);
                const provider = new AzureBrowseProvider(host);

                provider["_subscriptionCache"].set(
                    mockSubscriptions[0].subscriptionId,
                    mockSubscriptions[0],
                );

                const subscription: SqlCollectionInfo = {
                    id: mockSubscriptions[0].subscriptionId,
                    displayName: mockSubscriptions[0].name,
                    tenantId: mockSubscriptions[0].tenantId,
                    databases: [],
                    loadStatus: { status: ApiStatus.NotStarted },
                };

                await provider.loadCollectionContents(state, subscription);

                expect(subscription.loadStatus.status).to.equal(ApiStatus.Loaded);
                expect(subscription.databases).to.have.lengthOf(2);
                expect(
                    subscription.databases.some(
                        (s) => (s as AzureSqlServerInfo).server === "testServer-Ten0Sub1-2",
                    ),
                ).to.be.true;
            });

            test("marks the collection as Error when the subscription is missing from the cache", async () => {
                const state = createState();
                const { host } = createHost(state);
                const provider = new AzureBrowseProvider(host);

                const subscription: SqlCollectionInfo = {
                    id: "unknown",
                    displayName: "Unknown",
                    tenantId: "tenant",
                    databases: [],
                    loadStatus: { status: ApiStatus.NotStarted },
                };

                await provider.loadCollectionContents(state, subscription);

                expect(subscription.loadStatus.status).to.equal(ApiStatus.Error);
            });
        });

        suite("invalidateCache", () => {
            test("clears the cached subscriptions", () => {
                const state = createState();
                const provider = new AzureBrowseProvider(createHost(state).host);
                provider["_subscriptionCache"].set(
                    mockSubscriptions[0].subscriptionId,
                    mockSubscriptions[0],
                );

                provider.invalidateCache();

                expect(provider["_subscriptionCache"].size).to.equal(0);
            });
        });

        suite("toggleFavorite", () => {
            test("writes bare subscription IDs and migrates legacy composite entries", async () => {
                const { config, values } = createFakeWorkspaceConfig();
                values[configSelectedAzureSubscriptions] = ["legacy-tenant/legacy-sub"];
                sandbox.stub(vscode.workspace, "getConfiguration").returns(config);

                const state = createState();
                const provider = new AzureBrowseProvider(createHost(state).host);

                await provider.toggleFavorite(state, "new-sub");

                const stored = values[configSelectedAzureSubscriptions] as string[];
                expect(stored).to.deep.equal(["legacy-sub", "new-sub"]);
                expect(state.favoritedAzureSubscriptionIds).to.deep.equal([
                    "legacy-sub",
                    "new-sub",
                ]);
            });

            test("removes a subscription that was already favorited", async () => {
                const { config, values } = createFakeWorkspaceConfig();
                values[configSelectedAzureSubscriptions] = ["sub-1", "sub-2"];
                sandbox.stub(vscode.workspace, "getConfiguration").returns(config);

                const state = createState();
                const provider = new AzureBrowseProvider(createHost(state).host);

                await provider.toggleFavorite(state, "sub-1");

                expect(values[configSelectedAzureSubscriptions]).to.deep.equal(["sub-2"]);
                expect(state.favoritedAzureSubscriptionIds).to.deep.equal(["sub-2"]);
            });
        });
    });

    suite("FabricBrowseProvider", () => {
        function stubFabricHelpers() {
            sandbox.stub(AzureHelpers.VsCodeAzureHelper, "getAccountById").resolves({
                id: mockAccounts.signedInAccount.id,
                label: mockAccounts.signedInAccount.label,
            } as vscode.AuthenticationSessionAccountInformation);
            sandbox
                .stub(AzureHelpers.VsCodeAzureHelper, "getTenant")
                .resolves(mockTenants[0] as never);
        }

        suite("loadCollections", () => {
            test("populates workspaces and caches them for the next call", async () => {
                stubFabricHelpers();
                const fabricStub = sandbox
                    .stub(FabricHelper, "getFabricWorkspaces")
                    .resolves([
                        { id: "ws-1", displayName: "Workspace One" } as never,
                        { id: "ws-2", displayName: "Workspace Two" } as never,
                    ]);

                const state = createState({
                    selectedAccountId: mockAccounts.signedInAccount.id,
                    selectedTenantId: mockTenants[0].tenantId,
                });
                const { host } = createHost(state);
                const provider = new FabricBrowseProvider(host);

                await provider.loadCollections(
                    state,
                    mockAccounts.signedInAccount.id,
                    mockTenants[0].tenantId,
                );

                expect(state.fabricWorkspacesLoadStatus.status).to.equal(ApiStatus.Loaded);
                expect(state.fabricWorkspaces.map((w) => w.id)).to.deep.equal(["ws-1", "ws-2"]);

                // Second call must hit the cache instead of the API.
                await provider.loadCollections(
                    state,
                    mockAccounts.signedInAccount.id,
                    mockTenants[0].tenantId,
                );
                expect(fabricStub.callCount).to.equal(1);
            });

            test("sets fabricWorkspacesLoadStatus to Loading before awaiting the API", async () => {
                stubFabricHelpers();
                let statusWhenApiCalled: ApiStatus | undefined;
                sandbox.stub(FabricHelper, "getFabricWorkspaces").callsFake(async () => {
                    statusWhenApiCalled = state.fabricWorkspacesLoadStatus.status;
                    return [];
                });

                const state = createState({
                    selectedAccountId: mockAccounts.signedInAccount.id,
                    selectedTenantId: mockTenants[0].tenantId,
                });
                const { host } = createHost(state);
                const provider = new FabricBrowseProvider(host);

                await provider.loadCollections(
                    state,
                    mockAccounts.signedInAccount.id,
                    mockTenants[0].tenantId,
                );

                expect(statusWhenApiCalled).to.equal(ApiStatus.Loading);
            });

            test("reports Error when the API call fails", async () => {
                stubFabricHelpers();
                sandbox.stub(FabricHelper, "getFabricWorkspaces").rejects(new Error("fabric boom"));

                const state = createState({
                    selectedAccountId: mockAccounts.signedInAccount.id,
                    selectedTenantId: mockTenants[0].tenantId,
                });
                const { host } = createHost(state);
                const provider = new FabricBrowseProvider(host);

                await provider.loadCollections(
                    state,
                    mockAccounts.signedInAccount.id,
                    mockTenants[0].tenantId,
                );

                expect(state.fabricWorkspacesLoadStatus.status).to.equal(ApiStatus.Error);
            });
        });

        suite("loadCollectionContents", () => {
            test("populates databases from both FabricHelper APIs", async () => {
                sandbox.stub(FabricHelper, "getFabricDatabases").resolves([
                    {
                        id: "db-1",
                        displayName: "DB One",
                        databases: [],
                        server: "server-1",
                        type: "SqlDatabase",
                    } as SqlDbInfo,
                ]);
                sandbox.stub(FabricHelper, "getFabricSqlEndpoints").resolves([
                    {
                        id: "ep-1",
                        displayName: "Endpoint One",
                        databases: [],
                        server: "server-2",
                        type: "SqlEndpoint",
                    } as SqlDbInfo,
                ]);

                const state = createState();
                const { host } = createHost(state);
                const provider = new FabricBrowseProvider(host);

                const workspace: SqlCollectionInfo = {
                    id: "ws-1",
                    displayName: "Workspace One",
                    tenantId: mockTenants[0].tenantId,
                    databases: [],
                    loadStatus: { status: ApiStatus.NotStarted },
                };

                await provider.loadCollectionContents(state, workspace);

                expect(workspace.loadStatus.status).to.equal(ApiStatus.Loaded);
                expect(workspace.databases.map((d) => d.id).sort()).to.deep.equal(["db-1", "ep-1"]);
            });

            test("reports Error when both APIs fail", async () => {
                sandbox.stub(FabricHelper, "getFabricDatabases").rejects(new Error("dbs boom"));
                sandbox
                    .stub(FabricHelper, "getFabricSqlEndpoints")
                    .rejects(new Error("endpoints boom"));

                const state = createState();
                const { host } = createHost(state);
                const provider = new FabricBrowseProvider(host);

                const workspace: SqlCollectionInfo = {
                    id: "ws-1",
                    displayName: "Workspace One",
                    tenantId: mockTenants[0].tenantId,
                    databases: [],
                    loadStatus: { status: ApiStatus.NotStarted },
                };

                await provider.loadCollectionContents(state, workspace);

                expect(workspace.loadStatus.status).to.equal(ApiStatus.Error);
            });
        });

        suite("invalidateCache", () => {
            test("clears the cached workspaces", () => {
                const state = createState();
                const provider = new FabricBrowseProvider(createHost(state).host);
                provider["_workspaceCache"].set("key", []);

                provider.invalidateCache();

                expect(provider["_workspaceCache"].size).to.equal(0);
            });
        });
    });

    suite("autoLoadContents", () => {
        test("loads favorites even when total collections exceed the autoload limit", async () => {
            const state = createState();
            const { host } = createHost(state);
            const provider = new FabricBrowseProvider(host);

            // Fabric autoload limit is 10
            const workspaces: SqlCollectionInfo[] = Array.from({ length: 20 }, (_, i) => ({
                id: `ws-${i}`,
                displayName: `WS ${i}`,
                tenantId: "tenant",
                databases: [],
                loadStatus: { status: ApiStatus.NotStarted },
            }));
            state.fabricWorkspaces = workspaces;
            state.favoritedFabricWorkspaceIds = ["ws-0", "ws-5"];

            const loadContents = sandbox.stub(provider, "loadCollectionContents").resolves();

            await provider.autoLoadContents(state);

            // Only the two favorites should be loaded; non-favorites are skipped beyond limit.
            expect(loadContents.callCount).to.equal(2);
            const loadedIds = loadContents.getCalls().map((c) => c.args[1].id);
            expect(loadedIds.sort()).to.deep.equal(["ws-0", "ws-5"]);
        });

        test("loads all collections when within the autoload limit", async () => {
            const state = createState();
            const { host } = createHost(state);
            const provider = new FabricBrowseProvider(host);

            // 3 collections, well within Fabric's autoload limit of 10
            state.fabricWorkspaces = ["a", "b", "c"].map((id) => ({
                id,
                displayName: id,
                tenantId: "tenant",
                databases: [],
                loadStatus: { status: ApiStatus.NotStarted },
            }));
            state.favoritedFabricWorkspaceIds = ["a"];

            const loadContents = sandbox.stub(provider, "loadCollectionContents").resolves();

            await provider.autoLoadContents(state);

            expect(loadContents.callCount).to.equal(3);
        });

        test("is a no-op when there are no collections", async () => {
            const state = createState();
            const { host } = createHost(state);
            const provider = new FabricBrowseProvider(host);

            const loadContents = sandbox.stub(provider, "loadCollectionContents").resolves();

            await provider.autoLoadContents(state);

            expect(loadContents.notCalled).to.be.true;
        });
    });

    suite("BrowseProvider.inputMode", () => {
        test("AzureBrowseProvider reports AzureBrowse", () => {
            const state = createState();
            expect(new AzureBrowseProvider(createHost(state).host).inputMode).to.equal(
                ConnectionInputMode.AzureBrowse,
            );
        });

        test("FabricBrowseProvider reports FabricBrowse", () => {
            const state = createState();
            expect(new FabricBrowseProvider(createHost(state).host).inputMode).to.equal(
                ConnectionInputMode.FabricBrowse,
            );
        });
    });
});
