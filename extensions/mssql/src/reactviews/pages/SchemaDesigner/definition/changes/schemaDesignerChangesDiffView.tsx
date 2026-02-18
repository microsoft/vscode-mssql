/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";
import { DiffEditor } from "@monaco-editor/react";
import { useVscodeWebview } from "../../../../common/vscodeWebviewProvider";
import { SchemaDesigner } from "../../../../../sharedInterfaces/schemaDesigner";
import { resolveVscodeThemeType } from "../../../../common/utils";
import { useSchemaDesignerDefinitionPanelContext } from "../schemaDesignerDefinitionPanelContext";

const useStyles = makeStyles({
    diffContainer: {
        flex: 1,
        minHeight: 0,
        height: "100%",
        width: "100%",
    },
});

export const SchemaDesignerChangesDiffView = () => {
    const classes = useStyles();
    const { baselineDefinition, code } = useSchemaDesignerDefinitionPanelContext();
    const { themeKind } = useVscodeWebview<
        SchemaDesigner.SchemaDesignerWebviewState,
        SchemaDesigner.SchemaDesignerReducers
    >();

    return (
        <div className={classes.diffContainer}>
            <DiffEditor
                height="100%"
                language="sql"
                original={baselineDefinition}
                modified={code}
                theme={resolveVscodeThemeType(themeKind)}
                options={{
                    readOnly: true,
                    renderSideBySide: true,
                    renderOverviewRuler: true,
                }}
            />
        </div>
    );
};
