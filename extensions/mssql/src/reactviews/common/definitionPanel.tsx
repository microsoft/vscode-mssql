/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Toolbar, makeStyles, Tab, TabList } from "@fluentui/react-components";
import { Editor } from "@monaco-editor/react";
import { ImperativePanelHandle, Panel } from "react-resizable-panels";
import { resolveVscodeThemeType } from "./utils";
import { ColorThemeKind } from "../../sharedInterfaces/webview";
import * as FluentIcons from "@fluentui/react-icons";
import { locConstants } from "./locConstants";
import {
    useRef,
    useState,
    forwardRef,
    useImperativeHandle,
    ReactElement,
    ReactNode,
    RefAttributes,
} from "react";

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
    headerTabList: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
    },
    headerToolbar: {
        gap: "3px",
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
    definitionTabs: {
        flex: 1,
    },
    tabContent: {
        flex: "1 1 0",
        width: "100%",
        height: "100%",
        display: "flex",
        overflow: "auto",
    },
    definitionPanelScriptTab: {
        width: "100%",
        height: "100%",
        position: "relative",
    },
});

const SCRIPT_TAB_ID = "script";
const DEFAULTPANEL_SIZE = 25;
const MINIMUMPANEL_SIZE = 10;
const MAXIMUMPANEL_SIZE = 100;

export const DesignerDefinitionTabs = {
    Script: SCRIPT_TAB_ID,
} as const;

export interface DefinitionPanelController {
    openPanel: (size?: number) => void;
    closePanel: () => void;
    togglePanel: (size?: number) => void;
    isCollapsed: () => boolean;
}

export type DefinitionBuiltInTabIdentifier =
    (typeof DesignerDefinitionTabs)[keyof typeof DesignerDefinitionTabs];
export type DefinitionTabIdentifier<TCustomTabId extends string = never> =
    | DefinitionBuiltInTabIdentifier
    | TCustomTabId;

export interface DefinitionPanelCustomTab<TId extends string = string> {
    id: TId;
    label: string;
    content: ReactNode;
    headerActions?: ReactNode;
}

export interface ScriptTabProps {
    value: string;
    themeKind: ColorThemeKind;
    language?: string;
    openInEditor: (script: string) => void;
    copyToClipboard: (script: string) => void;
}

export interface DefintionPanelProps<TCustomTabId extends string = never> {
    activeTab?: DefinitionTabIdentifier<TCustomTabId>;
    scriptTab: ScriptTabProps;
    customTabs?: DefinitionPanelCustomTab<TCustomTabId>[];
    setActiveTab?: (tab: DefinitionTabIdentifier<TCustomTabId>) => void;
    onClose?: () => void;
    onPanelVisibilityChange?: (isVisible: boolean) => void;
}

function getScriptTab(
    props: ScriptTabProps,
    scriptPaneClassName: string,
): DefinitionPanelCustomTab<DefinitionBuiltInTabIdentifier> {
    return {
        id: SCRIPT_TAB_ID,
        label: locConstants.schemaDesigner.definition,
        content: (
            <div className={scriptPaneClassName}>
                <Editor
                    height={"100%"}
                    width={"100%"}
                    language={props.language}
                    theme={resolveVscodeThemeType(props.themeKind)}
                    value={props.value}
                    options={{
                        readOnly: true,
                    }}
                />
            </div>
        ),
        headerActions: (
            <>
                <Button
                    size="small"
                    appearance="subtle"
                    title={locConstants.schemaDesigner.openInEditor}
                    icon={<FluentIcons.Open12Regular />}
                    onClick={() => props.openInEditor(props.value)}>
                    {locConstants.schemaDesigner.openInEditor}
                </Button>
                <Button
                    size="small"
                    appearance="subtle"
                    title={locConstants.schemaDesigner.copy}
                    icon={<FluentIcons.Copy16Regular />}
                    onClick={() => props.copyToClipboard(props.value)}
                />
            </>
        ),
    };
}

type DefinitionPanelComponent = <TCustomTabId extends string = never>(
    props: DefintionPanelProps<TCustomTabId> & RefAttributes<DefinitionPanelController>,
) => ReactElement;

const DefinitionPanelInner = <TCustomTabId extends string = never>(
    {
        activeTab,
        scriptTab,
        customTabs = [],
        setActiveTab,
        onClose,
        onPanelVisibilityChange,
    }: DefintionPanelProps<TCustomTabId>,
    ref: React.ForwardedRef<DefinitionPanelController>,
): ReactElement => {
    const classes = useStyles();
    const panelRef = useRef<ImperativePanelHandle>(undefined as unknown as ImperativePanelHandle);
    const tabs: DefinitionPanelCustomTab<DefinitionTabIdentifier<TCustomTabId>>[] = [
        getScriptTab(scriptTab, classes.definitionPanelScriptTab),
        ...customTabs,
    ];
    const selectedTab: DefinitionTabIdentifier<TCustomTabId> = activeTab ?? SCRIPT_TAB_ID;
    const activeTabDefinition = tabs.find((tab) => tab.id === selectedTab) ?? tabs[0];
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
                    onPanelVisibilityChange?.(true);
                }
            },
            closePanel: () => {
                if (panelRef.current && !panelRef.current.isCollapsed()) {
                    panelRef.current.collapse();
                    onPanelVisibilityChange?.(false);
                }
            },
            togglePanel: (size: number = DEFAULTPANEL_SIZE) => {
                if (panelRef.current?.isCollapsed()) {
                    panelRef.current.expand(size);
                    onPanelVisibilityChange?.(true);
                } else {
                    panelRef?.current?.collapse();
                    onPanelVisibilityChange?.(false);
                }
            },
            isCollapsed: () => {
                return panelRef.current?.isCollapsed() ?? true;
            },
        }),
        [onPanelVisibilityChange],
    );

    return (
        <Panel
            collapsible
            minSize={MINIMUMPANEL_SIZE}
            ref={panelRef}
            onResize={(size) => {
                if (size === MAXIMUMPANEL_SIZE) {
                    setExpandCollapseButtonLabel(locConstants.tableDesigner.restorePanelSize);
                    setExpandCollapseButtonIcon(<FluentIcons.ChevronDown12Filled />);
                } else {
                    setExpandCollapseButtonLabel(locConstants.tableDesigner.maximizePanelSize);
                    setExpandCollapseButtonIcon(<FluentIcons.ChevronUp12Filled />);
                }
            }}
            onExpand={() => onPanelVisibilityChange?.(true)}
            onCollapse={() => onPanelVisibilityChange?.(false)}>
            <div className={classes.header}>
                <div className={classes.headerTabList}>
                    <TabList
                        size="small"
                        selectedValue={selectedTab}
                        onTabSelect={(_event, data) => {
                            if (!setActiveTab) {
                                return;
                            }
                            setActiveTab(data.value as DefinitionTabIdentifier<TCustomTabId>);
                        }}>
                        {tabs.map((tab) => (
                            <Tab value={tab.id} key={tab.id}>
                                {tab.label}
                            </Tab>
                        ))}
                    </TabList>
                </div>
                <Toolbar className={classes.headerToolbar}>
                    {activeTabDefinition?.headerActions}
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
                            onClose?.();
                            onPanelVisibilityChange?.(false);
                        }}
                    />
                </Toolbar>
            </div>
            <div className={classes.tabContent}>{activeTabDefinition?.content}</div>
        </Panel>
    );
};

export const DefinitionPanel = forwardRef(DefinitionPanelInner) as DefinitionPanelComponent;
