/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ReactDOM from "react-dom/client";
import "../../index.css";
import { VscodeWebviewProvider } from "../../common/vscodeWebviewProvider";
import { SchemaDesignerContext, SchemaDesignerStateProvider } from "./schemaDesignerStateProvider";
import { SchemaDesignerPage } from "./schemaDesignerPage";
import { ReactFlowProvider } from "@xyflow/react";
import { useContext, useEffect, useState } from "react";
import { makeStyles, Toolbar, ToolbarButton, tokens } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { DabPage } from "./dab/dabPage";
import { locConstants } from "../../common/locConstants";
import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";

const useStyles = makeStyles({
    root: {
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "row",
    },
    nav: {
        borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
        padding: tokens.spacingVerticalS,
        boxSizing: "border-box",
    },
    navButton: {
        justifyContent: "flex-start",
        width: "100%",
        columnGap: tokens.spacingHorizontalS,
    },
    content: {
        flex: 1,
        minWidth: 0,
        height: "100%",
    },
    dabPlaceholder: {
        height: "100%",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--vscode-foreground)",
        fontSize: tokens.fontSizeBase400,
    },
});

const MainLayout = () => {
    const context = useContext(SchemaDesignerContext);
    const isDabEnabled = context.state?.enableDAB ?? false;
    const [activeView, setActiveView] = useState<SchemaDesigner.SchemaDesignerActiveView>(() =>
        getActiveViewFromState(context.state?.activeView),
    );
    const classes = useStyles();
    const schemaDesignerLabel = locConstants.schemaDesigner.schemaDesignerNavLabel;
    const dabLabel = locConstants.schemaDesigner.dabNavLabel;

    useEffect(() => {
        setActiveView(getActiveViewFromState(context.state?.activeView));
    }, [context.state?.activeView]);

    if (isDabEnabled) {
        return (
            <div className={classes.root}>
                <div className={classes.nav}>
                    <Toolbar vertical>
                        <ToolbarButton
                            appearance={
                                activeView ===
                                SchemaDesigner.SchemaDesignerActiveView.SchemaDesigner
                                    ? "primary"
                                    : "subtle"
                            }
                            className={classes.navButton}
                            icon={<FluentIcons.TableRegular />}
                            onClick={() =>
                                setActiveView(
                                    SchemaDesigner.SchemaDesignerActiveView.SchemaDesigner,
                                )
                            }
                            title={schemaDesignerLabel}
                            aria-label={schemaDesignerLabel}
                        />
                        <ToolbarButton
                            appearance={
                                activeView === SchemaDesigner.SchemaDesignerActiveView.Dab
                                    ? "primary"
                                    : "subtle"
                            }
                            className={classes.navButton}
                            icon={<FluentIcons.DatabaseSearch24Regular />}
                            onClick={() =>
                                setActiveView(SchemaDesigner.SchemaDesignerActiveView.Dab)
                            }
                            title={dabLabel}
                            aria-label={dabLabel}
                        />
                    </Toolbar>
                </div>
                <div className={classes.content}>
                    <div
                        style={{
                            height: "100%",
                            width: "100%",
                            display:
                                activeView ===
                                SchemaDesigner.SchemaDesignerActiveView.SchemaDesigner
                                    ? "block"
                                    : "none",
                        }}>
                        <SchemaDesignerPage />
                    </div>
                    <div
                        style={{
                            height: "100%",
                            width: "100%",
                            display:
                                activeView === SchemaDesigner.SchemaDesignerActiveView.Dab
                                    ? "block"
                                    : "none",
                        }}>
                        <DabPage />
                    </div>
                </div>
            </div>
        );
    }

    return <SchemaDesignerPage />;
};

ReactDOM.createRoot(document.getElementById("root")!).render(
    <VscodeWebviewProvider>
        <ReactFlowProvider>
            <SchemaDesignerStateProvider>
                <MainLayout />
            </SchemaDesignerStateProvider>
        </ReactFlowProvider>
    </VscodeWebviewProvider>,
);

const getActiveViewFromState = (
    view?: SchemaDesigner.SchemaDesignerActiveView,
): SchemaDesigner.SchemaDesignerActiveView => {
    return view === SchemaDesigner.SchemaDesignerActiveView.Dab
        ? SchemaDesigner.SchemaDesignerActiveView.Dab
        : SchemaDesigner.SchemaDesignerActiveView.SchemaDesigner;
};
