/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Tab,
    TabList,
    Theme,
    makeStyles,
    shorthands,
    teamsHighContrastTheme,
    webDarkTheme,
} from "@fluentui/react-components";
import { useContext } from "react";
import {
    OpenFilled,
    ErrorCircleRegular,
    WarningRegular,
    InfoRegular,
    CopyFilled,
    ChevronUpFilled,
    ChevronDownFilled,
} from "@fluentui/react-icons";
import Editor from "@monaco-editor/react";
import { TableDesignerContext } from "./tableDesignerStateProvider";
import {
    DesignerIssue,
    DesignerResultPaneTabs,
    InputBoxProperties,
    TableProperties,
} from "../../../sharedInterfaces/tableDesigner";
import { locConstants } from "../../common/locConstants";
import { List, ListItem } from "@fluentui/react-list-preview";

const useStyles = makeStyles({
    root: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
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
    designerResultPaneTabs: {
        flex: 1,
    },
    tabContent: {
        ...shorthands.flex(1),
        width: "100%",
        height: "100%",
        display: "flex",
        ...shorthands.overflow("auto"),
    },
    designerResultPaneScript: {
        width: "100%",
        height: "100%",
        position: "relative",
    },
    designerResultPaneScriptOpenButton: {
        position: "absolute",
        top: "0px",
        right: "0px",
    },
    issuesContainer: {
        width: "100%",
        height: "100%",
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
            backgroundColor:
                "var(--vscode-editor-selectionHighlightBackground)",
        },
        width: "100%",
    },
});

