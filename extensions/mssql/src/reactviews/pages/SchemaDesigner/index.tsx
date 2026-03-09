/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ReactDOM from "react-dom/client";
import "../../index.css";
import { VscodeWebviewProvider2 } from "../../common/vscodeWebviewProvider2";
import { SchemaDesignerStateProvider } from "./schemaDesignerStateProvider";
import { useSchemaDesignerSelector } from "./schemaDesignerSelector";
import { SchemaDesignerPage } from "./schemaDesignerPage";
import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useState } from "react";
import { makeStyles, Toolbar, ToolbarButton, tokens, Tooltip } from "@fluentui/react-components";
import { TableSettingsRegular } from "@fluentui/react-icons";
import { DabPage } from "./dab/dabPage";
import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import { DabProvider } from "./dab/dabContext";
import { Schema16Regular } from "../../common/icons/fluentIcons";
import { locConstants } from "../../common/locConstants";

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
        boxSizing: "border-box",
    },
    content: {
        flex: 1,
        minWidth: 0,
        height: "100%",
        display: "flex",
    },
});

const MainLayout = () => {
    const stateActiveView = useSchemaDesignerSelector((s) => s?.activeView);
    const [activeView, setActiveView] = useState<SchemaDesigner.SchemaDesignerActiveView>(() =>
        getActiveViewFromState(stateActiveView),
    );
    const classes = useStyles();
    const schemaDesignerLabel = locConstants.schemaDesigner.schemaDesignerNavLabel;
    const dabLabel = locConstants.schemaDesigner.dabNavLabel;

    useEffect(() => {
        setActiveView(getActiveViewFromState(stateActiveView));
    }, [stateActiveView]);

    return (
        <div className={classes.root}>
            <div className={classes.nav}>
                <Toolbar vertical>
                    <Tooltip content={schemaDesignerLabel} relationship="label">
                        <ToolbarButton
                            appearance={
                                activeView ===
                                SchemaDesigner.SchemaDesignerActiveView.SchemaDesigner
                                    ? "primary"
                                    : "subtle"
                            }
                            icon={<Schema16Regular />}
                            onClick={() =>
                                setActiveView(
                                    SchemaDesigner.SchemaDesignerActiveView.SchemaDesigner,
                                )
                            }
                            title={schemaDesignerLabel}
                            aria-label={schemaDesignerLabel}
                        />
                    </Tooltip>
                    <Tooltip content={dabLabel} relationship="label">
                        <ToolbarButton
                            appearance={
                                activeView === SchemaDesigner.SchemaDesignerActiveView.Dab
                                    ? "primary"
                                    : "subtle"
                            }
                            icon={<TableSettingsRegular />}
                            onClick={() =>
                                setActiveView(SchemaDesigner.SchemaDesignerActiveView.Dab)
                            }
                            title={dabLabel}
                            aria-label={dabLabel}
                        />
                    </Tooltip>
                </Toolbar>
            </div>
            <div className={classes.content}>
                <div
                    style={{
                        height: "100%",
                        width: "100%",
                        flex: 1,
                        minWidth: 0,
                        maxWidth: "100%",
                        display:
                            activeView === SchemaDesigner.SchemaDesignerActiveView.SchemaDesigner
                                ? "block"
                                : "none",
                    }}>
                    <SchemaDesignerPage
                        activeView={activeView}
                        onNavigateToDab={() =>
                            setActiveView(SchemaDesigner.SchemaDesignerActiveView.Dab)
                        }
                    />
                </div>
                <div
                    style={{
                        height: "100%",
                        width: "100%",
                        flex: 1,
                        minWidth: 0,
                        maxWidth: "100%",
                        display:
                            activeView === SchemaDesigner.SchemaDesignerActiveView.Dab
                                ? "block"
                                : "none",
                    }}>
                    <DabProvider>
                        <DabPage
                            activeView={activeView}
                            onNavigateToSchema={() =>
                                setActiveView(
                                    SchemaDesigner.SchemaDesignerActiveView.SchemaDesigner,
                                )
                            }
                        />
                    </DabProvider>
                </div>
            </div>
        </div>
    );
};

ReactDOM.createRoot(document.getElementById("root")!).render(
    <VscodeWebviewProvider2>
        <ReactFlowProvider>
            <SchemaDesignerStateProvider>
                <MainLayout />
            </SchemaDesignerStateProvider>
        </ReactFlowProvider>
    </VscodeWebviewProvider2>,
);

const getActiveViewFromState = (
    view?: SchemaDesigner.SchemaDesignerActiveView,
): SchemaDesigner.SchemaDesignerActiveView => {
    return view === SchemaDesigner.SchemaDesignerActiveView.Dab
        ? SchemaDesigner.SchemaDesignerActiveView.Dab
        : SchemaDesigner.SchemaDesignerActiveView.SchemaDesigner;
};
