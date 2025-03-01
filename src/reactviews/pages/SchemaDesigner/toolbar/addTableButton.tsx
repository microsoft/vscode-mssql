/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";

export function AddTableButton() {
    return (
        <Button
            style={{
                minWidth: "100px",
            }}
            icon={<FluentIcons.Add16Filled />}
            size="small"
        >
            Add Table
        </Button>
    );
}
