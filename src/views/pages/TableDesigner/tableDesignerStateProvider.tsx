/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as designer from "../../../sharedInterfaces/tableDesigner";
import { WebviewContextProps } from "../../../sharedInterfaces/webview";
import { getCoreRPCs } from "../../common/utils";

import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { ReactNode, createContext, useRef, useState } from "react";

export interface TableDesignerContextProps
    extends WebviewContextProps<designer.TableDesignerWebviewState> {
    resultPaneResizeInfo: {
        originalHeight: number;
        setOriginalHeight: (height: number) => void;
        isMaximized: boolean;
        setIsMaximized: (isFullScreen: boolean) => void;
        currentHeight: number;
        setCurrentHeight: (height: number) => void;
    };
    propertiesPaneResizeInfo: {
        originalWidth: number;
        setOriginalWidth: (width: number) => void;
        isMaximized: boolean;
        setIsMaximized: (isFullScreen: boolean) => void;
        currentWidth: number;
        setCurrentWidth: (width: number) => void;
    };
    elementRefs: React.MutableRefObject<{ [key: string]: any | null }>;
    addElementRef: (path: (string | number)[], ref: any, UiArea: designer.DesignerUIArea) => void;

    /**
     * Initialize the table designer for the specified table.
     * @param table the table information.
     */
    initializeTableDesigner(): void;

    /**
     * Process the table change.
     * @param table the table information
     * @param tableChangeInfo the information about the change user made through the UI.
     */
    processTableEdit(tableChangeInfo: designer.DesignerEdit): void;

    /**
     * Publish the changes.
     * @param table the table information
     */
    publishChanges(): void;

    /**
     * Generate script for the changes.
     * @param table the table information
     */
    generateScript(): void;

    /**
     * Generate preview report describing the changes to be made.
     * @param table the table information
     */
    generatePreviewReport(): void;

    /**
     * Change the active tab of table designer pane.
     * @param tabId
     */
    setTab: (tabId: designer.DesignerMainPaneTabs) => void;

    /**
     * Create a new sql create script for the table.
     */
    scriptAsCreate: () => void;

    /**
     * Copy the 'Script as create' script to the clipboard.
     */
    copyScriptAsCreateToClipboard: () => void;

    /**
     * Get the unique id for the component.
     * @param componentPath the path of the component.
     */
    getComponentId: (componentPath: (string | number)[]) => string;

    /**
     * Get the error message for the component.
     * @param componentPath the path of the component.
     */
    getErrorMessage: (componentPath: (string | number)[]) => string | undefined;

    /**
     * Set the properties components.
     * @param data the properties components data.
     */
    setPropertiesComponents: (data: designer.PropertiesPaneData | undefined) => void;

    /**
     * Set the active result pane tab.
     * @param tabId the tab id.
     */
    setResultTab: (tabId: designer.DesignerResultPaneTabs) => void;

    /**
     * Close the table designer.
     */
    closeDesigner: () => void;

    /**
     * Continue editing the table.
     */
    continueEditing: () => void;

    /**
     * Copy the publish error to the clipboard.
     */
    copyPublishErrorToClipboard: () => void;
}

const TableDesignerContext = createContext<TableDesignerContextProps | undefined>(undefined);

interface TableDesignerProviderProps {
    children: ReactNode;
}

