/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { applyDabCommands, getDabToolStateFromConfig } from "../../src/dab/dabCommandEngine";
import { InMemoryStateCommandDiagnosticsSink } from "../../src/platform/stateCommands/stateCommandDiagnostics";
import { Dab } from "../../src/sharedInterfaces/dab";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";

suite("DabCommandEngine Tests", () => {
    const createTable = (
        id: string,
        schemaName: string,
        tableName: string,
    ): SchemaDesigner.Table => ({
        id,
        schema: schemaName,
        name: tableName,
        columns: [
            {
                id: `${id}-id`,
                name: "Id",
                dataType: "int",
                isPrimaryKey: true,
            } as SchemaDesigner.Column,
            {
                id: `${id}-name`,
                name: "Name",
                dataType: "nvarchar",
                isPrimaryKey: false,
            } as SchemaDesigner.Column,
        ],
        foreignKeys: [],
    });

    const createUnsupportedTable = (
        id: string,
        schemaName: string,
        tableName: string,
    ): SchemaDesigner.Table => ({
        ...createTable(id, schemaName, tableName),
        columns: [
            {
                id: `${id}-name`,
                name: "Name",
                dataType: "nvarchar",
                isPrimaryKey: false,
            } as SchemaDesigner.Column,
        ],
    });

    async function createBaseState(tables: SchemaDesigner.Table[]) {
        const state = await getDabToolStateFromConfig(null, tables);
        expect(state.response.returnState).to.equal("full");
        expect(state.response.config).to.not.equal(undefined);

        return {
            config: state.response.config!,
            version: state.response.version,
        };
    }

    test("applies command batches atomically when a later command fails", async () => {
        const diagnostics = new InMemoryStateCommandDiagnosticsSink();
        const tables = [createTable("t1", "dbo", "Users"), createTable("t2", "dbo", "Orders")];
        const base = await createBaseState(tables);

        const result = await applyDabCommands({
            baseConfig: base.config,
            schemaTables: tables,
            expectedVersion: base.version,
            commands: [
                { type: "set_api_types", apiTypes: [Dab.ApiType.Rest, Dab.ApiType.GraphQL] },
                {
                    type: "set_entity_actions",
                    entity: { id: "t1" },
                    enabledActions: [],
                },
            ],
            diagnostics,
            sessionId: "test-dab-session",
        });

        expect(result.shouldCommit).to.equal(false);
        expect(result.response.success).to.equal(false);
        if (result.response.success === false) {
            expect(result.response.appliedChanges).to.equal(0);
            expect(result.response.version).to.equal(base.version);
            expect(result.response.summary.apiTypes).to.deep.equal([Dab.ApiType.Rest]);
        }
        expect(result.config.apiTypes).to.deep.equal([Dab.ApiType.Rest]);
        expect(
            diagnostics.events.some(
                (event) =>
                    event.stage === "apply_batch" &&
                    event.status === "started" &&
                    event.commandCount === 2,
            ),
        ).to.equal(true);
        expect(
            diagnostics.events.some(
                (event) =>
                    event.stage === "apply_command" &&
                    event.status === "failed" &&
                    event.commandIndex === 1,
            ),
        ).to.equal(true);
        expect(
            diagnostics.events.some(
                (event) =>
                    event.stage === "commit" &&
                    event.status === "skipped" &&
                    event.sessionId === "test-dab-session",
            ),
        ).to.equal(true);
    });

    test("rejects duplicate entity names without mutating base config", async () => {
        const tables = [createTable("t1", "dbo", "Users"), createTable("t2", "dbo", "Orders")];
        const base = await createBaseState(tables);

        const result = await applyDabCommands({
            baseConfig: base.config,
            schemaTables: tables,
            expectedVersion: base.version,
            commands: [
                {
                    type: "patch_entity_settings",
                    entity: { id: "t1" },
                    set: { entityName: "SharedName" },
                },
                {
                    type: "patch_entity_settings",
                    entity: { id: "t2" },
                    set: { entityName: "sharedname" },
                },
            ],
        });

        expect(result.shouldCommit).to.equal(false);
        expect(result.response.success).to.equal(false);
        if (result.response.success === false) {
            expect(result.response.failedChangeIndex).to.equal(1);
            expect(result.response.message).to.include("entityName must be unique");
        }
        expect(
            result.config.entities.find((entity) => entity.id === "t1")?.advancedSettings
                .entityName,
        ).to.equal("Users");
        expect(
            result.config.entities.find((entity) => entity.id === "t2")?.advancedSettings
                .entityName,
        ).to.equal("Orders");
    });

    test("rejects enabling unsupported entities", async () => {
        const tables = [createUnsupportedTable("t1", "dbo", "UnsupportedTable")];
        const base = await createBaseState(tables);

        const result = await applyDabCommands({
            baseConfig: base.config,
            schemaTables: tables,
            expectedVersion: base.version,
            commands: [{ type: "set_entity_enabled", entity: { id: "t1" }, isEnabled: true }],
        });

        expect(result.shouldCommit).to.equal(false);
        expect(result.response.success).to.equal(false);
        if (result.response.success === false) {
            expect(result.response.reason).to.equal("entity_not_supported");
        }
        expect(result.config.entities[0].isEnabled).to.equal(false);
    });

    test("normalizes unsupported exposed columns before validating a UI edit", async () => {
        const tables = [
            {
                ...createTable("t1", "dbo", "Users"),
                columns: [
                    {
                        id: "t1-id",
                        name: "Id",
                        dataType: "int",
                        isPrimaryKey: true,
                    } as SchemaDesigner.Column,
                    {
                        id: "t1-profile",
                        name: "AdditionalContactInfo",
                        dataType: "xml",
                        isPrimaryKey: false,
                    } as SchemaDesigner.Column,
                ],
            },
        ];
        const staleConfig = Dab.createDefaultConfig(tables);
        staleConfig.entities[0].isEnabled = true;
        staleConfig.entities[0].isSupported = true;
        staleConfig.entities[0].columns[1].isSupported = false;
        staleConfig.entities[0].columns[1].isExposed = true;

        const state = await getDabToolStateFromConfig(staleConfig, tables);
        expect(state.config.entities[0].columns[1].isExposed).to.equal(false);

        const result = await applyDabCommands({
            baseConfig: staleConfig,
            schemaTables: tables,
            expectedVersion: state.response.version,
            commands: [{ type: "set_entity_enabled", entity: { id: "t1" }, isEnabled: false }],
        });

        expect(result.response.success).to.equal(true);
        expect(result.config.entities[0].isEnabled).to.equal(false);
        expect(result.config.entities[0].columns[1].isExposed).to.equal(false);
    });

    test("normalizes optional REST and GraphQL settings on successful apply", async () => {
        const tables = [createTable("t1", "dbo", "Users")];
        const base = await createBaseState(tables);

        const result = await applyDabCommands({
            baseConfig: base.config,
            schemaTables: tables,
            expectedVersion: base.version,
            commands: [
                {
                    type: "patch_entity_settings",
                    entity: { schemaName: "dbo", tableName: "Users" },
                    set: {
                        customRestPath: " users ",
                        customGraphQLType: " UserType ",
                    },
                },
            ],
        });

        expect(result.shouldCommit).to.equal(true);
        expect(result.response.success).to.equal(true);
        expect(result.config.entities[0].advancedSettings.customRestPath).to.equal("/users");
        expect(result.config.entities[0].advancedSettings.customGraphQLType).to.equal("UserType");
    });

    test("rejects unsafe and empty string settings without mutating config", async () => {
        const tables = [createTable("t1", "dbo", "Users")];
        const base = await createBaseState(tables);

        const unsafeNameResult = await applyDabCommands({
            baseConfig: base.config,
            schemaTables: tables,
            expectedVersion: base.version,
            commands: [
                {
                    type: "patch_entity_settings",
                    entity: { id: "t1" },
                    set: { entityName: "<script>alert('xss')</script>" },
                },
            ],
        });

        expect(unsafeNameResult.shouldCommit).to.equal(false);
        expect(unsafeNameResult.response.success).to.equal(false);
        expect(unsafeNameResult.config.entities[0].advancedSettings.entityName).to.equal("Users");

        const emptyRestPathResult = await applyDabCommands({
            baseConfig: base.config,
            schemaTables: tables,
            expectedVersion: base.version,
            commands: [
                {
                    type: "patch_entity_settings",
                    entity: { id: "t1" },
                    set: { customRestPath: "" },
                },
            ],
        });

        expect(emptyRestPathResult.shouldCommit).to.equal(false);
        expect(emptyRestPathResult.response.success).to.equal(false);
        expect(emptyRestPathResult.config.entities[0].advancedSettings.customRestPath).to.equal(
            undefined,
        );
    });

    test("patches advanced JSON atomically and changes version", async () => {
        const tables = [createTable("t1", "dbo", "Users")];
        const base = await createBaseState(tables);

        const result = await applyDabCommands({
            baseConfig: base.config,
            schemaTables: tables,
            expectedVersion: base.version,
            commands: [
                {
                    type: "patch_config_advanced_json",
                    set: {
                        runtime: {
                            rest: { path: "/data" },
                            host: { mode: "production" },
                        },
                    },
                },
                {
                    type: "patch_entity_advanced_json",
                    entity: { id: "t1" },
                    set: {
                        cache: { enabled: true, "ttl-seconds": 30 },
                        description: "User entity",
                    },
                },
            ],
        });

        expect(result.shouldCommit).to.equal(true);
        expect(result.response.success).to.equal(true);
        expect(result.response.version).to.not.equal(base.version);
        expect(result.config.advancedJson?.runtime).to.deep.equal({
            rest: { path: "/data" },
            host: { mode: "production" },
        });
        expect(result.config.entities[0].advancedJson?.cache).to.deep.equal({
            enabled: true,
            "ttl-seconds": 30,
        });
    });

    test("rejects advanced JSON attempts to override generated ownership", async () => {
        const tables = [createTable("t1", "dbo", "Users")];
        const base = await createBaseState(tables);

        const result = await applyDabCommands({
            baseConfig: base.config,
            schemaTables: tables,
            expectedVersion: base.version,
            commands: [
                {
                    type: "patch_config_advanced_json",
                    set: {
                        runtime: {
                            rest: { enabled: false },
                        },
                    },
                },
            ],
        });

        expect(result.shouldCommit).to.equal(false);
        expect(result.response.success).to.equal(false);
        if (result.response.success === false) {
            expect(result.response.message).to.include("runtime.rest.enabled");
        }
    });
});
