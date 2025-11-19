/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles } from "@fluentui/react-components";
import { locConstants } from "../../../common/locConstants";
import { useContext } from "react";
import { SchemaDesignerEditorContext } from "./schemaDesignerEditorDrawer";
import eventBus from "../schemaDesignerEvents";

const useStyles = makeStyles({
    editorFooter: {
        display: "flex",
        flexDirection: "row",
        gap: "10px",
        borderTop: "1px solid var(--vscode-badge-background)",
        padding: "10px",
    },
});
export function SchemaDesignerEditorFooter() {
    const context = useContext(SchemaDesignerEditorContext);
    if (!context) {
        return undefined;
    }
    const classes = useStyles();
    const errorCount = () => {
        let errorCount = 0;
        for (const key in context.errors) {
            if (context.errors[key]) {
                errorCount++;
            }
        }
        return errorCount;
    };
    return (
        <div className={classes.editorFooter}>
            <Button
                appearance="primary"
                onClick={() => {
                    context.save();
                    eventBus.emit("getScript");
                }}
                disabled={errorCount() > 0}>
                {context.isNewTable
                    ? locConstants.schemaDesigner.add
                    : locConstants.schemaDesigner.save}
            </Button>
            <Button
                appearance="secondary"
                onClick={() => {
                    context.cancel();
                }}>
                {locConstants.schemaDesigner.cancel}
            </Button>
        </div>
    );
}
