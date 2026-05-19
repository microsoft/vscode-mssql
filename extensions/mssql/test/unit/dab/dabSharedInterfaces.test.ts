/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { Dab } from "../../../src/sharedInterfaces/dab";

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
        expect(config.entities[0].parameters).to.deep.equal([
            {
                name: "userId",
                isRequired: true,
                defaultValue: 7,
                description: "User identifier",
            },
        ]);
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
