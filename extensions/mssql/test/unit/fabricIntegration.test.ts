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
    isFabricWorkspaceItemNode,
} from "../../src/integration/fabricIntegration";
import { SqlArtifactTypes } from "../../src/sharedInterfaces/fabric";

suite("Fabric extension integration", () => {
    const buildNode = (
        artifact: Partial<FabricWorkspaceItemNode["artifact"]> = {},
    ): FabricWorkspaceItemNode =>
        ({
            artifact: { type: SqlArtifactTypes.SqlDatabase, ...artifact },
        }) as FabricWorkspaceItemNode;

    suite("isFabricWorkspaceItemNode", () => {
        test("recognizes nodes carrying a Fabric artifact", () => {
            expect(isFabricWorkspaceItemNode(buildNode())).to.be.true;
        });

        test("rejects values that are not workspace item nodes", () => {
            expect(isFabricWorkspaceItemNode(undefined)).to.be.false;
            expect(isFabricWorkspaceItemNode("not a node")).to.be.false;
            expect(isFabricWorkspaceItemNode({})).to.be.false;
            expect(isFabricWorkspaceItemNode({ artifact: undefined })).to.be.false;
            expect(isFabricWorkspaceItemNode({ artifact: { displayName: "Sales" } })).to.be.false;
        });
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

        test("returns undefined when the environment is missing or unknown", () => {
            expect(getFabricWorkspaceItemEnvironment(buildNode())).to.be.undefined;
            expect(getFabricWorkspaceItemEnvironment(buildNode({ fabricEnvironment: "nowhere" })))
                .to.be.undefined;
        });
    });
});
