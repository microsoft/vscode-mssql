/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    DialogTrigger,
    ToolbarButton,
    Tooltip,
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import { useContext } from "react";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { Node, Edge, useReactFlow } from "@xyflow/react";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { flowUtils } from "../schemaDesignerUtils";
import eventBus from "../schemaDesignerEvents";

export function AutoArrangeButton() {
    const context = useContext(SchemaDesignerContext);
    const reactFlow = useReactFlow();

    const autoArrange = () => {
        eventBus.emit("pushState");
        const nodes = reactFlow.getNodes() as Node<SchemaDesigner.Table>[];
        const edges = reactFlow.getEdges() as Edge<SchemaDesigner.ForeignKey>[];
        const generateComponenets = flowUtils.generatePositions(nodes, edges);
        reactFlow.setNodes(generateComponenets.nodes);
        reactFlow.setEdges(generateComponenets.edges);
        context.resetView();
    };
    if (!context) {
        return undefined;
    }
    return (
        <Dialog>
            <DialogTrigger>
                <Tooltip content={locConstants.schemaDesigner.autoArrange} relationship="label">
                    <ToolbarButton appearance="subtle" icon={<FluentIcons.Flowchart20Regular />} />
                </Tooltip>
            </DialogTrigger>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>{locConstants.schemaDesigner.autoArrangeConfirmation}</DialogTitle>
                    <DialogContent>
                        {locConstants.schemaDesigner.autoArrangeConfirmationContent}
                    </DialogContent>
                    <DialogActions>
                        <DialogTrigger>
                            <Button appearance="primary" onClick={() => autoArrange()}>
                                {locConstants.schemaDesigner.autoArrange}
                            </Button>
                        </DialogTrigger>
                        <DialogTrigger>
                            <Button appearance="secondary" onClick={() => {}}>
                                {locConstants.schemaDesigner.cancel}
                            </Button>
                        </DialogTrigger>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}
