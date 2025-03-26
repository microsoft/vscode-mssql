/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { useContext } from "react";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { locConstants } from "../../../common/locConstants";

export function AddTableButton() {
    const context = useContext(SchemaDesignerContext);
    if (!context) {
        return undefined;
    }

    return (
        <Button
            icon={<FluentIcons.TableAdd16Regular />}
            size="small"
            onClick={() => {
                if (context?.schemaDesigner) {
                    context.schemaDesigner.addNewTable();
                }
            }}
            title={locConstants.schemaDesigner.addTable}
            appearance="subtle"
        >
            {locConstants.schemaDesigner.addTable}
        </Button>
    );
}
