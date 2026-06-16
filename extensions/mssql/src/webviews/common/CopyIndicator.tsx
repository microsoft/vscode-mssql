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
        color: "var(--vscode-scmGraph-foreground4)",
        gap: "4px",
    },
});

export const CopyIndicator: React.FC<{ visible: boolean }> = ({ visible }) => {
    const classes = styles();
    return (
        <div
            className={classes.copyIndicator}
            role={visible ? "status" : undefined}
            aria-hidden={!visible}
            style={{ visibility: visible ? "visible" : "hidden" }}>
            <CheckmarkCircle16Regular />
            {locConstants.common.copied}
        </div>
    );
};
