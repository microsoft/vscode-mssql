/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Divider, makeStyles, mergeClasses, shorthands } from "@fluentui/react-components";
import { Database32Regular } from "@fluentui/react-icons";
import { useState } from "react";
import { ResizableBox } from "react-resizable";
import { ConnectionsListContainer } from "./connectionsListContainer";
import { ConnectionInfoFormContainer } from "./connectionPageContainer";
import { DialogPageShell } from "../../common/dialogPageShell";
import { ConnectButton } from "./components/connectButton.component";
import { locConstants } from "../../common/locConstants";
import { AdvancedOptionsDrawer } from "./components/advancedOptionsDrawer.component";
import { useConnectionDialogSelector } from "./connectionDialogSelector";

export const useStyles = makeStyles({
    root: {
        flexDirection: "row",
        display: "flex",
        height: "100%",
        width: "100%",
        maxWidth: "100%",
        maxHeight: "100%",
    },
    mainContainer: {
        ...shorthands.flex(1),
        height: "100%",
    },
    mruContainer: {
        position: "relative",
        height: "100%",
        width: "325px",
        padding: "20px",
        flexShrink: 0,
    },
    collapsedMruContainer: {
        paddingLeft: "4px",
        paddingRight: "4px",
    },
    mruPaneHandle: {
        position: "absolute",
        top: "0",
        left: "0",
        width: "10px",
        height: "100%",
        cursor: "ew-resize",
        zIndex: 1,
    },
});

export const ConnectionPage = () => {
    const classes = useStyles();
    const [isAdvancedDrawerOpen, setIsAdvancedDrawerOpen] = useState(false);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    const [sidebarWidth, setSidebarWidth] = useState(350);

    const isEditingConnection = useConnectionDialogSelector((s) => s.isEditingConnection);
    const editingConnectionDisplayName = useConnectionDialogSelector(
        (s) => s.editingConnectionDisplayName,
    );

    const title =
        isEditingConnection && editingConnectionDisplayName
            ? locConstants.connectionDialog.editDatabaseConnection(editingConnectionDisplayName)
            : locConstants.connectionDialog.connectToDatabase;

    return (
        <div className={classes.root}>
            <div className={classes.mainContainer}>
                <DialogPageShell
                    icon={<Database32Regular />}
                    title={title}
                    footerStart={
                        <Button
                            onClick={() => {
                                setIsAdvancedDrawerOpen((prev) => !prev);
                            }}>
                            {locConstants.connectionDialog.advancedSettings}
                        </Button>
                    }
                    maxContentWidth={"medium"}
                    footerEnd={<ConnectButton form="connectionForm" />}>
                    <ConnectionInfoFormContainer />
                    <AdvancedOptionsDrawer
                        isAdvancedDrawerOpen={isAdvancedDrawerOpen}
                        setIsAdvancedDrawerOpen={setIsAdvancedDrawerOpen}
                    />
                </DialogPageShell>
            </div>
            <Divider
                style={{
                    width: "5px",
                    height: "100%",
                    flex: 0,
                }}
                vertical
            />
            <ResizableBox
                className={mergeClasses(
                    classes.mruContainer,
                    isSidebarCollapsed && classes.collapsedMruContainer,
                )}
                width={isSidebarCollapsed ? 32 : sidebarWidth}
                height={Infinity}
                maxConstraints={[isSidebarCollapsed ? 32 : 800, Infinity]}
                minConstraints={[isSidebarCollapsed ? 32 : 300, Infinity]}
                resizeHandles={isSidebarCollapsed ? [] : ["w"]}
                onResizeStop={(_event, { size }) => setSidebarWidth(size.width)}
                handle={<div className={classes.mruPaneHandle} />}>
                <ConnectionsListContainer
                    isCollapsed={isSidebarCollapsed}
                    onToggleCollapsed={() => setIsSidebarCollapsed((prev) => !prev)}
                />
            </ResizableBox>
        </div>
    );
};
