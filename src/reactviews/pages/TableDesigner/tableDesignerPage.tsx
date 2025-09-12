/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Divider, Spinner, makeStyles, shorthands } from "@fluentui/react-components";
import { useContext } from "react";
import * as designer from "../../../sharedInterfaces/tableDesigner";
import { TableDesignerContext } from "./tableDesignerStateProvider";
import { ErrorCircleRegular } from "@fluentui/react-icons";
import { ResizableBox } from "react-resizable";
import { DesignerPageRibbon } from "./designerPageRibbon";
import { DesignerMainPane } from "./designerMainPane";
import { DesignerPropertiesPane } from "./designerPropertiesPane";
import { DesignerResultPane } from "./designerResultPane";
import { locConstants } from "../../common/locConstants";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        maxWidth: "100%",
        maxHeight: "100%",
    },
    pageContext: {
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100%",
        width: "100%",
        flexDirection: "column",
    },
    errorIcon: {
        fontSize: "100px",
        opacity: 0.5,
    },
    retryButton: {
        marginTop: "10px",
    },
    resultPaneHandle: {
        position: "absolute",
        top: "0",
        right: "0",
        width: "100%",
        height: "10px",
        cursor: "ns-resize",
        zIndex: 1,
        boxShadow: "0px -1px 1px  var(--vscode-editorWidget-border)",
    },
    propertiesPaneHandle: {
        position: "absolute",
        top: "0",
        left: "0",
        width: "10px",
        height: "100%",
        cursor: "ew-resize",
        zIndex: 1,
        boxShadow: "-1px 0px 1px  var(--vscode-editorWidget-border)",
    },
    designerRibbon: {
        width: "100%",
    },
    mainContent: {
        height: "100%",
        width: "100%",
        minHeight: "100%",
        display: "flex",
        ...shorthands.flex(1),
        flexDirection: "column",
        ...shorthands.overflow("hidden"),
    },
    editor: {
        ...shorthands.overflow("hidden"),
        ...shorthands.flex(1),
        width: "100%",
        display: "flex",
        flexDirection: "row",
    },
    resultPaneContainer: {
        width: "100%",
        position: "relative",
    },
    mainPaneContainer: {
        ...shorthands.flex(1),
        height: "100%",
        ...shorthands.overflow("hidden"),
    },
    propertiesPaneContainer: {
        position: "relative",
        height: "100%",
        width: "300px",
        ...shorthands.overflow("hidden"),
    },
    resizeHandle: {
        height: "2px",
        backgroundColor: "var(--vscode-editorWidget-border)",
    },
});

export const TableDesigner = () => {
    const classes = useStyles();
    const context = useContext(TableDesignerContext);
    const tableDesignerState = context?.state;
    if (!tableDesignerState) {
        return null;
    }

    return (
        <div className={classes.root}>
            {tableDesignerState.apiState?.initializeState === designer.LoadState.Loading && (
                <div className={classes.pageContext}>
                    <Spinner
                        label={locConstants.tableDesigner.loadingTableDesigner}
                        labelPosition="below"
                    />
                </div>
            )}
            {tableDesignerState.apiState?.initializeState === designer.LoadState.Error && (
                <div className={classes.pageContext}>
                    <ErrorCircleRegular className={classes.errorIcon} />
                    <div>{locConstants.tableDesigner.errorLoadingDesigner}</div>
                    <Button className={classes.retryButton}>
                        {locConstants.tableDesigner.retry}
                    </Button>
                </div>
            )}
            {tableDesignerState.apiState?.initializeState === designer.LoadState.Loaded && (
                <div className={classes.mainContent}>
                    <PanelGroup direction="vertical">
                        <Panel defaultSize={75}>
                            <DesignerPageRibbon />
                            <div className={classes.editor}>
                                <div className={classes.mainPaneContainer}>
                                    <DesignerMainPane />
                                </div>
                                {context.state.propertiesPaneData && (
                                    <>
                                        <Divider
                                            style={{
                                                width: "5px",
                                                height: "100%",
                                                flex: 0,
                                            }}
                                            vertical
                                        />
                                        <ResizableBox
                                            width={
                                                context.propertiesPaneResizeInfo.isMaximized
                                                    ? 9999999
                                                    : context.propertiesPaneResizeInfo.currentWidth
                                            }
                                            onResizeStart={(_e, _div) => {
                                                context.propertiesPaneResizeInfo.setIsMaximized(
                                                    false,
                                                );
                                            }}
                                            onResizeStop={(_e, div) => {
                                                const parentContainerWidth =
                                                    div.node!.parentElement!.parentElement!
                                                        .offsetWidth!;

                                                const currentDivWidth = div.size.width;
                                                if (currentDivWidth >= parentContainerWidth - 50) {
                                                    context.propertiesPaneResizeInfo.setIsMaximized(
                                                        true,
                                                    );
                                                    context.propertiesPaneResizeInfo.setCurrentWidth(
                                                        parentContainerWidth,
                                                    );
                                                } else {
                                                    context.propertiesPaneResizeInfo.setCurrentWidth(
                                                        div.size.width,
                                                    );
                                                    context.propertiesPaneResizeInfo.setOriginalWidth(
                                                        div.size.width,
                                                    );
                                                }
                                            }}
                                            height={Infinity}
                                            maxConstraints={[Infinity, Infinity]}
                                            minConstraints={[10, Infinity]}
                                            resizeHandles={["w"]}
                                            handle={
                                                <div className={classes.propertiesPaneHandle} />
                                            }
                                            className={classes.propertiesPaneContainer}>
                                            <DesignerPropertiesPane />
                                        </ResizableBox>
                                    </>
                                )}
                            </div>
                        </Panel>
                        <PanelResizeHandle className={classes.resizeHandle} />
                        <DesignerResultPane />
                    </PanelGroup>
                </div>
            )}
        </div>
    );
};
