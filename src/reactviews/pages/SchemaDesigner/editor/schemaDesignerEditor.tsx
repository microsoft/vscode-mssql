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

    const tabWarningCount = (tab: SchemaDesignerEditorTab) =>
        Object.keys(context.warnings).filter((key) => {
            return key.includes(`${tab}_`) && context.warnings[key];
        }).length;

    if (!context.table) {
        return undefined;
    }

    const createTab = (tab: SchemaDesignerEditorTab) => {
        return (
            <Tab value={tab}>
                <div
                    style={{
                        display: "flex",
                        gap: "5px",
                        alignItems: "center",
                    }}>
                    {locConstants.schemaDesigner[tab]}
                    <CounterBadge
                        size="small"
                        count={tabErrorCount(tab)}
                        style={{
                            backgroundColor: "var(--vscode-inputValidation-errorBackground)",
                            color: "var(--vscode-problemsErrorIcon-foreground)",
                            border: "1px solid var(--vscode-inputValidation-errorBorder)",
                        }}
                        title={locConstants.schemaDesigner.nErrors(tabErrorCount(tab))}
                    />
                    <CounterBadge
                        size="small"
                        count={tabWarningCount(tab)}
                        style={{
                            backgroundColor: "var(--vscode-inputValidation-warningBackground)",
                            color: "var(--vscode-problemsWarningIcon-foreground)",
                            border: "1px solid var(--vscode-inputValidation-warningBorder)",
                        }}
                        title={locConstants.schemaDesigner.nWarnings(tabWarningCount(tab))}
                    />
                </div>
            </Tab>
        );
    };

    return (
        <div className={classes.editor}>
            <TabList
                selectedValue={context.selectedTabValue}
                onTabSelect={(_e, data) => context.setSelectedTabValue(data.value)}>
                {createTab(SchemaDesignerEditorTab.Table)}
                {createTab(SchemaDesignerEditorTab.ForeignKeys)}
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
