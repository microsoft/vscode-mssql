/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { Dab } from "../../../src/sharedInterfaces/dab";
import { AuthenticationType } from "../../../src/sharedInterfaces/connectionDialog";

function createSourceObject(overrides?: Partial<Dab.DabSourceObject>): Dab.DabSourceObject {
    return {
        id: "table:dbo.Users",
        sourceType: Dab.EntitySourceType.Table,
        schemaName: "dbo",
        sourceName: "Users",
        columns: [
            {
                id: "table:dbo.Users:Id",
                name: "Id",
                dataType: "int",
                isPrimaryKey: true,
                isSupported: true,
                isExposed: true,
            },
            {
                id: "table:dbo.Users:Name",
                name: "Name",
                dataType: "nvarchar",
                isPrimaryKey: false,
                isSupported: true,
                isExposed: true,
            },
        ],
        ...overrides,
    };
}

suite("DAB shared interface helpers", () => {
    test("normalizeRestMethods de-dupes and sorts methods in canonical order", () => {
        expect(
            Dab.normalizeRestMethods([
                Dab.RestMethod.Delete,
                Dab.RestMethod.Post,
                Dab.RestMethod.Get,
                Dab.RestMethod.Post,
            ]),
        ).to.deep.equal([Dab.RestMethod.Get, Dab.RestMethod.Post, Dab.RestMethod.Delete]);
    });

    test("validates DAB entity setting strings", () => {
        expect(Dab.validateDabEntityName("UsersApi")).to.equal(undefined);
        expect(Dab.validateDabEntityName("<script>alert('xss')</script>")).to.include(
            "entityName must start with a letter",
        );
        expect(Dab.validateDabEntityName(`A${"a".repeat(500)}`)).to.include(
            "128 characters or fewer",
        );

        expect(Dab.validateDabCustomRestPath("/users/by-id")).to.equal(undefined);
        expect(Dab.validateDabCustomRestPath("users.by_id")).to.equal(undefined);
        expect(Dab.validateDabCustomRestPath("'; DROP TABLE dbo.Todos; --")).to.include(
            "customRestPath must be a relative route path",
        );

        expect(Dab.validateDabCustomGraphQLType("UsersType")).to.equal(undefined);
        expect(Dab.validateDabCustomGraphQLType("_UsersType")).to.equal(undefined);
        expect(Dab.validateDabCustomGraphQLType("こんにちは")).to.equal(
            "customGraphQLType must be a valid GraphQL name.",
        );
    });

    test("validateSourceObjectForDab uses view fields for primary key support", () => {
        const supportedView = createSourceObject({
            id: "view:dbo.ActiveUsers",
            sourceType: Dab.EntitySourceType.View,
            sourceName: "ActiveUsers",
            fields: [{ name: "Id", isPrimaryKey: true }, { name: "Name" }],
            columns: [
                {
                    id: "view:dbo.ActiveUsers:Id",
                    name: "Id",
                    dataType: "sys.int",
                    isPrimaryKey: false,
                    isSupported: true,
                    isExposed: true,
                },
            ],
        });

        expect(Dab.validateSourceObjectForDab(supportedView)).to.deep.equal({
            isSupported: true,
        });

        const unsupportedView = createSourceObject({
            sourceType: Dab.EntitySourceType.View,
            fields: [{ name: "Id" }],
            columns: [
                {
                    id: "view:dbo.ActiveUsers:Payload",
                    name: "Payload",
                    dataType: "sys.xml",
                    isPrimaryKey: false,
                    isSupported: false,
                    isExposed: true,
                },
            ],
        });

        expect(Dab.validateSourceObjectForDab(unsupportedView)).to.deep.equal({
            isSupported: false,
            reasons: [
                { type: "noPrimaryKey" },
                { type: "unsupportedDataTypes", columns: "Payload (sys.xml)" },
            ],
        });
    });

    test("createDefaultConfigFromSources maps stored procedures to execute-only entities", () => {
        const config = Dab.createDefaultConfigFromSources([
            createSourceObject({
                id: "stored-procedure:dbo.GetUsers",
                sourceType: Dab.EntitySourceType.StoredProcedure,
                sourceName: "GetUsers",
                columns: [],
                parameters: [
                    {
                        name: "userId",
                        isRequired: true,
                        defaultValue: 7,
                        description: "User identifier",
                    },
                ],
            }),
        ]);

        expect(config.entities).to.have.lengthOf(1);
        expect(config.entities[0]).to.include({
            id: "stored-procedure:dbo.GetUsers",
            sourceType: Dab.EntitySourceType.StoredProcedure,
            sourceName: "GetUsers",
            tableName: "GetUsers",
            schemaName: "dbo",
            isEnabled: true,
            isSupported: true,
        });
        expect(config.entities[0].enabledActions).to.deep.equal([Dab.EntityAction.Execute]);
        expect(config.apiTypes).to.deep.equal([
            Dab.ApiType.Rest,
            Dab.ApiType.GraphQL,
            Dab.ApiType.Mcp,
        ]);
        expect(config.entities[0].advancedSettings.permissions).to.deep.equal([
            { role: Dab.AuthorizationRole.Anonymous, actions: [] },
            { role: Dab.AuthorizationRole.Authenticated, actions: [Dab.EntityAction.Execute] },
        ]);
        expect(config.entities[0].advancedSettings.exposeAsMcpCustomTool).to.equal(false);
        expect(config.entities[0].parameters).to.deep.equal([
            {
                name: "userId",
                isRequired: true,
                defaultValue: 7,
                description: "User identifier",
            },
        ]);
    });

    test("createDefaultConfigFromSources disables stored procedures with unsupported parameter types", () => {
        const config = Dab.createDefaultConfigFromSources([
            createSourceObject({
                id: "stored-procedure:HumanResources.uspUpdateEmployeeLogin",
                sourceType: Dab.EntitySourceType.StoredProcedure,
                schemaName: "HumanResources",
                sourceName: "uspUpdateEmployeeLogin",
                columns: [],
                parameters: [{ name: "OrganizationNode", dataType: "hierarchyid" }],
            }),
        ]);

        expect(config.entities[0]).to.include({
            isEnabled: false,
            isSupported: false,
        });
        expect(config.entities[0].unsupportedReasons).to.deep.equal([
            {
                type: "unsupportedDataTypes",
                columns: "OrganizationNode (hierarchyid)",
            },
        ]);
    });

    test("createDefaultConfigFromSources enables views without a key by falling back to the first usable column", () => {
        const viewColumn = (name: string, dataType: string): Dab.DabColumnConfig => ({
            id: `view:dbo.Totals:${name}`,
            name,
            dataType,
            isPrimaryKey: false,
            isSupported: Dab.isDataTypeSupportedForDab(dataType),
            isExposed: true,
        });
        const config = Dab.createDefaultConfigFromSources([
            createSourceObject({
                id: "view:dbo.Totals",
                sourceType: Dab.EntitySourceType.View,
                sourceName: "Totals",
                columns: [
                    viewColumn("Notes", "ntext"),
                    viewColumn("IsActive", "bit"),
                    viewColumn("Region", "nvarchar"),
                    viewColumn("Total", "money"),
                ],
                fields: undefined,
            }),
        ]);

        const entity = config.entities[0];
        expect(entity).to.include({ isEnabled: true, isSupported: true });
        expect(entity.unsupportedReasons).to.equal(undefined);
        expect(entity.fields?.filter((field) => field.isPrimaryKey)).to.deep.equal([
            { name: "Region", isPrimaryKey: true },
        ]);
        expect(Dab.isEntityRestEnabled(entity)).to.equal(true);
    });

    test("createDefaultConfigFromSources keeps a view without key candidates disabled", () => {
        const config = Dab.createDefaultConfigFromSources([
            createSourceObject({
                id: "view:dbo.Blobs",
                sourceType: Dab.EntitySourceType.View,
                sourceName: "Blobs",
                columns: [
                    {
                        id: "view:dbo.Blobs:Content",
                        name: "Content",
                        dataType: "varbinary",
                        isPrimaryKey: false,
                        isSupported: true,
                        isExposed: true,
                    },
                ],
                fields: undefined,
            }),
        ]);

        expect(config.entities[0]).to.include({ isEnabled: false, isSupported: true });
        expect(config.entities[0].unsupportedReasons).to.deep.equal([{ type: "noPrimaryKey" }]);
    });

    test("createDefaultConfigFromSources blocks stored procedures that would stop DAB at startup", () => {
        const procedure = (
            name: string,
            overrides: Partial<Dab.DabSourceObject>,
        ): Dab.DabSourceObject =>
            createSourceObject({
                id: `stored-procedure:dbo.${name}`,
                sourceType: Dab.EntitySourceType.StoredProcedure,
                sourceName: name,
                columns: [],
                ...overrides,
            });
        const config = Dab.createDefaultConfigFromSources([
            procedure("GetTotals", {
                resultColumns: [
                    { name: "Region", dataType: "nvarchar", ordinal: 1 },
                    { dataType: "int", ordinal: 2 },
                ],
            }),
            procedure("GetShapes", {
                resultColumns: [{ name: "Shape", dataType: "geography", ordinal: 1 }],
            }),
            procedure("SaveLines", {
                parameters: [{ name: "lines", dataType: "table type" }],
            }),
            procedure("RunReport", {
                resultColumns: [{ name: "Total", dataType: "int", ordinal: 1 }],
            }),
            procedure("ArchiveOrders", { resultColumns: [] }),
        ]);

        const byName = new Map(config.entities.map((entity) => [entity.sourceName, entity]));
        expect(byName.get("GetTotals")).to.include({ isEnabled: false, isSupported: false });
        expect(byName.get("GetTotals")?.unsupportedReasons).to.deep.equal([
            { type: "unnamedResultColumns" },
        ]);
        expect(byName.get("GetShapes")?.unsupportedReasons).to.deep.equal([
            { type: "unsupportedDataTypes", columns: "Shape (geography)" },
        ]);
        expect(byName.get("SaveLines")?.unsupportedReasons).to.deep.equal([
            { type: "unsupportedDataTypes", columns: "lines (table type)" },
        ]);
        expect(byName.get("RunReport")).to.include({ isEnabled: true, isSupported: true });
        expect(byName.get("ArchiveOrders")).to.include({ isEnabled: true, isSupported: true });
        expect(Dab.hasBlockingUnsupportedReason(byName.get("GetTotals")!)).to.equal(true);
    });

    test("syncConfigWithSources enables a saved view once its missing key resolves", () => {
        const keylessView = createSourceObject({
            id: "view:dbo.Report",
            sourceType: Dab.EntitySourceType.View,
            sourceName: "Report",
            columns: [
                {
                    id: "view:dbo.Report:Content",
                    name: "Content",
                    dataType: "varbinary",
                    isPrimaryKey: false,
                    isSupported: true,
                    isExposed: true,
                },
            ],
            fields: undefined,
        });
        const savedConfig = Dab.createDefaultConfigFromSources([keylessView]);
        expect(savedConfig.entities[0].isEnabled).to.equal(false);

        const keyedView = createSourceObject({
            ...keylessView,
            columns: [
                {
                    id: "view:dbo.Report:ReportKey",
                    name: "ReportKey",
                    dataType: "int",
                    isPrimaryKey: true,
                    isSupported: true,
                    isExposed: true,
                },
                ...keylessView.columns,
            ],
        });
        const { config, changed } = Dab.syncConfigWithSources(savedConfig, [keyedView]);

        expect(changed).to.equal(true);
        expect(config.entities[0]).to.include({ isEnabled: true, isSupported: true });
        expect(config.entities[0].unsupportedReasons).to.equal(undefined);
        expect(Dab.isEntityRestEnabled(config.entities[0])).to.equal(true);
        expect(Dab.isEntityGraphQLEnabled(config.entities[0])).to.equal(true);
        expect(Dab.isEntityMcpEnabled(config.entities[0])).to.equal(true);
    });

    test("syncConfigWithSources keeps a saved view disabled when the user turned it off", () => {
        const view = createSourceObject({
            id: "view:dbo.ActiveUsers",
            sourceType: Dab.EntitySourceType.View,
            sourceName: "ActiveUsers",
        });
        const savedConfig = Dab.createDefaultConfigFromSources([view]);
        savedConfig.entities[0].isEnabled = false;

        const { config } = Dab.syncConfigWithSources(savedConfig, [view]);

        expect(config.entities[0].isEnabled).to.equal(false);
    });

    test("getEntityExposedApiTypes intersects global and entity API settings", () => {
        const entity = Dab.createDefaultConfigFromSources([createSourceObject()]).entities[0];
        entity.advancedSettings = {
            ...entity.advancedSettings,
            restEnabled: true,
            graphQLEnabled: false,
            mcpEnabled: true,
            mcpDmlToolsEnabled: true,
        };

        expect(
            Dab.getEntityExposedApiTypes(entity, [Dab.ApiType.Rest, Dab.ApiType.GraphQL]),
        ).to.deep.equal([Dab.ApiType.Rest]);
        expect(
            Dab.getEntityExposedApiTypes(entity, [Dab.ApiType.GraphQL, Dab.ApiType.Mcp]),
        ).to.deep.equal([Dab.ApiType.Mcp]);
        expect(Dab.getEntityExposedApiTypes(entity, [])).to.deep.equal([]);

        entity.advancedSettings.graphQLEnabled = true;
        expect(
            Dab.getEntityExposedApiTypes(entity, [
                Dab.ApiType.Mcp,
                Dab.ApiType.GraphQL,
                Dab.ApiType.Rest,
            ]),
        ).to.deep.equal([Dab.ApiType.Rest, Dab.ApiType.GraphQL, Dab.ApiType.Mcp]);
    });

    test("effective exposure respects global API types without changing column preferences", () => {
        const entity = Dab.createDefaultConfigFromSources([createSourceObject()]).entities[0];
        const nameColumn = entity.columns.find((column) => column.name === "Name");
        if (!nameColumn) {
            throw new Error("Expected Name column");
        }

        expect(Dab.isEntityEffectivelyExposed(entity, [Dab.ApiType.Rest])).to.equal(true);
        expect(Dab.isColumnEffectivelyExposed(entity, nameColumn, [Dab.ApiType.Rest])).to.equal(
            true,
        );
        expect(Dab.isEntityEffectivelyExposed(entity, [])).to.equal(false);
        expect(Dab.isColumnEffectivelyExposed(entity, nameColumn, [])).to.equal(false);
        expect(nameColumn.isExposed).to.equal(true);
    });

    test("logical keys are effectively exposed only while their entity is exposed", () => {
        const entity = Dab.createDefaultConfigFromSources([createSourceObject()]).entities[0];
        const keyColumn = entity.columns.find((column) => column.name === "Id");
        if (!keyColumn) {
            throw new Error("Expected Id column");
        }
        keyColumn.isExposed = false;

        expect(Dab.isColumnEffectivelyExposed(entity, keyColumn, [Dab.ApiType.Rest])).to.equal(
            true,
        );
        expect(Dab.isColumnEffectivelyExposed(entity, keyColumn, [])).to.equal(false);
        expect(keyColumn.isExposed).to.equal(false);
    });

    test("syncConfigWithSources removes missing entities, adds new ones, and refreshes metadata", () => {
        const currentConfig = Dab.createDefaultConfigFromSources([
            createSourceObject({ id: "TABLE:DBO.USERS" }),
            createSourceObject({
                id: "table:dbo.Legacy",
                sourceName: "Legacy",
                columns: [],
            }),
        ]);
        currentConfig.entities[0].advancedSettings.entityName = "UsersApi";
        currentConfig.entities[0].columns[1].isExposed = false;

        const result = Dab.syncConfigWithSources(currentConfig, [
            createSourceObject({
                id: "table:dbo.users",
                sourceName: "UsersRenamed",
                columns: [
                    {
                        id: "table:dbo.users:Id",
                        name: "Id",
                        dataType: "int",
                        isPrimaryKey: true,
                        isSupported: true,
                        isExposed: true,
                    },
                    {
                        id: "table:dbo.users:DisplayName",
                        name: "DisplayName",
                        dataType: "nvarchar",
                        isPrimaryKey: false,
                        isSupported: true,
                        isExposed: true,
                    },
                ],
            }),
            createSourceObject({
                id: "view:dbo.ActiveUsers",
                sourceType: Dab.EntitySourceType.View,
                sourceName: "ActiveUsers",
                fields: [{ name: "Id", isPrimaryKey: true }],
            }),
        ]);

        expect(result.changed).to.equal(true);
        expect(result.config.entities.map((entity) => entity.id)).to.deep.equal([
            "table:dbo.users",
            "view:dbo.ActiveUsers",
        ]);
        expect(result.config.entities[0].advancedSettings.entityName).to.equal("UsersApi");
        expect(result.config.entities[0].sourceName).to.equal("UsersRenamed");
        expect(result.config.entities[0].columns.map((column) => column.name)).to.deep.equal([
            "Id",
            "DisplayName",
        ]);
        expect(result.config.entities[1].sourceType).to.equal(Dab.EntitySourceType.View);
    });
});

