/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback } from "react";
import { Edge, Node, ReactFlowJsonObject, ReactFlowInstance } from "@xyflow/react";
import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import eventBus from "./schemaDesignerEvents";
import { UndoRedoStack } from "../../common/undoRedoStack";

export const stateStack = new UndoRedoStack<
    ReactFlowJsonObject<Node<SchemaDesigner.Table>, Edge<SchemaDesigner.ForeignKey>>
>();

export const useOnPushUndoState = (
    reactFlow: ReactFlowInstance<Node<SchemaDesigner.Table>, Edge<SchemaDesigner.ForeignKey>>,
): (() => void) => {
    return useCallback(() => {
        const state = reactFlow.toObject() as ReactFlowJsonObject<
            Node<SchemaDesigner.Table>,
            Edge<SchemaDesigner.ForeignKey>
        >;
        stateStack.pushState(state);
        eventBus.emit("updateUndoRedoState", stateStack.canUndo(), stateStack.canRedo());
    }, [reactFlow]);
};
