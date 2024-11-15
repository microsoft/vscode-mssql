/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ArrowClockwise16Filled,
    Delete16Regular,
    ServerRegular,
} from "@fluentui/react-icons";
import {
    Button,
    Card,
    CardHeader,
    Slot,
    Text,
    Tree,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { MouseEventHandler, useContext } from "react";

import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { IConnectionDialogProfile } from "../../../sharedInterfaces/connectionDialog";
import { locConstants } from "../../common/locConstants";

const buttonContainer = "buttonContainer";

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
        [`& .${buttonContainer}`]: {
            visibility: "hidden",
        },
        ":hover": {
            [`& .${buttonContainer}`]: {
                visibility: "visible",
            },
        },
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

export const ConnectionsListContainer = () => {
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
                    onClick={context.refreshConnectionsList}
                />
            </div>
            <div className={styles.main}>
                {// state may not be initialized yet due to async loading of context
                context.state?.savedConnections.map((connection, index) => {
                    return (
                        <ConnectionCard
                            connection={connection}
                            key={"saved" + index}
                            actionButton={{
                                icon: <Delete16Regular />,
                                onClick: (e) => {
                                    context.deleteSavedConnection(connection);
                                    e.stopPropagation();
                                },
                                tooltip:
                                    locConstants.connectionDialog
                                        .deleteSavedConnection,
                            }}
                        />
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
                    onClick={context.refreshConnectionsList}
                />
            </div>
            <Tree>
                {// state may not be initialized yet due to async loading of context
                context.state?.recentConnections.map((connection, index) => {
                    return (
                        <ConnectionCard
                            connection={connection}
                            key={"mru" + index}
                            actionButton={{
                                icon: <Delete16Regular />,
                                onClick: (e) => {
                                    context.removeRecentConnection(connection);
                                    e.stopPropagation();
                                },
                                tooltip:
                                    locConstants.connectionDialog
                                        .removeRecentConnection,
                            }}
                        />
                    );
                })}
            </Tree>
        </div>
    );
};

export const ConnectionCard = ({
    connection,
    key,
    actionButton,
}: {
    connection: IConnectionDialogProfile;
    key?: string;
    actionButton?: {
        icon: Slot<"span">;
        onClick: MouseEventHandler;
        tooltip: string;
    };
}) => {
    const styles = useStyles();
    const context = useContext(ConnectionDialogContext);

    if (context === undefined) {
        return undefined;
    }

    return (
        <Card
            key={key}
            className={styles.connectionContainer}
            appearance="subtle"
            onClick={() => {
                context.loadConnection(connection);
            }}
        >
            <CardHeader
                image={<ServerRegular fontSize={20} />}
                header={connection.displayName}
                action={
                    actionButton && (
                        <div className={buttonContainer}>
                            <Button
                                icon={actionButton.icon}
                                appearance="subtle"
                                onClick={actionButton.onClick}
                                title={actionButton.tooltip}
                            />
                        </div>
                    )
                }
            />
        </Card>
    );
};