suite("DAB deployment step sequencing", () => {
    const targets = [Dab.DabDeploymentTarget.Docker, Dab.DabDeploymentTarget.DabCli];

    test("every target has prerequisite and deployment phases", () => {
        for (const target of targets) {
            const steps = Dab.dabDeploymentStepsByTarget[target];
            expect(steps.prerequisites, `${target} prerequisites`).to.not.be.empty;
            expect(steps.deployment, `${target} deployment steps`).to.not.be.empty;
        }
    });

    test("targets do not share any step", () => {
        const dockerSteps = Dab.getDabDeploymentSteps(Dab.DabDeploymentTarget.Docker);
        const cliSteps = Dab.getDabDeploymentSteps(Dab.DabDeploymentTarget.DabCli);

        expect(
            dockerSteps.filter((step) => cliSteps.includes(step)),
            "A shared step would run the wrong target's work",
        ).to.be.empty;
    });

    test("walking getNextDabDeploymentStep visits every step once, in order", () => {
        for (const target of targets) {
            const expected = Dab.getDabDeploymentSteps(target);
            const visited: Dab.DabDeploymentStepOrder[] = [];

            let step: Dab.DabDeploymentStepOrder | undefined = expected[0];
            while (step !== undefined) {
                visited.push(step);
                step = Dab.getNextDabDeploymentStep(target, step);
            }

            expect(visited, `${target} step walk`).to.deep.equal(expected);
        }
    });

    test("only the last deployment step is final", () => {
        for (const target of targets) {
            const steps = Dab.getDabDeploymentSteps(target);
            const finalSteps = steps.filter((step) => Dab.isFinalDabDeploymentStep(target, step));

            expect(finalSteps, `${target} final step`).to.deep.equal([steps[steps.length - 1]]);
        }
    });

    test("prerequisite steps come before deployment steps", () => {
        for (const target of targets) {
            const steps = Dab.getDabDeploymentSteps(target);
            const prerequisiteFlags = steps.map((step) => Dab.isDabPrerequisiteStep(target, step));
            const firstDeploymentIndex = prerequisiteFlags.indexOf(false);

            expect(
                prerequisiteFlags.slice(firstDeploymentIndex).some(Boolean),
                `${target} must not return to prerequisites mid-deployment`,
            ).to.be.false;
        }
    });
});

