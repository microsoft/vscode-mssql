/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    List,
    ListItem,
    Label,
    Spinner,
    Tooltip,
    Text,
    mergeClasses,
    SelectionItemId,
    Button,
    Input,
} from "@fluentui/react-components";
import { FabricWorkspaceInfo } from "../../../../sharedInterfaces/connectionDialog";
import { useCallback, SyntheticEvent, useState, BaseSyntheticEvent, useMemo } from "react";
import {
    ChevronDoubleLeftFilled,
    ChevronDoubleRightFilled,
    DismissRegular,
    ErrorCircleRegular,
    PeopleTeamRegular,
    SearchRegular,
} from "@fluentui/react-icons";
import { locConstants as Loc } from "../../../common/locConstants";
import { useStyles } from "./fabricWorkspaceViewer.styles";
import { ApiStatus, Status } from "../../../../sharedInterfaces/webview";
import { Keys } from "../../../common/keys";

interface Props {
    workspaces: FabricWorkspaceInfo[];
    onWorkspaceSelect: (workspace: FabricWorkspaceInfo) => void;
    selectedWorkspace?: FabricWorkspaceInfo;
    fabricWorkspacesLoadStatus: Status;
}

export const WorkspacesList = ({
    workspaces,
    onWorkspaceSelect,
    selectedWorkspace,
    fabricWorkspacesLoadStatus,
}: Props) => {
    const styles = useStyles();

    const [isExplorerCollapsed, setIsExplorerCollapsed] = useState(false);

    const selectedItems: SelectionItemId[] = selectedWorkspace ? [selectedWorkspace.id] : [];

    const toggleExplorer = () => {
        setIsExplorerCollapsed(!isExplorerCollapsed);
    };

    const [workspaceSearchFilter, setWorkspaceSearchFilter] = useState("");

    function handleClearWorkspaceSearch(e: BaseSyntheticEvent) {
        setWorkspaceSearchFilter("");
        e?.stopPropagation();
        // buttonRef.current?.focus();
    }

    const filteredWorkspaces = useMemo(() => {
        if (!workspaceSearchFilter.trim()) {
            return workspaces;
        }
        const searchTerm = workspaceSearchFilter.toLowerCase();
        return workspaces.filter((workspace) =>
            workspace.displayName.toLowerCase().includes(searchTerm),
        );
    }, [workspaces, workspaceSearchFilter]);

    const onSelectionChange = useCallback(
        (_: SyntheticEvent | Event, data: { selectedItems: SelectionItemId[] }) => {
            if (data.selectedItems.length > 0) {
                const selectedId = data.selectedItems[0] as string;
                const workspace = workspaces.find((w) => w.id === selectedId);
                if (workspace) {
                    onWorkspaceSelect(workspace);
                }
            }
        },
        [workspaces, onWorkspaceSelect],
    );

    return (
        <div
            className={
                isExplorerCollapsed ? styles.workspaceExplorerCollapsed : styles.workspaceExplorer
            }>
            {isExplorerCollapsed ? (
                <Button
                    appearance="subtle"
                    size="small"
                    icon={<ChevronDoubleRightFilled className={styles.collapseButtonIcon} />}
                    onClick={toggleExplorer}
                    onKeyDown={(e) => {
                        if (e.key === Keys.Enter || e.key === Keys.Space) {
                            toggleExplorer();
                            e.preventDefault();
                        }
                    }}
                    aria-label={Loc.connectionDialog.expandWorkspaceExplorer}
                    title={Loc.connectionDialog.expand}
                    className={styles.collapsedExplorerButton}
                />
            ) : (
                <>
                    <div className={styles.workspaceHeader}>
                        <div className={styles.workspaceSearchBox}>
                            <Input
                                placeholder={Loc.connectionDialog.searchWorkspaces}
                                value={workspaceSearchFilter}
                                onChange={(e) => setWorkspaceSearchFilter(e.target.value)}
                                contentBefore={<SearchRegular />}
                                contentAfter={
                                    <DismissRegular
                                        style={{
                                            cursor: "pointer",
                                            visibility: workspaceSearchFilter
                                                ? "visible"
                                                : "hidden",
                                        }}
                                        onClick={handleClearWorkspaceSearch}
                                        onKeyDown={(e) => {
                                            if (e.key === Keys.Enter) {
                                                handleClearWorkspaceSearch(e);
                                            }
                                        }}
                                        aria-label={Loc.common.clear}
                                        title={Loc.common.clear}
                                        role="button"
                                        tabIndex={workspaceSearchFilter ? 0 : -1}
                                    />
                                }
                                size="small"
                                style={{ width: "100%" }}
                            />
                        </div>
                        <div className={styles.collapseButton}>
                            <Button
                                appearance="subtle"
                                size="small"
                                icon={
                                    <ChevronDoubleLeftFilled
                                        className={styles.collapseButtonIcon}
                                    />
                                }
                                onClick={toggleExplorer}
                                onKeyDown={(e) => {
                                    if (e.key === Keys.Enter || e.key === Keys.Space) {
                                        toggleExplorer();
                                        e.preventDefault();
                                    }
                                }}
                                aria-label={Loc.connectionDialog.collapseWorkspaceExplorer}
                                title={Loc.connectionDialog.collapse}
                                style={{
                                    minWidth: "24px",
                                    display: "flex",
                                    justifyContent: "center",
                                    padding: "0 4px",
                                }}
                            />
                        </div>
                    </div>
                    <div className={styles.workspaceListContainer} style={{ position: "relative" }}>
                        {fabricWorkspacesLoadStatus.status === ApiStatus.Loading && (
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    position: "absolute",
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    bottom: 0,
                                    padding: "16px",
                                }}>
                                <Spinner size="medium" />
                                <Text className={styles.messageText}>
                                    {Loc.connectionDialog.loadingWorkspaces}
                                </Text>
                            </div>
                        )}
                        {fabricWorkspacesLoadStatus.status === ApiStatus.Error && (
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    position: "absolute",
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    bottom: 0,
                                    padding: "16px",
                                }}>
                                <Tooltip
                                    content={
                                        fabricWorkspacesLoadStatus.message ||
                                        Loc.connectionDialog.errorLoadingWorkspaces
                                    }
                                    relationship="label">
                                    <ErrorCircleRegular className={styles.errorIcon} />
                                </Tooltip>
                                <Text className={styles.messageText}>
                                    {Loc.connectionDialog.errorLoadingWorkspaces}
                                </Text>
                            </div>
                        )}
                        {fabricWorkspacesLoadStatus.status === ApiStatus.Loaded && (
                            <>
                                {!filteredWorkspaces ||
                                    (filteredWorkspaces.length === 0 && (
                                        <Label>{Loc.connectionDialog.noWorkspacesAvailable}</Label>
                                    ))}
                                {filteredWorkspaces.length > 0 && (
                                    <List
                                        role="listbox"
                                        aria-label={Loc.connectionDialog.fabricWorkspaces}
                                        selectionMode="single"
                                        navigationMode="composite"
                                        selectedItems={selectedItems}
                                        onSelectionChange={onSelectionChange}>
                                        {filteredWorkspaces.map((workspace) => (
                                            <ListItem
                                                key={workspace.id}
                                                value={workspace.id}
                                                className={mergeClasses(
                                                    styles.workspaceItem,
                                                    selectedItems.includes(workspace.id) &&
                                                        styles.workspaceItemSelected,
                                                )}
                                                aria-label={workspace.displayName}
                                                title={workspace.displayName}
                                                // eslint-disable-next-line no-restricted-syntax
                                                checkmark={null}>
                                                <div
                                                    style={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        minHeight: "20px",
                                                    }}>
                                                    {/* Icon container with consistent styling */}
                                                    <div className={styles.iconContainer}>
                                                        {/* display error if workspace status is errored */}
                                                        {workspace.loadStatus.status ===
                                                            ApiStatus.Error && (
                                                            <Tooltip
                                                                content={
                                                                    workspace.loadStatus.message ??
                                                                    ""
                                                                }
                                                                relationship="label">
                                                                <ErrorCircleRegular
                                                                    style={{
                                                                        width: "100%",
                                                                        height: "100%",
                                                                    }}
                                                                />
                                                            </Tooltip>
                                                        )}
                                                        {/* display loading spinner */}
                                                        {workspace.loadStatus.status ===
                                                            ApiStatus.Loading && (
                                                            <Spinner
                                                                size="extra-tiny"
                                                                style={{
                                                                    width: "100%",
                                                                    height: "100%",
                                                                }}
                                                            />
                                                        )}
                                                        {/* display workspace icon */}
                                                        {(workspace.loadStatus.status ===
                                                            ApiStatus.Loaded ||
                                                            workspace.loadStatus.status ===
                                                                ApiStatus.NotStarted) && (
                                                            <PeopleTeamRegular
                                                                style={{
                                                                    width: "100%",
                                                                    height: "100%",
                                                                }}
                                                            />
                                                        )}
                                                    </div>

                                                    <Text
                                                        style={{
                                                            overflow: "hidden",
                                                            textOverflow: "ellipsis",
                                                            whiteSpace: "nowrap",
                                                            flex: 1,
                                                        }}>
                                                        {workspace.displayName}
                                                    </Text>
                                                </div>
                                            </ListItem>
                                        ))}
                                    </List>
                                )}
                            </>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};
