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
import { locConstants } from "../../src/reactviews/common/locConstants";
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

        test("enforces strict targetHint match when active server is missing", async () => {
            const mockDesigner = sandbox.createStubInstance(SchemaDesignerWebviewController);
            sandbox.stub(mockDesigner as any, "server").get(() => undefined);
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
                        targetHint: { server: "localhost", database: "AdventureWorks" },
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

        test("accepts case-insensitive targetHint match and applies changes", async () => {
            const mockDesigner = sandbox.createStubInstance(SchemaDesignerWebviewController);
            sandbox.stub(mockDesigner as any, "server").get(() => "LocalHost");
            sandbox.stub(mockDesigner as any, "database").get(() => "AdventureWorks");
            mockDesigner.applyDabToolChanges.resolves({
                success: true,
                appliedChanges: 1,
                returnState: "none",
                stateOmittedReason: "caller_requested_none",
                version: "dabcfg_after",
                summary: {
                    entityCount: 1,
                    enabledEntityCount: 1,
                    apiTypes: [Dab.ApiType.Rest],
                },
            });

            const managerStub = {
                getActiveDesigner: sandbox.stub().returns(mockDesigner),
            };
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns(managerStub as any);

            const options = {
                input: {
                    operation: "apply_changes",
                    payload: {
                        expectedVersion: "dabcfg_before",
                        targetHint: { server: "localhost", database: "adventureworks" },
                        changes: [{ type: "set_all_entities_enabled", isEnabled: true }],
                    },
                    options: { returnState: "none" },
                },
            } as unknown as vscode.LanguageModelToolInvocationOptions<DabToolParams>;

            const parsed = JSON.parse(await dabTool.call(options, mockToken));
            expect(parsed.success).to.equal(true);
            expect(mockDesigner.applyDabToolChanges.calledOnce).to.equal(true);
        });

        test("returns invalid_request for unknown operation", async () => {
            const mockDesigner = sandbox.createStubInstance(SchemaDesignerWebviewController);
            sandbox.stub(mockDesigner as any, "server").get(() => "localhost");
            sandbox.stub(mockDesigner as any, "database").get(() => "AdventureWorks");
            const managerStub = {
                getActiveDesigner: sandbox.stub().returns(mockDesigner),
            };
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns(managerStub as any);

            const options = {
                input: { operation: "unknown_operation" },
            } as unknown as vscode.LanguageModelToolInvocationOptions<DabToolParams>;

            const parsed = JSON.parse(await dabTool.call(options, mockToken));
            expect(parsed.success).to.equal(false);
            expect(parsed.reason).to.equal("invalid_request");
            expect(parsed.message).to.include("Unknown operation");
            expect(parsed.server).to.equal("localhost");
            expect(parsed.database).to.equal("AdventureWorks");
        });

        test("returns invalid_request when apply_changes is missing expectedVersion", async () => {
            const mockDesigner = sandbox.createStubInstance(SchemaDesignerWebviewController);
            const managerStub = {
                getActiveDesigner: sandbox.stub().returns(mockDesigner),
            };
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns(managerStub as any);

            const options = {
                input: {
                    operation: "apply_changes",
                    payload: {
                        changes: [{ type: "set_all_entities_enabled", isEnabled: true }],
                    },
                },
            } as unknown as vscode.LanguageModelToolInvocationOptions<DabToolParams>;

            const parsed = JSON.parse(await dabTool.call(options, mockToken));
            expect(parsed.success).to.equal(false);
            expect(parsed.reason).to.equal("invalid_request");
            expect(parsed.message).to.equal("Missing payload.expectedVersion.");
            expect(mockDesigner.applyDabToolChanges.called).to.equal(false);
            expect(mockDesigner.revealToForeground.called).to.equal(false);
            expect(mockDesigner.showDabView.called).to.equal(false);
        });

        test("returns invalid_request when apply_changes is missing changes", async () => {
            const mockDesigner = sandbox.createStubInstance(SchemaDesignerWebviewController);
            const managerStub = {
                getActiveDesigner: sandbox.stub().returns(mockDesigner),
            };
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns(managerStub as any);

            const options = {
                input: {
                    operation: "apply_changes",
                    payload: {
                        expectedVersion: "dabcfg_abc",
                    },
                },
            } as unknown as vscode.LanguageModelToolInvocationOptions<DabToolParams>;

            const parsed = JSON.parse(await dabTool.call(options, mockToken));
            expect(parsed.success).to.equal(false);
            expect(parsed.reason).to.equal("invalid_request");
            expect(parsed.message).to.equal("Missing payload.changes (non-empty array).");
            expect(mockDesigner.applyDabToolChanges.called).to.equal(false);
            expect(mockDesigner.revealToForeground.called).to.equal(false);
            expect(mockDesigner.showDabView.called).to.equal(false);
        });

        test("maps apply_changes success receipt counts for all change types", async () => {
            const mockDesigner = sandbox.createStubInstance(SchemaDesignerWebviewController);
            sandbox.stub(mockDesigner as any, "server").get(() => "localhost");
            sandbox.stub(mockDesigner as any, "database").get(() => "AdventureWorks");
            mockDesigner.applyDabToolChanges.resolves({
                success: true,
                appliedChanges: 6,
                returnState: "none",
                stateOmittedReason: "caller_requested_none",
                version: "dabcfg_after",
                summary: {
                    entityCount: 2,
                    enabledEntityCount: 1,
                    apiTypes: [Dab.ApiType.Rest],
                },
            });

            const managerStub = {
                getActiveDesigner: sandbox.stub().returns(mockDesigner),
            };
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns(managerStub as any);

            const options = {
                input: {
                    operation: "apply_changes",
                    payload: {
                        expectedVersion: "dabcfg_before",
                        changes: [
                            { type: "set_api_types", apiTypes: [Dab.ApiType.Rest] },
                            { type: "set_entity_enabled", entity: { id: "t1" }, isEnabled: false },
                            {
                                type: "set_entity_actions",
                                entity: { id: "t1" },
                                actions: [Dab.EntityAction.Read],
                            },
                            {
                                type: "patch_entity_settings",
                                entity: { id: "t1" },
                                set: { authorizationRole: Dab.AuthorizationRole.Authenticated },
                            },
                            { type: "set_only_enabled_entities", entities: [{ id: "t2" }] },
                            { type: "set_all_entities_enabled", isEnabled: true },
                        ],
                    },
                    options: {
                        returnState: "none",
                    },
                },
            } as unknown as vscode.LanguageModelToolInvocationOptions<DabToolParams>;

            const parsed = JSON.parse(await dabTool.call(options, mockToken));
            expect(parsed.success).to.equal(true);
            expect(parsed.receipt).to.deep.equal({
                setApiTypesCount: 1,
                setEntityEnabledCount: 1,
                setEntityActionsCount: 1,
                patchEntitySettingsCount: 1,
                setOnlyEnabledEntitiesCount: 1,
                setAllEntitiesEnabledCount: 1,
            });
        });

        test("maps get_state success from webview and includes active target", async () => {
            const mockDesigner = sandbox.createStubInstance(SchemaDesignerWebviewController);
            sandbox.stub(mockDesigner as any, "server").get(() => "localhost");
            sandbox.stub(mockDesigner as any, "database").get(() => "AdventureWorks");
            mockDesigner.getDabToolState.resolves({
                returnState: "full",
                version: "dabcfg_state",
                summary: {
                    entityCount: 2,
                    enabledEntityCount: 2,
                    apiTypes: [Dab.ApiType.Rest],
                },
                config: Dab.createDefaultConfig([
                    createTable("t1", "dbo", "Users"),
                    createTable("t2", "sales", "Orders"),
                ]),
            });

            const managerStub = {
                getActiveDesigner: sandbox.stub().returns(mockDesigner),
            };
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns(managerStub as any);

            const options = {
                input: { operation: "get_state" },
            } as vscode.LanguageModelToolInvocationOptions<DabToolParams>;

            const parsed = JSON.parse(await dabTool.call(options, mockToken));
            expect(parsed.success).to.equal(true);
            expect(parsed.server).to.equal("localhost");
            expect(parsed.database).to.equal("AdventureWorks");
            expect(parsed.version).to.equal("dabcfg_state");
            expect(parsed.summary.entityCount).to.equal(2);
            expect(mockDesigner.getDabToolState.calledOnce).to.equal(true);
            expect(mockDesigner.revealToForeground.called).to.equal(false);
            expect(mockDesigner.showDabView.called).to.equal(false);
        });

        test("maps apply_changes success from webview and adds receipt counts", async () => {
            const mockDesigner = sandbox.createStubInstance(SchemaDesignerWebviewController);
            sandbox.stub(mockDesigner as any, "server").get(() => "localhost");
            sandbox.stub(mockDesigner as any, "database").get(() => "AdventureWorks");
            mockDesigner.applyDabToolChanges.resolves({
                success: true,
                appliedChanges: 2,
                returnState: "summary",
                stateOmittedReason: "caller_requested_summary",
                version: "dabcfg_after",
                summary: {
                    entityCount: 3,
                    enabledEntityCount: 1,
                    apiTypes: [Dab.ApiType.Rest, Dab.ApiType.GraphQL],
                },
            });

            const managerStub = {
                getActiveDesigner: sandbox.stub().returns(mockDesigner),
            };
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns(managerStub as any);

            const options = {
                input: {
                    operation: "apply_changes",
                    payload: {
                        expectedVersion: "dabcfg_before",
                        changes: [
                            {
                                type: "set_api_types",
                                apiTypes: [Dab.ApiType.Rest, Dab.ApiType.GraphQL],
                            },
                            { type: "set_all_entities_enabled", isEnabled: false },
                        ],
                    },
                    options: {
                        returnState: "summary",
                    },
                },
            } as unknown as vscode.LanguageModelToolInvocationOptions<DabToolParams>;

            const parsed = JSON.parse(await dabTool.call(options, mockToken));
            expect(parsed.success).to.equal(true);
            expect(parsed.appliedChanges).to.equal(2);
            expect(parsed.returnState).to.equal("summary");
            expect(parsed.stateOmittedReason).to.equal("caller_requested_summary");
            expect(parsed.receipt).to.deep.equal({
                setApiTypesCount: 1,
                setEntityEnabledCount: 0,
                setEntityActionsCount: 0,
                patchEntitySettingsCount: 0,
                setOnlyEnabledEntitiesCount: 0,
                setAllEntitiesEnabledCount: 1,
            });
            expect(mockDesigner.applyDabToolChanges.calledOnce).to.equal(true);
            expect(mockDesigner.revealToForeground.calledOnce).to.equal(true);
            expect(mockDesigner.showDabView.calledOnce).to.equal(true);
        });

        test("maps apply_changes failure from webview including version/summary", async () => {
            const mockDesigner = sandbox.createStubInstance(SchemaDesignerWebviewController);
            sandbox.stub(mockDesigner as any, "server").get(() => "localhost");
            sandbox.stub(mockDesigner as any, "database").get(() => "AdventureWorks");
            mockDesigner.applyDabToolChanges.resolves({
                success: false,
                reason: "validation_error",
                message: "actions must be unique.",
                failedChangeIndex: 1,
                appliedChanges: 1,
                version: "dabcfg_failed",
                summary: {
                    entityCount: 2,
                    enabledEntityCount: 1,
                    apiTypes: [Dab.ApiType.Rest],
                },
                returnState: "none",
                stateOmittedReason: "caller_requested_none",
            });

            const managerStub = {
                getActiveDesigner: sandbox.stub().returns(mockDesigner),
            };
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns(managerStub as any);

            const options = {
                input: {
                    operation: "apply_changes",
                    payload: {
                        expectedVersion: "dabcfg_before",
                        changes: [
                            { type: "set_all_entities_enabled", isEnabled: true },
                            {
                                type: "set_entity_actions",
                                entity: { id: "t1" },
                                actions: [Dab.EntityAction.Read, Dab.EntityAction.Read],
                            },
                        ],
                    },
                    options: {
                        returnState: "none",
                    },
                },
            } as unknown as vscode.LanguageModelToolInvocationOptions<DabToolParams>;

            const parsed = JSON.parse(await dabTool.call(options, mockToken));
            expect(parsed.success).to.equal(false);
            expect(parsed.reason).to.equal("validation_error");
            expect(parsed.failedChangeIndex).to.equal(1);
            expect(parsed.appliedChanges).to.equal(1);
            expect(parsed.version).to.equal("dabcfg_failed");
            expect(parsed.summary.enabledEntityCount).to.equal(1);
            expect(parsed.returnState).to.equal("none");
            expect(parsed.stateOmittedReason).to.equal("caller_requested_none");
            expect(mockDesigner.revealToForeground.calledOnce).to.equal(true);
            expect(mockDesigner.showDabView.calledOnce).to.equal(true);
        });

        test("maps apply_changes failure with config payload when provided by webview", async () => {
            const mockDesigner = sandbox.createStubInstance(SchemaDesignerWebviewController);
            sandbox.stub(mockDesigner as any, "server").get(() => "localhost");
            sandbox.stub(mockDesigner as any, "database").get(() => "AdventureWorks");
            mockDesigner.applyDabToolChanges.resolves({
                success: false,
                reason: "stale_state",
                message: "DAB configuration changed since last read.",
                failedChangeIndex: 0,
                appliedChanges: 0,
                version: "dabcfg_latest",
                summary: {
                    entityCount: 1,
                    enabledEntityCount: 1,
                    apiTypes: [Dab.ApiType.Rest],
                },
                returnState: "full",
                config: Dab.createDefaultConfig([createTable("t1", "dbo", "Users")]),
            });

            const managerStub = {
                getActiveDesigner: sandbox.stub().returns(mockDesigner),
            };
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns(managerStub as any);

            const options = {
                input: {
                    operation: "apply_changes",
                    payload: {
                        expectedVersion: "dabcfg_before",
                        changes: [{ type: "set_all_entities_enabled", isEnabled: false }],
                    },
                },
            } as unknown as vscode.LanguageModelToolInvocationOptions<DabToolParams>;

            const parsed = JSON.parse(await dabTool.call(options, mockToken));
            expect(parsed.success).to.equal(false);
            expect(parsed.reason).to.equal("stale_state");
            expect(parsed.returnState).to.equal("full");
            expect(parsed.config?.entities).to.have.length(1);
        });

        test("returns internal_error when tool call throws", async () => {
            const mockDesigner = sandbox.createStubInstance(SchemaDesignerWebviewController);
            sandbox.stub(mockDesigner as any, "server").get(() => "localhost");
            sandbox.stub(mockDesigner as any, "database").get(() => "AdventureWorks");
            mockDesigner.getDabToolState.rejects(new Error("boom"));
            const managerStub = {
                getActiveDesigner: sandbox.stub().returns(mockDesigner),
            };
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns(managerStub as any);

            const options = {
                input: { operation: "get_state" },
            } as vscode.LanguageModelToolInvocationOptions<DabToolParams>;

            const parsed = JSON.parse(await dabTool.call(options, mockToken));
            expect(parsed.success).to.equal(false);
            expect(parsed.reason).to.equal("internal_error");
            expect(parsed.message).to.equal("boom");
            expect(parsed.server).to.equal("localhost");
            expect(parsed.database).to.equal("AdventureWorks");
        });

        test("returns internal_error when tool call throws non-Error value", async () => {
            const mockDesigner = sandbox.createStubInstance(SchemaDesignerWebviewController);
            sandbox.stub(mockDesigner as any, "server").get(() => "localhost");
            sandbox.stub(mockDesigner as any, "database").get(() => "AdventureWorks");
            mockDesigner.getDabToolState.callsFake(async () => Promise.reject(42));
            const managerStub = {
                getActiveDesigner: sandbox.stub().returns(mockDesigner),
            };
            sandbox.stub(SchemaDesignerWebviewManager, "getInstance").returns(managerStub as any);

            const options = {
                input: { operation: "get_state" },
            } as vscode.LanguageModelToolInvocationOptions<DabToolParams>;

            const parsed = JSON.parse(await dabTool.call(options, mockToken));
            expect(parsed.success).to.equal(false);
            expect(parsed.reason).to.equal("internal_error");
            expect(parsed.message).to.equal("42");
        });

        test("prepareInvocation returns confirmation and invocation messages", async () => {
            const prepared = await dabTool.prepareInvocation(
                {
                    input: { operation: "get_state" },
                } as vscode.LanguageModelToolInvocationPrepareOptions<DabToolParams>,
                mockToken,
            );

            expect(prepared.invocationMessage).to.include("get_state");
            expect(prepared.confirmationMessages.title).to.include("Data API Builder");
            expect(prepared.confirmationMessages.message.value).to.include("get_state");
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

        test("get_state throws when handlers are not initialized", async () => {
            const harness = createDabHandlerHarness({
                tables: [createTable("t1", "dbo", "Users")],
                dabConfig: null,
                initialized: false,
            });

            let caughtError: unknown;
            try {
                await harness.getState();
            } catch (error) {
                caughtError = error;
            }

            expect(caughtError).to.be.instanceOf(Error);
            expect((caughtError as Error).message).to.equal(
                locConstants.schemaDesigner.schemaDesignerNotInitialized,
            );
        });

        test("get_state avoids commit when config is already synchronized with schema", async () => {
            const tables = [
                createTable("t1", "dbo", "Users"),
                createTable("t2", "sales", "Orders"),
            ];
            const harness = createDabHandlerHarness({
                tables,
                dabConfig: Dab.createDefaultConfig(tables),
            });

            const state = await harness.getState();
            expect(state.returnState).to.equal("full");
            expect(harness.commitSpy.called).to.equal(false);
        });

        test("apply_changes returns internal_error when handlers are not initialized", async () => {
            const harness = createDabHandlerHarness({
                tables: [createTable("t1", "dbo", "Users")],
                dabConfig: null,
                initialized: false,
            });

            const result = await harness.applyChanges({
                expectedVersion: "dabcfg_any",
                changes: [{ type: "set_all_entities_enabled", isEnabled: true }],
            });

            expect(result.success).to.equal(false);
            if (result.success) {
                throw new Error("Expected failure response");
            }
            expect(result.reason).to.equal("internal_error");
        });

        test("apply_changes returns invalid_request for missing expectedVersion/changes/unsupported returnState", async () => {
            const harness = createDabHandlerHarness({
                tables: [createTable("t1", "dbo", "Users")],
                dabConfig: null,
            });

            const missingVersion = await harness.applyChanges({
                changes: [{ type: "set_all_entities_enabled", isEnabled: true }],
            } as any);
            expect(missingVersion.success).to.equal(false);
            if (missingVersion.success) {
                throw new Error("Expected failure response");
            }
            expect(missingVersion.reason).to.equal("invalid_request");
            expect(missingVersion.message).to.equal("Missing expectedVersion.");

            const missingChanges = await harness.applyChanges({
                expectedVersion: "dabcfg_any",
            } as any);
            expect(missingChanges.success).to.equal(false);
            if (missingChanges.success) {
                throw new Error("Expected failure response");
            }
            expect(missingChanges.reason).to.equal("invalid_request");
            expect(missingChanges.message).to.equal("Missing changes (non-empty array).");

            const unsupportedReturnState = await harness.applyChanges({
                expectedVersion: "dabcfg_any",
                changes: [{ type: "set_all_entities_enabled", isEnabled: true }],
                options: { returnState: "unsupported" as any },
            });
            expect(unsupportedReturnState.success).to.equal(false);
            if (unsupportedReturnState.success) {
                throw new Error("Expected failure response");
            }
            expect(unsupportedReturnState.reason).to.equal("invalid_request");
            expect(unsupportedReturnState.message).to.include("Unsupported returnState");
        });

        test("apply_changes validates set_api_types and fails at index 0 with partial receipt", async () => {
            const harness = createDabHandlerHarness({
                tables: [createTable("t1", "dbo", "Users")],
                dabConfig: null,
            });
            const state = await harness.getState();
            harness.commitSpy.resetHistory();

            const result = await harness.applyChanges({
                expectedVersion: state.version,
                changes: [
                    {
                        type: "set_api_types",
                        apiTypes: [Dab.ApiType.Rest, Dab.ApiType.Rest],
                    },
                ],
            });

            expect(result.success).to.equal(false);
            if (result.success) {
                throw new Error("Expected failure response");
            }
            expect(result.reason).to.equal("validation_error");
            expect(result.message).to.equal("apiTypes must be unique.");
            expect(result.failedChangeIndex).to.equal(0);
            expect(result.appliedChanges).to.equal(0);
            expect(harness.commitSpy.calledOnce).to.equal(true);
        });

        test("apply_changes validates set_entity_actions payload", async () => {
            const harness = createDabHandlerHarness({
                tables: [createTable("t1", "dbo", "Users")],
                dabConfig: null,
            });
            const state = await harness.getState();
            harness.commitSpy.resetHistory();

            const result = await harness.applyChanges({
                expectedVersion: state.version,
                changes: [
                    {
                        type: "set_entity_actions",
                        entity: { id: "t1" },
                        actions: [Dab.EntityAction.Read, "bogus" as any],
                    },
                ],
            });

            expect(result.success).to.equal(false);
            if (result.success) {
                throw new Error("Expected failure response");
            }
            expect(result.reason).to.equal("validation_error");
            expect(result.message).to.equal("actions contains unsupported values.");
            expect(result.failedChangeIndex).to.equal(0);
            expect(result.appliedChanges).to.equal(0);
            expect(harness.commitSpy.calledOnce).to.equal(true);
        });

        test("apply_changes validates patch_entity_settings payload and duplicate entity names", async () => {
            const harness = createDabHandlerHarness({
                tables: [createTable("t1", "dbo", "Users"), createTable("t2", "dbo", "Orders")],
                dabConfig: null,
            });
            const state = await harness.getState();
            harness.commitSpy.resetHistory();

            const emptyPatch = await harness.applyChanges({
                expectedVersion: state.version,
                changes: [{ type: "patch_entity_settings", entity: { id: "t1" }, set: {} as any }],
            });
            expect(emptyPatch.success).to.equal(false);
            if (emptyPatch.success) {
                throw new Error("Expected failure response");
            }
            expect(emptyPatch.reason).to.equal("invalid_request");
            expect(emptyPatch.message).to.include("must include at least one property");

            const duplicateName = await harness.applyChanges({
                expectedVersion: state.version,
                changes: [
                    {
                        type: "patch_entity_settings",
                        entity: { id: "t1" },
                        set: { entityName: "Orders" },
                    },
                ],
            });
            expect(duplicateName.success).to.equal(false);
            if (duplicateName.success) {
                throw new Error("Expected failure response");
            }
            expect(duplicateName.reason).to.equal("validation_error");
            expect(duplicateName.message).to.include("entityName must be unique");
        });

        test("apply_changes patch_entity_settings rejects whitespace-only strings and trims accepted values", async () => {
            const harness = createDabHandlerHarness({
                tables: [createTable("t1", "dbo", "Users")],
                dabConfig: null,
            });
            let currentState = await harness.getState();

            const whitespaceEntityName = await harness.applyChanges({
                expectedVersion: currentState.version,
                changes: [
                    {
                        type: "patch_entity_settings",
                        entity: { id: "t1" },
                        set: { entityName: "   " },
                    },
                ],
            });
            expect(whitespaceEntityName.success).to.equal(false);
            if (whitespaceEntityName.success) {
                throw new Error("Expected failure response");
            }
            expect(whitespaceEntityName.reason).to.equal("invalid_request");
            expect(whitespaceEntityName.message).to.equal("entityName must be a non-empty string.");

            currentState = await harness.getState();
            const whitespaceRestPath = await harness.applyChanges({
                expectedVersion: currentState.version,
                changes: [
                    {
                        type: "patch_entity_settings",
                        entity: { id: "t1" },
                        set: { customRestPath: "   " },
                    },
                ],
            });
            expect(whitespaceRestPath.success).to.equal(false);
            if (whitespaceRestPath.success) {
                throw new Error("Expected failure response");
            }
            expect(whitespaceRestPath.reason).to.equal("invalid_request");
            expect(whitespaceRestPath.message).to.equal(
                "customRestPath cannot be an empty string.",
            );

            currentState = await harness.getState();
            const whitespaceGraphQLType = await harness.applyChanges({
                expectedVersion: currentState.version,
                changes: [
                    {
                        type: "patch_entity_settings",
                        entity: { id: "t1" },
                        set: { customGraphQLType: "   " },
                    },
                ],
            });
            expect(whitespaceGraphQLType.success).to.equal(false);
            if (whitespaceGraphQLType.success) {
                throw new Error("Expected failure response");
            }
            expect(whitespaceGraphQLType.reason).to.equal("invalid_request");
            expect(whitespaceGraphQLType.message).to.equal(
                "customGraphQLType cannot be an empty string.",
            );

            currentState = await harness.getState();
            const trimmedSuccess = await harness.applyChanges({
                expectedVersion: currentState.version,
                changes: [
                    {
                        type: "patch_entity_settings",
                        entity: { id: "t1" },
                        set: {
                            entityName: "  UsersApi  ",
                            customRestPath: "  /users  ",
                            customGraphQLType: "  UsersType  ",
                        },
                    },
                ],
            });
            expect(trimmedSuccess.success).to.equal(true);
            if (!trimmedSuccess.success) {
                throw new Error("Expected success response");
            }
            const settings = trimmedSuccess.config?.entities[0].advancedSettings;
            expect(settings).to.exist;
            expect(settings?.entityName).to.equal("UsersApi");
            expect(settings?.customRestPath).to.equal("/users");
            expect(settings?.customGraphQLType).to.equal("UsersType");
        });

        test("apply_changes validates set_only_enabled_entities and unknown change types", async () => {
            const harness = createDabHandlerHarness({
                tables: [createTable("t1", "dbo", "Users")],
                dabConfig: null,
            });
            const state = await harness.getState();
            harness.commitSpy.resetHistory();

            const emptyEntities = await harness.applyChanges({
                expectedVersion: state.version,
                changes: [{ type: "set_only_enabled_entities", entities: [] }],
            });
            expect(emptyEntities.success).to.equal(false);
            if (emptyEntities.success) {
                throw new Error("Expected failure response");
            }
            expect(emptyEntities.reason).to.equal("invalid_request");
            expect(emptyEntities.message).to.include("must be a non-empty array");

            const unknownType = await harness.applyChanges({
                expectedVersion: state.version,
                changes: [{ type: "unknown_change_type" } as any],
            });
            expect(unknownType.success).to.equal(false);
            if (unknownType.success) {
                throw new Error("Expected failure response");
            }
            expect(unknownType.reason).to.equal("invalid_request");
            expect(unknownType.message).to.include("Unknown change type");
        });

        test("apply_changes surfaces ambiguous entity references as validation_error", async () => {
            const harness = createDabHandlerHarness({
                tables: [createTable("t1", "dbo", "Users"), createTable("t2", "dbo", "Users")],
                dabConfig: null,
            });
            const state = await harness.getState();
            harness.commitSpy.resetHistory();

            const result = await harness.applyChanges({
                expectedVersion: state.version,
                changes: [
                    {
                        type: "set_entity_enabled",
                        entity: { schemaName: "dbo", tableName: "Users" },
                        isEnabled: false,
                    },
                ],
            });

            expect(result.success).to.equal(false);
            if (result.success) {
                throw new Error("Expected failure response");
            }
            expect(result.reason).to.equal("validation_error");
            expect(result.message).to.include("resolved to more than one entity");
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

        test("apply_changes stale_state supports caller_requested_none returnState", async () => {
            const harness = createDabHandlerHarness({
                tables: [createTable("t1", "dbo", "Users")],
                dabConfig: null,
            });

            const result = await harness.applyChanges({
                expectedVersion: "dabcfg_outdated",
                changes: [{ type: "set_all_entities_enabled", isEnabled: false }],
                options: { returnState: "none" },
            });

            expect(result.success).to.equal(false);
            if (result.success) {
                throw new Error("Expected stale_state response");
            }
            expect(result.reason).to.equal("stale_state");
            expect(result.returnState).to.equal("none");
            expect(result.stateOmittedReason).to.equal("caller_requested_none");
            expect(result).to.not.have.property("config");
        });

        test("apply_changes validates set_entity_enabled references (invalid shape and missing id)", async () => {
            const harness = createDabHandlerHarness({
                tables: [createTable("t1", "dbo", "Users")],
                dabConfig: null,
            });
            const state = await harness.getState();
            harness.commitSpy.resetHistory();

            const invalidEntityRef = await harness.applyChanges({
                expectedVersion: state.version,
                changes: [
                    {
                        type: "set_entity_enabled",
                        entity: { id: "t1", schemaName: "dbo", tableName: "Users" } as any,
                        isEnabled: false,
                    },
                ],
            });
            expect(invalidEntityRef.success).to.equal(false);
            if (invalidEntityRef.success) {
                throw new Error("Expected failure response");
            }
            expect(invalidEntityRef.reason).to.equal("invalid_request");
            expect(invalidEntityRef.message).to.include("either id OR schemaName+tableName");

            const missingEntityById = await harness.applyChanges({
                expectedVersion: state.version,
                changes: [
                    {
                        type: "set_entity_enabled",
                        entity: { id: "does-not-exist" },
                        isEnabled: true,
                    },
                ],
            });
            expect(missingEntityById.success).to.equal(false);
            if (missingEntityById.success) {
                throw new Error("Expected failure response");
            }
            expect(missingEntityById.reason).to.equal("not_found");
            expect(missingEntityById.message).to.include("does-not-exist");
        });

        test("apply_changes validates unsupported api types, entity actions, and patch fields", async () => {
            const harness = createDabHandlerHarness({
                tables: [createTable("t1", "dbo", "Users")],
                dabConfig: null,
            });
            const state = await harness.getState();
            harness.commitSpy.resetHistory();

            const unsupportedApiType = await harness.applyChanges({
                expectedVersion: state.version,
                changes: [
                    {
                        type: "set_api_types",
                        apiTypes: [Dab.ApiType.Rest, "bogus_api_type" as any],
                    },
                ],
            });
            expect(unsupportedApiType.success).to.equal(false);
            if (unsupportedApiType.success) {
                throw new Error("Expected failure response");
            }
            expect(unsupportedApiType.reason).to.equal("validation_error");
            expect(unsupportedApiType.message).to.equal("apiTypes contains unsupported values.");

            const duplicateActions = await harness.applyChanges({
                expectedVersion: state.version,
                changes: [
                    {
                        type: "set_entity_actions",
                        entity: { id: "t1" },
                        actions: [Dab.EntityAction.Read, Dab.EntityAction.Read],
                    },
                ],
            });
            expect(duplicateActions.success).to.equal(false);
            if (duplicateActions.success) {
                throw new Error("Expected failure response");
            }
            expect(duplicateActions.reason).to.equal("validation_error");
            expect(duplicateActions.message).to.equal("actions must be unique.");

            const unsupportedPatchProperty = await harness.applyChanges({
                expectedVersion: state.version,
                changes: [
                    {
                        type: "patch_entity_settings",
                        entity: { id: "t1" },
                        set: {
                            unsupportedProp: true,
                        } as any,
                    },
                ],
            });
            expect(unsupportedPatchProperty.success).to.equal(false);
            if (unsupportedPatchProperty.success) {
                throw new Error("Expected failure response");
            }
            expect(unsupportedPatchProperty.reason).to.equal("invalid_request");
            expect(unsupportedPatchProperty.message).to.include("Unsupported patch property");
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

        test("apply_changes set_only_enabled_entities updates enabled flags by selected ids", async () => {
            const harness = createDabHandlerHarness({
                tables: [
                    createTable("t1", "dbo", "Users"),
                    createTable("t2", "sales", "Orders"),
                    createTable("t3", "dbo", "Products"),
                ],
                dabConfig: null,
            });

            const currentState = await harness.getState();
            harness.commitSpy.resetHistory();

            const result = await harness.applyChanges({
                expectedVersion: currentState.version,
                changes: [
                    {
                        type: "set_only_enabled_entities",
                        entities: [{ id: "t2" }],
                    },
                ],
            });

            expect(result.success).to.equal(true);
            if (!result.success) {
                throw new Error("Expected success response");
            }

            const enabledEntityIds = (result.config?.entities ?? [])
                .filter((entity) => entity.isEnabled)
                .map((entity) => entity.id);
            expect(enabledEntityIds).to.deep.equal(["t2"]);
            expect(result.summary.enabledEntityCount).to.equal(1);
            expect(harness.commitSpy.calledOnce).to.equal(true);
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