suite("DAB engine readiness wait", () => {
    const minute = 60_000;

    test("waits five minutes for an engine with no entities", () => {
        expect(Dab.getDabEngineReadyTimeoutMs(0)).to.equal(5 * minute);
    });

    test("waits longer for each entity the engine loads", () => {
        // 321 entities took more than 19 minutes to load against a remote
        // database, so their wait has to be well past that.
        expect(Dab.getDabEngineReadyTimeoutMs(321)).to.equal(5 * minute + 321 * 6_000);
        expect(Dab.getDabEngineReadyTimeoutMs(321)).to.be.greaterThan(30 * minute);
    });

    test("stops growing at two hours", () => {
        expect(Dab.getDabEngineReadyTimeoutMs(100_000)).to.equal(120 * minute);
    });

    test("counts only the supported entities the deployment exposes", () => {
        const exposed = {
            isSupported: true,
            advancedSettings: {},
        } as unknown as Dab.DabEntityConfig;
        const config = {
            apiTypes: [Dab.ApiType.Rest],
            entities: [
                exposed,
                exposed,
                { ...exposed, isSupported: false },
                { ...exposed, advancedSettings: { restEnabled: false } },
            ],
        } as unknown as Dab.DabConfig;

        expect(Dab.getExposedDabEntityCount(config)).to.equal(2);
        expect(Dab.getExposedDabEntityCount(undefined)).to.equal(0);
    });
});

