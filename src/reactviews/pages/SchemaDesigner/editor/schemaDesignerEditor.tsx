/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CounterBadge, makeStyles, Tab, TabList } from "@fluentui/react-components";
import { useContext } from "react";
import { locConstants } from "../../../common/locConstants";
import { SchemaDesignerEditorFooter } from "./schemaDesignerEditorFooter";
import { SchemaDesignerEditorTablePanel } from "./schemaDesignerEditorTablePanel";
import { SchemaDesignerEditorForeignKeyPanel } from "./schemaDesignerEditorForeignKeyPanel";
import { SchemaDesignerEditorContext, SchemaDesignerEditorTab } from "./schemaDesignerEditorDrawer";

const useStyles = makeStyles({
    editor: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
    },
    editorPanel: {
        flex: "1",
        overflow: "hidden",
    },
    tablePanel: {
        display: "flex",
        flexDirection: "column",
        padding: "5px 0px",
        gap: "5px",
        overflow: "hidden",
        maxHeight: "calc(100% - 10px)",
    },
    tablePanelRow: {
        display: "flex",
        flexDirection: "row",
        flex: "1",
        gap: "5px",
        padding: "0px 5px",
    },
    dataTypeDropdown: {
        minWidth: "110px",
        maxWidth: "110px",
        "> button": {
            textOverflow: "ellipsis",
        },
    },
    foreignKeyContainer: {
        display: "flex",
        flexDirection: "column",
        gap: "5px",
        padding: "5px",
        borderTop: "1px solid",
    },
});

export const SchemaDesignerEditor = () => {
    const classes = useStyles();

    const context = useContext(SchemaDesignerEditorContext);
    if (!context) {
        return undefined;
    }

    const tabErrorCount = (tab: SchemaDesignerEditorTab) =>
        Object.keys(context.errors).filter((key) => {
            return key.includes(`${tab}_`) && context.errors[key];
        }).length;

    if (!context.table) {
        return undefined;
    }

    return (
        <div className={classes.editor}>
            <TabList
                selectedValue={context.selectedTabValue}
                onTabSelect={(_e, data) => context.setSelectedTabValue(data.value)}>
                <Tab value={SchemaDesignerEditorTab.Table}>
                    {locConstants.schemaDesigner.table}
                    <CounterBadge
                        size="small"
                        count={tabErrorCount(SchemaDesignerEditorTab.Table)}
                        color="danger"
                    />
                </Tab>
                <Tab value={SchemaDesignerEditorTab.ForeignKeys}>
                    {locConstants.schemaDesigner.foreignKeys}
                    <CounterBadge
                        size="small"
                        count={tabErrorCount(SchemaDesignerEditorTab.ForeignKeys)}
                        color="danger"
                    />
                </Tab>
            </TabList>
            <div className={classes.editorPanel}>
                {context.selectedTabValue === SchemaDesignerEditorTab.Table && (
                    <SchemaDesignerEditorTablePanel />
                )}
                {context.selectedTabValue === SchemaDesignerEditorTab.ForeignKeys && (
                    <SchemaDesignerEditorForeignKeyPanel />
                )}
            </div>
            <SchemaDesignerEditorFooter />
        </div>
    );
};
