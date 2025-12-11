/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode, createContext, useCallback, useEffect, useMemo, useState } from "react";
import { getCoreRPCs2 } from "../../common/utils";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { ExecutionPlanProvider } from "../../../sharedInterfaces/executionPlan";
import { CoreRPCs } from "../../../sharedInterfaces/webview";
import {
    GridContextMenuAction,
    QueryResultPaneTabs,
    QueryResultReducers,
    QueryResultViewMode,
    QueryResultWebviewState,
} from "../../../sharedInterfaces/queryResult";
import { WebviewRpc } from "../../common/rpc";
import GridContextMenu from "./table/plugins/GridContextMenu";
import HeaderContextMenu, { HeaderContextMenuAction } from "./table/plugins/HeaderContextMenu";
import ColumnMenuPopup, {
    ColumnMenuPopupAnchorRect,
    FilterListItem,
    FilterValue,
} from "./table/plugins/ColumnMenuPopup";
import { TableColumnResizeDialog } from "./table/TableColumnResizeDialog";

export interface ColumnFilterPopupOptions {
    columnId: string;
    anchorRect: ColumnMenuPopupAnchorRect;
    items: FilterListItem[];
    initialSelected: FilterValue[];
    onApply: (selected: FilterValue[]) => Promise<void>;
    onClear: () => Promise<void>;
    onDismiss: () => void;
}

/**
 * Options for opening the resize column dialog
 */
type ResizeColumnDialogState = {
    open: boolean;
    columnId: string;
    columnName: string;
    initialWidth: number;
    gridId: string;
    onSubmit: (width: number) => Promise<void> | void;
    onDismiss: () => void;
};

export interface QueryResultReactProvider
    extends Omit<ExecutionPlanProvider, "getExecutionPlan">,
        CoreRPCs {
    extensionRpc: WebviewRpc<QueryResultReducers>;
    setResultTab: (tabId: QueryResultPaneTabs) => void;
    setResultViewMode: (viewMode: QueryResultViewMode) => void;
    // Grid context menu control
    showGridContextMenu: (
        x: number,
        y: number,
        onAction: (action: GridContextMenuAction) => void | Promise<void>,
    ) => void;
    hideGridContextMenu: () => void;
    showColumnFilterPopup: (options: ColumnFilterPopupOptions) => void;
    hideColumnMenuPopup: () => void;
    // Header context menu control
    showHeaderContextMenu: (
        x: number,
        y: number,
        onAction: (action: HeaderContextMenuAction) => void | Promise<void>,
    ) => void;
    hideHeaderContextMenu: () => void;
    /**
     * Gets the execution plan graph from the provider for a result set
     * @param uri the uri of the query result state this request is associated with
     */
    getExecutionPlan(uri: string): void;

    /**
     * Opens a file of type with with specified content
     * @param content the content of the file
     * @param type the type of file to open
     */
    openFileThroughLink(content: string, type: string): void;
    /**
     * Opens the resize column dialog
     * @param options options for the resize dialog
     * @returns void
     */
    openResizeDialog: (options: Partial<ResizeColumnDialogState>) => void;
}

export const QueryResultCommandsContext = createContext<QueryResultReactProvider | undefined>(
    undefined,
);

interface QueryResultProviderProps {
    children: ReactNode;
}

