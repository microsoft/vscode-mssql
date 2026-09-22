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
        // Outlined in a tint of its own text colour rather than filled with a flat grey: the
        // grey version sat on a near-grey background and had to be hunted for.
        border: `1px solid color-mix(in srgb, ${tokens.colorBrandForegroundLink} 24%, transparent)`,
        // The editor font, so a version number lines up the way a version number should.
        fontFamily: "var(--vscode-editor-font-family), monospace",
    },
});

/**
 * Extension version, shown beside a page title.
 *
 * Shared rather than restyled per page: the Welcome header, its What's new drawer and the
 * Changelog page each carried their own copy of this, with a comment in each claiming it
 * matched the others.
 */
export const VersionBadge = ({ version }: { version: string }) => {
    const classes = useStyles();
    return <span className={classes.badge}>{locConstants.overview.version(version)}</span>;
};
