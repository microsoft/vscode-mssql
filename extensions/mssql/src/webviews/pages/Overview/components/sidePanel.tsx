/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Text, makeStyles, tokens } from "@fluentui/react-components";
import { ReactNode } from "react";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
        padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
        borderRadius: tokens.borderRadiusMedium,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground1,
    },
    header: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalS,
    },
    icon: {
        display: "flex",
        flexShrink: 0,
        color: tokens.colorNeutralForeground3,
    },
    heading: {
        marginTop: 0,
        marginBottom: 0,
        fontSize: "14px",
        lineHeight: "20px",
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground1,
    },
});

interface SidePanelProps {
    title: string;
    icon?: ReactNode;
    children: ReactNode;
}

export const SidePanel = ({ title, icon, children }: SidePanelProps) => {
    const classes = useStyles();
    return (
        <section className={classes.root}>
            <div className={classes.header}>
                {icon && (
                    <span className={classes.icon} aria-hidden="true">
                        {icon}
                    </span>
                )}
                <Text as="h2" className={classes.heading}>
                    {title}
                </Text>
            </div>
            {children}
        </section>
    );
};
