/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import { TypedEventEmitter } from "../../common/eventEmitter";

export type SchemaDesignerToast = {
    title: string;
    body: string;
    intent?: "error" | "info" | "success" | "warning";
};

export type MyEvents = {
    getScript: () => void;
    openCodeDrawer: () => void;
    editTable: (
        table: SchemaDesigner.Table,
        schema: SchemaDesigner.Schema,
        showForeignKeys?: boolean,
    ) => void;
    newTable: (schema: SchemaDesigner.Schema) => void;
    onFindWidgetValueChange: (searchText: string) => void;
    /** Begin a logical transaction (used to group history pushes into one undo step) */
    beginTransaction: (reason?: string) => void;
    /** End a logical transaction */
    endTransaction: (reason?: string) => void;
    pushState: () => void;
    undo: () => void;
    redo: () => void;
    updateUndoRedoState: (undoEnabled: boolean, redoEnabled: boolean) => void;
    showToast: (toast: SchemaDesignerToast) => void;
};

const eventBus = new TypedEventEmitter<MyEvents>();
export default eventBus;