const QueryResultStateProvider: React.FC<QueryResultProviderProps> = ({ children }) => {
    const { extensionRpc } = useVscodeWebview2<QueryResultWebviewState, QueryResultReducers>();
    // Grid context menu state
    const [menuState, setMenuState] = useState<{
        open: boolean;
        x: number;
        y: number;
        onAction?: (action: GridContextMenuAction) => void | Promise<void>;
    }>({ open: false, x: 0, y: 0 });

    const [filterPopupState, setFilterPopupState] = useState<ColumnFilterPopupOptions | undefined>(
        undefined,
    );

    const [headerMenuState, setHeaderMenuState] = useState<{
        open: boolean;
        x: number;
        y: number;
        onAction?: (action: HeaderContextMenuAction) => void | Promise<void>;
    }>({ open: false, x: 0, y: 0 });

    const [resizeDialogState, setResizeDialogState] = useState<ResizeColumnDialogState>({
        open: false,
        columnId: "",
        columnName: "",
        initialWidth: 0,
        gridId: "",
        onDismiss: () => {},
        onSubmit: () => {},
    });

    const hideFilterPopup = useCallback(() => {
        setFilterPopupState((state) => {
            if (state?.onDismiss) {
                state.onDismiss();
            }
            return undefined;
        });
    }, []);

    const hideContextMenu = useCallback(() => {
        setMenuState((s) => (s.open ? { ...s, open: false } : s));
    }, []);

    const hideHeaderContextMenu = useCallback(() => {
        setHeaderMenuState((s) => (s.open ? { ...s, open: false } : s));
    }, []);

    const commands = useMemo<QueryResultReactProvider>(
        () => ({
            extensionRpc,
            ...getCoreRPCs2<QueryResultReducers>(extensionRpc),
            setResultTab: (tabId: QueryResultPaneTabs) => {
                extensionRpc.action("setResultTab", { tabId });
            },
            setResultViewMode: (viewMode: QueryResultViewMode) => {
                extensionRpc.action("setResultViewMode", { viewMode });
            },

            // Grid context menu API
            showGridContextMenu: (x: number, y: number, onAction) => {
                hideFilterPopup();
                setMenuState({ open: true, x, y, onAction });
            },
            hideGridContextMenu: () => {
                setMenuState((s) => ({ ...s, open: false }));
            },
            showColumnFilterPopup: (options: ColumnFilterPopupOptions) => {
                setMenuState((s) => (s.open ? { ...s, open: false } : s));
                setFilterPopupState((state) => {
                    state?.onDismiss?.();
                    return { ...options };
                });
            },
            hideColumnMenuPopup: hideFilterPopup,
            // Header context menu API
            showHeaderContextMenu: (x: number, y: number, onAction) => {
                hideFilterPopup();
                hideHeaderContextMenu();
                setHeaderMenuState({ open: true, x, y, onAction });
            },
            hideHeaderContextMenu: () => {
                setHeaderMenuState((s) => ({ ...s, open: false }));
            },

            openFileThroughLink: (content: string, type: string) => {
                extensionRpc.action("openFileThroughLink", { content, type });
            },

            // Execution Plan commands

            /**
             * Gets the execution plan for a specific query result
             * @param uri the uri of the query result state this request is associated with
             */
            getExecutionPlan: (uri: string) => {
                extensionRpc.action("getExecutionPlan", { uri });
            },
            /**
             * Saves the execution plan for a specific query result
             * @param sqlPlanContent the content of the SQL plan to save
             */
            saveExecutionPlan: (sqlPlanContent: string) => {
                extensionRpc.action("saveExecutionPlan", { sqlPlanContent });
            },
            /**
             * Shows the XML representation of the execution plan for a specific query result
             * @param sqlPlanContent the content of the SQL plan to show
             */
            showPlanXml: (sqlPlanContent: string) => {
                extensionRpc.action("showPlanXml", { sqlPlanContent });
            },
            /**
             * Shows the query for a specific query result
             * @param query the query to show
             */
            showQuery: (query: string) => {
                extensionRpc.action("showQuery", { query });
            },
            /**
             * Updates the total cost for a specific query result
             * @param addedCost the cost to add to the total
             */
            updateTotalCost: (addedCost: number) => {
                extensionRpc.action("updateTotalCost", { addedCost });
            },
            openResizeDialog: (options: Partial<ResizeColumnDialogState>) => {
                setResizeDialogState((state) => ({
                    ...state,
                    ...options,
                    open: true,
                }));
            },
        }),
        [extensionRpc, hideFilterPopup, hideHeaderContextMenu],
    );

    // Close context menu when focus leaves the webview or it becomes hidden
    useEffect(() => {
        const closeOverlays = () => {
            hideContextMenu();
            hideFilterPopup();
            hideHeaderContextMenu();
        };
        const handleVisibilityChange = () => {
            if (document.visibilityState === "hidden") {
                closeOverlays();
            }
        };
        window.addEventListener("blur", closeOverlays);
        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => {
            window.removeEventListener("blur", closeOverlays);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, [hideFilterPopup, hideContextMenu, hideHeaderContextMenu]);
    return (
        <QueryResultCommandsContext.Provider value={commands}>
            {children}
            {menuState.open && (
                <GridContextMenu
                    x={menuState.x}
                    y={menuState.y}
                    open={menuState.open}
                    onAction={async (action) => {
                        await menuState.onAction?.(action);
                        setMenuState((s) => ({ ...s, open: false }));
                    }}
                    onClose={() => setMenuState((s) => ({ ...s, open: false }))}
                />
            )}
            {headerMenuState.open && (
                <HeaderContextMenu
                    x={headerMenuState.x}
                    y={headerMenuState.y}
                    open={headerMenuState.open}
                    onAction={async (action) => {
                        await headerMenuState.onAction?.(action);
                        setHeaderMenuState((s) => ({ ...s, open: false }));
                    }}
                    onClose={() => setHeaderMenuState((s) => ({ ...s, open: false }))}
                />
            )}
            {filterPopupState && (
                <ColumnMenuPopup
                    anchorRect={filterPopupState.anchorRect}
                    items={filterPopupState.items}
                    initialSelected={filterPopupState.initialSelected}
                    onApply={async (selected) => {
                        await filterPopupState.onApply(selected);
                        hideFilterPopup();
                    }}
                    onClear={async () => {
                        await filterPopupState.onClear();
                        hideFilterPopup();
                    }}
                    onDismiss={() => {
                        hideFilterPopup();
                    }}
                />
            )}
            {resizeDialogState.open && (
                <TableColumnResizeDialog
                    open={resizeDialogState.open}
                    columnName={resizeDialogState.columnName}
                    initialWidth={resizeDialogState.initialWidth}
                    onSubmit={async (newWidth: number) => {
                        await resizeDialogState.onSubmit(newWidth);
                        setResizeDialogState((state) => ({ ...state, open: false }));
                    }}
                    onDismiss={() => {
                        resizeDialogState.onDismiss();
                        setResizeDialogState((state) => ({ ...state, open: false }));
                    }}
                />
            )}
        </QueryResultCommandsContext.Provider>
    );
};

export { QueryResultStateProvider };
