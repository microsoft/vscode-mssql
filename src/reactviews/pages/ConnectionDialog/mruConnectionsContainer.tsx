/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Card,
    CardHeader,
    Text,
    Tree,
    TreeItem,
    TreeItemLayout,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import {
    ServerRegular,
    ArrowClockwise16Filled,
    Delete16Filled,
} from "@fluentui/react-icons";
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
        gap: "5px",
        display: "flex",
        flexDirection: "column",
        flexWrap: "wrap",
    },

    connectionContainer: {
        width: "100%",
        maxWidth: "100%",
        height: "fit-content",
        padding: "5px",
        margin: "0px",
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
    buttonContainer: {
        visibility: "visible",
    },
    "&:hover .buttonContainer": {
        visibility: "hidden",
    },
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
                    {locConstants.connectionDialog.savedConnections}
                </Text>
                <Button
                    icon={<ArrowClockwise16Filled />}
                    appearance="subtle"
                    onClick={context.refreshMruConnections}
                />
            </div>
            <div className={styles.main}>
                {// state may not be initialized yet due to async loading of context
                context.state?.savedConnections.map((connection, index) => {
                    return (
                        <Card
                            key={"saved" + index}
                            className={styles.connectionContainer}
                            appearance="subtle"
                            onClick={() => {
                                context.loadConnection(connection);
                            }}
                        >
                            <CardHeader
                                image={<ServerRegular />}
                                header={connection.displayName}
                                action={
                                    <div className={styles.buttonContainer}>
                                        <Button
                                            icon={<Delete16Filled />}
                                            appearance="subtle"
                                            onClick={(e) => {
                                                console.log(
                                                    `Remove connection: ${connection.displayName}`,
                                                );
                                                e.stopPropagation();
                                            }}
                                            title="Remove connection"
                                        />
                                    </div>
                                }
                            />
                        </Card>
                    );
                })}
            </div>
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
                            className={styles.connectionContainer}
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
