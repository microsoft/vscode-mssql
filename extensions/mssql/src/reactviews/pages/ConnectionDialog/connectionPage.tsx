/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Divider, makeStyles, shorthands } from "@fluentui/react-components";
import { DatabaseRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { ResizableBox } from "react-resizable";
import { ConnectionsListContainer } from "./connectionsListContainer";
import { ConnectionInfoFormContainer } from "./connectionPageContainer";
import { DialogPageShell } from "../../common/dialogPageShell";
import { ConnectButton } from "./components/connectButton.component";
import { locConstants } from "../../common/locConstants";
import { AdvancedOptionsDrawer } from "./components/advancedOptionsDrawer.component";

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

    return (
        <div className={classes.root}>
            <div className={classes.mainContainer}>
                <DialogPageShell
                    icon={<DatabaseRegular />}
                    title={locConstants.connectionDialog.connectToDatabase}
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
                className={classes.mruContainer}
                width={350}
                height={Infinity}
                maxConstraints={[800, Infinity]}
                minConstraints={[300, Infinity]}
                resizeHandles={["w"]}
                handle={<div className={classes.mruPaneHandle} />}>
                <ConnectionsListContainer />
            </ResizableBox>
        </div>
    );
};
