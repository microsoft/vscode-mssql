/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import { useContext } from "react";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";

export function DeleteNodesButton() {
    const context = useContext(SchemaDesignerContext);
    return (
        <Button
            size="small"
            icon={<FluentIcons.Delete16Filled />}
            title={locConstants.schemaDesigner.deleteNodes}
            appearance="subtle"
            onClick={() => {
                if (context.schemaDesigner) {
                    const selectedCell =
                        context.schemaDesigner.mxGraph.getSelectionCell();
                    if (selectedCell) {
                        context.schemaDesigner.mxGraph.removeCells([
                            selectedCell,
                        ]);
                    }
                }
            }}
        >
            {locConstants.schemaDesigner.deleteNodes}
        </Button>
    );
}
