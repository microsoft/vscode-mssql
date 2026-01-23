/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar, ToolbarDivider } from "@fluentui/react-components";
import { ViewDefinitionsButton } from "./viewDefinitionsButton";
import { ExportDiagramButton } from "./exportDiagramButton";
import { FilterTablesButton } from "./filterTablesButton";
import { AddTableButton } from "./addTableButton";
import { PublishChangesDialogButton } from "./publishChangesDialogButton";
import { AutoArrangeButton } from "./autoArrangeButton";
import { DeleteNodesButton } from "./deleteNodesButton";
import { UndoRedoButtons } from "./undoRedoButton";
import { ShowChangesButton } from "./showChangesButton";

export function SchemaDesignerToolbar() {
    return (
        <div style={{ width: "100%", height: "30px", padding: "5px 0px" }}>
            <Toolbar
                size="small"
                style={{
                    width: "100%",
                    overflow: "hidden",
                    overflowX: "auto",
                    gap: "3px",
                    alignItems: "center",
                }}>
                <PublishChangesDialogButton />
                <ViewDefinitionsButton />
                <ExportDiagramButton />
                <ToolbarDivider />
                <AddTableButton />
                <UndoRedoButtons />
                <AutoArrangeButton />
                <DeleteNodesButton />
                <ToolbarDivider />
                <FilterTablesButton />
                <ToolbarDivider />
                <ShowChangesButton />
            </Toolbar>
        </div>
    );
}
