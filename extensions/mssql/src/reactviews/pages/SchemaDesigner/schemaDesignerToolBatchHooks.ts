/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Edge, Node, ReactFlowInstance } from "@xyflow/react";
import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import { useMaybeAutoArrangeForToolBatch } from "./schemaDesignerToolBatchUtils";
import { useOnPushUndoState } from "./schemaDesignerUndoState";

export const useSchemaDesignerToolBatchHandlers = ({
    reactFlow,
    resetView,
}: {
    reactFlow: ReactFlowInstance<Node<SchemaDesigner.Table>, Edge<SchemaDesigner.ForeignKey>>;
    resetView: () => void;
}): {
    onPushUndoState: () => void;
    maybeAutoArrangeForToolBatch: (preTableCount: number, postTableCount: number) => Promise<void>;
} => {
    const onPushUndoState = useOnPushUndoState(reactFlow);
    const maybeAutoArrangeForToolBatch = useMaybeAutoArrangeForToolBatch({
        reactFlow,
        resetView,
        onPushUndoState,
    });

    return { onPushUndoState, maybeAutoArrangeForToolBatch };
};
