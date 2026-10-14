/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { IConnectionInfo } from "vscode-mssql";
import { fabricIds, guidFromBase32 } from "../../../src/performance/platformMetrics";

suite("Performance platform metrics", () => {
    test("decodes a GUID from base32 in .NET byte order", () => {
        expect(guidFromBase32("x6eps4xrq2xudenlfv6naeo3i4")).to.equal(
            "72f988bf-86f1-41af-91ab-2d7cd011db47",
        );
        expect(guidFromBase32("not base32!")).to.equal(undefined);
        expect(guidFromBase32("abc")).to.equal(undefined);
    });

    test("reads the tenant, workspace, and item of a SQL database in Fabric", () => {
        const connection = {
            server: "x6eps4xrq2xudenlfv6naeo3i4-eysrwmp5slwedk3zxqjvq7c54a.msit-database.fabric.microsoft.com,1433",
            database: "Test Database-0d373898-c2da-4729-ac46-80c1ef8ed940",
        } as IConnectionInfo;

        expect(fabricIds(connection)).to.deep.equal({
            tenantId: "72f988bf-86f1-41af-91ab-2d7cd011db47",
            workspaceId: "311b2526-92fd-41ec-ab79-bc13587c5de0",
            itemId: "0d373898-c2da-4729-ac46-80c1ef8ed940",
        });
    });

    test("has no Fabric IDs without an item ID in the database name", () => {
        const connection = {
            server: "x6eps4xrq2xudenlfv6naeo3i4-eysrwmp5slwedk3zxqjvq7c54a.msit-database.fabric.microsoft.com",
            database: "master",
        } as IConnectionInfo;

        expect(fabricIds(connection)).to.equal(undefined);
    });
});
