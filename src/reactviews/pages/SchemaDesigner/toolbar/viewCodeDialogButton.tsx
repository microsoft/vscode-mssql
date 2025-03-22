/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import { useContext } from "react";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";

export function ViewCodeDialogButton() {
    const context = useContext(SchemaDesignerContext);
    return (
        <Button
            size="small"
            icon={<FluentIcons.Code16Filled />}
            title={locConstants.schemaDesigner.viewCode}
            appearance="subtle"
            onClick={() => {
                context.setIsCodeDrawerOpen(true);
                context.getScript();
            }}
        >
            {locConstants.schemaDesigner.viewCode}
        </Button>
    );
}
