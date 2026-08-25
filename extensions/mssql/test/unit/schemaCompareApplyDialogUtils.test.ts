/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as mssql from "vscode-mssql";
import {
    SchemaCompareEndpointType,
    SchemaDifferenceType,
    SchemaUpdateAction,
} from "../../src/sharedInterfaces/schemaCompare";
import {
    getSchemaCompareApplySummarySections,
    getSchemaCompareApplyTargetName,
} from "../../src/webviews/pages/SchemaCompare/components/schemaCompareApplyDialogUtils";

suite("SchemaCompare apply dialog utils", () => {
    function createDifference(
        name: string,
        updateAction: SchemaUpdateAction,
        included = true,
    ): mssql.DiffEntry {
        return {
            updateAction,
            differenceType: SchemaDifferenceType.Object,
            name,
            sourceValue: [],
            targetValue: [],
            parent: undefined as unknown as mssql.DiffEntry,
            children: [],
            sourceScript: "",
            targetScript: "",
            sourceObjectType: "",
            targetObjectType: "",
            included,
        };
    }

    function createEndpoint(
        overrides: Partial<mssql.SchemaCompareEndpointInfo> = {},
    ): mssql.SchemaCompareEndpointInfo {
        return {
            endpointType: SchemaCompareEndpointType.Database,
            packageFilePath: "",
            serverDisplayName: "localhost (sa)",
            serverName: "localhost",
            databaseName: "master",
            ownerUri: "connection-uri",
            connectionDetails: {
                options: {},
            },
            connectionName: "Local SQL",
            projectFilePath: "",
            targetScripts: [],
            extractTarget: 0,
            dataSchemaProvider: "",
            ...overrides,
        };
    }

    test("groups included changes by create, change, and drop with counts per object type", () => {
        const sections = getSchemaCompareApplySummarySections([
            createDifference("Table", SchemaUpdateAction.Add),
            createDifference("Table", SchemaUpdateAction.Add),
            createDifference("View", SchemaUpdateAction.Add),
            createDifference("Stored Procedure", SchemaUpdateAction.Change),
            createDifference("Table", SchemaUpdateAction.Delete),
            createDifference("View", SchemaUpdateAction.Delete, false),
        ]);

        expect(sections).to.deep.equal([
            {
                action: SchemaUpdateAction.Add,
                totalCount: 3,
                typeCounts: [
                    { objectType: "Table", count: 2 },
                    { objectType: "View", count: 1 },
                ],
            },
            {
                action: SchemaUpdateAction.Change,
                totalCount: 1,
                typeCounts: [{ objectType: "Stored Procedure", count: 1 }],
            },
            {
                action: SchemaUpdateAction.Delete,
                totalCount: 1,
                typeCounts: [{ objectType: "Table", count: 1 }],
            },
        ]);
    });

    test("uses connection name and appends a database not specified by the connection", () => {
        expect(getSchemaCompareApplyTargetName(createEndpoint())).to.equal("Local SQL:master");
    });

    test("does not repeat a database already specified by the connection", () => {
        expect(
            getSchemaCompareApplyTargetName(
                createEndpoint({
                    connectionDetails: {
                        options: {
                            database: "MASTER",
                        },
                    },
                }),
            ),
        ).to.equal("Local SQL");
    });

    test("appends the selected database when it differs from the connection database", () => {
        expect(
            getSchemaCompareApplyTargetName(
                createEndpoint({
                    connectionDetails: {
                        options: {
                            database: "tempdb",
                        },
                    },
                }),
            ),
        ).to.equal("Local SQL:master");
    });

    test("falls back to the project path for project targets", () => {
        expect(
            getSchemaCompareApplyTargetName(
                createEndpoint({
                    endpointType: SchemaCompareEndpointType.Project,
                    connectionName: "",
                    serverDisplayName: "",
                    serverName: "",
                    databaseName: "",
                    projectFilePath: "C:\\projects\\Inventory\\Inventory.sqlproj",
                }),
            ),
        ).to.equal("C:\\projects\\Inventory\\Inventory.sqlproj");
    });
});
