/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ToolbarButton } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import { useContext } from "react";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { Node, Edge, useReactFlow } from "@xyflow/react";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { flowUtils } from "../schemaDesignerUtils";

export function AutoArrangeButton() {
    const context = useContext(SchemaDesignerContext);
    const reactFlow = useReactFlow();
    if (!context) {
        return undefined;
    }
    return (
        <ToolbarButton
            icon={<FluentIcons.Flowchart16Filled />}
            onClick={() => {
                const nodes = reactFlow.getNodes() as Node<SchemaDesigner.Table>[];
                const schema = flowUtils.extractSchemaModel(
                    nodes,
                    reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[],
                );
                const generateComponenets = flowUtils.generateSchemaDesignerFlowComponents(schema);
                reactFlow.setNodes(generateComponenets.nodes);
                reactFlow.setEdges(generateComponenets.edges);
            }}
            title={locConstants.schemaDesigner.autoArrange}
            appearance="subtle">
            {locConstants.schemaDesigner.autoArrange}
        </ToolbarButton>
    );
}
