/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Toolbar } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { ViewCodeDialogButton } from "./viewCodeDialogButton";
import { ExportDiagramButton } from "./exportDiagramButton";
import { FilterTablesButton } from "./filterTablesButton";
import { SearchTablesButton } from "./searchTablesButton";
import { AddTableButton } from "./addTableButton";
import { PublishChangesDialogButton } from "./publishChangesDialogButton";
import { AutoArrangeButton } from "./autoArrangeButton";

export function SchemaDesignerToolbar() {
    return (
        <Toolbar
            size="small"
            style={{
                gap: "10px",
                paddingTop: "5px",
                paddingBottom: "5px",
                width: "100%",
                overflow: "hidden",
                overflowX: "auto",
            }}
        >
            <Button
                style={{
                    minWidth: "86px",
                }}
                size="small"
                icon={<FluentIcons.ArrowCounterclockwise16Filled />}
            >
                Refresh
            </Button>
            <PublishChangesDialogButton />
            <ViewCodeDialogButton />
            <ExportDiagramButton />
            <AddTableButton />
            <AutoArrangeButton />
            <FilterTablesButton />
            <SearchTablesButton />
        </Toolbar>
    );
}
