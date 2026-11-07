/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Toolbar, ToolbarButton } from "@fluentui/react-components";
import { useContext } from "react";
import { QueryResultCommandsContext } from "./queryResultStateProvider";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import * as qr from "../../../sharedInterfaces/queryResult";
import { locConstants } from "../../common/locConstants";
import { TableRegular } from "@fluentui/react-icons";
import { WebviewAction } from "../../../sharedInterfaces/webview";

export const ACTIONBAR_WIDTH_PX = 30;

const useStyles = makeStyles({
    commandBarContainer: {
        width: `${ACTIONBAR_WIDTH_PX}px`,
        flexShrink: 0,
        overflow: "hidden",
        display: "flex",
        paddingRight: "10px",
    },
    commandBar: {
        width: "100%",
    },
    toolbarButton: {
        width: "32px",
        height: "32px",
        minWidth: "32px",
        minHeight: "32px",
        padding: "4px",
        display: "inline-flex",
        justifyContent: "center",
        alignItems: "center",
        flexShrink: 0,
    },
});

/**
 * The toolbar beside the results text view. The grid view has its own toolbar.
 */
const CommandBar = () => {
    const classes = useStyles();
    const context = useContext(QueryResultCommandsContext);
    const { keyBindings } = useVscodeWebview();

    if (context === undefined) {
        return undefined;
    }

    const toggleToGridViewTooltip = locConstants.queryResult.toggleToGridView(
        keyBindings[WebviewAction.QueryResultSwitchToTextView]?.label,
    );

    return (
        <div className={classes.commandBarContainer}>
            <Toolbar vertical className={classes.commandBar} aria-label="Query result commands">
                <ToolbarButton
                    appearance="subtle"
                    className={classes.toolbarButton}
                    icon={<TableRegular />}
                    aria-label={toggleToGridViewTooltip}
                    title={toggleToGridViewTooltip}
                    onClick={() => context.setResultViewMode(qr.QueryResultViewMode.Grid)}
                />
            </Toolbar>
        </div>
    );
};

export default CommandBar;
