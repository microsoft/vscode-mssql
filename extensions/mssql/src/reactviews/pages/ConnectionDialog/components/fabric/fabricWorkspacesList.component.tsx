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
import { FabricWorkspaceInfo } from "../../../../../sharedInterfaces/fabric";
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
} from "@fluentui/react-icons";
import { locConstants as Loc } from "../../../../common/locConstants";
import { useFabricExplorerStyles } from "./fabricExplorer.styles";
import { ApiStatus, Status } from "../../../../../sharedInterfaces/webview";
import { KeyCode } from "../../../../common/keys";

export const FabricWorkspacesList = ({
  workspaces,
  onSelectWorkspace,
  selectedWorkspace,
  fabricWorkspacesLoadStatus,
}: FabricWorkspacesListProps) => {
  const styles = useFabricExplorerStyles();

  const [isExplorerCollapsed, setIsExplorerCollapsed] = useState(false);

  const selectedItems: SelectionItemId[] = selectedWorkspace
    ? [selectedWorkspace.id]
    : [];

  const toggleExplorer = () => {
    setIsExplorerCollapsed(!isExplorerCollapsed);
  };

  const [workspaceSearchFilter, setWorkspaceSearchFilter] = useState("");

  function handleClearWorkspaceSearch(e: BaseSyntheticEvent) {
    setWorkspaceSearchFilter("");
    e?.stopPropagation();
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

  // Automatically select the first workspace when workspaces are loaded and none is selected
  useEffect(() => {
    if (
      fabricWorkspacesLoadStatus.status === ApiStatus.Loaded &&
      workspaces.length > 0 &&
      !selectedWorkspace
    ) {
      onSelectWorkspace(workspaces[0]);
    }
  }, [
    workspaces,
    selectedWorkspace,
    fabricWorkspacesLoadStatus.status,
    onSelectWorkspace,
  ]);

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
    <div
      className={
        isExplorerCollapsed
          ? styles.workspaceListCollapsed
          : styles.workspaceList
      }
    >
      <div className={styles.workspaceHeader}>
        {!isExplorerCollapsed && (
          <Input
            placeholder={Loc.connectionDialog.searchWorkspaces}
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
              ? Loc.connectionDialog.expandWorkspaceExplorer
              : Loc.connectionDialog.collapseWorkspaceExplorer
          }
          title={
            isExplorerCollapsed
              ? Loc.connectionDialog.expandWorkspaceExplorer
              : Loc.connectionDialog.collapseWorkspaceExplorer
          }
          className={styles.collapseWorkspaceListButton}
        />
      </div>
      {!isExplorerCollapsed && (
        <div
          className={styles.workspaceListContainer}
          style={{ position: "relative" }}
        >
          {fabricWorkspacesLoadStatus.status === ApiStatus.Loading && (
            <div className={styles.workspaceListMessageContainer}>
              <Spinner size="medium" />
              <Text className={styles.messageText}>
                {Loc.connectionDialog.loadingWorkspaces}
              </Text>
            </div>
          )}
          {fabricWorkspacesLoadStatus.status === ApiStatus.Error && (
            <div className={styles.workspaceListMessageContainer}>
              <Tooltip
                content={
                  fabricWorkspacesLoadStatus.message ||
                  Loc.connectionDialog.errorLoadingWorkspaces
                }
                relationship="label"
              >
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
                  <div className={styles.workspaceListMessageContainer}>
                    <Text className={styles.messageText}>
                      {Loc.connectionDialog.noWorkspacesFound}
                    </Text>
                  </div>
                ))}
              {filteredWorkspaces.length > 0 && (
                <List
                  role="listbox"
                  aria-label={Loc.connectionDialog.fabricWorkspaces}
                  selectionMode="single"
                  navigationMode="composite"
                  selectedItems={selectedItems}
                  onSelectionChange={onSelectionChange}
                >
                  {filteredWorkspaces.map((workspace) => (
                    <FabricWorkspaceListItem
                      key={workspace.id}
                      workspace={workspace}
                      isSelected={selectedItems.includes(workspace.id)}
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

const FabricWorkspaceListItem = ({
  workspace,
  isSelected,
}: FabricWorkspaceListItemProps) => {
  const styles = useFabricExplorerStyles();

  return (
    <ListItem
      key={workspace.id}
      value={workspace.id}
      className={mergeClasses(
        styles.workspaceItem,
        isSelected && styles.workspaceItemSelected,
      )}
      aria-label={workspace.displayName}
      title={workspace.displayName}
      // eslint-disable-next-line no-restricted-syntax
      checkmark={null}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          minHeight: "20px",
        }}
      >
        {/* Icon container with consistent styling */}
        <div className={styles.iconContainer}>
          {/* display error if workspace status is errored */}
          {workspace.loadStatus.status === ApiStatus.Error && (
            <Tooltip
              content={workspace.loadStatus.message ?? ""}
              relationship="label"
            >
              <ErrorCircleRegular
                style={{
                  width: "100%",
                  height: "100%",
                }}
              />
            </Tooltip>
          )}
          {/* display loading spinner */}
          {workspace.loadStatus.status === ApiStatus.Loading && (
            <Spinner
              size="extra-tiny"
              style={{
                width: "100%",
                height: "100%",
              }}
            />
          )}
          {/* display workspace icon */}
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
          }}
        >
          {workspace.displayName}
        </Text>
      </div>
    </ListItem>
  );
};

interface FabricWorkspacesListProps {
  workspaces: FabricWorkspaceInfo[];
  onSelectWorkspace: (workspace: FabricWorkspaceInfo) => void;
  selectedWorkspace?: FabricWorkspaceInfo;
  fabricWorkspacesLoadStatus: Status;
}

interface FabricWorkspaceListItemProps {
  workspace: FabricWorkspaceInfo;
  isSelected: boolean;
}
