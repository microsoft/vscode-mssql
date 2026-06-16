/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";
import { locConstants } from "./locConstants";
import { CheckmarkCircle16Regular } from "@fluentui/react-icons";
const styles = makeStyles({
    copyIndicator: {
        display: "flex",
        justifyContent: "left",
        alignItems: "center",
        color: "var(--vscode-testing-iconPassed)",
        gap: "4px",
    },
});

export const CopyIndicator: React.FC<{ visible: boolean }> = ({ visible }) => {
    const classes = styles();
    // The live region is always rendered so screen readers register it before its
    // contents change. Announcements fire when the inner text is added on copy.
    return (
        <div
            className={classes.copyIndicator}
            role="status"
            aria-live="polite"
            style={{ visibility: visible ? "visible" : "hidden" }}>
            {visible && (
                <>
                    <CheckmarkCircle16Regular />
                    {locConstants.common.copied}
                </>
            )}
        </div>
    );
};
