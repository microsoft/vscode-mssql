/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesignerContext } from "./schemaDesignerStateProvider";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Button, makeStyles } from "@fluentui/react-components";
import eventBus, { SchemaDesignerChangesPanelTab } from "./schemaDesignerEvents";
import {
    DesignerDefinitionPane,
    DesignerDefinitionPaneRef,
    DesignerDefinitionTabValue,
    DesignerDefinitionTabs,
} from "../../common/designerDefinitionPane";
import { locConstants } from "../../common/locConstants";
import { SegmentedControl } from "../../common/segmentedControl";
import { SchemaDesignerChangesPanel } from "./changes/schemaDesignerChangesPanel";
import { SchemaDesignerChangesCodeDiff } from "./changes/schemaDesignerChangesCodeDiff";
import { getVisiblePendingAiSchemaChanges } from "./aiLedger/ledgerUtils";

enum SchemaDesignerDefinitionCustomTabs {
    Changes = "changes",
    PendingAiChanges = "pendingAiChanges",
}

enum SchemaDesignerChangesViewMode {
    List = "list",
    Code = "code",
}

type SchemaDesignerDefinitionTab = DesignerDefinitionTabs | SchemaDesignerDefinitionCustomTabs;

const DEFAULT_PANEL_SIZE = 25;

const useStyles = makeStyles({
    changesViewModeButton: {
        minWidth: "92px",
    },
});

interface ChangesTabToolbarActionsProps {
    changesViewMode: SchemaDesignerChangesViewMode;
    setChangesViewMode: (mode: SchemaDesignerChangesViewMode) => void;
    buttonClassName: string;
}

const ChangesTabToolbarActions = ({
    changesViewMode,
    setChangesViewMode,
    buttonClassName,
}: ChangesTabToolbarActionsProps) => {
    return (
        <SegmentedControl<SchemaDesignerChangesViewMode>
            value={changesViewMode}
            ariaLabel={locConstants.schemaDesigner.changesViewModeLabel}
            options={[
                {
                    value: SchemaDesignerChangesViewMode.List,
                    label: locConstants.schemaDesigner.changesListView,
                },
                {
                    value: SchemaDesignerChangesViewMode.Code,
                    label: locConstants.schemaDesigner.codeChangesView,
                },
            ]}
            onValueChange={setChangesViewMode}
            buttonClassName={buttonClassName}
        />
    );
};

interface PendingAiTabToolbarActionsProps {
    onKeepAll: () => void;
    onUndoAll: () => void;
    disabled: boolean;
}

const PendingAiTabToolbarActions = ({
    onKeepAll,
    onUndoAll,
    disabled,
}: PendingAiTabToolbarActionsProps) => {
    return (
        <>
            <Button size="small" appearance="primary" onClick={onKeepAll} disabled={disabled}>
                {locConstants.schemaDesigner.keepAll}
            </Button>
            <Button size="small" appearance="subtle" onClick={onUndoAll} disabled={disabled}>
                {locConstants.schemaDesigner.undoAll}
            </Button>
        </>
    );
};

