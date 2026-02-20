/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Tooltip } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import eventBus from "../schemaDesignerEvents";
import { useEffect, useState } from "react";
import { locConstants } from "../../../common/locConstants";

export function UndoRedoButtons() {
    const [isUndoEnabled, setIsUndoEnabled] = useState(false);
    const [isRedoEnabled, setIsRedoEnabled] = useState(false);
    useEffect(() => {
        const handleUpdateUndoRedoState = (undoEnabled: boolean, redoEnabled: boolean) => {
            setIsUndoEnabled(undoEnabled);
            setIsRedoEnabled(redoEnabled);
        };
        eventBus.on("updateUndoRedoState", handleUpdateUndoRedoState);
        return () => {
            eventBus.off("updateUndoRedoState", handleUpdateUndoRedoState);
        };
    }, []);
    return (
        <>
            <Tooltip content={locConstants.schemaDesigner.undo} relationship="label">
                <Button
                    appearance="subtle"
                    size="small"
                    icon={<FluentIcons.ArrowUndo16Regular />}
                    onClick={() => {
                        eventBus.emit("undo");
                    }}
                    disabled={!isUndoEnabled}>
                    {locConstants.schemaDesigner.undo}
                </Button>
            </Tooltip>
            <Tooltip content={locConstants.schemaDesigner.redo} relationship="label">
                <Button
                    appearance="subtle"
                    size="small"
                    icon={<FluentIcons.ArrowRedo16Regular />}
                    onClick={() => {
                        eventBus.emit("redo");
                    }}
                    disabled={!isRedoEnabled}>
                    {locConstants.schemaDesigner.redo}
                </Button>
            </Tooltip>
        </>
    );
}
