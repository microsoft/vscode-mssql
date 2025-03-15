/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Toolbar, ToolbarDivider } from "@fluentui/react-components";
import { ViewCodeDialogButton } from "./viewCodeDialogButton";
import { ExportDiagramButton } from "./exportDiagramButton";
import { FilterTablesButton } from "./filterTablesButton";
import { AddTableButton } from "./addTableButton";
import { PublishChangesDialogButton } from "./publishChangesDialogButton";
import { AutoArrangeButton } from "./autoArrangeButton";
import { DeleteNodesButton } from "./deleteNodesButton";
import * as FluentIcons from "@fluentui/react-icons";
import { useContext } from "react";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";

export function SchemaDesignerToolbar() {
    const context = useContext(SchemaDesignerContext);
    return (
        <Toolbar
            size="small"
            style={{
                paddingTop: "5px",
                paddingBottom: "5px",
                width: "100%",
                overflow: "hidden",
                overflowX: "auto",
            }}
        >
            <PublishChangesDialogButton />
            <ViewCodeDialogButton />
            <ExportDiagramButton />
            <ToolbarDivider />
            <AddTableButton />
            <AutoArrangeButton />
            <DeleteNodesButton />
            <Button
                size="small"
                appearance="subtle"
                icon={<FluentIcons.ArrowUndo16Filled />}
                onClick={() => {
                    if (context.schemaDesigner) {
                        context.schemaDesigner.mxEditor.execute("undo");
                    }
                }}
            >
                Undo
            </Button>
            <Button
                size="small"
                appearance="subtle"
                icon={<FluentIcons.ArrowRedo16Filled />}
                onClick={() => {
                    if (context.schemaDesigner) {
                        context.schemaDesigner.mxEditor.execute("redo");
                    }
                }}
            >
                Redo
            </Button>
            <ToolbarDivider />
            <FilterTablesButton />
            {/* <SearchTablesButton /> */}
        </Toolbar>
    );
}
