/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Spinner, makeStyles, shorthands } from "@fluentui/react-components";
import { useContext, useEffect, useRef } from "react";
import * as designer from "../../../sharedInterfaces/tableDesigner";
import { TableDesignerContext } from "./tableDesignerStateProvider";
import { ErrorCircleRegular } from "@fluentui/react-icons";
import { DesignerPageRibbon } from "./designerPageRibbon";
import { DesignerMainPane } from "./designerMainPane";
import { DesignerPropertiesPane } from "./designerPropertiesPane";
import { DesignerResultPane } from "./designerResultPane";
import { locConstants } from "../../common/locConstants";
import {
    ImperativePanelHandle,
    Panel,
    PanelGroup,
    PanelResizeHandle,
} from "react-resizable-panels";

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
    topPanelContent: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        maxHeight: "100%",
    },
    resultPaneContainer: {
        width: "100%",
        position: "relative",
    },
    propertiesPaneContainer: {
        position: "relative",
        height: "100%",
        width: "100%",
        ...shorthands.overflow("hidden"),
    },
    resizeHandle: {
        height: "2px",
        backgroundColor: "var(--vscode-editorWidget-border)",
    },
    verticalResizeHandle: {
        width: "2px",
        backgroundColor: "var(--vscode-editorWidget-border)",
    },
});

export const TableDesigner = () => {
    const classes = useStyles();
    const context = useContext(TableDesignerContext);
    const tableDesignerState = context?.state;
    const editorRef = useRef<HTMLDivElement>(null);
    const propertiesPanelRef = useRef<ImperativePanelHandle>(null);
    if (!tableDesignerState) {
        return null;
    }

    useEffect(() => {
        if (!context || !context.state.propertiesPaneData) {
            return;
        }
        // Adjust properties panel size when maximize/restore toggles
        if (context.propertiesPaneResizeInfo.isMaximized) {
            propertiesPanelRef.current?.resize(100);
        } else {
            const containerWidth = editorRef.current?.offsetWidth ?? 0;
            if (containerWidth > 0) {
                const desiredPx = context.propertiesPaneResizeInfo.currentWidth || 450;
                const pct = Math.max(10, Math.min(90, (desiredPx / containerWidth) * 100));
                propertiesPanelRef.current?.resize(pct);
            } else {
                // Fallback to a sane default if we can't measure
                propertiesPanelRef.current?.resize(30);
            }
        }
    }, [context?.state.propertiesPaneData, context?.propertiesPaneResizeInfo.isMaximized]);

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
                    <Button
                        className={classes.retryButton}
                        onClick={() => context.initializeTableDesigner()}>
                        {locConstants.tableDesigner.retry}
                    </Button>
                </div>
            )}
            {tableDesignerState.apiState?.initializeState === designer.LoadState.Loaded && (
                <div className={classes.mainContent}>
                    <PanelGroup direction="vertical">
                        <Panel defaultSize={75}>
                            <div className={classes.topPanelContent}>
                                <DesignerPageRibbon />
                                <div className={classes.editor} ref={editorRef}>
                                    <PanelGroup direction="horizontal">
                                        <Panel defaultSize={100} minSize={10} collapsible>
                                            <DesignerMainPane />
                                        </Panel>
                                        <PanelResizeHandle
                                            className={classes.verticalResizeHandle}
                                        />
                                        {context.state.propertiesPaneData && (
                                            <Panel
                                                defaultSize={0}
                                                minSize={10}
                                                collapsible
                                                ref={propertiesPanelRef}
                                                onResize={(size) => {
                                                    const containerWidth =
                                                        editorRef.current?.offsetWidth ?? 0;
                                                    if (containerWidth > 0) {
                                                        const widthPx =
                                                            (size / 100) * containerWidth;
                                                        context.propertiesPaneResizeInfo.setCurrentWidth(
                                                            widthPx,
                                                        );
                                                        if (
                                                            !context.propertiesPaneResizeInfo
                                                                .isMaximized
                                                        ) {
                                                            context.propertiesPaneResizeInfo.setOriginalWidth(
                                                                widthPx,
                                                            );
                                                        }
                                                    }
                                                }}>
                                                <div className={classes.propertiesPaneContainer}>
                                                    <DesignerPropertiesPane />
                                                </div>
                                            </Panel>
                                        )}
                                    </PanelGroup>
                                </div>
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
