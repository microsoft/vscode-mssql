/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { DabTool, DabToolParams } from "../../src/copilot/tools/dabTool";
import { SchemaDesignerWebviewManager } from "../../src/schemaDesigner/schemaDesignerWebviewManager";
import { SchemaDesignerWebviewController } from "../../src/schemaDesigner/schemaDesignerWebviewController";
import { Dab } from "../../src/sharedInterfaces/dab";
import { registerSchemaDesignerDabToolHandlers } from "../../src/reactviews/pages/SchemaDesigner/schemaDesignerRpcHandlers";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";
import * as telemetry from "../../src/telemetry/telemetry";

chai.use(sinonChai);

suite("DabTool Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockToken: vscode.CancellationToken;
    let dabTool: DabTool;

    const createTable = (
        id: string,
        schemaName: string,
        tableName: string,
    ): SchemaDesigner.Table => {
        return {
            id,
            schema: schemaName,
            name: tableName,
            columns: [],
            foreignKeys: [],
        };
    };

    const createTables = (count: number): SchemaDesigner.Table[] => {
        return Array.from({ length: count }).map((_, index) =>
            createTable(`table-${index + 1}`, "dbo", `Table${index + 1}`),
        );
    };

    const createDabHandlerHarness = (params: {
        tables: SchemaDesigner.Table[];
        dabConfig?: Dab.DabConfig | null;
        initialized?: boolean;
    }) => {
        let currentTables = params.tables;
        let currentDabConfig = params.dabConfig ?? null;
        const isInitializedRef = { current: params.initialized ?? true };
        const requestHandlers = new Map<string, (request: any) => Promise<any>>();
        const commitSpy = sandbox.spy((config: Dab.DabConfig) => {
            currentDabConfig = config;
        });

        const extensionRpc = {
            onRequest: sandbox.stub().callsFake((type: any, handler: any) => {
                requestHandlers.set(type.method, handler);
            }),
        };

        registerSchemaDesignerDabToolHandlers({
            extensionRpc: extensionRpc as any,
            isInitializedRef,
            getCurrentDabConfig: () => currentDabConfig,
            getCurrentSchemaTables: () => currentTables,
            commitDabConfig: commitSpy,
        });

        return {
            getState: () =>
                requestHandlers.get(Dab.GetDabToolStateRequest.type.method)!(undefined as any),
            applyChanges: (request: Dab.ApplyDabToolChangesParams) =>
                requestHandlers.get(Dab.ApplyDabToolChangesRequest.type.method)!(request),
            setTables: (tables: SchemaDesigner.Table[]) => {
                currentTables = tables;
            },
            getConfig: () => currentDabConfig,
            commitSpy,
        };
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        mockToken = {} as vscode.CancellationToken;
        dabTool = new DabTool();
        sandbox.stub(telemetry, "sendActionEvent");
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("Tool behavior", () => {
        test("returns no_active_designer when there is no active schema designer", async () => {
            const managerStub = {
                getActiveDesigner: sandbox.stub().returns(undefined),
            };
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns(managerStub as any);

            const options = {
                input: { operation: "get_state" },
            } as vscode.LanguageModelToolInvocationOptions<DabToolParams>;

            const parsed = JSON.parse(await dabTool.call(options, mockToken));
            expect(parsed.success).to.equal(false);
            expect(parsed.reason).to.equal("no_active_designer");
        });

        test("validates targetHint before webview RPC and returns target_mismatch", async () => {
            const mockDesigner = sandbox.createStubInstance(SchemaDesignerWebviewController);
            sandbox.stub(mockDesigner as any, "server").get(() => "localhost");
            sandbox.stub(mockDesigner as any, "database").get(() => "AdventureWorks");

            const managerStub = {
                getActiveDesigner: sandbox.stub().returns(mockDesigner),
            };
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns(managerStub as any);

            const options = {
                input: {
                    operation: "apply_changes",
                    payload: {
                        expectedVersion: "dabcfg_abc",
                        targetHint: { server: "localhost", database: "WrongDb" },
                        changes: [{ type: "set_all_entities_enabled", isEnabled: false }],
                    },
                },
            } as vscode.LanguageModelToolInvocationOptions<DabToolParams>;

            const parsed = JSON.parse(await dabTool.call(options, mockToken));
            expect(parsed.success).to.equal(false);
            expect(parsed.reason).to.equal("target_mismatch");
            expect(mockDesigner.applyDabToolChanges.called).to.equal(false);
            expect(mockDesigner.revealToForeground.called).to.equal(false);
            expect(mockDesigner.showDabView.called).to.equal(false);
        });
    });

    suite("Webview handler behavior", () => {
        test("get_state initializes/syncs DAB config and returns version + summary (full when entityCount <= 150)", async () => {
            const harness = createDabHandlerHarness({
                tables: [createTable("t1", "dbo", "Users"), createTable("t2", "sales", "Orders")],
                dabConfig: {
                    apiTypes: [Dab.ApiType.Rest],
                    entities: [
                        {
                            ...Dab.createDefaultEntityConfig(createTable("t1", "dbo", "OldUsers")),
                            tableName: "OldUsers",
                        },
                        Dab.createDefaultEntityConfig(createTable("orphan", "dbo", "Removed")),
                    ],
                },
            });

            const state = await harness.getState();
            expect(state.returnState).to.equal("full");
            expect(state.version).to.match(/^dabcfg_[a-f0-9]{64}$/);
            expect(state.summary.entityCount).to.equal(2);
            expect(state.config?.entities.map((e) => e.id).sort()).to.deep.equal(["t1", "t2"]);
            expect(state.config?.entities.find((e) => e.id === "t1")?.tableName).to.equal("Users");
            expect(harness.commitSpy.calledOnce).to.equal(true);
        });

        test("get_state auto-downgrades to summary when entityCount > 150", async () => {
            const harness = createDabHandlerHarness({
                tables: createTables(151),
                dabConfig: null,
            });

            const state = await harness.getState();
            expect(state.returnState).to.equal("summary");
            expect(state.stateOmittedReason).to.equal("entity_count_over_threshold");
            expect(state).to.not.have.property("config");
        });

        test("apply_changes ensures init+sync before version comparison and returns stale_state details", async () => {
            const harness = createDabHandlerHarness({
                tables: [createTable("t1", "dbo", "Users")],
                dabConfig: null,
            });

            const result = await harness.applyChanges({
                expectedVersion: "dabcfg_outdated",
                changes: [{ type: "set_all_entities_enabled", isEnabled: false }],
            });

            expect(result.success).to.equal(false);
            if (result.success) {
                throw new Error("Expected stale_state response");
            }
            expect(result.reason).to.equal("stale_state");
            expect(result.version).to.match(/^dabcfg_[a-f0-9]{64}$/);
            expect(result.summary?.entityCount).to.equal(1);
            expect(result.returnState).to.equal("full");
            expect(result.config?.entities).to.have.length(1);
            expect(result.stateOmittedReason).to.equal(undefined);
            expect(harness.commitSpy.called).to.equal(false);
            expect(harness.getConfig()).to.equal(null);
        });

        test("apply_changes stale_state respects returnState policy (default full -> summary over threshold)", async () => {
            const harness = createDabHandlerHarness({
                tables: createTables(101),
                dabConfig: null,
            });

            const result = await harness.applyChanges({
                expectedVersion: "dabcfg_outdated",
                changes: [{ type: "set_all_entities_enabled", isEnabled: false }],
            });

            expect(result.success).to.equal(false);
            if (result.success) {
                throw new Error("Expected stale_state response");
            }
            expect(result.reason).to.equal("stale_state");
            expect(result.returnState).to.equal("summary");
            expect(result.stateOmittedReason).to.equal("entity_count_over_threshold");
            expect(result).to.not.have.property("config");
            expect(result.summary?.entityCount).to.equal(101);
            expect(harness.commitSpy.called).to.equal(false);
            expect(harness.getConfig()).to.equal(null);
        });

        test("apply_changes success path returns appliedChanges = changes.length and commits once", async () => {
            const harness = createDabHandlerHarness({
                tables: [createTable("t1", "dbo", "Users"), createTable("t2", "sales", "Orders")],
                dabConfig: null,
            });

            const currentState = await harness.getState();
            harness.commitSpy.resetHistory();

            const result = await harness.applyChanges({
                expectedVersion: currentState.version,
                changes: [
                    { type: "set_api_types", apiTypes: [Dab.ApiType.Rest, Dab.ApiType.GraphQL] },
                    {
                        type: "set_entity_enabled",
                        entity: { schemaName: "dbo", tableName: "Users" },
                        isEnabled: false,
                    },
                ],
            });

            expect(result.success).to.equal(true);
            if (!result.success) {
                throw new Error("Expected success response");
            }
            expect(result.appliedChanges).to.equal(2);
            expect(harness.commitSpy.calledOnce).to.equal(true);
        });

        test("apply_changes failure path uses fail-fast prefix commit semantics", async () => {
            const harness = createDabHandlerHarness({
                tables: [createTable("t1", "dbo", "Users"), createTable("t2", "sales", "Orders")],
                dabConfig: null,
            });

            const currentState = await harness.getState();
            harness.commitSpy.resetHistory();

            const result = await harness.applyChanges({
                expectedVersion: currentState.version,
                changes: [
                    { type: "set_api_types", apiTypes: [Dab.ApiType.Rest, Dab.ApiType.GraphQL] },
                    {
                        type: "set_entity_actions",
                        entity: { schemaName: "sales", tableName: "MissingTable" },
                        actions: [Dab.EntityAction.Read],
                    },
                ],
            });

            expect(result.success).to.equal(false);
            if (result.success) {
                throw new Error("Expected failure response");
            }
            expect(result.failedChangeIndex).to.equal(1);
            expect(result.appliedChanges).to.equal(1);
            expect(result.version).to.match(/^dabcfg_[a-f0-9]{64}$/);
            expect(result.summary?.apiTypes).to.deep.equal([Dab.ApiType.Rest, Dab.ApiType.GraphQL]);
            expect(harness.commitSpy.calledOnce).to.equal(true);
        });

        test("apply_changes defaults to full returnState and auto-downgrades to summary when entityCount > 100", async () => {
            const smallHarness = createDabHandlerHarness({
                tables: createTables(2),
                dabConfig: null,
            });
            const smallState = await smallHarness.getState();

            const fullResult = await smallHarness.applyChanges({
                expectedVersion: smallState.version,
                changes: [{ type: "set_all_entities_enabled", isEnabled: true }],
            });
            expect(fullResult.success).to.equal(true);
            if (!fullResult.success) {
                throw new Error("Expected success response");
            }
            expect(fullResult.returnState).to.equal("full");
            expect(fullResult.config).to.exist;

            const largeHarness = createDabHandlerHarness({
                tables: createTables(101),
                dabConfig: null,
            });
            const largeState = await largeHarness.getState();
            const summaryResult = await largeHarness.applyChanges({
                expectedVersion: largeState.version,
                changes: [{ type: "set_all_entities_enabled", isEnabled: false }],
            });

            expect(summaryResult.success).to.equal(true);
            if (!summaryResult.success) {
                throw new Error("Expected success response");
            }
            expect(summaryResult.returnState).to.equal("summary");
            expect(summaryResult.stateOmittedReason).to.equal("entity_count_over_threshold");
            expect(summaryResult).to.not.have.property("config");
        });

        test("apply_changes supports clearing customRestPath/customGraphQLType via null patch values", async () => {
            const table = createTable("t1", "dbo", "Users");
            const config = Dab.createDefaultConfig([table]);
            config.entities[0].advancedSettings.customRestPath = "/users";
            config.entities[0].advancedSettings.customGraphQLType = "UsersType";

            const harness = createDabHandlerHarness({
                tables: [table],
                dabConfig: config,
            });
            const state = await harness.getState();

            const result = await harness.applyChanges({
                expectedVersion: state.version,
                changes: [
                    {
                        type: "patch_entity_settings",
                        entity: { id: "t1" },
                        set: {
                            customRestPath: null,
                            customGraphQLType: null,
                        },
                    },
                ],
            });

            expect(result.success).to.equal(true);
            if (!result.success) {
                throw new Error("Expected success response");
            }
            expect(result.returnState).to.equal("full");
            const settings = result.config?.entities[0].advancedSettings;
            expect(settings).to.exist;
            expect(settings).to.not.have.property("customRestPath");
            expect(settings).to.not.have.property("customGraphQLType");
        });
    });
});
