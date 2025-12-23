/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Body1,
    Button,
    Checkbox,
    CheckboxCheckedValue,
    Dropdown,
    Input,
    Label,
    Option,
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
    FolderOpenRegular,
    PresenceAvailableRegular,
    Warning16Regular,
} from "@fluentui/react-icons";
import { useEffect, useMemo, useState } from "react";

import {
    AdsMigrationConnection,
    AdsMigrationConnectionGroup,
    AzureDataStudioMigrationBrowseForConfigRequest,
    AzureDataStudioMigrationWebviewState,
} from "../../../sharedInterfaces/azureDataStudioMigration";
import { AuthenticationType } from "../../../sharedInterfaces/connectionDialog";
import { useAzureDataStudioMigrationSelector } from "./azureDataStudioMigrationSelector";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { locConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    root: {
        height: "100%",
        width: "100%",
        display: "flex",
        justifyContent: "center",
    },
    layout: {
        width: "100%",
        maxWidth: "1200px",
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
    truncatedCell: {
        display: "inline-block",
        maxWidth: "220px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        verticalAlign: "bottom",
    },
    authCell: {
        minWidth: "200px",
    },
    importBar: {
        display: "flex",
        justifyContent: "flex-end",
        padding: "0 16px 24px",
    },
});

export const AzureDataStudioMigrationPage = () => {
    const classes = useStyles();
    const loc = locConstants.azureDataStudioMigration;
    const { extensionRpc } = useVscodeWebview2<AzureDataStudioMigrationWebviewState, void>();
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
    const [authOverrides, setAuthOverrides] = useState<Record<string, string>>({});

    useEffect(() => {
        setConfigPath(state.adsConfigPath ?? "");
    }, [state.adsConfigPath]);

    useEffect(() => {
        setConnectionGroups(state.connectionGroups ?? []);
    }, [state.connectionGroups]);

    useEffect(() => {
        setConnections(state.connections ?? []);
        setAuthOverrides({});
    }, [state.connections]);

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

    const computeHeaderState = (selected: number, total: number): CheckboxCheckedValue => {
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
        setConnectionGroups((prev) =>
            prev.map((group) => (group.id === groupId ? { ...group, selected: checked } : group)),
        );
    };

    const toggleAllGroups = (checked: boolean) => {
        setConnectionGroups((prev) => prev.map((group) => ({ ...group, selected: checked })));
    };

    const toggleConnection = (connectionId: string, checked: boolean) => {
        setConnections((prev) =>
            prev.map((connection) => {
                const currentId = getConnectionId(connection);
                if (currentId === connectionId) {
                    return { ...connection, selected: checked };
                }
                return connection;
            }),
        );
    };

    const toggleAllConnections = (checked: boolean) => {
        setConnections((prev) =>
            prev.map((connection) => ({
                ...connection,
                selected: checked,
            })),
        );
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

    const getConnectionDisplayName = (connection: AdsMigrationConnection) =>
        connection.profile.profileName?.trim() ?? "";

    const computeEffectiveStatus = (connection: AdsMigrationConnection, connectionId: string) => {
        if (
            connection.status === "needsAttention" &&
            connection.profile.authenticationType === AuthenticationType.SqlLogin
        ) {
            const override = authOverrides[connectionId]?.trim();
            if (override) {
                return "ready";
            }
        }
        return connection.status;
    };

    const renderStatusIcon = (
        status: "ready" | "needsAttention" | "alreadyImported",
        tooltip: string,
    ) => {
        let icon: JSX.Element;
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

    const renderGroupStatusIcon = (status: AdsMigrationConnectionGroup["status"]) => {
        const tooltip =
            status === "alreadyImported"
                ? loc.connectionGroupStatusAlreadyImported
                : loc.connectionGroupStatusReady;
        return renderStatusIcon(status, tooltip);
    };

    const renderConnectionStatusIcon = (status: AdsMigrationConnection["status"]) => {
        const tooltip =
            status === "alreadyImported"
                ? loc.connectionStatusAlreadyImported
                : status === "needsAttention"
                  ? loc.connectionStatusNeedsAttention
                  : loc.connectionStatusReady;
        return renderStatusIcon(status, tooltip);
    };

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
            value || options?.emptyTooltip || options?.emptyDisplay || loc.connectionValueMissing;
        const style = options?.maxWidth ? { maxWidth: `${options.maxWidth}px` } : undefined;
        return (
            <Tooltip content={tooltip} relationship="description">
                <span className={classes.truncatedCell} style={style}>
                    {content || "\u00A0"}
                </span>
            </Tooltip>
        );
    };

    const handleAuthenticationChange = (connectionId: string, value: string) => {
        setAuthOverrides((prev) => ({
            ...prev,
            [connectionId]: value,
        }));
    };

    const renderAuthenticationCell = (connection: AdsMigrationConnection, connectionId: string) => {
        if (connection.profile.authenticationType === AuthenticationType.SqlLogin) {
            return (
                <Input
                    value={authOverrides[connectionId] ?? ""}
                    onChange={(_, data) => handleAuthenticationChange(connectionId, data.value)}
                    placeholder={loc.authenticationSqlPlaceholder}
                />
            );
        }

        if (connection.profile.authenticationType === AuthenticationType.AzureMFA) {
            const selected = authOverrides[connectionId] ?? "entra";
            return (
                <Dropdown
                    selectedOptions={[selected]}
                    onOptionSelect={(_, data) =>
                        handleAuthenticationChange(connectionId, data.optionValue as string)
                    }>
                    <Option value="entra">{loc.authenticationAzureOption}</Option>
                </Dropdown>
            );
        }

        return <Text>{loc.authenticationNotRequired}</Text>;
    };

    const hasBlockingWarnings = connections.some((connection) => {
        const connectionId = getConnectionId(connection);
        return (
            connection.selected &&
            computeEffectiveStatus(connection, connectionId) === "needsAttention"
        );
    });
    const importDisabled = hasBlockingWarnings;

    return (
        <div className={classes.root}>
            <div className={classes.layout}>
                <div>
                    <Title3 as="h1">{loc.title}</Title3>
                    <Body1 className={classes.summaryText}>{loc.subtitle}</Body1>
                </div>
                <section className={classes.inputSection}>
                    <Label htmlFor="ads-config-input">{loc.configInputLabel}</Label>
                    <Body1 className={classes.summaryText}>{loc.configInputDescription}</Body1>
                    <div className={classes.pickerRow}>
                        <Input
                            id="ads-config-input"
                            value={configPath}
                            onChange={(_, data) => setConfigPath(data.value)}
                            className={classes.pickerInput}
                            placeholder={loc.configInputPlaceholder}
                        />
                        <Button
                            type="button"
                            appearance="secondary"
                            icon={<FolderOpenRegular />}
                            onClick={handleBrowseForConfig}>
                            {loc.browseButton}
                        </Button>
                    </div>
                </section>
                <div className={classes.tablesStack}>
                    <section className={classes.tableSection}>
                        <div className={classes.sectionHeader}>
                            <div className={classes.sectionHeaderRow}>
                                <Subtitle2>{loc.connectionGroupsHeader}</Subtitle2>
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
                                            ? loc.connectionGroupsExpand
                                            : loc.connectionGroupsCollapse
                                    }
                                    onClick={() => setGroupsCollapsed((prev) => !prev)}
                                />
                            </div>
                            <Text className={classes.summaryText}>
                                {loc.connectionGroupsSelection(
                                    groupSelection.selected,
                                    groupSelection.total,
                                )}
                            </Text>
                            <Text className={classes.summaryText}>{loc.groupsRootNote}</Text>
                        </div>
                        {!groupsCollapsed && (
                            <div className={classes.tableWrapper}>
                                {connectionGroups.length === 0 ? (
                                    <Text className={classes.emptyState}>
                                        {loc.noConnectionGroups}
                                    </Text>
                                ) : (
                                    <div className={classes.tableScrollArea}>
                                        <Table role="grid">
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHeaderCell
                                                        className={classes.narrowColumn}>
                                                        <Checkbox
                                                            aria-label={loc.selectAllGroupsLabel}
                                                            checked={groupHeaderState}
                                                            onChange={(_, data) =>
                                                                toggleAllGroups(
                                                                    data.checked === true,
                                                                )
                                                            }
                                                        />
                                                    </TableHeaderCell>
                                                    <TableHeaderCell
                                                        className={classes.narrowColumn}>
                                                        {loc.connectionStatusColumn}
                                                    </TableHeaderCell>
                                                    <TableHeaderCell>
                                                        {loc.groupNameColumn}
                                                    </TableHeaderCell>
                                                    <TableHeaderCell>
                                                        {loc.groupColorColumn}
                                                    </TableHeaderCell>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {connectionGroups.map((group) => (
                                                    <TableRow key={group.id}>
                                                        <TableCell className={classes.narrowColumn}>
                                                            <Checkbox
                                                                checked={group.selected}
                                                                onChange={(_, data) =>
                                                                    toggleConnectionGroup(
                                                                        group.id,
                                                                        !!data.checked,
                                                                    )
                                                                }
                                                                aria-label={loc.groupSelectionToggle(
                                                                    group.name,
                                                                )}
                                                            />
                                                        </TableCell>
                                                        <TableCell className={classes.narrowColumn}>
                                                            {renderGroupStatusIcon(group.status)}
                                                        </TableCell>
                                                        <TableCell>{group.name}</TableCell>
                                                        <TableCell>
                                                            {group.color ? (
                                                                <Tooltip
                                                                    content={loc.groupColorSwatch(
                                                                        group.name,
                                                                        group.color,
                                                                    )}
                                                                    relationship="label">
                                                                    <div
                                                                        className={
                                                                            classes.colorSwatch
                                                                        }
                                                                        style={{
                                                                            backgroundColor:
                                                                                group.color,
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
                                <Subtitle2>{loc.connectionsHeader}</Subtitle2>
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
                                            ? loc.connectionsExpand
                                            : loc.connectionsCollapse
                                    }
                                    onClick={() => setConnectionsCollapsed((prev) => !prev)}
                                />
                            </div>
                            <Text className={classes.summaryText}>
                                {loc.connectionsSelection(
                                    connectionSelection.selected,
                                    connectionSelection.total,
                                )}
                            </Text>
                        </div>
                        {!connectionsCollapsed && (
                            <div className={classes.tableWrapper}>
                                {connections.length === 0 ? (
                                    <Text className={classes.emptyState}>{loc.noConnections}</Text>
                                ) : (
                                    <div className={classes.tableScrollArea}>
                                        <Table role="grid">
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHeaderCell
                                                        className={classes.narrowColumn}>
                                                        <Checkbox
                                                            aria-label={
                                                                loc.selectAllConnectionsLabel
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
                                                        className={classes.narrowColumn}>
                                                        {loc.connectionStatusColumn}
                                                    </TableHeaderCell>
                                                    <TableHeaderCell>
                                                        {loc.connectionNameColumn}
                                                    </TableHeaderCell>
                                                    <TableHeaderCell>
                                                        {loc.connectionServerColumn}
                                                    </TableHeaderCell>
                                                    <TableHeaderCell>
                                                        {loc.connectionDatabaseColumn}
                                                    </TableHeaderCell>
                                                    <TableHeaderCell>
                                                        {loc.connectionAuthColumn}
                                                    </TableHeaderCell>
                                                    <TableHeaderCell>
                                                        {loc.connectionUserColumn}
                                                    </TableHeaderCell>
                                                    <TableHeaderCell>
                                                        {loc.authenticationColumn}
                                                    </TableHeaderCell>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {connections.map((connection) => {
                                                    const connectionId =
                                                        getConnectionId(connection);
                                                    const displayName =
                                                        getConnectionDisplayName(connection);
                                                    const effectiveStatus = computeEffectiveStatus(
                                                        connection,
                                                        connectionId,
                                                    );
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
                                                                    aria-label={loc.connectionSelectionToggle(
                                                                        displayName || connectionId,
                                                                    )}
                                                                />
                                                            </TableCell>
                                                            <TableCell
                                                                className={classes.narrowColumn}>
                                                                {renderConnectionStatusIcon(
                                                                    effectiveStatus,
                                                                )}
                                                            </TableCell>
                                                            <TableCell>
                                                                {renderTruncatedCell(displayName, {
                                                                    allowBlank: true,
                                                                    emptyTooltip:
                                                                        loc.connectionDisplayNameMissing,
                                                                    maxWidth: 220,
                                                                })}
                                                            </TableCell>
                                                            <TableCell>
                                                                {renderTruncatedCell(
                                                                    connection.profile.server ?? "",
                                                                    {
                                                                        emptyTooltip:
                                                                            loc.connectionValueMissing,
                                                                        emptyDisplay: "-",
                                                                        maxWidth: 200,
                                                                    },
                                                                )}
                                                            </TableCell>
                                                            <TableCell>
                                                                {renderTruncatedCell(
                                                                    connection.profile.database ??
                                                                        "",
                                                                    {
                                                                        emptyTooltip:
                                                                            loc.connectionValueMissing,
                                                                        emptyDisplay: "-",
                                                                        maxWidth: 180,
                                                                    },
                                                                )}
                                                            </TableCell>
                                                            <TableCell>
                                                                {
                                                                    connection.profile
                                                                        .authenticationType
                                                                }
                                                            </TableCell>
                                                            <TableCell>
                                                                {renderTruncatedCell(
                                                                    connection.profile.user ?? "",
                                                                    {
                                                                        emptyTooltip:
                                                                            loc.connectionValueMissing,
                                                                        emptyDisplay: "-",
                                                                        maxWidth: 180,
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
                        {loc.importButtonLabel}
                    </Button>
                </div>
            </div>
        </div>
    );
};
