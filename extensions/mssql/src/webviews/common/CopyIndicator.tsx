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
    // The live region stays in the accessibility tree at all times so screen readers
    // register it before its contents change. Only the inner text is toggled, which
    // triggers the announcement when it is added on copy. Avoid visibility:hidden here
    // since it removes the element from the accessibility tree and suppresses the
    // aria-live announcement.
    return (
        <div className={classes.copyIndicator} role="status" aria-live="polite">
            {visible && (
                <>
                    <CheckmarkCircle16Regular />
                    {locConstants.common.copied}
                </>
            )}
        </div>
    );
};
