/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Text, makeStyles, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
    heading: {
        // <h2> carries a browser default margin that would fight the flex gaps around it.
        marginTop: 0,
        marginBottom: 0,
        fontSize: "14px",
        lineHeight: "20px",
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground1,
    },
});

/** Small uppercase label that opens each Overview section. */
export const SectionHeading = ({ children }: { children: string }) => {
    const classes = useStyles();
    return (
        <Text as="h2" className={classes.heading}>
            {children}
        </Text>
    );
};
