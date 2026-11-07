/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ReactNode, useEffect, useRef } from "react";
import { makeStyles, mergeClasses, Text, tokens } from "@fluentui/react-components";
import { CheckmarkCircle24Regular } from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";

const useStyles = makeStyles({
    content: {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        maxWidth: "760px",
        width: "100%",
        minWidth: 0,
    },
    heading: { margin: 0, lineHeight: "28px" },
    card: {
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: "8px",
        padding: "16px",
        backgroundColor:
            "color-mix(in srgb, var(--vscode-editorGutter-addedBackground) 15%, var(--vscode-editor-background))",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
    },
    successHeading: { display: "flex", alignItems: "center", gap: "10px" },
    passed: { color: "var(--vscode-testing-iconPassed)" },
    metadata: { margin: 0, display: "flex", flexDirection: "column" },
    row: {
        display: "grid",
        gridTemplateColumns: "120px minmax(0, 1fr)",
        gap: "12px",
        padding: "8px 0",
        "@media (max-width: 480px)": { gridTemplateColumns: "minmax(0, 1fr)", gap: "4px" },
    },
    label: { color: "var(--vscode-descriptionForeground)", lineHeight: "20px" },
    value: { margin: 0, overflowWrap: "anywhere" },
    sql: { fontFamily: "var(--vscode-editor-font-family), monospace" },
    actions: { display: "flex", flexWrap: "wrap", gap: "12px" },
});

export const AzureSqlDatabaseDeploymentComplete = ({
    databaseName,
    metadata,
    cardFooter,
    actions,
    children,
}: {
    databaseName: string;
    metadata: { label: string; value: ReactNode; sql?: boolean }[];
    cardFooter?: ReactNode;
    actions?: ReactNode;
    children?: ReactNode;
}) => {
    const classes = useStyles();
    const strings = locConstants.azureSqlDatabase;
    const heading = useRef<HTMLHeadingElement>(null);
    useEffect(() => {
        const frame = requestAnimationFrame(() => heading.current?.focus());
        return () => cancelAnimationFrame(frame);
    }, []);
    return (
        <section className={classes.content} aria-label={strings.deploymentReady}>
            <Text
                as="h2"
                size={500}
                weight="semibold"
                className={classes.heading}
                aria-live="polite"
                tabIndex={-1}
                ref={heading}>
                {strings.deploymentReady}
            </Text>
            <div className={classes.card}>
                <div className={classes.successHeading} role="status">
                    <CheckmarkCircle24Regular className={classes.passed} aria-hidden />
                    <Text weight="semibold">{databaseName}</Text>
                </div>
                <dl className={classes.metadata}>
                    {metadata.map(({ label, value, sql }) => (
                        <div key={label} className={classes.row}>
                            <dt className={classes.label}>{label}</dt>
                            <dd className={mergeClasses(classes.value, sql && classes.sql)}>
                                {value}
                            </dd>
                        </div>
                    ))}
                </dl>
                {cardFooter}
            </div>
            {actions && <div className={classes.actions}>{actions}</div>}
            {children}
        </section>
    );
};
