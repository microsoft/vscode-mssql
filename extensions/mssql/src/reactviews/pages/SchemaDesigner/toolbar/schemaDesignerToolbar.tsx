/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Toolbar, ToolbarDivider } from "@fluentui/react-components";
import { ViewDefinitionsButton } from "./viewDefinitionsButton";
import { ExportDiagramButton } from "./exportDiagramButton";
import { FilterTablesButton } from "./filterTablesButton";
import { AddTableButton } from "./addTableButton";
import { PublishChangesDialogButton } from "./publishChangesDialogButton";
import { AutoArrangeButton } from "./autoArrangeButton";
import { DeleteNodesButton } from "./deleteNodesButton";
import { UndoRedoButtons } from "./undoRedoButton";
import { ShowChangesButton } from "./showChangesButton";
import { ShowCopilotChangesButton } from "./showCopilotChangesButton";
import { SchemaDesignerWebviewCopilotChatEntry } from "../copilot/schemaDesignerWebviewCopilotChatEntry";
import { DesignApiButton } from "./designApiButton";
import { useLayoutEffect, useRef, useState } from "react";
import { locConstants } from "../../../common/locConstants";
import { SchemaDesignerToolbarContext } from "./schemaDesignerToolbarContext";

const useStyles = makeStyles({
    toolbarContainer: {
        width: "100%",
        minHeight: "32px",
        padding: "2px 0px",
    },
    toolbar: {
        width: "100%",
        overflowX: "hidden",
        overflowY: "hidden",
        alignItems: "center",
        gap: "2px",
        flexWrap: "nowrap",
        "& .fui-Button": {
            whiteSpace: "nowrap",
            flexShrink: 0,
        },
    },
});

interface SchemaDesignerToolbarProps {
    showDiscovery: boolean;
    onNavigateToDab?: () => void;
}

export function SchemaDesignerToolbar({
    showDiscovery,
    onNavigateToDab,
}: SchemaDesignerToolbarProps) {
    const classes = useStyles();
    const toolbarRef = useRef<HTMLDivElement | null>(null);
    const [isCompact, setIsCompact] = useState(false);
    /**
     * Stores the scrollWidth measured when the toolbar is rendered with full
     * labels (isCompact === false). We only update this when NOT compact so we
     * have a stable number to compare against when deciding whether to expand.
     */
    const fullWidthRef = useRef(0);

    /**
     * Hysteresis buffer (in px) to prevent flickering at the compact/full
     * boundary. We require a few extra pixels of room before expanding back
     * to full labels so that sub-pixel rounding differences don't cause an
     * immediate re-collapse.
     */
    const HYSTERESIS = 10;

    useLayoutEffect(() => {
        const toolbar = toolbarRef.current;
        if (!toolbar) {
            return;
        }

        const check = () => {
            if (isCompact) {
                // Already compact — expand back only when the container is
                // comfortably wider than the last measured full-label width.
                if (toolbar.clientWidth >= fullWidthRef.current + HYSTERESIS) {
                    setIsCompact(false);
                }
            } else {
                // Full mode — record content width and compact if it overflows.
                fullWidthRef.current = toolbar.scrollWidth;
                if (toolbar.scrollWidth > toolbar.clientWidth + 1) {
                    setIsCompact(true);
                }
            }
        };

        check();

        const observer = new ResizeObserver(check);
        observer.observe(toolbar);
        return () => observer.disconnect();
    }, [isCompact]);

    return (
        <SchemaDesignerToolbarContext.Provider value={{ isCompact }}>
            <div className={classes.toolbarContainer}>
                <Toolbar ref={toolbarRef} size="small" className={classes.toolbar}>
                    <PublishChangesDialogButton />
                    <ViewDefinitionsButton />
                    <ShowChangesButton />
                    <ExportDiagramButton />
                    <ToolbarDivider />
                    <UndoRedoButtons />
                    <ToolbarDivider />
                    <AddTableButton />
                    <DeleteNodesButton />
                    <ToolbarDivider />
                    <AutoArrangeButton />
                    <FilterTablesButton />
                    <ToolbarDivider />
                    <SchemaDesignerWebviewCopilotChatEntry
                        scenario="schemaDesigner"
                        entryPoint="schemaDesignerToolbar"
                        discoveryTitle={
                            locConstants.schemaDesigner.schemaDesignerCopilotDiscoveryTitle
                        }
                        discoveryBody={
                            locConstants.schemaDesigner.schemaDesignerCopilotDiscoveryBody
                        }
                        showDiscovery={showDiscovery}
                        hideLabel={isCompact}
                    />
                    <ShowCopilotChangesButton />
                    <ToolbarDivider />
                    <DesignApiButton onNavigateToDab={onNavigateToDab} />
                </Toolbar>
            </div>
        </SchemaDesignerToolbarContext.Provider>
    );
}