export const SchemaDesignerDefinitionsPanel = () => {
    const classes = useStyles();
    const {
        aiLedger,
        changesPanelTab,
        copyToClipboard,
        getDefinition,
        getBaselineDefinition,
        openInEditor,
        schemaChangesCount,
        keepAllAiLedger,
        undoAllAiLedger,
        setChangesPanelTab,
        setIsChangesPanelVisible,
        setShowChangesHighlight,
        themeKind,
    } = useContext(SchemaDesignerContext);
    const [code, setCode] = useState<string>("");
    const [baselineCode, setBaselineCode] = useState<string>("");
    const [activeTab, setActiveTab] = useState<SchemaDesignerDefinitionTab>(
        DesignerDefinitionTabs.Script,
    );
    const [changesViewMode, setChangesViewMode] = useState<SchemaDesignerChangesViewMode>(
        SchemaDesignerChangesViewMode.List,
    );
    const [isLoadingCodeDiff, setIsLoadingCodeDiff] = useState(false);
    const [isApplyingPendingAiHeaderAction, setIsApplyingPendingAiHeaderAction] = useState(false);

    const definitionPaneRef = useRef<DesignerDefinitionPaneRef | null>(
        undefined as unknown as DesignerDefinitionPaneRef | null,
    );
    const codeDiffRequestIdRef = useRef(0);

    const pendingAiChangesCount = useMemo(
        () => getVisiblePendingAiSchemaChanges(aiLedger).length,
        [aiLedger],
    );

    const refreshScript = useCallback(async () => {
        const script = await getDefinition();
        setCode(script);
    }, [getDefinition]);
    const refreshCodeDiffScripts = useCallback(async () => {
        const requestId = ++codeDiffRequestIdRef.current;
        setIsLoadingCodeDiff(true);
        try {
            const [baselineScript, currentScript] = await Promise.all([
                getBaselineDefinition(),
                getDefinition(),
            ]);
            if (requestId !== codeDiffRequestIdRef.current) {
                return;
            }
            setBaselineCode(baselineScript);
            setCode(currentScript);
        } catch {
            // Ignore transient script generation failures; next refresh will retry.
        } finally {
            if (requestId === codeDiffRequestIdRef.current) {
                setIsLoadingCodeDiff(false);
            }
        }
    }, [getBaselineDefinition, getDefinition]);

    const activateScriptTab = useCallback(() => {
        setActiveTab(DesignerDefinitionTabs.Script);
        setIsChangesPanelVisible(false);
        setShowChangesHighlight(false);
    }, [setIsChangesPanelVisible, setShowChangesHighlight]);

    const activateChangesTab = useCallback(
        (tab: SchemaDesignerChangesPanelTab = "baseline") => {
            setActiveTab(
                tab === "pendingAi"
                    ? SchemaDesignerDefinitionCustomTabs.PendingAiChanges
                    : SchemaDesignerDefinitionCustomTabs.Changes,
            );
            setChangesPanelTab(tab);
            setIsChangesPanelVisible(true);
            setShowChangesHighlight(true);
        },
        [setChangesPanelTab, setIsChangesPanelVisible, setShowChangesHighlight],
    );

    useEffect(() => {
        const handleGetScript = () => {
            setTimeout(() => {
                void refreshScript();
            }, 0);
        };

        const handleOpenCodeDrawer = () => {
            setTimeout(() => {
                void refreshScript();
            }, 0);

            if (!definitionPaneRef.current) {
                return;
            }

            if (definitionPaneRef.current.isCollapsed()) {
                activateScriptTab();
                definitionPaneRef.current.openPanel(DEFAULT_PANEL_SIZE);
                return;
            }

            if (activeTab === DesignerDefinitionTabs.Script) {
                definitionPaneRef.current.closePanel();
                setIsChangesPanelVisible(false);
                setShowChangesHighlight(false);
                return;
            }

            activateScriptTab();
        };

        const handleOpenChangesPanel = (tab?: SchemaDesignerChangesPanelTab) => {
            activateChangesTab(tab ?? "baseline");

            if (!definitionPaneRef.current) {
                return;
            }

            if (definitionPaneRef.current.isCollapsed()) {
                definitionPaneRef.current.openPanel(DEFAULT_PANEL_SIZE);
            }
        };

        const handleToggleChangesPanel = () => {
            if (!definitionPaneRef.current) {
                return;
            }

            if (definitionPaneRef.current.isCollapsed()) {
                activateChangesTab("baseline");
                definitionPaneRef.current.openPanel(DEFAULT_PANEL_SIZE);
                return;
            }

            if (activeTab !== SchemaDesignerDefinitionCustomTabs.Changes) {
                activateChangesTab("baseline");
                return;
            }

            if (changesPanelTab !== "baseline") {
                setChangesPanelTab("baseline");
                return;
            }

            definitionPaneRef.current.closePanel();
            setIsChangesPanelVisible(false);
            setShowChangesHighlight(false);
        };

        eventBus.on("getScript", handleGetScript);
        eventBus.on("openCodeDrawer", handleOpenCodeDrawer);
        eventBus.on("openChangesPanel", handleOpenChangesPanel);
        eventBus.on("toggleChangesPanel", handleToggleChangesPanel);

        return () => {
            eventBus.off("getScript", handleGetScript);
            eventBus.off("openCodeDrawer", handleOpenCodeDrawer);
            eventBus.off("openChangesPanel", handleOpenChangesPanel);
            eventBus.off("toggleChangesPanel", handleToggleChangesPanel);
        };
    }, [
        activateChangesTab,
        activateScriptTab,
        activeTab,
        refreshScript,
        changesPanelTab,
        setChangesPanelTab,
        setIsChangesPanelVisible,
        setShowChangesHighlight,
    ]);

    useEffect(() => {
        return () => {
            setIsChangesPanelVisible(false);
            setShowChangesHighlight(false);
        };
    }, [setIsChangesPanelVisible, setShowChangesHighlight]);

    const handleSetActiveTab = (tab: DesignerDefinitionTabValue) => {
        const nextTab = tab as SchemaDesignerDefinitionTab;
        setActiveTab(nextTab);

        if (
            nextTab === SchemaDesignerDefinitionCustomTabs.Changes ||
            nextTab === SchemaDesignerDefinitionCustomTabs.PendingAiChanges
        ) {
            setChangesPanelTab(
                nextTab === SchemaDesignerDefinitionCustomTabs.PendingAiChanges
                    ? "pendingAi"
                    : "baseline",
            );
            setIsChangesPanelVisible(true);
            setShowChangesHighlight(true);
            return;
        }

        setIsChangesPanelVisible(false);
        setShowChangesHighlight(false);
    };

    const changesTabLabel = locConstants.schemaDesigner.changesPanelTitle(schemaChangesCount);
    const pendingAiTabLabel =
        locConstants.schemaDesigner.pendingAiChangesPanelTitle(pendingAiChangesCount);
    const isChangesTabActive =
        activeTab === SchemaDesignerDefinitionCustomTabs.Changes ||
        activeTab === SchemaDesignerDefinitionCustomTabs.PendingAiChanges;
    const isBaselineChangesTabActive = activeTab === SchemaDesignerDefinitionCustomTabs.Changes;

    useEffect(() => {
        if (!isBaselineChangesTabActive || changesViewMode !== SchemaDesignerChangesViewMode.Code) {
            return;
        }

        void refreshCodeDiffScripts();
    }, [changesViewMode, isBaselineChangesTabActive, refreshCodeDiffScripts]);

    useEffect(() => {
        if (
            !isBaselineChangesTabActive ||
            changesViewMode !== SchemaDesignerChangesViewMode.Code ||
            schemaChangesCount !== 0
        ) {
            return;
        }
        let disposed = false;

        const refreshBaseline = async () => {
            try {
                const baselineScript = await getBaselineDefinition();
                if (!disposed) {
                    setBaselineCode(baselineScript);
                }
            } catch {
                // Ignore transient script generation failures; next refresh will retry.
            }
        };
        void refreshBaseline();
        return () => {
            disposed = true;
        };
    }, [changesViewMode, getBaselineDefinition, isBaselineChangesTabActive, schemaChangesCount]);

    const handleKeepAllPendingAi = useCallback(() => {
        if (isApplyingPendingAiHeaderAction) {
            return;
        }
        keepAllAiLedger();
    }, [isApplyingPendingAiHeaderAction, keepAllAiLedger]);

    const handleUndoAllPendingAi = useCallback(async () => {
        if (isApplyingPendingAiHeaderAction) {
            return;
        }
        setIsApplyingPendingAiHeaderAction(true);
        try {
            await undoAllAiLedger();
        } finally {
            setIsApplyingPendingAiHeaderAction(false);
        }
    }, [isApplyingPendingAiHeaderAction, undoAllAiLedger]);

    const changesTabContent =
        changesViewMode === SchemaDesignerChangesViewMode.List ? (
            <SchemaDesignerChangesPanel tab="baseline" />
        ) : (
            <SchemaDesignerChangesCodeDiff
                originalScript={baselineCode}
                modifiedScript={code}
                themeKind={themeKind}
                isLoading={isLoadingCodeDiff}
            />
        );

    const pendingAiTabContent = <SchemaDesignerChangesPanel tab="pendingAi" />;

    return (
        <DesignerDefinitionPane
            ref={definitionPaneRef}
            script={code}
            themeKind={themeKind}
            openInEditor={openInEditor}
            copyToClipboard={copyToClipboard}
            activeTab={activeTab}
            setActiveTab={handleSetActiveTab}
            customTabs={[
                {
                    id: SchemaDesignerDefinitionCustomTabs.Changes,
                    label: changesTabLabel,
                    content: changesTabContent,
                    actions: {
                        toolbarActions: (
                            <ChangesTabToolbarActions
                                changesViewMode={changesViewMode}
                                setChangesViewMode={setChangesViewMode}
                                buttonClassName={classes.changesViewModeButton}
                            />
                        ),
                    },
                },
                {
                    id: SchemaDesignerDefinitionCustomTabs.PendingAiChanges,
                    label: pendingAiTabLabel,
                    content: pendingAiTabContent,
                    actions: {
                        toolbarActions: (
                            <PendingAiTabToolbarActions
                                onKeepAll={handleKeepAllPendingAi}
                                onUndoAll={() => {
                                    void handleUndoAllPendingAi();
                                }}
                                disabled={
                                    isApplyingPendingAiHeaderAction || pendingAiChangesCount === 0
                                }
                            />
                        ),
                    },
                },
            ]}
            onPanelVisibilityChange={(isVisible) => {
                if (!isVisible) {
                    setIsChangesPanelVisible(false);
                    setShowChangesHighlight(false);
                    return;
                }

                if (isChangesTabActive) {
                    setIsChangesPanelVisible(true);
                    setShowChangesHighlight(true);
                }
            }}
            onClose={() => {
                setIsChangesPanelVisible(false);
                setShowChangesHighlight(false);
            }}
        />
    );
};
