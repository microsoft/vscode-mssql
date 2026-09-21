/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";

import { FabricEnvironment } from "../../src/fabric/fabricDatabaseHub";
import {
    FabricWorkspaceItemNode,
    getFabricWorkspaceItemEnvironment,
    isFabricSqlDatabaseNode,
} from "../../src/integration/fabricIntegration";
import { SqlArtifactTypes } from "../../src/sharedInterfaces/fabric";

suite("Fabric extension integration", () => {
    const buildNode = (
        artifact: Partial<FabricWorkspaceItemNode["artifact"]> = {},
    ): FabricWorkspaceItemNode => ({
        artifact: {
            id: "artifact-id",
            type: SqlArtifactTypes.SqlDatabase,
            displayName: "Sales",
            description: undefined,
            workspaceId: "workspace-id",
            fabricEnvironment: "PROD",
            ...artifact,
        },
    });

    suite("isFabricSqlDatabaseNode", () => {
        test("distinguishes SQL databases from other Fabric items", () => {
            expect(isFabricSqlDatabaseNode(buildNode())).to.be.true;
            expect(isFabricSqlDatabaseNode(buildNode({ type: SqlArtifactTypes.Warehouse }))).to.be
                .false;
            expect(
                isFabricSqlDatabaseNode(buildNode({ type: SqlArtifactTypes.SqlAnalyticsEndpoint })),
            ).to.be.false;
        });
    });

    suite("getFabricWorkspaceItemEnvironment", () => {
        test("resolves the environment the node reports", () => {
            expect(
                getFabricWorkspaceItemEnvironment(buildNode({ fabricEnvironment: "MSIT" })),
            ).to.equal(FabricEnvironment.Msit);
            expect(
                getFabricWorkspaceItemEnvironment(buildNode({ fabricEnvironment: "prod" })),
            ).to.equal(FabricEnvironment.Prod);
        });

        test("returns undefined when the environment is unknown", () => {
            expect(getFabricWorkspaceItemEnvironment(buildNode({ fabricEnvironment: "nowhere" })))
                .to.be.undefined;
        });
    });
});
