/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";
import { useContext, useEffect, useRef, useState } from "react";
import { locConstants } from "../../../common/locConstants";
import { DabToolbar } from "./dabToolbar";
import { DabEntityTable } from "./dabEntityTable";
import { DabInfoBanner } from "./dabInfoBanner";
import { DabDefinitionsPanel, DabDefinitionsPanelRef } from "./dabDefinitionsPanel";
import { DabDeploymentDialog } from "./deployment/dabDeploymentDialog";
import { DabDeploymentsDialog } from "./deployments/dabDeploymentsDialog";
import { Dab } from "../../../../sharedInterfaces/dab";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useDabContext } from "./dabContext";
import { useSchemaDesignerSelector } from "../schemaDesignerSelector";
import { LoadingLog } from "../../../common/loadingLog";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { defaultDabEntityFilters } from "./dabEntityFilters";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        position: "relative",
        height: "100%",
        width: "100%",
        overflow: "hidden",
    },
    content: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
    },
    panelGroup: {
        flex: 1,
        minHeight: 0,
    },
    panelContent: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
    },
    loadingContainer: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--vscode-editor-background)",
        zIndex: 1000,
    },
    resizeHandle: {
        height: "2px",
        backgroundColor: "var(--vscode-editorWidget-border)",
    },
});

interface DabPageProps {
    activeView?: SchemaDesigner.SchemaDesignerActiveView;
    onNavigateToSchema?: () => void;
}

export const DabPage = ({ activeView, onNavigateToSchema }: DabPageProps) => {
    const classes = useStyles();
    const [entityFilters, setEntityFilters] = useState(defaultDabEntityFilters);
    const schemaDesignerContext = useContext(SchemaDesignerContext);
    const {
        dabConfig,
        initializeDabConfig,
        syncDabConfigWithSchema,
        isInitialized,
        isDabDeploymentSupported,
        isDockerTargetSupported,
        dabDeploymentState,
    } = useDabContext();
    const showDeployments = useSchemaDesignerSelector((s) => s?.enableDeploymentsView) ?? false;
    const isDabTabActive = activeView === SchemaDesigner.SchemaDesignerActiveView.Dab;
    const hasUnsupportedDataTypes =
        dabConfig?.entities.some(
            (e) =>
                !e.isSupported &&
                e.unsupportedReasons?.some((r) => r.type === "unsupportedDataTypes"),
        ) ?? false;
    // Whether this connection can be deployed at all depends on what the
    // toolbar offers. Deploy runs in a container and nothing else, so an
    // authentication the container cannot carry is a dead end. The deployments
    // experience also reaches the CLI, which carries Windows Authentication
    // and an Entra sign-in already on the machine, so there only a connection
    // no target can carry is worth a banner.
    const hasNoWayToDeploy = showDeployments ? !isDabDeploymentSupported : !isDockerTargetSupported;
    const canShowDiscovery = isDabTabActive && isInitialized && Boolean(dabConfig);
    const definitionsPanelRef = useRef<DabDefinitionsPanelRef>(
        undefined as unknown as DabDefinitionsPanelRef,
    );

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

    const isSchemaLoading = !isInitialized;
    const isDabConfigLoading = isInitialized && !dabConfig;
    const loadingMessages = isSchemaLoading
        ? (schemaDesignerContext?.initializationProgressMessages ?? [])
        : [];

    return (
        <div className={classes.root}>
            {/* The toolbar's Deploy button drives the original self-contained
                dialog; the deployments experience drives its own. Only one is
                rendered, so the deployments experience can be removed without
                touching the flow behind Deploy. */}
            {dabDeploymentState.entryPoint === Dab.DabDeploymentEntryPoint.Standalone ? (
                <DabDeploymentDialog />
            ) : (
                <DabDeploymentsDialog />
            )}
            {hasNoWayToDeploy && (
                <DabInfoBanner
                    title={locConstants.schemaDesigner.authenticationNotSupported}
                    message={locConstants.schemaDesigner.dabDeploymentNotSupportedBanner}
                    learnMoreUrl="https://aka.ms/dab-dep-limitation"
                />
            )}
            {hasUnsupportedDataTypes && (
                <DabInfoBanner
                    title={locConstants.schemaDesigner.unsupportedDataTypesDetected}
                    message={locConstants.schemaDesigner.dabUnsupportedDataTypesBanner}
                    learnMoreUrl="https://aka.ms/dab-datatype-limitation"
                />
            )}
            <PanelGroup direction="vertical" className={classes.panelGroup}>
                <Panel defaultSize={100}>
                    <div className={classes.panelContent}>
                        <DabToolbar
                            showDiscovery={canShowDiscovery}
                            onNavigateToSchema={onNavigateToSchema}
                            onViewConfig={() => definitionsPanelRef.current?.openPanel()}
                            entityFilters={entityFilters}
                            setEntityFilters={setEntityFilters}
                        />
                        <div className={classes.content}>
                            <DabEntityTable entityFilters={entityFilters} />
                        </div>
                    </div>
                </Panel>
                <PanelResizeHandle className={classes.resizeHandle} />
                <DabDefinitionsPanel ref={definitionsPanelRef} />
            </PanelGroup>
            {(isSchemaLoading || isDabConfigLoading) && (
                <div className={classes.loadingContainer}>
                    <LoadingLog messages={loadingMessages} minHeight="100%" />
                </div>
            )}
        </div>
    );
};
