/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import { DabConfigFileBuilder } from "../../../src/dab/dabConfigFileBuilder";
import { Dab } from "../../../src/sharedInterfaces/dab";

function createTestEntity(overrides?: Partial<Dab.DabEntityConfig>): Dab.DabEntityConfig {
    return {
        id: "test-id-1",
        tableName: "Users",
        schemaName: "dbo",
        isEnabled: true,
        enabledActions: [
            Dab.EntityAction.Create,
            Dab.EntityAction.Read,
            Dab.EntityAction.Update,
            Dab.EntityAction.Delete,
        ],
        advancedSettings: {
            entityName: "Users",
            authorizationRole: Dab.AuthorizationRole.Anonymous,
        },
        ...overrides,
    };
}

function createTestConfig(overrides?: Partial<Dab.DabConfig>): Dab.DabConfig {
    return {
        apiTypes: [Dab.ApiType.Rest],
        entities: [createTestEntity()],
        ...overrides,
    };
}

const defaultConnectionInfo: Dab.DabConnectionInfo = {
    connectionString: "Server=localhost;Database=TestDb;Trusted_Connection=true;",
};

suite("DabConfigFileBuilder Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let builder: DabConfigFileBuilder;

    setup(() => {
        sandbox = sinon.createSandbox();
        builder = new DabConfigFileBuilder();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("build", () => {
        suite("basic config generation", () => {
            test("should return valid JSON", () => {
                const result = builder.build(createTestConfig(), defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed).to.be.an("object");
            });

            test("should set $schema to the DAB schema URL", () => {
                const result = builder.build(createTestConfig(), defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed.$schema).to.include("data-api-builder/releases");
                expect(parsed.$schema).to.include("dab.draft.schema.json");
            });

            test("should set database-type to mssql", () => {
                const result = builder.build(createTestConfig(), defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed["data-source"]["database-type"]).to.equal("mssql");
            });

            test("should include the connection string from connectionInfo", () => {
                const connectionInfo: Dab.DabConnectionInfo = {
                    connectionString: "Server=myserver;Database=mydb;",
                };
                const result = builder.build(createTestConfig(), connectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed["data-source"]["connection-string"]).to.equal(
                    "Server=myserver;Database=mydb;",
                );
            });

            test("should include all top-level sections", () => {
                const result = builder.build(createTestConfig(), defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed).to.have.property("$schema");
                expect(parsed).to.have.property("data-source");
                expect(parsed).to.have.property("runtime");
                expect(parsed).to.have.property("entities");
            });
        });

        suite("runtime section - API types mapping", () => {
            test("should enable REST when apiTypes includes Rest", () => {
                const config = createTestConfig({
                    apiTypes: [Dab.ApiType.Rest],
                });
                const result = builder.build(config, defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed.runtime.rest.enabled).to.equal(true);
            });

            test("should disable REST when apiTypes does not include Rest", () => {
                const config = createTestConfig({
                    apiTypes: [Dab.ApiType.GraphQL],
                });
                const result = builder.build(config, defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed.runtime.rest.enabled).to.equal(false);
            });

            test("should enable GraphQL when apiTypes includes GraphQL", () => {
                const config = createTestConfig({
                    apiTypes: [Dab.ApiType.GraphQL],
                });
                const result = builder.build(config, defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed.runtime.graphql.enabled).to.equal(true);
            });

            test("should disable GraphQL when apiTypes does not include GraphQL", () => {
                const config = createTestConfig({
                    apiTypes: [Dab.ApiType.Rest],
                });
                const result = builder.build(config, defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed.runtime.graphql.enabled).to.equal(false);
            });

            test("should enable MCP when apiTypes includes Mcp", () => {
                const config = createTestConfig({
                    apiTypes: [Dab.ApiType.Mcp],
                });
                const result = builder.build(config, defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed.runtime.mcp.enabled).to.equal(true);
            });

            test("should disable MCP when apiTypes does not include Mcp", () => {
                const config = createTestConfig({
                    apiTypes: [Dab.ApiType.Rest],
                });
                const result = builder.build(config, defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed.runtime.mcp.enabled).to.equal(false);
            });

            test("should handle multiple API types enabled simultaneously", () => {
                const config = createTestConfig({
                    apiTypes: [Dab.ApiType.Rest, Dab.ApiType.GraphQL, Dab.ApiType.Mcp],
                });
                const result = builder.build(config, defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed.runtime.rest.enabled).to.equal(true);
                expect(parsed.runtime.graphql.enabled).to.equal(true);
                expect(parsed.runtime.mcp.enabled).to.equal(true);
            });

            test("should set default REST path to /api", () => {
                const result = builder.build(createTestConfig(), defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed.runtime.rest.path).to.equal("/api");
            });

            test("should set default GraphQL path to /graphql", () => {
                const result = builder.build(createTestConfig(), defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed.runtime.graphql.path).to.equal("/graphql");
            });

            test("should set host.mode to development", () => {
                const result = builder.build(createTestConfig(), defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed.runtime.host.mode).to.equal("development");
            });

            test("should set CORS origins to wildcard", () => {
                const result = builder.build(createTestConfig(), defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed.runtime.host.cors.origins).to.deep.equal(["*"]);
            });
        });

        suite("entity filtering", () => {
            test("should include only entities where isEnabled is true", () => {
                const config = createTestConfig({
                    entities: [
                        createTestEntity({
                            id: "1",
                            advancedSettings: {
                                entityName: "EnabledEntity",
                                authorizationRole: Dab.AuthorizationRole.Anonymous,
                            },
                            isEnabled: true,
                        }),
                        createTestEntity({
                            id: "2",
                            advancedSettings: {
                                entityName: "DisabledEntity",
                                authorizationRole: Dab.AuthorizationRole.Anonymous,
                            },
                            isEnabled: false,
                        }),
                    ],
                });
                const result = builder.build(config, defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed.entities).to.have.property("EnabledEntity");
                expect(parsed.entities).to.not.have.property("DisabledEntity");
            });

            test("should handle all entities disabled", () => {
                const config = createTestConfig({
                    entities: [createTestEntity({ isEnabled: false })],
                });
                const result = builder.build(config, defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(Object.keys(parsed.entities)).to.have.lengthOf(0);
            });

            test("should handle empty entities array", () => {
                const config = createTestConfig({ entities: [] });
                const result = builder.build(config, defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(Object.keys(parsed.entities)).to.have.lengthOf(0);
            });
        });

        suite("entity source mapping", () => {
            test("should set source.type to table", () => {
                const result = builder.build(createTestConfig(), defaultConnectionInfo);
                const parsed = JSON.parse(result);
                const entity = parsed.entities["Users"];
                expect(entity.source.type).to.equal("table");
            });

            test("should format source.object as schema.table", () => {
                const config = createTestConfig({
                    entities: [
                        createTestEntity({
                            schemaName: "sales",
                            tableName: "Orders",
                        }),
                    ],
                });
                const result = builder.build(config, defaultConnectionInfo);
                const parsed = JSON.parse(result);
                const entity = parsed.entities["Users"];
                expect(entity.source.object).to.equal("sales.Orders");
            });

            test("should use advancedSettings.entityName as the entity key", () => {
                const config = createTestConfig({
                    entities: [
                        createTestEntity({
                            tableName: "tbl_users",
                            advancedSettings: {
                                entityName: "User",
                                authorizationRole: Dab.AuthorizationRole.Anonymous,
                            },
                        }),
                    ],
                });
                const result = builder.build(config, defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed.entities).to.have.property("User");
                expect(parsed.entities).to.not.have.property("tbl_users");
            });
        });

        suite("entity REST property", () => {
            test("should not include rest property when no customRestPath is set", () => {
                const result = builder.build(createTestConfig(), defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed.entities["Users"].rest).to.be.undefined;
            });

            test("should return object with path when customRestPath is set", () => {
                const config = createTestConfig({
                    entities: [
                        createTestEntity({
                            advancedSettings: {
                                entityName: "Users",
                                authorizationRole: Dab.AuthorizationRole.Anonymous,
                                customRestPath: "users-api",
                            },
                        }),
                    ],
                });
                const result = builder.build(config, defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed.entities["Users"].rest).to.deep.equal({
                    path: "/users-api",
                });
            });

            test("should prefix customRestPath with / if not already present", () => {
                const config = createTestConfig({
                    entities: [
                        createTestEntity({
                            advancedSettings: {
                                entityName: "Users",
                                authorizationRole: Dab.AuthorizationRole.Anonymous,
                                customRestPath: "my-path",
                            },
                        }),
                    ],
                });
                const result = builder.build(config, defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed.entities["Users"].rest.path).to.equal("/my-path");
            });

            test("should not double-prefix / on customRestPath", () => {
                const config = createTestConfig({
                    entities: [
                        createTestEntity({
                            advancedSettings: {
                                entityName: "Users",
                                authorizationRole: Dab.AuthorizationRole.Anonymous,
                                customRestPath: "/already-prefixed",
                            },
                        }),
                    ],
                });
                const result = builder.build(config, defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed.entities["Users"].rest.path).to.equal("/already-prefixed");
            });
        });

        suite("entity GraphQL property", () => {
            test("should not include graphql property when no customGraphQLType is set", () => {
                const result = builder.build(createTestConfig(), defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed.entities["Users"].graphql).to.be.undefined;
            });

            test("should return object with type when customGraphQLType is set", () => {
                const config = createTestConfig({
                    apiTypes: [Dab.ApiType.GraphQL],
                    entities: [
                        createTestEntity({
                            advancedSettings: {
                                entityName: "Users",
                                authorizationRole: Dab.AuthorizationRole.Anonymous,
                                customGraphQLType: "UserType",
                            },
                        }),
                    ],
                });
                const result = builder.build(config, defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed.entities["Users"].graphql).to.deep.equal({
                    type: "UserType",
                });
            });
        });

        suite("entity permissions", () => {
            test("should map Anonymous role to anonymous in permissions", () => {
                const config = createTestConfig({
                    entities: [
                        createTestEntity({
                            advancedSettings: {
                                entityName: "Users",
                                authorizationRole: Dab.AuthorizationRole.Anonymous,
                            },
                        }),
                    ],
                });
                const result = builder.build(config, defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed.entities["Users"].permissions[0].role).to.equal("anonymous");
            });

            test("should map Authenticated role to authenticated in permissions", () => {
                const config = createTestConfig({
                    entities: [
                        createTestEntity({
                            advancedSettings: {
                                entityName: "Users",
                                authorizationRole: Dab.AuthorizationRole.Authenticated,
                            },
                        }),
                    ],
                });
                const result = builder.build(config, defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed.entities["Users"].permissions[0].role).to.equal("authenticated");
            });

            test("should include all enabled actions in permissions", () => {
                const config = createTestConfig({
                    entities: [
                        createTestEntity({
                            enabledActions: [Dab.EntityAction.Create, Dab.EntityAction.Read],
                        }),
                    ],
                });
                const result = builder.build(config, defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed.entities["Users"].permissions[0].actions).to.deep.equal([
                    "create",
                    "read",
                ]);
            });

            test("should handle single action", () => {
                const config = createTestConfig({
                    entities: [
                        createTestEntity({
                            enabledActions: [Dab.EntityAction.Read],
                        }),
                    ],
                });
                const result = builder.build(config, defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed.entities["Users"].permissions[0].actions).to.deep.equal(["read"]);
            });

            test("should handle empty actions array", () => {
                const config = createTestConfig({
                    entities: [
                        createTestEntity({
                            enabledActions: [],
                        }),
                    ],
                });
                const result = builder.build(config, defaultConnectionInfo);
                const parsed = JSON.parse(result);
                expect(parsed.entities["Users"].permissions[0].actions).to.deep.equal([]);
            });
        });

        suite("full integration", () => {
            test("should generate complete config with multiple entities and mixed settings", () => {
                const config = createTestConfig({
                    apiTypes: [Dab.ApiType.Rest, Dab.ApiType.GraphQL],
                    entities: [
                        createTestEntity({
                            id: "1",
                            tableName: "Users",
                            schemaName: "dbo",
                            isEnabled: true,
                            enabledActions: [
                                Dab.EntityAction.Create,
                                Dab.EntityAction.Read,
                                Dab.EntityAction.Update,
                                Dab.EntityAction.Delete,
                            ],
                            advancedSettings: {
                                entityName: "User",
                                authorizationRole: Dab.AuthorizationRole.Anonymous,
                            },
                        }),
                        createTestEntity({
                            id: "2",
                            tableName: "Orders",
                            schemaName: "sales",
                            isEnabled: true,
                            enabledActions: [Dab.EntityAction.Read],
                            advancedSettings: {
                                entityName: "Order",
                                authorizationRole: Dab.AuthorizationRole.Authenticated,
                                customRestPath: "orders-api",
                                customGraphQLType: "OrderType",
                            },
                        }),
                        createTestEntity({
                            id: "3",
                            tableName: "Logs",
                            schemaName: "dbo",
                            isEnabled: false,
                            advancedSettings: {
                                entityName: "Log",
                                authorizationRole: Dab.AuthorizationRole.Anonymous,
                            },
                        }),
                    ],
                });

                const result = builder.build(config, defaultConnectionInfo);
                const parsed = JSON.parse(result);

                // Top-level structure
                expect(parsed).to.have.property("$schema");
                expect(parsed["data-source"]["database-type"]).to.equal("mssql");

                // Runtime
                expect(parsed.runtime.rest.enabled).to.equal(true);
                expect(parsed.runtime.graphql.enabled).to.equal(true);
                expect(parsed.runtime.mcp.enabled).to.equal(false);

                // Entities - only enabled ones
                expect(Object.keys(parsed.entities)).to.have.lengthOf(2);
                expect(parsed.entities).to.have.property("User");
                expect(parsed.entities).to.have.property("Order");
                expect(parsed.entities).to.not.have.property("Log");

                // First entity - defaults
                const user = parsed.entities["User"];
                expect(user.source.object).to.equal("dbo.Users");
                expect(user.permissions[0].role).to.equal("anonymous");
                expect(user.permissions[0].actions).to.deep.equal([
                    "create",
                    "read",
                    "update",
                    "delete",
                ]);

                // Second entity - custom settings
                const order = parsed.entities["Order"];
                expect(order.source.object).to.equal("sales.Orders");
                expect(order.rest).to.deep.equal({
                    path: "/orders-api",
                });
                expect(order.graphql).to.deep.equal({
                    type: "OrderType",
                });
                expect(order.permissions[0].role).to.equal("authenticated");
                expect(order.permissions[0].actions).to.deep.equal(["read"]);
            });
        });
    });
});
