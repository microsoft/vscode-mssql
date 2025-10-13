/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useContext } from "react";
import {
    makeStyles,
    tokens,
    Button,
    Title3,
    Body1,
    Caption1,
    MessageBar,
    MessageBarBody,
} from "@fluentui/react-components";
import { MigrationScriptPreviewContext } from "./migrationScriptPreviewStateProvider";
import { Warning24Regular, Checkmark24Regular } from "@fluentui/react-icons";

const useStyles = makeStyles({
    container: {
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        backgroundColor: tokens.colorNeutralBackground1,
        color: tokens.colorNeutralForeground1,
    },
    header: {
        padding: tokens.spacingVerticalL,
        borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    title: {
        marginBottom: tokens.spacingVerticalS,
    },
    metadata: {
        display: "flex",
        gap: tokens.spacingHorizontalL,
        marginTop: tokens.spacingVerticalS,
    },
    metadataItem: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXXS,
    },
    metadataLabel: {
        color: tokens.colorNeutralForeground3,
    },
    metadataValue: {
        fontWeight: tokens.fontWeightSemibold,
    },
    warningBanner: {
        margin: tokens.spacingVerticalL,
    },
    scriptContainer: {
        flex: 1,
        overflow: "auto",
        padding: tokens.spacingVerticalL,
    },
    scriptContent: {
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: tokens.fontSizeBase300,
        lineHeight: tokens.lineHeightBase300,
        whiteSpace: "pre-wrap",
        backgroundColor: tokens.colorNeutralBackground3,
        padding: tokens.spacingVerticalL,
        borderRadius: tokens.borderRadiusMedium,
        border: `1px solid ${tokens.colorNeutralStroke1}`,
    },
    footer: {
        padding: tokens.spacingVerticalL,
        borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
        backgroundColor: tokens.colorNeutralBackground2,
        display: "flex",
        justifyContent: "flex-end",
        gap: tokens.spacingHorizontalM,
    },
    executeButton: {
        backgroundColor: tokens.colorPaletteRedBackground3,
        color: tokens.colorNeutralForegroundOnBrand,
        ":hover": {
            backgroundColor: tokens.colorPaletteRedBackground2,
        },
    },
});

export const MigrationScriptPreviewPage: React.FC = () => {
    const context = useContext(MigrationScriptPreviewContext);
    const classes = useStyles();

    if (!context || !context.state) {
        return <div>Loading...</div>;
    }

    const { state, executeScript, cancel } = context;

    return (
        <div className={classes.container}>
            <div className={classes.header}>
                <Title3 className={classes.title}>Review Migration Script</Title3>
                <div className={classes.metadata}>
                    <div className={classes.metadataItem}>
                        <Caption1 className={classes.metadataLabel}>Operation</Caption1>
                        <Body1 className={classes.metadataValue}>{state.operationType}</Body1>
                    </div>
                    <div className={classes.metadataItem}>
                        <Caption1 className={classes.metadataLabel}>Table</Caption1>
                        <Body1 className={classes.metadataValue}>{state.tableName}</Body1>
                    </div>
                </div>
            </div>

            {state.hasDataLoss && (
                <MessageBar
                    intent="warning"
                    className={classes.warningBanner}
                    icon={<Warning24Regular />}>
                    <MessageBarBody>
                        <strong>Warning: Potential Data Loss</strong>
                        <br />
                        This migration script may result in data loss. Please review the script
                        carefully before executing. This operation CANNOT be undone.
                    </MessageBarBody>
                </MessageBar>
            )}

            {!state.hasDataLoss && (
                <MessageBar
                    intent="info"
                    className={classes.warningBanner}
                    icon={<Checkmark24Regular />}>
                    <MessageBarBody>
                        <strong>No Data Loss Expected</strong>
                        <br />
                        This migration script should not result in data loss. However, please review
                        the script carefully before executing.
                    </MessageBarBody>
                </MessageBar>
            )}

            <div className={classes.scriptContainer}>
                <div className={classes.scriptContent}>{state.script}</div>
            </div>

            <div className={classes.footer}>
                <Button appearance="secondary" onClick={cancel}>
                    Cancel
                </Button>
                <Button
                    appearance="primary"
                    className={state.hasDataLoss ? classes.executeButton : undefined}
                    onClick={executeScript}>
                    Execute Script
                </Button>
            </div>
        </div>
    );
};
