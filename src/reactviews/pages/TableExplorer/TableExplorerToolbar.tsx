/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar, ToolbarButton } from "@fluentui/react-components";
import { SaveRegular } from "@fluentui/react-icons";
import { locConstants as loc } from "../../common/locConstants";
import { useTableExplorerContext } from "./TableExplorerStateProvider";

export const TableExplorerToolbar: React.FC = () => {
    const context = useTableExplorerContext();

    const handleSave = () => {
        context.commitChanges();
    };

    return (
        <Toolbar>
            <ToolbarButton
                aria-label={loc.tableExplorer.save}
                title={loc.tableExplorer.save}
                icon={<SaveRegular />}
                onClick={handleSave}>
                {loc.tableExplorer.save}
            </ToolbarButton>
        </Toolbar>
    );
};