suite("DAB deployment naming", () => {
    test("builds a name of the form DAB_<database>_<n>", () => {
        expect(Dab.buildDabDeploymentName("AdventureWorks2022", 1)).to.equal(
            "DAB_AdventureWorks2022_1",
        );
    });

    test("drops characters a container name cannot carry", () => {
        expect(Dab.buildDabDeploymentName("My DB (prod)!", 2)).to.equal("DAB_MyDBprod_2");
    });

    test("truncates a long database name", () => {
        const name = Dab.buildDabDeploymentName("A".repeat(60), 1);

        expect(name).to.equal(`DAB_${"A".repeat(Dab.DAB_DEPLOYMENT_NAME_DB_MAX_LENGTH)}_1`);
    });

    test("falls back when a database name reduces to nothing", () => {
        expect(Dab.buildDabDeploymentName("---", 1)).to.equal("DAB_db_1");
    });

    test("always produces a legal Docker container name", () => {
        const dockerNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
        for (const database of ["AdventureWorks2022", "My DB (prod)!", "---", "0", "ünïcodé"]) {
            expect(
                Dab.buildDabDeploymentName(database, 3),
                `"${database}" must yield a usable container name`,
            ).to.match(dockerNamePattern);
        }
    });
});

suite("DAB target support by authentication", () => {
    const targets = [Dab.DabDeploymentTarget.DabCli, Dab.DabDeploymentTarget.Docker];

    test("SQL authentication works with every target", () => {
        for (const target of targets) {
            expect(
                Dab.isDabTargetSupportedForAuthentication(target, AuthenticationType.SqlLogin),
                `${target} with SQL authentication`,
            ).to.be.true;
        }
    });

    test("Windows authentication works with the CLI", () => {
        expect(
            Dab.isDabTargetSupportedForAuthentication(
                Dab.DabDeploymentTarget.DabCli,
                AuthenticationType.Integrated,
            ),
            "The CLI runs as the signed-in user, so it can pass Windows credentials through",
        ).to.be.true;
    });

    test("Windows authentication cannot use a container", () => {
        expect(
            Dab.isDabTargetSupportedForAuthentication(
                Dab.DabDeploymentTarget.Docker,
                AuthenticationType.Integrated,
            ),
            "A container runs outside the Windows session",
        ).to.be.false;
    });

    test("Entra authentication works with the CLI", () => {
        for (const authType of [
            AuthenticationType.AzureMFA,
            AuthenticationType.ActiveDirectoryDefault,
            AuthenticationType.AzureMFAAndUser,
            AuthenticationType.ActiveDirectoryServicePrincipal,
        ]) {
            expect(
                Dab.isDabTargetSupportedForAuthentication(Dab.DabDeploymentTarget.DabCli, authType),
                `the CLI with ${authType}`,
            ).to.be.true;
        }
    });

    test("Entra authentication cannot use a container", () => {
        expect(
            Dab.isDabTargetSupportedForAuthentication(
                Dab.DabDeploymentTarget.Docker,
                AuthenticationType.AzureMFA,
            ),
            "A container cannot see the host's Entra sign-in",
        ).to.be.false;
    });

    test("an unknown or missing authentication type supports no target", () => {
        for (const target of targets) {
            expect(Dab.isDabTargetSupportedForAuthentication(target, undefined)).to.be.false;
            expect(Dab.isDabTargetSupportedForAuthentication(target, "Something")).to.be.false;
        }
    });
});