export const DesignerResultPane = () => {
    const classes = useStyles();
    const state = useContext(TableDesignerContext);
    const metadata = state?.state;
    const getVscodeTheme = (theme: Theme) => {
        switch (theme) {
            case webDarkTheme:
                return "vs-dark";
            case teamsHighContrastTheme:
                return "hc-black";
            default:
                return "light";
        }
    };

    const openAndFocusIssueComponet = async (issue: DesignerIssue) => {
        const issuePath = issue.propertyPath ?? [];
        console.log(`focusing on`, issuePath);
        if (!metadata?.view?.tabs || !state?.provider) {
            return;
        }
        const containingTab = metadata.view.tabs.find((tab) => {
            return tab.components.find((c) => {
                return c.propertyName === issuePath[0];
            });
        });

        if (!containingTab) {
            return;
        } else {
            state.provider.setTab(containingTab.id as any);
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        let tableComponent;
        let tableModel;
        if (issuePath.length > 1) {
            // error is found in a table row. Load properties for the row
            tableComponent = containingTab.components.find(
                (c) => c.propertyName === issuePath[0],
            );
            if (!tableComponent) {
                return;
            }
            tableModel = metadata.model![tableComponent.propertyName];
            if (!tableModel) {
                return;
            }
            state?.provider.setPropertiesComponents({
                componentPath: [issuePath[0], issuePath[1]],
                component: tableComponent,
                model: tableModel,
            });
        }

        let elementToFocus: HTMLElement | undefined = undefined;
        switch (issuePath.length) {
            case 1: // This is a component in the main tab area. Therefore we can directly focus on the component
            case 3: // This is a component in the properties pane. Since we have already loaded the properties pane, we can directly focus on the component
            case 5: // This is a component in the table inside the properties pane. Since we have already loaded the properties pane, we can directly focus on the component
                elementToFocus =
                    state.elementRefs.current[
                        state.provider.getComponentId(issuePath as any)
                    ];
                break;
            case 2: // This is table row. Therefore focuing on the first property of the row
                if (!tableComponent) {
                    return;
                }
                const firstProperty = (
                    tableComponent.componentProperties as TableProperties
                ).itemProperties[0].propertyName;
                elementToFocus =
                    state.elementRefs.current[
                        state.provider.getComponentId([
                            ...issuePath,
                            firstProperty,
                        ] as any)
                    ];
                break;
            case 4: // This is table row in properties pane. Therefore focuing on the first property of the row
                if (!tableComponent) {
                    return;
                }
                const subTableName = issuePath[2];
                const subTableComponent = (
                    tableComponent.componentProperties as TableProperties
                ).itemProperties.find((c) => c.propertyName === subTableName);
                if (!subTableComponent) {
                    return;
                }
                const firstPropertyInSubTable = (
                    subTableComponent.componentProperties as TableProperties
                ).itemProperties[0].propertyName;
                elementToFocus =
                    state.elementRefs.current[
                        state.provider.getComponentId([
                            ...issuePath,
                            firstPropertyInSubTable,
                        ] as any)
                    ];
                break;
            default:
                break;
        }

        if (elementToFocus) {
            elementToFocus.scrollIntoView({
                behavior: "smooth",
                block: "center",
                inline: "center",
            });
            elementToFocus.focus();
        }
    };

    if (!metadata) {
        return undefined;
    }
    return (
        <div className={classes.root}>
            <div className={classes.ribbon}>
                <TabList
                    size="small"
                    selectedValue={metadata.tabStates!.resultPaneTab}
                    onTabSelect={(_event, data) => {
                        state.provider.setResultTab(
                            data.value as DesignerResultPaneTabs,
                        );
                    }}
                    className={classes.designerResultPaneTabs}
                >
                    <Tab
                        value={DesignerResultPaneTabs.Script}
                        key={DesignerResultPaneTabs.Script}
                    >
                        {locConstants.tableDesigner.scriptAsCreate}
                    </Tab>
                    {metadata.issues?.length !== 0 && (
                        <Tab
                            value={DesignerResultPaneTabs.Issues}
                            key={DesignerResultPaneTabs.Issues}
                        >
                            {locConstants.tableDesigner.issuesTabHeader(
                                metadata.issues?.length!,
                            )}
                        </Tab>
                    )}
                </TabList>
                {metadata.tabStates!.resultPaneTab ===
                    DesignerResultPaneTabs.Script && (
                    <>
                        <Button
                            size="small"
                            appearance="outline"
                            onClick={() => state.provider.scriptAsCreate()}
                            title={locConstants.tableDesigner.openInEditor}
                            icon={<OpenFilled />}
                        >
                            {locConstants.tableDesigner.openInEditor}
                        </Button>
                        <Button
                            size="small"
                            appearance="outline"
                            onClick={() =>
                                state.provider.copyScriptAsCreateToClipboard()
                            }
                            title={locConstants.tableDesigner.copyScript}
                            icon={<CopyFilled />}
                        >
                            {locConstants.tableDesigner.copyScript}
                        </Button>
                    </>
                )}
                <Button
                    size="small"
                    appearance="transparent"
                    onClick={() => {
                        if (state.resultPaneResizeInfo.isMaximized) {
                            state.resultPaneResizeInfo.setCurrentHeight(
                                state.resultPaneResizeInfo.originalHeight,
                            );
                        }
                        state.resultPaneResizeInfo.setIsMaximized(
                            !state.resultPaneResizeInfo.isMaximized,
                        );
                    }}
                    title={
                        state.resultPaneResizeInfo.isMaximized
                            ? locConstants.tableDesigner.restorePanelSize
                            : locConstants.tableDesigner.maximizePanelSize
                    }
                    icon={
                        state.resultPaneResizeInfo.isMaximized ? (
                            <ChevronDownFilled />
                        ) : (
                            <ChevronUpFilled />
                        )
                    }
                />
            </div>
            <div className={classes.tabContent}>
                {metadata.tabStates!.resultPaneTab ===
                    DesignerResultPaneTabs.Script && (
                    <div className={classes.designerResultPaneScript}>
                        <Editor
                            height={"100%"}
                            width={"100%"}
                            language="sql"
                            theme={getVscodeTheme(state!.theme!)}
                            value={
                                (
                                    metadata?.model![
                                        "script"
                                    ] as InputBoxProperties
                                ).value ?? ""
                            }
                            options={{
                                readOnly: true,
                            }}
                        ></Editor>
                    </div>
                )}
                {metadata.tabStates!.resultPaneTab ===
                    DesignerResultPaneTabs.Issues &&
                    metadata.issues?.length !== 0 && (
                        <div className={classes.issuesContainer}>
                            <List navigationMode="items">
                                {metadata.issues!.map((item, index) => {
                                    return (
                                        <ListItem
                                            key={`issue-${index}`}
                                            onAction={async () =>
                                                openAndFocusIssueComponet(item)
                                            }
                                        >
                                            <div className={classes.issuesRows}>
                                                {item.severity === "error" && (
                                                    <ErrorCircleRegular
                                                        fontSize={20}
                                                        color="var(--vscode-errorForeground)"
                                                    />
                                                )}
                                                {item.severity ===
                                                    "warning" && (
                                                    <WarningRegular
                                                        fontSize={20}
                                                        color="yellow"
                                                    />
                                                )}
                                                {item.severity ===
                                                    "information" && (
                                                    <InfoRegular
                                                        fontSize={20}
                                                        color="blue"
                                                    />
                                                )}
                                                {item.description}
                                            </div>
                                        </ListItem>
                                    );
                                })}
                            </List>
                        </div>
                    )}
            </div>
        </div>
    );
};
