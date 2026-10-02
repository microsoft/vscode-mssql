/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, tokens } from "@fluentui/react-components";

import { locConstants } from "./locConstants";

const useStyles = makeStyles({
    badge: {
        display: "inline-flex",
        alignItems: "center",
        minHeight: "22px",
        padding: "0 8px",
        borderRadius: "999px",
        fontSize: "11px",
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: tokens.colorBrandForegroundLink,
        border: `1px solid color-mix(in srgb, ${tokens.colorBrandForegroundLink} 24%, transparent)`,
        fontFamily: "var(--vscode-editor-font-family), monospace",
    },
});

export const VersionBadge = ({ version }: { version: string }) => {
    const classes = useStyles();
    return <span className={classes.badge}>{locConstants.overview.version(version)}</span>;
};