suite("DAB supported data types", () => {
    test("json and vector are exposable", () => {
        // Supported by the engine from 2.1 onward.
        expect(Dab.isDataTypeSupportedForDab("json")).to.be.true;
        expect(Dab.isDataTypeSupportedForDab("vector")).to.be.true;
    });

    test("types the engine still refuses stay blocked", () => {
        for (const dataType of ["xml", "sql_variant", "rowversion", "geography", "hierarchyid"]) {
            expect(
                Dab.isDataTypeSupportedForDab(dataType),
                `${dataType} is still unsupported by the engine`,
            ).to.be.false;
        }
    });

    test("both deployment targets run one engine version", () => {
        expect(Dab.DAB_CLI_VERSION).to.equal(Dab.DAB_ENGINE_VERSION);
        expect(
            Dab.DAB_CONTAINER_IMAGE,
            "A tag can be moved to another image; only a digest names one build",
        ).to.equal(`${Dab.DAB_CONTAINER_IMAGE_REPOSITORY}@${Dab.DAB_CONTAINER_IMAGE_DIGEST}`);
        expect(Dab.DAB_CONTAINER_IMAGE_DIGEST).to.match(/^sha256:[0-9a-f]{64}$/);
    });
});

suite("DAB CLI connection string", () => {
    test("passes a SQL authentication connection through untouched", () => {
        const connectionString = "Server=localhost,1433;Database=Db;User ID=sa;Password=p;";

        expect(
            Dab.buildDabCliConnectionString(connectionString, AuthenticationType.SqlLogin),
        ).to.equal(connectionString);
    });

    test("passes a Windows authentication connection through untouched", () => {
        const connectionString = "Server=localhost;Database=Db;Integrated Security=True;";

        expect(
            Dab.buildDabCliConnectionString(connectionString, AuthenticationType.Integrated),
        ).to.equal(connectionString);
    });

    test("strips credentials for Entra so the engine acquires its own token", () => {
        // The engine only reaches for a token when nothing else in the string
        // says who is connecting.
        const result = Dab.buildDabCliConnectionString(
            "Server=x.database.windows.net;Database=Db;User ID=me@contoso.com;Authentication=ActiveDirectoryInteractive;Encrypt=True;",
            AuthenticationType.AzureMFA,
        );

        expect(result).to.equal("Server=x.database.windows.net;Database=Db;Encrypt=True");
    });

    test("keeps the properties that are not credentials", () => {
        const result = Dab.buildDabCliConnectionString(
            "Server=x;Database=Db;Password=p;TrustServerCertificate=True;Connect Timeout=30;",
            AuthenticationType.ActiveDirectoryDefault,
        );

        expect(result).to.contain("TrustServerCertificate=True");
        expect(result).to.contain("Connect Timeout=30");
        expect(result).to.not.contain("Password");
    });

    test("matches credential properties regardless of spelling or case", () => {
        const result = Dab.buildDabCliConnectionString(
            "Server=x;Database=Db; UID =me; PWD =secret;Trusted_Connection=True;",
            AuthenticationType.AzureMFA,
        );

        expect(result).to.equal("Server=x;Database=Db");
    });

    test("keeps service principal credentials so the engine signs in as that principal", () => {
        // The client id and secret travel as User ID and Password. Stripping
        // them would leave the engine authenticating as whichever identity is
        // signed in on the machine, or as none at all.
        const connectionString =
            "Server=x.database.windows.net;Database=Db;User ID=client-id;Password=client-secret;Authentication=ActiveDirectoryServicePrincipal;Encrypt=True;";

        expect(
            Dab.buildDabCliConnectionString(
                connectionString,
                AuthenticationType.ActiveDirectoryServicePrincipal,
            ),
        ).to.equal(connectionString);
    });

    test("reports which authentication types are Entra", () => {
        expect(Dab.isEntraAuthentication(AuthenticationType.AzureMFA)).to.be.true;
        expect(Dab.isEntraAuthentication(AuthenticationType.ActiveDirectoryServicePrincipal)).to.be
            .true;
        expect(Dab.isEntraAuthentication(AuthenticationType.SqlLogin)).to.be.false;
        expect(Dab.isEntraAuthentication(AuthenticationType.Integrated)).to.be.false;
        expect(Dab.isEntraAuthentication(undefined)).to.be.false;
    });

    test("only the ambient Entra types make the engine acquire its own token", () => {
        for (const authType of [
            AuthenticationType.AzureMFA,
            AuthenticationType.ActiveDirectoryDefault,
            AuthenticationType.AzureMFAAndUser,
        ]) {
            expect(
                Dab.usesAmbientEntraCredentials(authType),
                `${authType} has no credential of its own to pass on`,
            ).to.be.true;
        }

        expect(
            Dab.usesAmbientEntraCredentials(AuthenticationType.ActiveDirectoryServicePrincipal),
            "a service principal carries its own credential",
        ).to.be.false;
        expect(Dab.usesAmbientEntraCredentials(AuthenticationType.SqlLogin)).to.be.false;
        expect(Dab.usesAmbientEntraCredentials(undefined)).to.be.false;
    });
});
