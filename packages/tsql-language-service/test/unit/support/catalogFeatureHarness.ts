/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    TsqlLanguageFeatureService,
    type CompletionItem,
    type ObjectMetadata,
    type SqlObjectKind,
} from "../../../src/index.ts";
import { defined } from "./assertions.ts";

export interface CatalogFeatureServices {
    readonly features: TsqlLanguageFeatureService;
    readonly metadata: InMemoryMetadataProvider;
    readonly runtime: InProcessLanguageServiceRuntime;
}

export function createCatalogFeatureServices(options?: {
    readonly includeHiddenUserColumn?: boolean;
}): CatalogFeatureServices {
    const objects: readonly ObjectMetadata[] = [
        {
            ...object("users", "dbo", "Users", "table"),
            extendedProperties: [{ name: "MS_Description", value: "Application users" }],
        },
        object("orders", "sales", "Orders", "table"),
        object("odd-orders", "My Schema", "Order-Items", "table"),
        object("reserved-object", "My Schema", "select", "table"),
        object("rebuild", "sales", "RebuildOrder", "procedure"),
        { ...object("sysobjects", "dbo", "sysobjects", "view"), system: true },
        object("archive-orders", "history", "Orders2024", "table", "ArchiveDb"),
        object("archive-summary", "history", "OrderSummary", "view", "ArchiveDb"),
        { ...object("order-code", "sales", "OrderCode", "type"), typeCategory: "alias" },
        { ...object("row-set", "dbo", "RowSet", "type"), typeCategory: "table" },
        {
            ...object("archive-code", "history", "ArchiveCode", "type", "ArchiveDb"),
            typeCategory: "clr",
        },
    ];
    const metadata = new InMemoryMetadataProvider({
        environment: {
            currentDatabase: "CustomerDb",
            defaultSchema: "sales",
            caseSensitive: false,
        },
        schemas: [
            { database: "CustomerDb", name: "sys" },
            { database: "CustomerDb", name: "reporting" },
            { database: "CustomerDb", name: "dbo" },
            { database: "CustomerDb", name: "db_accessadmin" },
            { database: "CustomerDb", name: "sales" },
            { database: "CustomerDb", name: "My Schema" },
            { database: "ArchiveDb", name: "history" },
        ],
        databases: [{ name: "CustomerDb" }, { name: "ArchiveDb" }, { name: "master" }],
        objects,
        columns: new Map([
            [
                "users",
                [
                    {
                        name: "Id",
                        typeDisplay: "int",
                        nullable: false,
                        extendedProperties: [
                            { name: "MS_Description", value: "Stable user identifier" },
                        ],
                    },
                    { name: "Display Name", typeDisplay: "nvarchar(100)", nullable: true },
                    ...(options?.includeHiddenUserColumn
                        ? [
                              {
                                  name: "SysStartTime",
                                  typeDisplay: "datetime2",
                                  hidden: true,
                              },
                          ]
                        : []),
                ],
            ],
            [
                "orders",
                [
                    { name: "OrderId", typeDisplay: "int", identity: true },
                    { name: "CustomerId", typeDisplay: "int", nullable: false },
                    { name: "ComputedTotal", typeDisplay: "money", computed: true },
                ],
            ],
        ]),
        parameters: new Map([["rebuild", [{ ordinal: 1, name: "@OrderId", typeDisplay: "int" }]]]),
        foreignKeys: new Map([
            [
                "orders",
                [
                    {
                        name: "FK_Orders_Users",
                        referencedObject: { id: "users", database: "CustomerDb" },
                        columns: [{ parentColumn: "CustomerId", referencedColumn: "Id" }],
                    },
                ],
            ],
        ]),
        principals: [
            { id: "login:app", name: "AppLogin", kind: "login" },
            { id: "role:sysadmin", name: "sysadmin", kind: "serverRole", system: true },
            { id: "user:alice", database: "CustomerDb", name: "Alice", kind: "user" },
            {
                id: "role:app",
                database: "CustomerDb",
                name: "app_role",
                kind: "databaseRole",
            },
        ],
    });
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        metadata,
    );
    return {
        features: new TsqlLanguageFeatureService(runtime, metadata),
        metadata,
        runtime,
    };
}

export function object(
    id: string,
    schema: string,
    name: string,
    kind: SqlObjectKind,
    database = "CustomerDb",
): ObjectMetadata {
    return { ref: { id, database }, database, schema, name, kind };
}

export function applyCompletion(sql: string, item: CompletionItem): string {
    const edit = defined(item.edit, "expected a completion edit");
    return `${sql.slice(0, edit.start)}${edit.newText}${sql.slice(edit.end)}`;
}
