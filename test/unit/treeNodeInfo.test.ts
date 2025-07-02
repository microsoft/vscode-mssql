/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { TreeNodeInfo } from "../../src/extension/objectExplorer/nodes/treeNodeInfo";

suite("TreeNodeInfo", () => {
    test("When creating multiple TreeNodeInfo in quick succession, the nodePath should be unique", () => {
        const node1 = new TreeNodeInfo(
            "node_label",
            undefined,
            undefined,
            "node_path",
            undefined,
            undefined,
            "session_id",
            undefined,
            undefined,
            undefined,
            undefined,
        );

        const node2 = new TreeNodeInfo(
            "node_label",
            undefined,
            undefined,
            "node_path",
            undefined,
            undefined,
            "session_id",
            undefined,
            undefined,
            undefined,
            undefined,
        );
        expect(node1.id).to.not.equal(node2.id, "Node IDs should be unique");
    });
});
