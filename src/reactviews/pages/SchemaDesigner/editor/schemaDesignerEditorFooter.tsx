/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles } from "@fluentui/react-components";
import { locConstants } from "../../../common/locConstants";
import { useContext } from "react";
import { SchemaDesignerEditorContext } from "./schemaDesignerEditorDrawer";
import eventBus from "../schemaDesignerUtils";

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
    return (
        <div className={classes.editorFooter}>
            <Button
                appearance="primary"
                onClick={() => {
                    context.save();
                    eventBus.emit("getScript");
                }}
                disabled={Object.keys(context.errors).length > 0}
            >
                {locConstants.schemaDesigner.save}
            </Button>
            <Button
                appearance="secondary"
                onClick={() => {
                    context.cancel();
                }}
            >
                {locConstants.schemaDesigner.cancel}
            </Button>
        </div>
    );
}
