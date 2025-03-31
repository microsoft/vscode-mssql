/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar, ToolbarDivider } from "@fluentui/react-components";
import { ViewCodeDialogButton } from "./viewCodeDialogButton";
import { ExportDiagramButton } from "./exportDiagramButton";
import { FilterTablesButton } from "./filterTablesButton";
import { AddTableButton } from "./addTableButton";
import { PublishChangesDialogButton } from "./publishChangesDialogButton";
import { AutoArrangeButton } from "./autoArrangeButton";
import { DeleteNodesButton } from "./deleteNodesButton";

export function SchemaDesignerToolbar() {
    return (
        <Toolbar
            size="small"
            style={{
                paddingTop: "5px",
                paddingBottom: "5px",
                width: "100%",
                overflow: "hidden",
                overflowX: "auto",
            }}>
            <PublishChangesDialogButton />
            <ViewCodeDialogButton />
            <ExportDiagramButton />
            <ToolbarDivider />
            <AddTableButton />
            <AutoArrangeButton />
            <DeleteNodesButton />
            <ToolbarDivider />
            <FilterTablesButton />
        </Toolbar>
    );
}
