/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Spinner, Text } from "@fluentui/react-components";
import { useEffect } from "react";
import { locConstants } from "../../../common/locConstants";
import { DabToolbar } from "./dabToolbar";
import { DabEntityTable } from "./dabEntityTable";
import { DabDefinitionsPanel } from "./dabDefinitionsPanel";
import { DabDeploymentDialog } from "./deployment/dabDeploymentDialog";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useDabContext } from "./dabContext";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        overflow: "hidden",
    },
    content: {
        flex: 1,
        overflow: "auto",
    },
    loadingContainer: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: "12px",
    },
    resizeHandle: {
        height: "2px",
        backgroundColor: "var(--vscode-editorWidget-border)",
    },
});

interface DabPageProps {
    activeView?: SchemaDesigner.SchemaDesignerActiveView;
}

export const DabPage = ({ activeView }: DabPageProps) => {
    const classes = useStyles();
    const { dabConfig, initializeDabConfig, syncDabConfigWithSchema, isInitialized } =
        useDabContext();
    const isDabTabActive = activeView === SchemaDesigner.SchemaDesignerActiveView.Dab;
    const canShowDiscovery = isDabTabActive && isInitialized && dabConfig != null;

    // Initialize DAB config when schema is first initialized
    useEffect(() => {
        if (isInitialized && !dabConfig) {
            initializeDabConfig();
        }
    }, [isInitialized, dabConfig, initializeDabConfig]);

    // Sync DAB config with schema when switching to DAB tab
    useEffect(() => {
        if (isInitialized && isDabTabActive && dabConfig) {
            // Incremental sync: add new tables, remove deleted ones, keep existing settings
            syncDabConfigWithSchema();
        }
    }, [activeView]);

    // Show loading state while schema is being initialized
    if (!isInitialized) {
        return (
            <div className={classes.root}>
                <div className={classes.loadingContainer}>
                    <Spinner size="medium" />
                    <Text>{locConstants.schemaDesigner.loading}</Text>
                </div>
            </div>
        );
    }

    // Show loading state while DAB config is being initialized
    if (!dabConfig) {
        return (
            <div className={classes.root}>
                <div className={classes.loadingContainer}>
                    <Spinner size="medium" />
                    <Text>{locConstants.schemaDesigner.initializingDabConfig}</Text>
                </div>
            </div>
        );
    }

    return (
        <div className={classes.root}>
            <DabDeploymentDialog />
            <PanelGroup direction="vertical">
                <Panel defaultSize={100}>
                    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                        <DabToolbar showDiscovery={canShowDiscovery} />
                        <div className={classes.content}>
                            <DabEntityTable />
                        </div>
                    </div>
                </Panel>
                <PanelResizeHandle className={classes.resizeHandle} />
                <DabDefinitionsPanel />
            </PanelGroup>
        </div>
    );
};
