/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TextView } from "./textView";
import { makeStyles } from "@fluentui/react-components";
import CommandBar, { ACTIONBAR_WIDTH_PX } from "./commandBar";

const useStyles = makeStyles({
    textViewContainer: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        fontWeight: "normal",
    },
});

export const QueryResultsTextView = () => {
    const classes = useStyles();

    return (
        <div className={classes.textViewContainer}>
            <div style={{ flex: 1, display: "flex", flexDirection: "row" }}>
                <div
                    style={{
                        width: `calc(100% - ${ACTIONBAR_WIDTH_PX}px)`,
                        height: "100%",
                    }}>
                    <TextView />
                </div>
                <CommandBar />
            </div>
        </div>
    );
};
