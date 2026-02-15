/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Toolbar, makeStyles, Tab, TabList, shorthands } from "@fluentui/react-components";
import { Editor } from "@monaco-editor/react";
import { ImperativePanelHandle, Panel } from "react-resizable-panels";
import { resolveVscodeThemeType } from "./utils";
import { ColorThemeKind } from "../../sharedInterfaces/webview";
import * as FluentIcons from "@fluentui/react-icons";
import { locConstants } from "./locConstants";
import { useRef, useState, forwardRef, useImperativeHandle, ReactElement, ReactNode } from "react";

const useStyles = makeStyles({
    resizeHandle: {
        position: "absolute",
        top: "0",
        right: "0",
        width: "100%",
        height: "10px",
        cursor: "ns-resize",
        zIndex: 1,
        boxShadow: "0px -1px 1px  var(--vscode-editorWidget-border)",
    },
    resizePaneContainer: {
        width: "100%",
        position: "relative",
    },
    header: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexShrink: 0,
        minWidth: 0,
    },
    ribbon: {
        width: "100%",
        display: "flex",
        flexDirection: "row",
        "> *": {
            marginRight: "10px",
        },
        padding: "5px 0px",
    },
    designerDefinitionPaneTabs: {
        flex: 1,
    },
    tabContent: {
        ...shorthands.flex(1),
        width: "100%",
        display: "flex",
        minHeight: 0,
        minWidth: 0,
        ...shorthands.overflow("hidden"),
    },
    designerDefinitionPaneScript: {
        width: "100%",
        height: "100%",
        minHeight: 0,
        minWidth: 0,
        position: "relative",
    },
    paneContent: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        minWidth: 0,
        ...shorthands.overflow("hidden"),
    },
    tabsContainer: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        minWidth: 0,
    },
    headerToolbar: {
        gap: "3px",
        flexShrink: 0,
    },
});

const DEFAULTPANEL_SIZE = 25;
const MINIMUMPANEL_SIZE = 10;
const MAXIMUMPANEL_SIZE = 100;

export enum DesignerDefinitionTabs {
    Script = "script",
}

export type DesignerDefinitionTabValue = DesignerDefinitionTabs | string;

export interface DesignerDefinitionCustomTab {
    id: string;
    label: string;
    content: ReactNode;
    headerActions?: ReactNode;
}

export interface DesignerDefinitionPaneRef {
    openPanel: (size?: number) => void;
    closePanel: () => void;
    togglePanel: (size?: number) => void;
    isCollapsed: () => boolean;
}

interface DesignerDefinitionPaneProps {
    script: string;
    themeKind: ColorThemeKind;
    openInEditor: (script: string) => void;
    copyToClipboard: (script: string) => void;
    activeTab?: DesignerDefinitionTabValue;
    setActiveTab?: (tab: DesignerDefinitionTabValue) => void;
    onClose?: () => void;
    language?: string;
    customTabs?: DesignerDefinitionCustomTab[];
    onPanelVisibilityChange?: (isVisible: boolean) => void;
    headerActions?: ReactNode;
}

export const DesignerDefinitionPane = forwardRef<
    DesignerDefinitionPaneRef,
    DesignerDefinitionPaneProps
