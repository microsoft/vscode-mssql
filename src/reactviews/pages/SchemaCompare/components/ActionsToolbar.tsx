/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar, ToolbarButton } from "@fluentui/react-components";

interface Props {}

const ActionsToolbar: React.FC<Props> = () => {
    return (
        <Toolbar>
            <ToolbarButton>Generate Migration</ToolbarButton>
            <ToolbarButton>Apply Migration</ToolbarButton>
            <ToolbarButton>Options</ToolbarButton>
        </Toolbar>
    );
};

export default ActionsToolbar;
