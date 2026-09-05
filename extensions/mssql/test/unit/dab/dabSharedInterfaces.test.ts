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

    test("the default deployment state matches its target's steps", () => {
        for (const target of targets) {
            const state = Dab.createDefaultDeploymentState(target);
            const steps = Dab.getDabDeploymentSteps(target);

            expect(state.target).to.equal(target);
            expect(state.stepStatuses.map((status) => status.step)).to.deep.equal(steps);
            expect(state.currentDeploymentStep, `${target} starts at its first step`).to.equal(
                steps[0],
            );
        }
    });

    test("the default deployment state is Docker when no target is given", () => {
        expect(Dab.createDefaultDeploymentState().target).to.equal(Dab.DabDeploymentTarget.Docker);
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
        expect(Dab.DAB_CONTAINER_IMAGE).to.contain(`:${Dab.DAB_ENGINE_VERSION}`);
        expect(
            Dab.DAB_CONTAINER_IMAGE,
            "A floating tag would let the container drift from the CLI",
        ).to.not.contain(":latest");
    });
});

suite("DAB deployment entry points", () => {
    test("the deployments dialog is the default entry point", () => {
        expect(Dab.createDefaultDeploymentState().entryPoint).to.equal(
            Dab.DabDeploymentEntryPoint.Deployments,
        );
    });

    test("the standalone flow keeps a completion step to finish on", () => {
        // The toolbar's Deploy flow has no deployments list to return to, so
        // the completion step has to remain reachable independently of it.
        expect(Dab.DabDeploymentDialogStep.Complete).to.not.be.undefined;
    });

    test("a target's steps do not depend on the entry point", () => {
        for (const target of [Dab.DabDeploymentTarget.Docker, Dab.DabDeploymentTarget.DabCli]) {
            const steps = Dab.getDabDeploymentSteps(target);
            for (const entryPoint of [
                Dab.DabDeploymentEntryPoint.Standalone,
                Dab.DabDeploymentEntryPoint.Deployments,
            ]) {
                const state = {
                    ...Dab.createDefaultDeploymentState(target),
                    entryPoint,
                };
                expect(
                    state.stepStatuses.map((status) => status.step),
                    `${target} from ${entryPoint}`,
                ).to.deep.equal(steps);
            }
        }
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

    test("reports which authentication types are Entra", () => {
        expect(Dab.isEntraAuthentication(AuthenticationType.AzureMFA)).to.be.true;
        expect(Dab.isEntraAuthentication(AuthenticationType.SqlLogin)).to.be.false;
        expect(Dab.isEntraAuthentication(AuthenticationType.Integrated)).to.be.false;
        expect(Dab.isEntraAuthentication(undefined)).to.be.false;
    });
});
