/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import { useReactFlow } from "@xyflow/react";

export function DeleteNodesButton() {
    const reactflow = useReactFlow();
    return (
        <Button
            size="small"
            icon={<FluentIcons.Delete16Filled />}
            title={locConstants.schemaDesigner.delete}
            appearance="subtle"
            onClick={() => {
                const selectedNodes = reactflow
                    .getNodes()
                    .filter((node) => node.selected);
                if (selectedNodes.length > 0) {
                    void reactflow.deleteElements({
                        nodes: selectedNodes,
                    });
                } else {
                    const selectedEdges = reactflow
                        .getEdges()
                        .filter((edge) => edge.selected);
                    void reactflow.deleteElements({
                        nodes: [],
                        edges: selectedEdges,
                    });
                }
            }}
        >
            {locConstants.schemaDesigner.delete}
        </Button>
    );
}
