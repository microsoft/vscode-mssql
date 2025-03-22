/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles } from "@fluentui/react-components";
import { locConstants } from "../../../common/locConstants";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useContext } from "react";

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
    const context = useContext(SchemaDesignerContext);
    if (!context) {
        return undefined;
    }
    const classes = useStyles();
    return (
        <div className={classes.editorFooter}>
            <Button
                appearance="primary"
                onClick={() => {
                    if (context.schemaDesigner) {
                        context.schemaDesigner.updateActiveCellStateTable(
                            context.selectedTable,
                        );
                        context.getScript();
                    }
                    context.setIsEditDrawerOpen(false);
                }}
            >
                {locConstants.schemaDesigner.save}
            </Button>
            <Button
                appearance="secondary"
                onClick={() => {
                    context.setIsEditDrawerOpen(false);
                }}
            >
                {locConstants.schemaDesigner.cancel}
            </Button>
        </div>
    );
}