const TableDesignerStateProvider: React.FC<TableDesignerProviderProps> = ({ children }) => {
    const webviewState = useVscodeWebview<
        designer.TableDesignerWebviewState,
        designer.TableDesignerReducers
    >();

    // Result pane height state
    const [resultPaneHeight, setResultPaneHeight] = useState<number>(300);
    const [isResultPaneFullScreen, setIsResultPaneFullScreen] = useState<boolean>(false);
    const [originalHeight, setOriginalHeight] = useState<number>(300);

    // Properties pane width state
    const [propertiesPaneWidth, setPropertiesPaneWidth] = useState<number>(450);
    const [isPropertiesPaneFullScreen, setIsPropertiesPaneFullScreen] = useState<boolean>(false);
    const [originalWidth, setOriginalWidth] = useState<number>(450);

    const elementRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
    const tableState = webviewState?.state;

    function getComponentId(componentPath: (string | number)[]): string {
        return `${tableState.tableInfo?.id}_${componentPath.join("_")}`;
    }

    return (
        <TableDesignerContext.Provider
            value={{
                ...getCoreRPCs(webviewState),
                processTableEdit: function (tableChangeInfo: designer.DesignerEdit): void {
                    webviewState?.extensionRpc.action("processTableEdit", {
                        table: tableState.tableInfo!,
                        tableChangeInfo: tableChangeInfo,
                    });
                },
                publishChanges: function (): void {
                    webviewState?.extensionRpc.action("publishChanges", {
                        table: tableState.tableInfo!,
                    });
                },
                generateScript: function (): void {
                    webviewState?.extensionRpc.action("generateScript", {
                        table: tableState.tableInfo!,
                    });
                },
                generatePreviewReport: function (): void {
                    webviewState?.extensionRpc.action("generatePreviewReport", {
                        table: tableState.tableInfo!,
                    });
                },
                initializeTableDesigner: function (): void {
                    webviewState?.extensionRpc.action("initializeTableDesigner", {
                        table: tableState.tableInfo!,
                    });
                },
                scriptAsCreate: function (): void {
                    webviewState?.extensionRpc.action("scriptAsCreate", {});
                },
                copyScriptAsCreateToClipboard: function (): void {
                    webviewState?.extensionRpc.action("copyScriptAsCreateToClipboard", {});
                },
                setTab: function (tabId: designer.DesignerMainPaneTabs): void {
                    webviewState?.extensionRpc.action("setTab", {
                        tabId: tabId,
                    });
                },
                getComponentId: getComponentId,
                getErrorMessage: function (componentPath: (string | number)[]): string | undefined {
                    const componentPathStr = componentPath.join(".");
                    const result = [];
                    for (const issue of tableState.issues ?? []) {
                        if (issue.propertyPath) {
                            if (issue.propertyPath?.join(".") === componentPathStr) {
                                result.push(issue.description);
                            }
                        }
                    }
                    if (result.length === 0) {
                        return undefined;
                    }
                    return result.join("\n") ?? "";
                },
                setPropertiesComponents: function (
                    components: designer.PropertiesPaneData | undefined,
                ): void {
                    webviewState?.extensionRpc.action("setPropertiesComponents", {
                        components: components!,
                    });
                },
                setResultTab: function (tabId: designer.DesignerResultPaneTabs): void {
                    webviewState?.extensionRpc.action("setResultTab", {
                        tabId: tabId,
                    });
                },
                closeDesigner: function (): void {
                    webviewState?.extensionRpc.action("closeDesigner", {});
                },
                continueEditing: function (): void {
                    webviewState?.extensionRpc.action("continueEditing", {});
                },
                copyPublishErrorToClipboard: function (): void {
                    webviewState?.extensionRpc.action("copyPublishErrorToClipboard", {});
                },
                state: webviewState?.state as designer.TableDesignerWebviewState,
                themeKind: webviewState?.themeKind,
                resultPaneResizeInfo: {
                    originalHeight: originalHeight,
                    setOriginalHeight: setOriginalHeight,
                    isMaximized: isResultPaneFullScreen,
                    setIsMaximized: setIsResultPaneFullScreen,
                    currentHeight: resultPaneHeight,
                    setCurrentHeight: setResultPaneHeight,
                },
                propertiesPaneResizeInfo: {
                    originalWidth: originalWidth,
                    setOriginalWidth: setOriginalWidth,
                    isMaximized: isPropertiesPaneFullScreen,
                    setIsMaximized: setIsPropertiesPaneFullScreen,
                    currentWidth: propertiesPaneWidth,
                    setCurrentWidth: setPropertiesPaneWidth,
                },
                elementRefs: elementRefs,
                addElementRef: function (
                    path: (string | number)[],
                    ref: any,
                    UiArea: designer.DesignerUIArea,
                ): void {
                    const key = getComponentId(path);
                    /**
                     * If the component is in the main view, we don't want to store the reference
                     * of the component copy in the properties view.
                     */
                    if (UiArea === "PropertiesView" && elementRefs.current[key]) {
                        return;
                    }
                    return (elementRefs.current[key] = ref);
                },
            }}>
            {children}
        </TableDesignerContext.Provider>
    );
};

export { TableDesignerContext, TableDesignerStateProvider };
