/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CounterBadge,
    makeStyles,
    Tab,
    TabList,
    TabValue,
} from "@fluentui/react-components";
import { useContext, useEffect, useState } from "react";
import { locConstants } from "../../../common/locConstants";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { SchemaDesignerEditorFooter } from "./schemaDesignerEditorFooter";
import { SchemaDesignerEditorTablePanel } from "./schemaDesignerEditorTablePanel";
import { SchemaDesignerEditorForeignKeyPanel } from "./schemaDesignerEditorForeignKeyPanel";

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

    const context = useContext(SchemaDesignerContext);
    if (!context) {
        return undefined;
    }

    const [selectedTabValue, setSelectedTabValue] = useState<TabValue>("table");
    const [tablePanelErrorCount, setTablePanelErrorCount] = useState(0);
    const [foreignKeyPanelErrorCount, setForeignKeyPanelErrorCount] =
        useState(0);

    useEffect(() => {
        setSelectedTabValue("table");
    }, [context.isEditDrawerOpen]);

    if (!context.selectedTable || !context.schemaDesigner?.schema) {
        return undefined;
    }

    return (
        <div className={classes.editor}>
            <TabList
                selectedValue={selectedTabValue}
                onTabSelect={(_e, data) => setSelectedTabValue(data.value)}
            >
                <Tab value="table">
                    {locConstants.schemaDesigner.table}
                    <CounterBadge
                        size="small"
                        count={tablePanelErrorCount}
                        color="danger"
                    />
                </Tab>
                <Tab value="foreignKeys">
                    {locConstants.schemaDesigner.foreignKeys}
                    <CounterBadge
                        size="small"
                        count={foreignKeyPanelErrorCount}
                        color="danger"
                    />
                </Tab>
            </TabList>
            <div className={classes.editorPanel}>
                {selectedTabValue === "table" && (
                    <SchemaDesignerEditorTablePanel
                        setErrorCount={setTablePanelErrorCount}
                    />
                )}
                {selectedTabValue === "foreignKeys" && (
                    <SchemaDesignerEditorForeignKeyPanel
                        setErrorCount={setForeignKeyPanelErrorCount}
                    />
                )}
            </div>
            <SchemaDesignerEditorFooter
                errorCount={tablePanelErrorCount + foreignKeyPanelErrorCount}
            />
        </div>
    );
};
