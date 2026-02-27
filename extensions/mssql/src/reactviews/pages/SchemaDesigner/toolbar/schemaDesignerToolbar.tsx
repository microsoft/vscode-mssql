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
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useContext } from "react";
import { locConstants } from "../../../common/locConstants";

const useStyles = makeStyles({
    toolbarContainer: {
        width: "100%",
        minHeight: "32px",
        padding: "2px 0px",
    },
    toolbar: {
        width: "100%",
        overflowX: "auto",
        overflowY: "hidden",
        alignItems: "center",
        gap: "2px",
        flexWrap: "nowrap",
        "& .fui-Button__content": {
            whiteSpace: "nowrap",
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
    const context = useContext(SchemaDesignerContext);
    const classes = useStyles();

    return (
        <div className={classes.toolbarContainer}>
            <Toolbar size="small" className={classes.toolbar}>
                <PublishChangesDialogButton />
                <ViewDefinitionsButton />
                <ExportDiagramButton />
                <ToolbarDivider />
                <AddTableButton />
                <DeleteNodesButton />
                <ToolbarDivider />
                <UndoRedoButtons />
                <ToolbarDivider />
                <AutoArrangeButton />
                <FilterTablesButton />
                {context.isDabEnabled() && (
                    <>
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
                        />
                        <ToolbarDivider />
                        <ShowChangesButton />
                        <ShowCopilotChangesButton />
                        <ToolbarDivider />
                        <DesignApiButton onNavigateToDab={onNavigateToDab} />
                    </>
                )}
            </Toolbar>
        </div>
    );
}
