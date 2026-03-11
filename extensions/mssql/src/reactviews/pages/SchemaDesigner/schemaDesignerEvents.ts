/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import { TypedEventEmitter } from "../../common/eventEmitter";

export type MyEvents = {
    refreshFlowState: () => void;
    revealForeignKeyEdges: (foreignKeyId: string) => void;
    clearEdgeSelection: () => void;
    editTable: (
        table: SchemaDesigner.Table,
        schema: SchemaDesigner.Schema,
        showForeignKeys?: boolean,
    ) => void;
    newTable: (schema: SchemaDesigner.Schema) => void;
    onFindWidgetValueChange: (searchText: string) => void;
    pushState: () => void;
    undo: () => void;
    redo: () => void;
    updateUndoRedoState: (undoEnabled: boolean, redoEnabled: boolean) => void;
    /**
     * Emitted when the user manually edits entities (tables, columns, foreign keys)
     * through the editor drawer. Carries the set of entity IDs that were modified.
     * Used by CopilotChangesProvider to auto-remove copilot-tracked changes for
     * entities the user has taken ownership of.
     */
    userEditedEntities: (entityIds: Set<string>) => void;
};

const eventBus = new TypedEventEmitter<MyEvents>();
export default eventBus;
