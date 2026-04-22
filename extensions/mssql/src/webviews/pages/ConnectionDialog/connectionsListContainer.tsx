/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ArrowClockwise16Filled,
    Copy16Regular,
    Delete16Regular,
    Dismiss16Regular,
    ServerRegular,
} from "@fluentui/react-icons";
import {
    Button,
    Card,
    CardHeader,
    Slot,
    Text,
    Tooltip,
    Tree,
    makeStyles,
    tokens,
    Image,
} from "@fluentui/react-components";
import { MouseEventHandler, useContext, useEffect, useState } from "react";

import { ConnectionDialogContext } from "./connectionDialogStateProvider";
import { useConnectionDialogSelector } from "./connectionDialogSelector";
import { getConnectionCardKey } from "./connectionCardUtils";
import {
    ConnectionDialogReducers,
    ConnectionDialogWebviewState,
    IConnectionDialogProfile,
} from "../../../sharedInterfaces/connectionDialog";
import { locConstants } from "../../common/locConstants";
import { KeyCode } from "../../common/keys";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { ExecuteCommandRequest } from "../../../sharedInterfaces/webview";

const buttonContainer = "buttonContainer";

const useStyles = makeStyles({
    container: {
        height: "100%",
        display: "flex",
        flexDirection: "column",
    },
    listScrollArea: {
        flex: "1 1 auto",
        overflowY: "auto",
        paddingRight: "4px",
    },
    paneTitle: {
        marginTop: "8px",
        marginBottom: "4px",
        marginRight: "12px",
    },
    main: {
        gap: "2px",
        display: "flex",
        flexDirection: "column",
        flexWrap: "wrap",
    },

    connectionContainer: {
        width: "100%",
        maxWidth: "100%",
        height: "fit-content",
        padding: "2px 5px",
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
    adsMigrationContainer: {
        marginTop: "4px",
        marginBottom: "8px",
    },
    adsMigrationButton: {
        width: "100%",
        justifyContent: "flex-start",
        paddingTop: "8px",
        paddingBottom: "8px",
    },
    adsMigrationIcon: {
        width: "32px",
        height: "32px",
    },
});

const azureDataStudioIcon = require("../../media/azureDataStudio.svg");

export const ConnectionsListContainer = () => {
    const styles = useStyles();
    const context = useContext(ConnectionDialogContext);
    const savedConnections = useConnectionDialogSelector((s) => s.savedConnections) ?? [];
    const recentConnections = useConnectionDialogSelector((s) => s.recentConnections) ?? [];
    const { extensionRpc } = useVscodeWebview<
        ConnectionDialogWebviewState,
        ConnectionDialogReducers
    >();
    const hasRecentConnections = recentConnections.length > 0;

    if (context === undefined) {
        return undefined;
    }

    return (
        <div className={styles.container}>
            <div className={styles.adsMigrationContainer}>
                <Button
                    className={styles.adsMigrationButton}
                    appearance="secondary"
                    icon={
                        <Image
                            className={styles.adsMigrationIcon}
                            src={azureDataStudioIcon}
                            alt={locConstants.connectionDialog.importFromAzureDataStudio}
                        />
                    }
                    onClick={async () => {
                        await extensionRpc.sendRequest(ExecuteCommandRequest.type, {
                            command: "mssql.openAzureDataStudioMigration",
                        });
                    }}>
                    {locConstants.connectionDialog.importFromAzureDataStudio}
                </Button>
            </div>
            <div className={styles.listScrollArea}>
                {hasRecentConnections && (
                    <>
                        <div className={styles.paneTitle}>
                            <Text weight="semibold" className={styles.paneTitle}>
                                {locConstants.connectionDialog.recentConnections}
                            </Text>
                            <Button
                                icon={<ArrowClockwise16Filled />}
                                appearance="subtle"
                                onClick={context.refreshConnectionsList}
                                title={locConstants.common.refresh}
                            />
                        </div>
                        <Tree>
                            {recentConnections.map((connection, _index) => {
                                return (
                                    <ConnectionCard
                                        connection={connection}
                                        key={getConnectionCardKey(connection)}
                                        onSelect={() =>
                                            context.loadConnectionAsNewDraft(connection)
                                        }
                                        actionButtons={[
                                            {
                                                icon: <Copy16Regular />,
                                                onClick: (e) => {
                                                    context.loadConnectionAsNewDraft(connection);
                                                    e.stopPropagation();
                                                },
                                                tooltip: (displayName) =>
                                                    locConstants.connectionDialog.createCopiedConnection(
                                                        displayName,
                                                    ),
                                            },
                                            {
                                                icon: <Dismiss16Regular />,
                                                onClick: (e) => {
                                                    context.removeRecentConnection(connection);
                                                    e.stopPropagation();
                                                },
                                                tooltip: () =>
                                                    locConstants.connectionDialog
                                                        .removeRecentConnection,
                                            },
                                        ]}
                                        primaryActionTooltip={(displayName) =>
                                            locConstants.connectionDialog.createCopiedConnection(
                                                displayName,
                                            )
                                        }
                                    />
                                );
                            })}
                        </Tree>
                    </>
                )}
                <div className={styles.paneTitle}>
                    <Text weight="semibold" className={styles.paneTitle}>
                        {locConstants.connectionDialog.savedConnections}
                    </Text>
                    <Button
                        icon={<ArrowClockwise16Filled />}
                        appearance="subtle"
                        onClick={context.refreshConnectionsList}
                        title={locConstants.common.refresh}
                    />
                </div>
                <div className={styles.main}>
                    {savedConnections.map((connection, _index) => {
                        return (
                            <ConnectionCard
                                connection={connection}
                                key={getConnectionCardKey(connection)}
                                onSelect={() => context.loadConnectionForEdit(connection)}
                                actionButtons={[
                                    {
                                        icon: <Copy16Regular />,
                                        onClick: (e) => {
                                            context.loadConnectionAsNewDraft(connection);
                                            e.stopPropagation();
                                        },
                                        tooltip: (displayName) =>
                                            locConstants.connectionDialog.createCopiedConnection(
                                                displayName,
                                            ),
                                    },
                                    {
                                        icon: <Delete16Regular />,
                                        onClick: (e) => {
                                            context.deleteSavedConnection(connection);
                                            e.stopPropagation();
                                        },
                                        tooltip: () =>
                                            locConstants.connectionDialog.deleteSavedConnection,
                                    },
                                ]}
                                primaryActionTooltip={(displayName) =>
                                    locConstants.connectionDialog.editConnection(displayName)
                                }
                            />
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export const ConnectionCard = ({
    connection,
    onSelect,
    actionButtons,
    primaryActionTooltip,
}: {
    connection: IConnectionDialogProfile;
    onSelect: () => void;
    actionButtons?: {
        icon: Slot<"span">;
        onClick: MouseEventHandler;
        tooltip: (displayName: string) => string;
    }[];
    primaryActionTooltip: (displayName: string) => string;
}) => {
    const styles = useStyles();
    const context = useContext(ConnectionDialogContext);
    const [displayName, setDisplayName] = useState<string>(
        connection.profileName || connection.server,
    );

    // Refresh the display name whenever the rendered connection identity changes.
    useEffect(() => {
        let isMounted = true;
        setDisplayName(connection.profileName || connection.server);

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
    }, [
        context,
        connection.id,
        connection.server,
        connection.database,
        connection.authenticationType,
        connection.profileName,
        connection.user,
    ]);

    if (context === undefined) {
        return undefined;
    }

    const cardTooltip = primaryActionTooltip(displayName);

    return (
        <Tooltip content={cardTooltip} relationship="label">
            <Card
                className={styles.connectionContainer}
                appearance="subtle"
                size="small"
                tabIndex={0}
                onClick={() => {
                    onSelect();
                }}
                onKeyDown={(e) => {
                    if (e.code === KeyCode.Enter || e.code === KeyCode.Space) {
                        e.preventDefault();
                        onSelect();
                    }
                }}
                title={cardTooltip}
                role="button"
                style={{ cursor: "pointer" }}>
                <CardHeader
                    image={<ServerRegular fontSize={20} />}
                    header={displayName}
                    action={
                        actionButtons && actionButtons.length > 0 ? (
                            <div className={buttonContainer}>
                                {actionButtons.map((actionButton, index) => {
                                    const tooltipText = actionButton.tooltip(displayName);

                                    return (
                                        <Tooltip
                                            key={index}
                                            content={tooltipText}
                                            relationship="label">
                                            <Button
                                                icon={actionButton.icon}
                                                appearance="subtle"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    actionButton.onClick(e);
                                                }}
                                                onKeyDown={(e) => {
                                                    if (
                                                        e.code === KeyCode.Enter ||
                                                        e.code === KeyCode.Space
                                                    ) {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                                        actionButton.onClick(e as any);
                                                    }
                                                }}
                                                aria-label={tooltipText}
                                                tabIndex={0}
                                            />
                                        </Tooltip>
                                    );
                                })}
                            </div>
                        ) : undefined
                    }
                />
            </Card>
        </Tooltip>
    );
};
