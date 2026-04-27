/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    List,
    ListItem,
    Spinner,
    Tooltip,
    Text,
    mergeClasses,
    SelectionItemId,
    Button,
    Input,
} from "@fluentui/react-components";
import { SqlCollectionInfo } from "../../../../../sharedInterfaces/fabric";
import {
    useCallback,
    SyntheticEvent,
    useState,
    BaseSyntheticEvent,
    useMemo,
    useEffect,
} from "react";
import {
    ChevronDoubleLeftFilled,
    ChevronDoubleRightFilled,
    DismissRegular,
    ErrorCircleRegular,
    PeopleTeamRegular,
    SearchRegular,
    StarFilled,
    StarRegular,
} from "@fluentui/react-icons";
import { locConstants as Loc } from "../../../../common/locConstants";
import { useSqlExplorerStyles } from "./sqlExplorer.styles";
import { ApiStatus, Status } from "../../../../../sharedInterfaces/webview";
import { KeyCode } from "../../../../common/keys";
import { useConnectionDialogSelector } from "../../connectionDialogSelector";

export const SqlCollectionList = ({
    workspaces,
    onSelectWorkspace,
    selectedWorkspace,
    loadStatus: loadStatusProp,
    listLabel,
    searchPlaceholder,
    noItemsFoundMessage,
    loadingMessage,
    errorMessage,
    favoritedIds,
    onToggleFavorite,
}: SqlCollectionListProps) => {
    const styles = useSqlExplorerStyles();
    const sqlCollectionsLoadStatus = useConnectionDialogSelector((s) => s.sqlCollectionsLoadStatus);

    // Use prop override if provided, otherwise fall back to store
    const effectiveLoadStatus = loadStatusProp ?? sqlCollectionsLoadStatus;

    const [isExplorerCollapsed, setIsExplorerCollapsed] = useState(false);

    const selectedItems: SelectionItemId[] = selectedWorkspace ? [selectedWorkspace.id] : [];

    const toggleExplorer = () => {
        setIsExplorerCollapsed(!isExplorerCollapsed);
    };

    const [workspaceSearchFilter, setWorkspaceSearchFilter] = useState("");

    function handleClearWorkspaceSearch(e: BaseSyntheticEvent) {
        setWorkspaceSearchFilter("");
        e?.stopPropagation();
    }

    // Sort: favorites first (stable), then alphabetical by displayName (case-insensitive)
    const sortedWorkspaces = useMemo(() => {
        return [...workspaces].sort((a, b) => {
            const aFav = favoritedIds?.includes(a.id) ?? false;
            const bFav = favoritedIds?.includes(b.id) ?? false;
            if (aFav !== bFav) {
                return aFav ? -1 : 1;
            }
            return a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase());
        });
    }, [workspaces, favoritedIds]);

    const filteredWorkspaces = useMemo(() => {
        if (!workspaceSearchFilter.trim()) {
            return sortedWorkspaces;
        }
        const searchTerm = workspaceSearchFilter.toLowerCase();
        return sortedWorkspaces.filter(
            (workspace) =>
                workspace.displayName.toLowerCase().includes(searchTerm) ||
                workspace.id.toLowerCase().includes(searchTerm),
        );
    }, [sortedWorkspaces, workspaceSearchFilter]);

    // Automatically select the first collection when collections are loaded and none is selected
    useEffect(() => {
        if (
            effectiveLoadStatus.status === ApiStatus.Loaded &&
            workspaces.length > 0 &&
            !selectedWorkspace
        ) {
            onSelectWorkspace(workspaces[0]);
        }
    }, [workspaces, selectedWorkspace, effectiveLoadStatus.status, onSelectWorkspace]);

    const onSelectionChange = useCallback(
        (_: SyntheticEvent | Event, data: { selectedItems: SelectionItemId[] }) => {
            if (data.selectedItems.length > 0) {
                const selectedId = data.selectedItems[0] as string;
                const workspace = workspaces.find((w) => w.id === selectedId);
                if (workspace) {
                    onSelectWorkspace(workspace);
                }
            }
        },
        [workspaces, onSelectWorkspace],
    );

    return (
        <div className={isExplorerCollapsed ? styles.workspaceListCollapsed : styles.workspaceList}>
            <div className={styles.workspaceHeader}>
                {!isExplorerCollapsed && (
                    <Input
                        placeholder={searchPlaceholder ?? Loc.connectionDialog.searchCollections}
                        value={workspaceSearchFilter}
                        onChange={(e) => setWorkspaceSearchFilter(e.target.value)}
                        contentBefore={<SearchRegular />}
                        contentAfter={
                            <DismissRegular
                                style={{
                                    cursor: "pointer",
                                    visibility: workspaceSearchFilter ? "visible" : "hidden",
                                }}
                                onClick={handleClearWorkspaceSearch}
                                onKeyDown={(e) => {
                                    if (e.code === KeyCode.Enter) {
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
                        style={{ flex: 1 }}
                    />
                )}
                <Button
                    appearance="subtle"
                    size="small"
                    icon={
                        isExplorerCollapsed ? (
                            <ChevronDoubleRightFilled className={styles.collapseButtonIcon} />
                        ) : (
                            <ChevronDoubleLeftFilled className={styles.collapseButtonIcon} />
                        )
                    }
                    onClick={toggleExplorer}
                    onKeyDown={(e) => {
                        if (e.code === KeyCode.Enter || e.code === KeyCode.Space) {
                            toggleExplorer();
                            e.preventDefault();
                        }
                    }}
                    aria-label={
                        isExplorerCollapsed
                            ? Loc.connectionDialog.expandCollectionExplorer
                            : Loc.connectionDialog.collapseCollectionExplorer
                    }
                    title={
                        isExplorerCollapsed
                            ? Loc.connectionDialog.expandCollectionExplorer
                            : Loc.connectionDialog.collapseCollectionExplorer
                    }
                    className={styles.collapseWorkspaceListButton}
                />
            </div>
            {!isExplorerCollapsed && (
                <div className={styles.workspaceListContainer} style={{ position: "relative" }}>
                    {effectiveLoadStatus.status === ApiStatus.Loading && (
                        <div className={styles.workspaceListMessageContainer}>
                            <Spinner size="medium" />
                            <Text className={styles.messageText}>
                                {loadingMessage ?? Loc.connectionDialog.loadingCollections}
                            </Text>
                        </div>
                    )}
                    {effectiveLoadStatus.status === ApiStatus.Error && (
                        <div className={styles.workspaceListMessageContainer}>
                            <Tooltip
                                content={
                                    effectiveLoadStatus.message ||
                                    errorMessage ||
                                    Loc.connectionDialog.errorLoadingCollections
                                }
                                relationship="label">
                                <ErrorCircleRegular className={styles.errorIcon} />
                            </Tooltip>
                            <Text className={styles.messageText}>
                                {errorMessage ?? Loc.connectionDialog.errorLoadingCollections}
                            </Text>
                        </div>
                    )}
                    {effectiveLoadStatus.status === ApiStatus.Loaded && (
                        <>
                            {!filteredWorkspaces ||
                                (filteredWorkspaces.length === 0 && (
                                    <div className={styles.workspaceListMessageContainer}>
                                        <Text className={styles.messageText}>
                                            {noItemsFoundMessage ??
                                                Loc.connectionDialog.noCollectionsFound}
                                        </Text>
                                    </div>
                                ))}
                            {filteredWorkspaces.length > 0 && (
                                <List
                                    role="listbox"
                                    aria-label={listLabel ?? Loc.connectionDialog.sqlCollections}
                                    selectionMode="single"
                                    navigationMode="composite"
                                    selectedItems={selectedItems}
                                    onSelectionChange={onSelectionChange}>
                                    {filteredWorkspaces.map((workspace) => (
                                        <SqlCollectionListItem
                                            key={workspace.id}
                                            workspace={workspace}
                                            isSelected={selectedItems.includes(workspace.id)}
                                            isFavorited={
                                                favoritedIds?.includes(workspace.id) ?? false
                                            }
                                            onToggleFavorite={onToggleFavorite}
                                        />
                                    ))}
                                </List>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

const SqlCollectionListItem = ({
    workspace,
    isSelected,
    isFavorited,
    onToggleFavorite,
}: SqlCollectionListItemProps) => {
    const styles = useSqlExplorerStyles();
    const [isHovered, setIsHovered] = useState(false);

    const showStar = isFavorited || isHovered;

    return (
        <ListItem
            key={workspace.id}
            value={workspace.id}
            className={mergeClasses(
                styles.workspaceItem,
                isSelected && styles.workspaceItemSelected,
            )}
            aria-label={workspace.displayName}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            // eslint-disable-next-line no-restricted-syntax
            checkmark={null}>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    minHeight: "20px",
                    width: "100%",
                }}>
                {/* Icon + name with name/ID tooltip on the left */}
                <Tooltip
                    content={
                        <div>
                            <div>{workspace.displayName}</div>
                            <div
                                style={{
                                    opacity: 0.75,
                                    fontSize: "11px",
                                    marginTop: "2px",
                                    fontFamily: "monospace",
                                }}>
                                {workspace.id}
                            </div>
                        </div>
                    }
                    relationship="description"
                    positioning="before">
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            flex: 1,
                            overflow: "hidden",
                        }}>
                        {/* Icon container */}
                        <div className={styles.iconContainer}>
                            {workspace.loadStatus.status === ApiStatus.Error && (
                                <Tooltip
                                    content={workspace.loadStatus.message ?? ""}
                                    relationship="label">
                                    <ErrorCircleRegular
                                        style={{
                                            width: "100%",
                                            height: "100%",
                                        }}
                                    />
                                </Tooltip>
                            )}
                            {workspace.loadStatus.status === ApiStatus.Loading && (
                                <Spinner
                                    size="extra-tiny"
                                    style={{
                                        width: "100%",
                                        height: "100%",
                                    }}
                                />
                            )}
                            {(workspace.loadStatus.status === ApiStatus.Loaded ||
                                workspace.loadStatus.status === ApiStatus.NotStarted) && (
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
                </Tooltip>

                {/* Star button with its own tooltip */}
                {onToggleFavorite && (
                    <Tooltip
                        content={
                            isFavorited
                                ? Loc.connectionDialog.removeFromFavorites
                                : Loc.connectionDialog.addToFavorites
                        }
                        relationship="label">
                        <button
                            className={styles.starButton}
                            style={{ visibility: showStar ? "visible" : "hidden" }}
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleFavorite(workspace.id);
                            }}
                            onKeyDown={(e) => {
                                if (e.code === KeyCode.Enter || e.code === KeyCode.Space) {
                                    e.stopPropagation();
                                    onToggleFavorite(workspace.id);
                                    e.preventDefault();
                                }
                            }}
                            aria-label={
                                isFavorited
                                    ? Loc.connectionDialog.removeFromFavorites
                                    : Loc.connectionDialog.addToFavorites
                            }
                            aria-pressed={isFavorited}>
                            {isFavorited ? (
                                <StarFilled
                                    className={styles.starFilled}
                                    style={{ width: "14px", height: "14px" }}
                                />
                            ) : (
                                <StarRegular style={{ width: "14px", height: "14px" }} />
                            )}
                        </button>
                    </Tooltip>
                )}
            </div>
        </ListItem>
    );
};

export interface SqlCollectionListProps {
    workspaces: SqlCollectionInfo[];
    onSelectWorkspace: (workspace: SqlCollectionInfo) => void;
    selectedWorkspace?: SqlCollectionInfo;
    /** Override the store's sqlCollectionsLoadStatus */
    loadStatus?: Status;
    /** aria-label for the list */
    listLabel?: string;
    /** Placeholder for the search input */
    searchPlaceholder?: string;
    /** Message when no items are found */
    noItemsFoundMessage?: string;
    /** Message while loading */
    loadingMessage?: string;
    /** Message on error */
    errorMessage?: string;
    /** IDs of favorited collections (sorted to top with filled star) */
    favoritedIds?: string[];
    /** Called when the user clicks the star for a collection */
    onToggleFavorite?: (collectionId: string) => void;
}

interface SqlCollectionListItemProps {
    workspace: SqlCollectionInfo;
    isSelected: boolean;
    isFavorited: boolean;
    onToggleFavorite?: (collectionId: string) => void;
}
