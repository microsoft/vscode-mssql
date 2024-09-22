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
    DesignerResultPaneTabs,
    InputBoxProperties,
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
        overflow: "hidden scroll",
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
                                {metadata.issues!.map((item, index) => (
                                    <ListItem
                                        key={`issue-${index}`}
                                        onAction={() => {
                                            const path =
                                                state.provider.getComponentId(
                                                    metadata.issues![index]
                                                        .propertyPath as any,
                                                );
                                            if (path) {
                                                const element =
                                                    state.elementRefs.current[
                                                        path
                                                    ];
                                                if (element) {
                                                    element.scrollIntoView({
                                                        behavior: "smooth",
                                                        block: "center",
                                                        inline: "center",
                                                    });
                                                    element.focus();
                                                }
                                            }
                                        }}
                                    >
                                        <div className={classes.issuesRows}>
                                            {item.severity === "error" && (
                                                <ErrorCircleRegular
                                                    fontSize={20}
                                                    color="var(--vscode-errorForeground)"
                                                />
                                            )}
                                            {item.severity === "warning" && (
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
                                ))}
                            </List>
                        </div>
                    )}
            </div>
        </div>
    );
};
