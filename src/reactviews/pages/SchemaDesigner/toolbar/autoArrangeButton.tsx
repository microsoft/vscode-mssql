/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import { useContext } from "react";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";

export function AutoArrangeButton() {
    const context = useContext(SchemaDesignerContext);
    if (!context) {
        return undefined;
    }
    return (
        <Button
            icon={<FluentIcons.Flowchart16Filled />}
            size="small"
            onClick={() => {
                if (context?.schemaDesigner) {
                    context.schemaDesigner.autoLayout();
                }
            }}
            title={locConstants.schemaDesigner.autoArrange}
            appearance="subtle"
        >
            {locConstants.schemaDesigner.autoArrange}
        </Button>
    );
}
