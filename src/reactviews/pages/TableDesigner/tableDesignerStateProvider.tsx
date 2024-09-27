/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode, createContext, useRef, useState } from "react";
import * as designer from "../../../sharedInterfaces/tableDesigner";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { Theme } from "@fluentui/react-components";

export interface TableDesignerState {
    provider: designer.TableDesignerReactProvider;
    state: designer.TableDesignerWebviewState;
    theme: Theme;
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
    addElementRef: (
        path: (string | number)[],
        ref: any,
        UiArea: designer.DesignerUIArea,
    ) => void;
}

const TableDesignerContext = createContext<TableDesignerState | undefined>(
    undefined,
);

interface TableDesignerContextProps {
    children: ReactNode;
}

const TableDesignerStateProvider: React.FC<TableDesignerContextProps> = ({
    children,
}) => {
    const webviewState = useVscodeWebview<
        designer.TableDesignerWebviewState,
        designer.TableDesignerReducers
    >();

    // Result pane height state
    const [resultPaneHeight, setResultPaneHeight] = useState<number>(300);
    const [isResultPaneFullScreen, setIsResultPaneFullScreen] =
        useState<boolean>(false);
    const [originalHeight, setOriginalHeight] = useState<number>(300);

    // Properties pane width state
    const [propertiesPaneWidth, setPropertiesPaneWidth] = useState<number>(500);
    const [isPropertiesPaneFullScreen, setIsPropertiesPaneFullScreen] =
        useState<boolean>(false);
    const [originalWidth, setOriginalWidth] = useState<number>(500);

    const elementRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
    const tableState = webviewState?.state;

    function getComponentId(componentPath: (string | number)[]): string {
        return `${tableState.tableInfo?.id}_${componentPath.join("_")}`;
    }

    return (
        <TableDesignerContext.Provider
            value={{
                provider: {
                    processTableEdit: function (
                        tableChangeInfo: designer.DesignerEdit,
                    ): void {
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
                        webviewState?.extensionRpc.action(
                            "generatePreviewReport",
                            {
                                table: tableState.tableInfo!,
                            },
                        );
                    },
                    initializeTableDesigner: function (): void {
                        webviewState?.extensionRpc.action(
                            "initializeTableDesigner",
                            {
                                table: tableState.tableInfo!,
                            },
                        );
                    },
                    scriptAsCreate: function (): void {
                        webviewState?.extensionRpc.action("scriptAsCreate", {});
                    },
                    copyScriptAsCreateToClipboard: function (): void {
                        webviewState?.extensionRpc.action(
                            "copyScriptAsCreateToClipboard",
                            {},
                        );
                    },
                    setTab: function (
                        tabId: designer.DesignerMainPaneTabs,
                    ): void {
                        webviewState?.extensionRpc.action("setTab", {
                            tabId: tabId,
                        });
                    },
                    getComponentId: getComponentId,
                    getErrorMessage: function (
                        componentPath: (string | number)[],
                    ): string | undefined {
                        const componentPathStr = componentPath.join(".");
                        const result = [];
                        for (const issue of tableState.issues ?? []) {
                            if (issue.propertyPath) {
                                if (
                                    issue.propertyPath?.join(".") ===
                                    componentPathStr
                                ) {
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
                        webviewState?.extensionRpc.action(
                            "setPropertiesComponents",
                            {
                                components: components!,
                            },
                        );
                    },
                    setResultTab: function (
                        tabId: designer.DesignerResultPaneTabs,
                    ): void {
                        webviewState?.extensionRpc.action("setResultTab", {
                            tabId: tabId,
                        });
                    },
                    closeDesigner: function (): void {
                        webviewState?.extensionRpc.action("closeDesigner", {});
                    },
                    continueEditing: function (): void {
                        webviewState?.extensionRpc.action(
                            "continueEditing",
                            {},
                        );
                    },
                },
                state: webviewState?.state as designer.TableDesignerWebviewState,
                theme: webviewState?.theme,
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
                    if (
                        UiArea === "PropertiesView" &&
                        elementRefs.current[key]
                    ) {
                        return;
                    }
                    return (elementRefs.current[key] = ref);
                },
            }}
        >
            {children}
        </TableDesignerContext.Provider>
    );
};

export { TableDesignerContext, TableDesignerStateProvider };
