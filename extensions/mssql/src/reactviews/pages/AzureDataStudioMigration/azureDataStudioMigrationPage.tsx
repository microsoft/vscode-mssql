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
    makeStyles,
    shorthands,
} from "@fluentui/react-components";
import {
    CheckmarkCircle16Regular,
    ChevronDownRegular,
    ChevronRightRegular,
    FolderOpenRegular,
    ShieldLockRegular,
    Warning16Regular,
} from "@fluentui/react-icons";
import { useEffect, useMemo, useState } from "react";

import {
    AdsMigrationConnection,
    AdsMigrationConnectionGroup,
    AzureDataStudioMigrationBrowseForConfigRequest,
    AzureDataStudioMigrationWebviewState,
} from "../../../sharedInterfaces/azureDataStudioMigration";
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

    useEffect(() => {
        setConfigPath(state.adsConfigPath ?? "");
    }, [state.adsConfigPath]);

    useEffect(() => {
        setConnectionGroups(state.connectionGroups ?? []);
    }, [state.connectionGroups]);

    useEffect(() => {
        setConnections(state.connections ?? []);
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
        setConnectionGroups((prev) =>
            prev.map((group) => (group.id === groupId ? { ...group, selected: checked } : group)),
        );
    };

    const toggleAllGroups = (checked: boolean) => {
        setConnectionGroups((prev) => prev.map((group) => ({ ...group, selected: checked })));
    };

    const toggleConnection = (connectionId: string, checked: boolean) => {
        setConnections((prev) =>
            prev.map((connection) =>
                connection.id === connectionId ? { ...connection, selected: checked } : connection,
            ),
        );
    };

    const toggleAllConnections = (checked: boolean) => {
        setConnections((prev) => prev.map((connection) => ({ ...connection, selected: checked })));
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

    const renderStatusIcon = (status: AdsMigrationConnection["status"]) => {
        if (status === "ready") {
            return (
                <span className={classes.statusCell}>
                    <CheckmarkCircle16Regular
                        aria-label={loc.connectionStatusReady}
                        color="var(--vscode-testing-iconPassed)"
                    />
                    <Text>{loc.connectionStatusReady}</Text>
                </span>
            );
        }
        return (
            <span className={classes.statusCell}>
                <Warning16Regular
                    aria-label={loc.connectionStatusNeedsAttention}
                    color="var(--vscode-testing-iconErrored)"
                />
                <Text>{loc.connectionStatusNeedsAttention}</Text>
            </span>
        );
    };

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
                                                    <TableHeaderCell>
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
                                                        <TableCell>
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
                                                        <TableCell>{group.name}</TableCell>
                                                        <TableCell>
                                                            <div
                                                                className={classes.colorSwatch}
                                                                style={{
                                                                    backgroundColor: group.color,
                                                                }}
                                                                aria-label={loc.groupColorSwatch(
                                                                    group.name,
                                                                    group.color,
                                                                )}
                                                            />
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                )}
                            </div>
                        )}
                        <Text className={classes.summaryText}>{loc.groupsRootNote}</Text>
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
                                                    <TableHeaderCell>
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
                                                    <TableHeaderCell>
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
                                                        {loc.connectionActionsColumn}
                                                    </TableHeaderCell>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {connections.map((connection) => (
                                                    <TableRow key={connection.id}>
                                                        <TableCell>
                                                            <Checkbox
                                                                checked={connection.selected}
                                                                onChange={(_, data) =>
                                                                    toggleConnection(
                                                                        connection.id,
                                                                        !!data.checked,
                                                                    )
                                                                }
                                                                aria-label={loc.connectionSelectionToggle(
                                                                    connection.displayName,
                                                                )}
                                                            />
                                                        </TableCell>
                                                        <TableCell>
                                                            {renderStatusIcon(connection.status)}
                                                        </TableCell>
                                                        <TableCell>
                                                            {connection.displayName}
                                                        </TableCell>
                                                        <TableCell>{connection.server}</TableCell>
                                                        <TableCell>
                                                            {connection.database ?? "—"}
                                                        </TableCell>
                                                        <TableCell>
                                                            {connection.authenticationType}
                                                        </TableCell>
                                                        <TableCell>
                                                            {connection.userId ?? "—"}
                                                        </TableCell>
                                                        <TableCell className={classes.buttonCell}>
                                                            <Button
                                                                appearance="secondary"
                                                                size="small"
                                                                icon={<ShieldLockRegular />}
                                                                onClick={() => {
                                                                    // Placeholder for future auth wiring
                                                                    return;
                                                                }}>
                                                                {loc.addAuthentication}
                                                            </Button>
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
                </div>
            </div>
        </div>
    );
};
