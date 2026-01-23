/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import { TypedEventEmitter } from "../../common/eventEmitter";

export type MyEvents = {
    getScript: () => void;
    openCodeDrawer: () => void;
    toggleChangesPanel: () => void;
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
};

const eventBus = new TypedEventEmitter<MyEvents>();
export default eventBus;
