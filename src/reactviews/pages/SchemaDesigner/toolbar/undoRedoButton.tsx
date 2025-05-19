/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import eventBus from "../schemaDesignerEvents";
import { useEffect, useState } from "react";

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
            <Button
                size="small"
                icon={<FluentIcons.ArrowUndo16Regular />}
                onClick={() => {
                    eventBus.emit("undo");
                }}
                disabled={!isUndoEnabled}
                title={"Undo"}
                appearance="subtle">
                {"Undo"}
            </Button>
            <Button
                size="small"
                icon={<FluentIcons.ArrowRedo16Regular />}
                onClick={() => {
                    eventBus.emit("redo");
                }}
                disabled={!isRedoEnabled}
                title={"Redo"}
                appearance="subtle">
                {"Redo"}
            </Button>
        </>
    );
}
