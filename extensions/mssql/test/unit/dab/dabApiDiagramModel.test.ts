/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { Dab } from "../../../src/sharedInterfaces/dab";
import {
    createDabApiDiagramModel,
    filterDabApiDiagramModel,
} from "../../../src/webviews/pages/SchemaDesigner/dab/dabApiDiagramModel";

function createEntity(overrides?: Partial<Dab.DabEntityConfig>): Dab.DabEntityConfig {
    return {
        id: "books",
        tableName: "Books",
        schemaName: "dbo",
        isEnabled: true,
        isSupported: true,
        enabledActions: [
            Dab.EntityAction.Create,
            Dab.EntityAction.Read,
            Dab.EntityAction.Update,
            Dab.EntityAction.Delete,
        ],
        advancedSettings: {
            entityName: "Books",
            authorizationRole: Dab.AuthorizationRole.Anonymous,
        },
        ...overrides,
    };
}

function createConfig(overrides?: Partial<Dab.DabConfig>): Dab.DabConfig {
    return {
        apiTypes: [Dab.ApiType.Rest, Dab.ApiType.GraphQL, Dab.ApiType.Mcp],
        entities: [createEntity()],
        ...overrides,
    };
}

suite("DabApiDiagramModel", () => {
    test("includes only enabled and supported entities", () => {
        const model = createDabApiDiagramModel(
            createConfig({
                entities: [
                    createEntity({
                        id: "enabled",
                        advancedSettings: {
                            entityName: "Books",
                            authorizationRole: Dab.AuthorizationRole.Anonymous,
                        },
                    }),
                    createEntity({
                        id: "disabled",
                        isEnabled: false,
                        advancedSettings: {
                            entityName: "Authors",
                            authorizationRole: Dab.AuthorizationRole.Anonymous,
                        },
                    }),
                    createEntity({
                        id: "unsupported",
                        isSupported: false,
                        advancedSettings: {
                            entityName: "Reviews",
                            authorizationRole: Dab.AuthorizationRole.Anonymous,
                        },
                    }),
                ],
            }),
        );

        expect(model.rest.entities.map((entity) => entity.id)).to.deep.equal(["enabled"]);
        expect(model.graphql.entities.map((entity) => entity.id)).to.deep.equal(["enabled"]);
        expect(model.mcp.entities.map((entity) => entity.id)).to.deep.equal(["enabled"]);
    });

    test("normalizes custom REST paths for generated endpoints", () => {
        const model = createDabApiDiagramModel(
            createConfig({
                entities: [
                    createEntity({
                        advancedSettings: {
                            entityName: "Books",
                            authorizationRole: Dab.AuthorizationRole.Anonymous,
                            customRestPath: "//catalog/items",
                        },
                    }),
                ],
            }),
        );

        expect(model.rest.entities[0].basePath).to.equal("/catalog/items");
        expect(model.rest.entities[0].endpoints.map((endpoint) => endpoint.path)).to.deep.equal([
            "/catalog/items",
            "/catalog/items/id/{id}",
            "/catalog/items",
            "/catalog/items/id/{id}",
            "/catalog/items/id/{id}",
            "/catalog/items/id/{id}",
        ]);
    });

    test("uses custom GraphQL type names and pluralization for operation names", () => {
        const model = createDabApiDiagramModel(
            createConfig({
                entities: [
                    createEntity({
                        advancedSettings: {
                            entityName: "Books",
                            authorizationRole: Dab.AuthorizationRole.Anonymous,
                            customGraphQLType: "LibraryEntry",
                        },
                    }),
                ],
            }),
        );

        expect(model.graphql.entities[0].singularName).to.equal("LibraryEntry");
        expect(model.graphql.entities[0].pluralName).to.equal("LibraryEntries");
        expect(
            model.graphql.entities[0].operations.map((operation) => operation.name),
        ).to.deep.equal([
            "libraryEntries",
            "libraryEntry_by_pk",
            "createLibraryEntry",
            "updateLibraryEntry",
            "deleteLibraryEntry",
        ]);
    });

    test("maps CRUD actions to REST, GraphQL, and MCP shapes", () => {
        const model = createDabApiDiagramModel(
            createConfig({
                entities: [
                    createEntity({
                        enabledActions: [Dab.EntityAction.Read, Dab.EntityAction.Update],
                    }),
                ],
            }),
        );

        expect(model.rest.entities[0].endpoints.map((endpoint) => endpoint.method)).to.deep.equal([
            "GET",
            "GET",
            "PUT",
            "PATCH",
        ]);
        expect(
            model.graphql.entities[0].operations.map((operation) => operation.name),
        ).to.deep.equal(["books", "books_by_pk", "updateBooks"]);
        expect(model.mcp.tools).to.deep.equal([
            { name: "describe_entities", enabled: true },
            { name: "read_records", enabled: true },
            { name: "create_record", enabled: false },
            { name: "update_record", enabled: true },
            { name: "delete_record", enabled: false },
            { name: "execute_entity", enabled: false },
        ]);
        expect(model.mcp.entities[0].tools.map((tool) => tool.name)).to.deep.equal([
            "describe_entities",
            "read_records",
            "update_record",
        ]);
    });

    test("tracks API type enabled state independently per column", () => {
        const model = createDabApiDiagramModel(
            createConfig({
                apiTypes: [Dab.ApiType.Rest],
            }),
        );

        expect(model.rest.enabled).to.equal(true);
        expect(model.graphql.enabled).to.equal(false);
        expect(model.mcp.enabled).to.equal(false);
    });

    test("filters entities and tools across all sections", () => {
        const model = createDabApiDiagramModel(
            createConfig({
                entities: [
                    createEntity(),
                    createEntity({
                        id: "authors",
                        tableName: "Authors",
                        advancedSettings: {
                            entityName: "Authors",
                            authorizationRole: Dab.AuthorizationRole.Anonymous,
                        },
                    }),
                ],
            }),
        );

        const filteredModel = filterDabApiDiagramModel(model, "author");

        expect(filteredModel.rest.entities.map((entity) => entity.id)).to.deep.equal(["authors"]);
        expect(filteredModel.graphql.entities.map((entity) => entity.id)).to.deep.equal([
            "authors",
        ]);
        expect(filteredModel.mcp.entities.map((entity) => entity.id)).to.deep.equal(["authors"]);
    });
});