>(
    (
        {
            script,
            themeKind,
            openInEditor,
            copyToClipboard,
            activeTab,
            setActiveTab,
            onClose,
            language = "sql",
            customTabs,
            onPanelVisibilityChange,
            headerActions,
        },
        ref,
    ) => {
        const classes = useStyles();
        const panelRef = useRef<ImperativePanelHandle>(null);
        const [expandCollapseButtonLabel, setExpandCollapseButtonLabel] = useState<string>(
            locConstants.tableDesigner.maximizePanelSize,
        );
        const [expandCollapseButtonIcon, setExpandCollapseButtonIcon] = useState<ReactElement>(
            <FluentIcons.ChevronUp12Filled />,
        );
        const selectedTab = activeTab ?? DesignerDefinitionTabs.Script;
        const activeCustomTab = customTabs?.find((tab) => tab.id === selectedTab);
        const selectedHeaderActions =
            selectedTab === DesignerDefinitionTabs.Script
                ? headerActions
                : activeCustomTab?.headerActions;

        useImperativeHandle(
            ref,
            () => ({
                openPanel: (size: number = DEFAULTPANEL_SIZE) => {
                    if (panelRef.current?.isCollapsed()) {
                        panelRef.current.expand(size);
                    }
                },
                closePanel: () => {
                    if (panelRef.current && !panelRef.current.isCollapsed()) {
                        panelRef.current.collapse();
                    }
                },
                togglePanel: (size: number = DEFAULTPANEL_SIZE) => {
                    if (panelRef.current?.isCollapsed()) {
                        panelRef.current.expand(size);
                    } else {
                        panelRef?.current?.collapse();
                    }
                },
                isCollapsed: () => {
                    return panelRef.current?.isCollapsed() ?? true;
                },
            }),
            [],
        );

        return (
            <Panel
                collapsible
                minSize={MINIMUMPANEL_SIZE}
                ref={panelRef}
                onResize={(size) => {
                    onPanelVisibilityChange?.(size > 0);
                    if (size > DEFAULTPANEL_SIZE + 1) {
                        setExpandCollapseButtonLabel(locConstants.tableDesigner.restorePanelSize);
                        setExpandCollapseButtonIcon(<FluentIcons.ChevronDown12Filled />);
                    } else {
                        setExpandCollapseButtonLabel(locConstants.tableDesigner.maximizePanelSize);
                        setExpandCollapseButtonIcon(<FluentIcons.ChevronUp12Filled />);
                    }
                }}>
                <div className={classes.paneContent}>
                    <div className={classes.header}>
                        <div className={classes.tabsContainer}>
                            <TabList
                                size="small"
                                selectedValue={selectedTab}
                                onTabSelect={(_event, data) => {
                                    if (!setActiveTab) {
                                        return;
                                    }
                                    setActiveTab(data.value as DesignerDefinitionTabValue);
                                }}>
                                <Tab
                                    value={DesignerDefinitionTabs.Script}
                                    key={DesignerDefinitionTabs.Script}>
                                    {locConstants.schemaDesigner.definition}
                                </Tab>
                                {customTabs?.map((tab) => (
                                    <Tab value={tab.id} key={tab.id}>
                                        {tab.label}
                                    </Tab>
                                ))}
                            </TabList>
                        </div>
                        <Toolbar className={classes.headerToolbar}>
                            {selectedTab === DesignerDefinitionTabs.Script && (
                                <>
                                    <Button
                                        size="small"
                                        appearance="subtle"
                                        title={locConstants.schemaDesigner.openInEditor}
                                        icon={<FluentIcons.Open12Regular />}
                                        onClick={() => openInEditor(script)}>
                                        {locConstants.schemaDesigner.openInEditor}
                                    </Button>
                                    <Button
                                        size="small"
                                        appearance="subtle"
                                        title={locConstants.schemaDesigner.copy}
                                        icon={<FluentIcons.Copy16Regular />}
                                        onClick={() => copyToClipboard(script)}
                                    />
                                </>
                            )}
                            {selectedHeaderActions}

                            <Button
                                size="small"
                                appearance="subtle"
                                onClick={() => {
                                    const currentSize = panelRef.current?.getSize() ?? 0;
                                    const shouldRestore = currentSize > DEFAULTPANEL_SIZE + 1;
                                    if (shouldRestore) {
                                        panelRef.current?.resize(DEFAULTPANEL_SIZE);
                                    } else {
                                        panelRef.current?.resize(MAXIMUMPANEL_SIZE);
                                    }
                                }}
                                title={expandCollapseButtonLabel}
                                icon={expandCollapseButtonIcon}
                            />
                            <Button
                                size="small"
                                appearance="subtle"
                                title={locConstants.schemaDesigner.close}
                                icon={<FluentIcons.Dismiss12Regular />}
                                onClick={() => {
                                    if (panelRef.current) {
                                        panelRef.current.collapse();
                                    }
                                    // Notify parent component that panel is closing
                                    onClose?.();
                                }}
                            />
                        </Toolbar>
                    </div>

                    <div className={classes.tabContent}>
                        {selectedTab === DesignerDefinitionTabs.Script && (
                            <div className={classes.designerDefinitionPaneScript}>
                                <Editor
                                    height={"100%"}
                                    width={"100%"}
                                    language={language}
                                    theme={resolveVscodeThemeType(themeKind)}
                                    value={script}
                                    options={{
                                        readOnly: true,
                                    }}
                                />
                            </div>
                        )}
                        {activeCustomTab && (
                            <div className={classes.designerDefinitionPaneScript}>
                                {activeCustomTab.content}
                            </div>
                        )}
                    </div>
                </div>
            </Panel>
        );
    },
);
