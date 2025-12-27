/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Body1,
    Button,
    Checkbox,
    Input,
    Label,
    Subtitle2,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Text,
    Title3,
    Tooltip,
    makeStyles,
    shorthands,
} from "@fluentui/react-components";
import {
    CheckmarkCircle16Filled,
    ChevronDownRegular,
    ChevronRightRegular,
    EyeOffRegular,
    EyeRegular,
    FolderOpenRegular,
    PresenceAvailableRegular,
    Warning16Regular,
} from "@fluentui/react-icons";
import { CSSProperties, useEffect, useMemo, useState } from "react";

import {
    AdsMigrationConnection,
    AdsMigrationConnectionGroup,
    AzureDataStudioMigrationBrowseForConfigRequest,
    AzureDataStudioMigrationReducers,
    AzureDataStudioMigrationWebviewState,
} from "../../../sharedInterfaces/azureDataStudioMigration";
import { AuthenticationType } from "../../../sharedInterfaces/connectionDialog";
import { useAzureDataStudioMigrationSelector } from "./azureDataStudioMigrationSelector";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { locConstants as Loc } from "../../common/locConstants";
import { EntraSignInDialog } from "./components/entraSignInDialog";

export const AzureDataStudioMigrationPage = () => {
    const LocMigration = Loc.azureDataStudioMigration;

    const classes = useStyles();
    const { extensionRpc } = useVscodeWebview2<
        AzureDataStudioMigrationWebviewState,
        AzureDataStudioMigrationReducers
    >();
    const state = useAzureDataStudioMigrationSelector((s) => s);

    const [configPath, setConfigPath] = useState(state.adsConfigPath ?? "");
    const [connectionGroups, setConnectionGroups] = useState<AdsMigrationConnectionGroup[]>(
        state.connectionGroups ?? [],
    );
    const [connections, setConnections] = useState<AdsMigrationConnection[]>(
        state.connections ?? [],
    );
    const [groupsCollapsed, setGroupsCollapsed] = useState(false);
    const [connectionsCollapsed, setConnectionsCollapsed] = useState(false);
    const [dialog, setDialog] = useState(state.dialog);
    const [passwordVisibility, setPasswordVisibility] = useState<Record<string, boolean>>({});

    useEffect(() => {
        setConfigPath(state.adsConfigPath ?? "");
    }, [state.adsConfigPath]);

    useEffect(() => {
        setConnectionGroups(state.connectionGroups ?? []);
    }, [state.connectionGroups]);

    useEffect(() => {
        setConnections(state.connections ?? []);
        setPasswordVisibility({});
    }, [state.connections]);

    useEffect(() => {
        setDialog(state.dialog);
    }, [state.dialog]);

    const groupSelection = useMemo(() => {
        const total = connectionGroups.length;
        const selected = connectionGroups.filter((group) => group.selected).length;
        return { total, selected };
    }, [connectionGroups]);

    const connectionSelection = useMemo(() => {
        const total = connections.length;
        const selected = connections.filter((connection) => connection.selected).length;
        return { total, selected };
    }, [connections]);

    const computeHeaderState = (selected: number, total: number): boolean | "mixed" => {
        if (total === 0 || selected === 0) {
            return false;
        }
        if (selected === total) {
            return true;
        }
        return "mixed";
    };

    const groupHeaderState = computeHeaderState(groupSelection.selected, groupSelection.total);
    const connectionHeaderState = computeHeaderState(
        connectionSelection.selected,
        connectionSelection.total,
    );

    const toggleConnectionGroup = (groupId: string, checked: boolean) => {
        extensionRpc.action("setConnectionGroupSelections", { groupId, selected: checked });
    };

    const toggleAllGroups = (checked: boolean) => {
        extensionRpc.action("setConnectionGroupSelections", { selected: checked });
    };

    const toggleConnection = (connectionId: string, checked: boolean) => {
        const targetConnection = connections.find(
            (connection) => getConnectionId(connection) === connectionId,
        );
        const connectionProfileId = targetConnection?.profile.id ?? connectionId;
        extensionRpc.action("setConnectionSelections", {
            connectionId: connectionProfileId,
            selected: checked,
        });
    };

    const toggleAllConnections = (checked: boolean) => {
        extensionRpc.action("setConnectionSelections", { selected: checked });
    };

    const handleBrowseForConfig = async () => {
        const result = await extensionRpc.sendRequest(
            AzureDataStudioMigrationBrowseForConfigRequest.type,
            undefined,
        );
        if (result) {
            setConfigPath(result);
        }
    };

    const getConnectionId = (connection: AdsMigrationConnection) =>
        connection.profile.id ||
        connection.profile.profileName ||
        `${connection.profile.server}-${connection.profile.database}-${connection.profile.user}`;

    const renderStatusIcon = (
        status: "ready" | "needsAttention" | "alreadyImported",
        tooltip: string,
    ) => {
        let icon: React.JSX.Element;
        let color = "";
        switch (status) {
            case "alreadyImported":
                icon = <CheckmarkCircle16Filled />;
                color = "var(--vscode-testing-iconPassed)";
                break;
            case "ready":
                icon = <PresenceAvailableRegular />;
                color = "var(--vscode-testing-iconPassed)";
                break;
            default:
                icon = <Warning16Regular />;
                color = "var(--vscode-testing-iconErrored)";
                break;
        }

        return (
            <Tooltip content={tooltip} relationship="label">
                <span className={classes.statusIconOnly} style={{ color }}>
                    {icon}
                </span>
            </Tooltip>
        );
    };

    const renderGroupStatusIcon = (
        status: AdsMigrationConnectionGroup["status"],
        tooltip: string,
    ) => {
        return renderStatusIcon(status, tooltip);
    };

    const renderConnectionStatusIcon = (
        status: AdsMigrationConnection["status"],
        tooltip: string,
    ) => renderStatusIcon(status, tooltip);

    const renderTruncatedCell = (
        rawValue: string,
        options?: {
            allowBlank?: boolean;
            emptyTooltip?: string;
            emptyDisplay?: string;
            maxWidth?: number;
        },
    ) => {
        const value = rawValue ?? "";
        const content =
            value ||
            (options?.allowBlank
                ? ""
                : options?.emptyDisplay !== undefined
                  ? options.emptyDisplay
                  : "-");

        const tooltip =
            value ||
            options?.emptyTooltip ||
            options?.emptyDisplay ||
            LocMigration.connectionValueMissing;

        const style: CSSProperties = { width: "100%" };
        if (options?.maxWidth) {
            style.maxWidth = `${options.maxWidth}px`;
        }
        return (
            <Tooltip content={tooltip} relationship="description">
                <span className={classes.truncatedCell} style={style}>
                    {content || "\u00A0"}
                </span>
            </Tooltip>
        );
    };

    const handleEnterPassword = (connectionId: string, value: string) => {
        setConnections((prev) =>
            prev.map((connection) => {
                const currentId = getConnectionId(connection);
                if (currentId === connectionId) {
                    return {
                        ...connection,
                        profile: {
                            ...connection.profile,
                            password: value,
                        },
                    };
                }
                return connection;
            }),
        );

        extensionRpc.action("enterSqlPassword", { connectionId, password: value });
    };

    const togglePasswordVisibility = (connectionId: string) => {
        setPasswordVisibility((prev) => ({
            ...prev,
            [connectionId]: !prev[connectionId],
        }));
    };

    const handleEntraSignIn = (connectionId: string) => {
        extensionRpc.action("openEntraSignInDialog", { connectionId });
    };

    const handleCloseDialog = () => {
        extensionRpc.action("closeDialog");
    };

    const handleSignInDialogSubmit = (connectionId: string) => {
        extensionRpc.action("signIntoEntraAccount", { connectionId });
    };

    const handleSelectAccount = (connectionId: string, accountId: string, tenantId: string) => {
        extensionRpc.action("selectAccount", { connectionId, accountId, tenantId });
    };

    const renderAuthenticationCell = (connection: AdsMigrationConnection, connectionId: string) => {
        if (connection.profile.authenticationType === AuthenticationType.Integrated) {
            return undefined;
        }

        return (
            <Tooltip content={connection.statusMessage} relationship="label">
                <div>
                    {connection.profile.authenticationType === AuthenticationType.SqlLogin && (
                        <Input
                            type={passwordVisibility[connectionId] ? "text" : "password"}
                            value={connection.profile.password ?? ""}
                            onChange={(_, data) => handleEnterPassword(connectionId, data.value)}
                            placeholder={LocMigration.enterPassword}
                            contentAfter={
                                <Button
                                    appearance="transparent"
                                    size="small"
                                    icon={
                                        passwordVisibility[connectionId] ? (
                                            <EyeOffRegular />
                                        ) : (
                                            <EyeRegular />
                                        )
                                    }
                                    title={
                                        passwordVisibility[connectionId]
                                            ? Loc.common.hidePassword
                                            : Loc.common.showPassword
                                    }
                                    aria-label={
                                        passwordVisibility[connectionId]
                                            ? Loc.common.hidePassword
                                            : Loc.common.showPassword
                                    }
                                    onClick={() => togglePasswordVisibility(connectionId)}
                                />
                            }
                        />
                    )}
                    {connection.profile.authenticationType === AuthenticationType.AzureMFA && (
                        <Button
                            onClick={() => {
                                handleEntraSignIn(connectionId);
                            }}>
                            {Loc.connectionDialog.selectAnAccount}
                        </Button>
                    )}
                </div>
            </Tooltip>
        );
    };

    const hasBlockingWarnings = connections.some((connection) => {
        return connection.selected && connection.status === "needsAttention";
    });

    const nothingSelected = groupSelection.selected === 0 && connectionSelection.selected === 0;
    const importDisabled = hasBlockingWarnings || nothingSelected;

    const dialogContent =
        dialog?.type === "entraSignIn" ? (
            <EntraSignInDialog
                dialog={dialog}
                onCancel={handleCloseDialog}
                onSignIn={handleSignInDialogSubmit}
                onSelectAccount={handleSelectAccount}
            />
        ) : null;

    return (
        <div className={classes.root}>
            <div className={classes.layout}>
                {dialogContent}
                <div>
                    <Title3 as="h1">{LocMigration.title}</Title3>
                    <Body1 className={classes.summaryText}>{LocMigration.subtitle}</Body1>
                </div>
                <section className={classes.inputSection}>
                    <Label htmlFor="ads-config-input">{LocMigration.configInputLabel}</Label>
                    <Body1 className={classes.summaryText}>
                        {LocMigration.configInputDescription}
                    </Body1>
                    <div className={classes.pickerRow}>
                        <Input
                            id="ads-config-input"
                            value={configPath}
                            onChange={(_, data) => setConfigPath(data.value)}
                            className={classes.pickerInput}
                            placeholder={LocMigration.configInputPlaceholder}
                        />
                        <Button
                            type="button"
                            appearance="secondary"
                            icon={<FolderOpenRegular />}
                            onClick={handleBrowseForConfig}>
                            {LocMigration.browseButton}
                        </Button>
                    </div>
                </section>
                <div className={classes.tablesStack}>
                    <section className={classes.tableSection}>
                        <div className={classes.sectionHeader}>
                            <div className={classes.sectionHeaderRow}>
                                <Subtitle2>{LocMigration.connectionGroupsHeader}</Subtitle2>
                                <Button
                                    appearance="subtle"
                                    className={classes.collapseButton}
                                    icon={
                                        groupsCollapsed ? (
                                            <ChevronRightRegular />
                                        ) : (
                                            <ChevronDownRegular />
                                        )
                                    }
                                    title={
                                        groupsCollapsed
                                            ? LocMigration.connectionGroupsExpand
                                            : LocMigration.connectionGroupsCollapse
                                    }
                                    onClick={() => setGroupsCollapsed((prev) => !prev)}
                                />
                            </div>
                            <Text className={classes.summaryText}>
                                {LocMigration.connectionGroupsSelection(
                                    groupSelection.selected,
                                    groupSelection.total,
                                )}
                            </Text>
                            <Text className={classes.summaryText}>
                                {LocMigration.groupsRootNote}
                            </Text>
                        </div>
                        {!groupsCollapsed && (
                            <div className={classes.tableWrapper}>
                                {connectionGroups.length === 0 ? (
                                    <Text className={classes.emptyState}>
                                        {LocMigration.noConnectionGroups}
                                    </Text>
                                ) : (
                                    <div className={classes.tableScrollArea}>
                                        <Table role="grid" className={classes.dataTable}>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHeaderCell
                                                        className={classes.narrowColumn}>
                                                        <Checkbox
                                                            aria-label={
                                                                LocMigration.selectAllGroupsLabel
                                                            }
                                                            checked={groupHeaderState}
                                                            onChange={(_, data) =>
                                                                toggleAllGroups(
                                                                    data.checked === true,
                                                                )
                                                            }
                                                        />
                                                    </TableHeaderCell>
                                                    <TableHeaderCell
                                                        className={`${classes.narrowColumn} ${classes.statusColumnHeader}`}>
                                                        {LocMigration.connectionStatusColumn}
                                                    </TableHeaderCell>
                                                    <TableHeaderCell className={classes.nameColumn}>
                                                        {LocMigration.groupNameColumn}
                                                    </TableHeaderCell>
                                                    <TableHeaderCell
                                                        className={classes.serverColumn}>
                                                        {LocMigration.groupColorColumn}
                                                    </TableHeaderCell>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {connectionGroups.map((group) => (
                                                    <TableRow key={group.group.id}>
                                                        <TableCell className={classes.narrowColumn}>
                                                            <Checkbox
                                                                checked={group.selected}
                                                                onChange={(_, data) =>
                                                                    toggleConnectionGroup(
                                                                        group.group.id,
                                                                        !!data.checked,
                                                                    )
                                                                }
                                                                aria-label={LocMigration.groupSelectionToggle(
                                                                    group.group.name,
                                                                )}
                                                            />
                                                        </TableCell>
                                                        <TableCell
                                                            className={`${classes.narrowColumn} ${classes.statusColumnHeader}`}>
                                                            {renderGroupStatusIcon(
                                                                group.status,
                                                                group.statusMessage,
                                                            )}
                                                        </TableCell>
                                                        <TableCell className={classes.nameColumn}>
                                                            {group.group.name}
                                                        </TableCell>
                                                        <TableCell className={classes.serverColumn}>
                                                            {group.group.color ? (
                                                                <Tooltip
                                                                    content={LocMigration.groupColorSwatch(
                                                                        group.group.name,
                                                                        group.group.color,
                                                                    )}
                                                                    relationship="label">
                                                                    <div
                                                                        className={
                                                                            classes.colorSwatch
                                                                        }
                                                                        style={{
                                                                            backgroundColor:
                                                                                group.group.color,
                                                                        }}
                                                                    />
                                                                </Tooltip>
                                                            ) : (
                                                                <Text>—</Text>
                                                            )}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                )}
                            </div>
                        )}
                    </section>
                    <section className={classes.tableSection}>
                        <div className={classes.sectionHeader}>
                            <div className={classes.sectionHeaderRow}>
                                <Subtitle2>{LocMigration.connectionsHeader}</Subtitle2>
                                <Button
                                    appearance="subtle"
                                    className={classes.collapseButton}
                                    icon={
                                        connectionsCollapsed ? (
                                            <ChevronRightRegular />
                                        ) : (
                                            <ChevronDownRegular />
                                        )
                                    }
                                    title={
                                        connectionsCollapsed
                                            ? LocMigration.connectionsExpand
                                            : LocMigration.connectionsCollapse
                                    }
                                    onClick={() => setConnectionsCollapsed((prev) => !prev)}
                                />
                            </div>
                            <Text className={classes.summaryText}>
                                {LocMigration.connectionsSelection(
                                    connectionSelection.selected,
                                    connectionSelection.total,
                                )}
                            </Text>
                        </div>
                        {!connectionsCollapsed && (
                            <div className={classes.tableWrapper}>
                                {connections.length === 0 ? (
                                    <Text className={classes.emptyState}>
                                        {LocMigration.noConnections}
                                    </Text>
                                ) : (
                                    <div className={classes.tableScrollArea}>
                                        <Table role="grid" className={classes.dataTable}>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHeaderCell
                                                        className={classes.narrowColumn}>
                                                        <Checkbox
                                                            aria-label={
                                                                LocMigration.selectAllConnectionsLabel
                                                            }
                                                            checked={connectionHeaderState}
                                                            onChange={(_, data) =>
                                                                toggleAllConnections(
                                                                    data.checked === true,
                                                                )
                                                            }
                                                        />
                                                    </TableHeaderCell>
                                                    <TableHeaderCell
                                                        className={`${classes.narrowColumn} ${classes.statusColumnHeader}`}>
                                                        {LocMigration.connectionStatusColumn}
                                                    </TableHeaderCell>
                                                    <TableHeaderCell className={classes.nameColumn}>
                                                        {LocMigration.connectionProfileName}
                                                    </TableHeaderCell>
                                                    <TableHeaderCell
                                                        className={classes.serverColumn}>
                                                        {LocMigration.connectionServerColumn}
                                                    </TableHeaderCell>
                                                    <TableHeaderCell
                                                        className={classes.databaseColumn}>
                                                        {LocMigration.connectionDatabaseColumn}
                                                    </TableHeaderCell>
                                                    <TableHeaderCell
                                                        className={classes.authTypeColumn}>
                                                        {LocMigration.connectionAuthColumn}
                                                    </TableHeaderCell>
                                                    <TableHeaderCell className={classes.userColumn}>
                                                        {LocMigration.connectionUserColumn}
                                                    </TableHeaderCell>
                                                    <TableHeaderCell>
                                                        {LocMigration.authenticationColumn}
                                                    </TableHeaderCell>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {connections.map((connection) => {
                                                    const connectionId =
                                                        getConnectionId(connection);
                                                    const displayName =
                                                        connection.profileName ?? "";
                                                    return (
                                                        <TableRow key={connectionId}>
                                                            <TableCell
                                                                className={classes.narrowColumn}>
                                                                <Checkbox
                                                                    checked={connection.selected}
                                                                    onChange={(_, data) =>
                                                                        toggleConnection(
                                                                            connectionId,
                                                                            !!data.checked,
                                                                        )
                                                                    }
                                                                    aria-label={LocMigration.connectionSelectionToggle(
                                                                        displayName || connectionId,
                                                                    )}
                                                                />
                                                            </TableCell>
                                                            <TableCell
                                                                className={classes.narrowColumn}>
                                                                {renderConnectionStatusIcon(
                                                                    connection.status,
                                                                    connection.statusMessage,
                                                                )}
                                                            </TableCell>
                                                            <TableCell
                                                                className={classes.nameColumn}>
                                                                {renderTruncatedCell(displayName, {
                                                                    allowBlank: true,
                                                                    emptyTooltip:
                                                                        LocMigration.connectionDisplayNameMissing,
                                                                })}
                                                            </TableCell>
                                                            <TableCell
                                                                className={classes.serverColumn}>
                                                                {renderTruncatedCell(
                                                                    connection.profile.server ?? "",
                                                                    {
                                                                        emptyTooltip:
                                                                            LocMigration.connectionValueMissing,
                                                                        emptyDisplay: "-",
                                                                    },
                                                                )}
                                                            </TableCell>
                                                            <TableCell
                                                                className={classes.databaseColumn}>
                                                                {renderTruncatedCell(
                                                                    connection.profile.database ??
                                                                        "",
                                                                    {
                                                                        emptyTooltip:
                                                                            LocMigration.connectionValueMissing,
                                                                        emptyDisplay:
                                                                            LocMigration.connectionDatabaseDefault,
                                                                    },
                                                                )}
                                                            </TableCell>
                                                            <TableCell
                                                                className={classes.authTypeColumn}>
                                                                {
                                                                    connection.profile
                                                                        .authenticationType
                                                                }
                                                            </TableCell>
                                                            <TableCell
                                                                className={classes.userColumn}>
                                                                {renderTruncatedCell(
                                                                    connection.profile.user ?? "",
                                                                    {
                                                                        emptyTooltip:
                                                                            LocMigration.connectionValueMissing,
                                                                        emptyDisplay: "-",
                                                                    },
                                                                )}
                                                            </TableCell>
                                                            <TableCell className={classes.authCell}>
                                                                {renderAuthenticationCell(
                                                                    connection,
                                                                    connectionId,
                                                                )}
                                                            </TableCell>
                                                        </TableRow>
                                                    );
                                                })}
                                            </TableBody>
                                        </Table>
                                    </div>
                                )}
                            </div>
                        )}
                    </section>
                </div>
                <div className={classes.importBar}>
                    <Button appearance="primary" disabled={importDisabled}>
                        {LocMigration.importButtonLabel}
                    </Button>
                </div>
            </div>
        </div>
    );
};

const useStyles = makeStyles({
    root: {
        height: "100%",
        width: "100%",
        display: "flex",
        justifyContent: "center",
    },
    layout: {
        width: "100%",
        maxWidth: "1500px",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        ...shorthands.padding("16px", "24px"),
        boxSizing: "border-box",
    },
    inputSection: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
    },
    pickerRow: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexWrap: "wrap",
    },
    pickerInput: {
        flex: "1 1 320px",
        minWidth: "260px",
    },
    tablesStack: {
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        flex: 1,
        minHeight: 0,
    },
    tableSection: {
        borderRadius: "12px",
        border: "1px solid var(--vscode-editorWidget-border)",
        backgroundColor: "var(--vscode-sideBar-background)",
        ...shorthands.padding("16px"),
        display: "flex",
        flexDirection: "column",
        gap: "16px",
    },
    sectionHeader: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
    },
    summaryText: {
        color: "var(--vscode-descriptionForeground)",
    },
    tableWrapper: {
        overflowX: "auto",
    },
    tableScrollArea: {
        overflowY: "auto",
        maxHeight: "360px",
        borderRadius: "8px",
    },
    dataTable: {
        width: "100%",
        tableLayout: "fixed",
    },
    colorSwatch: {
        width: "16px",
        height: "16px",
        borderRadius: "4px",
        border: "1px solid var(--vscode-editorWidget-border)",
    },
    emptyState: {
        fontStyle: "italic",
        color: "var(--vscode-descriptionForeground)",
    },
    buttonCell: {
        display: "flex",
        justifyContent: "flex-start",
    },
    sectionHeaderRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
    },
    collapseButton: {
        minWidth: "32px",
        height: "32px",
    },
    statusCell: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
    },
    statusIconOnly: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
    },
    narrowColumn: {
        width: "40px",
        maxWidth: "40px",
        paddingInlineEnd: "4px",
        paddingInlineStart: "4px",
    },
    statusColumnHeader: {
        width: "48px",
        maxWidth: "48px",
    },
    truncatedCell: {
        display: "block",
        width: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        verticalAlign: "bottom",
    },
    authCell: {
        width: "10%",
    },
    importBar: {
        display: "flex",
        justifyContent: "flex-end",
        padding: "0 16px 24px",
    },
    nameColumn: {
        width: "15%",
        maxWidth: "300px",
    },
    serverColumn: {
        width: "15%",
        maxWidth: "280px",
    },
    databaseColumn: {
        width: "15%",
        maxWidth: "200px",
    },
    userColumn: {
        width: "15%",
        maxWidth: "220px",
    },
    authTypeColumn: {
        width: "90px",
        maxWidth: "110px",
        whiteSpace: "nowrap",
    },
});
