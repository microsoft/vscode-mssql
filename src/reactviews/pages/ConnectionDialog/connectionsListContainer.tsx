/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ArrowClockwise16Filled, Delete16Regular, ServerRegular } from "@fluentui/react-icons";
import {
    Button,
    Card,
    CardHeader,
    Slot,
    Text,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { MouseEventHandler, useContext, useEffect, useState } from "react";

import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { IConnectionDialogProfile } from "../../../sharedInterfaces/connectionDialog";
import { locConstants } from "../../common/locConstants";
import { Keys } from "../../common/keys";

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
        ":focus-within": {
            [`& .${buttonContainer}`]: {
                visibility: "visible",
            },
        },
        ":focus": {
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
            <div className={styles.paneTitle} id="saved-connections-heading">
                <Text weight="semibold" className={styles.paneTitle}>
                    {locConstants.connectionDialog.savedConnections}
                </Text>
                <Button
                    icon={<ArrowClockwise16Filled />}
                    appearance="subtle"
                    onClick={context.refreshConnectionsList}
                />
            </div>
            <div className={styles.main} role="region" aria-labelledby="saved-connections-heading">
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
                                tooltip: locConstants.connectionDialog.deleteSavedConnection,
                            }}
                        />
                    );
                })}
            </div>
            <div className={styles.paneTitle} id="recent-connections-heading">
                <Text weight="semibold" className={styles.paneTitle}>
                    {locConstants.connectionDialog.recentConnections}
                </Text>
                <Button
                    icon={<ArrowClockwise16Filled />}
                    appearance="subtle"
                    onClick={context.refreshConnectionsList}
                />
            </div>
            <div className={styles.main} role="region" aria-labelledby="recent-connections-heading">
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
                                tooltip: locConstants.connectionDialog.removeRecentConnection,
                            }}
                        />
                    );
                })}
            </div>
        </div>
    );
};

export const ConnectionCard = ({
    connection,
    actionButton,
}: {
    connection: IConnectionDialogProfile;
    actionButton?: {
        icon: Slot<"span">;
        onClick: MouseEventHandler;
        tooltip: string;
    };
}) => {
    const styles = useStyles();
    const context = useContext(ConnectionDialogContext);
    const [displayName, setDisplayName] = useState<string>(
        connection.profileName || connection.server,
    );

    // Fetch the display name asynchronously when the component mounts
    useEffect(() => {
        let isMounted = true;
        const loadDisplayName = async () => {
            if (context) {
                const name = await context.getConnectionDisplayName(connection);
                if (isMounted) {
                    setDisplayName(name);
                }
            }
        };

        void loadDisplayName();

        return () => {
            isMounted = false;
        };
    }, [context, connection]);

    if (context === undefined) {
        return undefined;
    }

    return (
        <Card
            className={styles.connectionContainer}
            appearance="subtle"
            tabIndex={0}
            onClick={() => {
                context.loadConnection(connection);
            }}
            onKeyDown={(e) => {
                if (e.key === Keys.Enter || e.key === Keys.Space) {
                    e.preventDefault();
                    context.loadConnection(connection);
                }
            }}
            title={locConstants.connectionDialog.connectTo(displayName)}
            aria-label={locConstants.connectionDialog.connectTo(displayName)}
            role="button"
            style={{ cursor: "pointer" }}>
            <CardHeader
                image={<ServerRegular fontSize={20} />}
                header={displayName}
                action={
                    actionButton && (
                        <div className={buttonContainer}>
                            <Button
                                icon={actionButton.icon}
                                appearance="subtle"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    actionButton.onClick(e);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === Keys.Enter || e.key === Keys.Space) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        actionButton.onClick(e as any);
                                    }
                                }}
                                title={actionButton.tooltip}
                                aria-label={`${actionButton.tooltip} for ${displayName}`}
                                tabIndex={0}
                            />
                        </div>
                    )
                }
            />
        </Card>
    );
};
