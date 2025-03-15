/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Editor } from "@monaco-editor/react";
import { useContext } from "react";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { resolveVscodeThemeType } from "../../../common/utils";
import { makeStyles } from "@fluentui/react-components";

const useStyles = makeStyles({
    tablePanel: {
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        overflowX: "hidden",
        padding: "10px",
        gap: "10px",
    },
});

export function SchemaDesignerEditorCodePanel() {
    const classes = useStyles();
    const context = useContext(SchemaDesignerContext);
    if (!context) {
        return undefined;
    }
    return (
        <div className={classes.tablePanel}>
            <Editor
                height={"100%"}
                width={"100%"}
                language="sql"
                theme={resolveVscodeThemeType(context?.themeKind)}
                value={
                    context.script.scripts.find(
                        (s) => s.tableId === context.selectedTable.id,
                    )?.script
                }
                options={{
                    readOnly: true,
                }}
            ></Editor>
        </div>
    );
}
