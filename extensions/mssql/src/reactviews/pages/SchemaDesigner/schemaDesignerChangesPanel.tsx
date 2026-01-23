/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useRef } from "react";
import { Button, makeStyles, Text } from "@fluentui/react-components";
import { Dismiss12Regular } from "@fluentui/react-icons";
import { ImperativePanelHandle, Panel } from "react-resizable-panels";
import eventBus from "./schemaDesignerEvents";
import { SchemaDesignerContext } from "./schemaDesignerStateProvider";
import { locConstants } from "../../common/locConstants";

const DEFAULT_PANEL_SIZE = 25;
const MIN_PANEL_SIZE = 10;

const useStyles = makeStyles({
    container: {
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--vscode-editor-background)",
        minHeight: 0,
    },
    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "4px 8px",
        borderBottom: "1px solid var(--vscode-editorWidget-border)",
    },
    list: {
        flex: 1,
        overflow: "auto",
        padding: "6px 10px",
        minHeight: 0,
    },
    empty: {
        padding: "10px",
        opacity: 0.8,
    },
    row: {
        padding: "4px 0px",
        borderBottom: "1px solid var(--vscode-sideBarSectionHeader-border)",
    },
});

export const SchemaDesignerChangesPanel = () => {
    const context = useContext(SchemaDesignerContext);
    const classes = useStyles();
    const panelRef = useRef<ImperativePanelHandle | undefined>(undefined);

    useEffect(() => {
        // Ensure panel starts collapsed
        panelRef.current?.collapse();

        const toggle = () => {
            if (!panelRef.current) {
                return;
            }

            if (panelRef.current.isCollapsed()) {
                panelRef.current.expand(DEFAULT_PANEL_SIZE);
            } else {
                panelRef.current.collapse();
            }
        };

        eventBus.on("toggleChangesPanel", toggle);
        return () => {
            eventBus.off("toggleChangesPanel", toggle);
        };
    }, []);

    return (
        <Panel
            collapsible
            defaultSize={DEFAULT_PANEL_SIZE}
            minSize={MIN_PANEL_SIZE}
            ref={(ref) => {
                panelRef.current = ref ?? undefined;
            }}>
            <div className={classes.container}>
                <div className={classes.header}>
                    <Text weight="semibold">
                        {locConstants.schemaDesigner.changesPanelTitle(context.schemaChangesCount)}
                    </Text>
                    <Button
                        size="small"
                        appearance="subtle"
                        icon={<Dismiss12Regular />}
                        title={locConstants.schemaDesigner.close}
                        aria-label={locConstants.schemaDesigner.close}
                        onClick={() => panelRef.current?.collapse()}
                    />
                </div>

                {context.schemaChanges.length === 0 ? (
                    <div className={classes.empty}>{locConstants.schemaDesigner.noChangesYet}</div>
                ) : (
                    <div className={classes.list}>
                        {context.schemaChanges.map((line) => (
                            <div key={line} className={classes.row}>
                                {line}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Panel>
    );
};
