/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, ToolbarButton, Tooltip } from "@fluentui/react-components";
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
                <ToolbarButton
                    appearance="subtle"
                    icon={<FluentIcons.ArrowUndo20Regular />}
                    onClick={() => {
                        eventBus.emit("undo");
                    }}
                    disabled={!isUndoEnabled}
                />
            </Tooltip>
            <Tooltip content={locConstants.schemaDesigner.redo} relationship="label">
                <ToolbarButton
                    appearance="subtle"
                    icon={<FluentIcons.ArrowRedo20Regular />}
                    onClick={() => {
                        eventBus.emit("redo");
                    }}
                    disabled={!isRedoEnabled}
                />
            </Tooltip>
        </>
    );
}
