/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Toolbar,
    makeStyles,
    Tab,
    TabList,
    shorthands,
    List,
    ListItem,
} from "@fluentui/react-components";
import { Editor } from "@monaco-editor/react";
import { ImperativePanelHandle, Panel } from "react-resizable-panels";
import { resolveVscodeThemeType } from "./utils";
import { ColorThemeKind } from "../../sharedInterfaces/webview";
import * as FluentIcons from "@fluentui/react-icons";
import { ErrorCircleRegular, InfoRegular, WarningRegular } from "@fluentui/react-icons";
import { locConstants } from "./locConstants";
import { useRef, useState, forwardRef, useImperativeHandle, ReactElement } from "react";

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
        height: "100%",
        display: "flex",
        ...shorthands.overflow("auto"),
    },
    designerDefinitionPaneScript: {
        width: "100%",
        height: "100%",
        position: "relative",
    },
    issuesContainer: {
        width: "100%",
        height: "calc( 100% - 10px )", // Subtracting 10px to account for padding and hiding double scrollbars
        flexDirection: "column",
        "> *": {
            marginBottom: "10px",
        },
        backgroundColor: "var(--vscode-editor-background)",
        padding: "5px",
        overflow: "hidden auto",
    },
    issuesRows: {
        display: "flex",
        lineHeight: "20px",
        padding: "5px",
        "> *": {
            marginRight: "10px",
        },
        ":hover": {
            backgroundColor: "var(--vscode-editor-selectionHighlightBackground)",
        },
        width: "100%",
    },
});

const DEFAULTPANEL_SIZE = 40;
const MINIMUMPANEL_SIZE = 10;
const MAXIMUMPANEL_SIZE = 100;

export interface DesignerIssue {
    description: string;
    severity: "error" | "warning" | "information";
    propertyPath?: (string | number)[];
}

export enum DesignerDefinitionTabs {
    Script = "script",
    Issues = "issues",
}

export interface DesignerDefinitionPaneRef {
    openPanel: (size?: number) => void;
    closePanel: () => void;
    togglePanel: (size?: number) => void;
    isCollapsed: () => boolean;
}

export const DesignerDefinitionPane = forwardRef<
    DesignerDefinitionPaneRef,
    {
        script: string;
        themeKind: ColorThemeKind;
        openInEditor: (script: string) => void;
        copyToClipboard: (script: string) => void;
        issues?: DesignerIssue[];
        onIssueClick?: (issue: DesignerIssue) => void;
        activeTab?: DesignerDefinitionTabs;
        setActiveTab?: (tab: DesignerDefinitionTabs) => void;
    }
>(
    (
        {
            script,
            themeKind,
            openInEditor,
            copyToClipboard,
            issues,
            onIssueClick,
            activeTab,
            setActiveTab,
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
                    if (size === MAXIMUMPANEL_SIZE) {
                        setExpandCollapseButtonLabel(locConstants.tableDesigner.maximizePanelSize);
                        setExpandCollapseButtonIcon(<FluentIcons.ChevronDown12Filled />);
                    } else {
                        setExpandCollapseButtonLabel(locConstants.tableDesigner.maximizePanelSize);
                        setExpandCollapseButtonIcon(<FluentIcons.ChevronUp12Filled />);
                    }
                }}>
                <div className={classes.header}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <TabList
                            size="small"
                            selectedValue={activeTab}
                            onTabSelect={(_event, data) => {
                                if (!setActiveTab) {
                                    return;
                                }
                                setActiveTab(data.value as DesignerDefinitionTabs);
                            }}>
                            <Tab
                                value={DesignerDefinitionTabs.Script}
                                key={DesignerDefinitionTabs.Script}>
                                {locConstants.schemaDesigner.definition}
                            </Tab>
                            {issues && issues.length > 0 && (
                                <Tab
                                    value={DesignerDefinitionTabs.Issues}
                                    key={DesignerDefinitionTabs.Issues}>
                                    {locConstants.tableDesigner.issuesTabHeader(issues.length)}
                                </Tab>
                            )}
                        </TabList>
                    </div>
                    <Toolbar style={{ gap: "3px" }}>
                        {activeTab === DesignerDefinitionTabs.Script && (
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

                        <Button
                            size="small"
                            appearance="subtle"
                            onClick={() => {
                                if (panelRef.current?.getSize() === MAXIMUMPANEL_SIZE) {
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
                            }}
                        />
                    </Toolbar>
                </div>

                <div className={classes.tabContent}>
                    {(!issues ||
                        issues.length === 0 ||
                        activeTab === DesignerDefinitionTabs.Script) && (
                        <div className={classes.designerDefinitionPaneScript}>
                            <Editor
                                height={"100%"}
                                width={"100%"}
                                language="sql"
                                theme={resolveVscodeThemeType(themeKind)}
                                value={script}
                                options={{
                                    readOnly: true,
                                }}
                            />
                        </div>
                    )}
                    {activeTab === DesignerDefinitionTabs.Issues && issues && issues.length > 0 && (
                        <div className={classes.issuesContainer}>
                            <List navigationMode="items">
                                {issues.map((item, index) => (
                                    <ListItem
                                        key={`issue-${index}`}
                                        onAction={() => onIssueClick?.(item)}>
                                        <div className={classes.issuesRows}>
                                            {item.severity === "error" && (
                                                <ErrorCircleRegular
                                                    fontSize={20}
                                                    color="var(--vscode-errorForeground)"
                                                />
                                            )}
                                            {item.severity === "warning" && (
                                                <WarningRegular fontSize={20} color="yellow" />
                                            )}
                                            {item.severity === "information" && (
                                                <InfoRegular fontSize={20} color="blue" />
                                            )}
                                            {item.description}
                                        </div>
                                    </ListItem>
                                ))}
                            </List>
                        </div>
                    )}
                </div>
            </Panel>
        );
    },
);
