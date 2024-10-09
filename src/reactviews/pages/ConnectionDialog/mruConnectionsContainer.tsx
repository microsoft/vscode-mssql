/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Text,
    Tree,
    TreeItem,
    TreeItemLayout,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { ServerRegular, ArrowClockwise16Filled } from "@fluentui/react-icons";
import { useContext } from "react";
import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { locConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    paneTitle: {
        marginTop: "12px",
        marginBottom: "12px",
        marginRight: "12px",
    },
    main: {
        gap: "36px",
        display: "flex",
        flexDirection: "column",
        flexWrap: "wrap",
    },

    card: {
        width: "100%",
        maxWidth: "100%",
        height: "fit-content",
        marginBottom: "10px",
    },
    horizontalCardImage: {
        width: "50px",
        height: "30px",
        paddingRight: "0px",
    },
    caption: {
        color: tokens.colorNeutralForeground3,
    },

    text: { margin: "0" },
});

export const MruConnectionsContainer = () => {
    const styles = useStyles();
    const context = useContext(ConnectionDialogContext);

    if (context === undefined) {
        return undefined;
    }

    return (
        <div>
            <div className={styles.paneTitle}>
                <Text weight="semibold" className={styles.paneTitle}>
                    {locConstants.connectionDialog.recentConnections}
                </Text>
                <Button
                    icon={<ArrowClockwise16Filled />}
                    appearance="subtle"
                    onClick={context.refreshMruConnections}
                />
            </div>
            <Tree>
                {// state may not be initialized yet due to async loading of context
                context.state?.recentConnections.map((connection, index) => {
                    return (
                        <TreeItem
                            itemType="leaf"
                            key={"mru" + index}
                            className={styles.card}
                            onClick={() => {
                                context.loadConnection(connection);
                            }}
                        >
                            <TreeItemLayout iconBefore={<ServerRegular />}>
                                {connection.displayName}
                            </TreeItemLayout>
                        </TreeItem>
                    );
                })}
            </Tree>
        </div>
    );
};
