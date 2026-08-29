/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, MessageBar, Text, tokens } from "@fluentui/react-components";
import { ErrorCircle16Regular, Warning16Regular } from "@fluentui/react-icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { locConstants } from "../../../common/locConstants";
import { useDabContext } from "./dabContext";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        minHeight: 0,
        padding: "4px 8px",
        boxSizing: "border-box",
        gap: "6px",
    },
    centered: {
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "10px",
        textAlign: "center",
    },
    actions: {
        display: "flex",
        gap: "8px",
    },
    list: {
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
    },
    listInner: {
        position: "relative",
        width: "100%",
    },
    row: {
        position: "absolute",
        left: 0,
        right: 0,
        display: "flex",
        alignItems: "flex-start",
        gap: "8px",
        minHeight: "36px",
        padding: "6px 8px",
        boxSizing: "border-box",
        borderBottom: "1px solid var(--vscode-panel-border)",
        color: tokens.colorNeutralForeground1,
        ":hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
        },
    },
    severity: {
        width: "68px",
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
    },
    severityLabel: {
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
        fontWeight: tokens.fontWeightSemibold,
    },
    errorIcon: {
        color: "var(--vscode-errorForeground)",
    },
    warningIcon: {
        color: "var(--vscode-editorWarning-foreground)",
    },
    message: {
        flex: 1,
        minWidth: 0,
        fontSize: tokens.fontSizeBase200,
        lineHeight: tokens.lineHeightBase200,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
    },
    location: {
        flexShrink: 0,
        color: tokens.colorNeutralForeground3,
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: tokens.fontSizeBase100,
        lineHeight: tokens.lineHeightBase200,
        paddingInlineStart: "4px",
    },
});

export const DabValidationPanel = () => {
    const classes = useStyles();
    const { dabValidationState, retryDabCliSetup, openDabDotnetSettings, openLogsInNewTab } =
        useDabContext();
    const scrollRef = useRef<HTMLDivElement>(null);
    const diagnostics = dabValidationState.diagnostics;
    const virtualizer = useVirtualizer({
        count: diagnostics.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 36,
        overscan: 8,
    });

    if (dabValidationState.status === "blocked") {
        const setup = dabValidationState.setup;
        const isMissingRuntime = setup.status === "missingRuntime";
        return (
            <div className={classes.root}>
                <div className={classes.centered}>
                    <ErrorCircle16Regular />
                    <Text weight="semibold">
                        {locConstants.schemaDesigner.dabValidationUnavailable}
                    </Text>
                    <Text>
                        {setup.reason ??
                            (isMissingRuntime
                                ? locConstants.schemaDesigner.dabMissingDotnetRuntime
                                : locConstants.schemaDesigner.dabCliInstallFailed)}
                    </Text>
                    <div className={classes.actions}>
                        {isMissingRuntime && (
                            <Button onClick={openDabDotnetSettings}>
                                {locConstants.schemaDesigner.dabOpenSettings}
                            </Button>
                        )}
                        <Button appearance="primary" onClick={retryDabCliSetup}>
                            {locConstants.schemaDesigner.dabRetrySetup}
                        </Button>
                        {!isMissingRuntime && setup.logs && (
                            <Button onClick={() => openLogsInNewTab(setup.logs ?? "")}>
                                {locConstants.schemaDesigner.dabViewLogs}
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    if (dabValidationState.status === "valid" && diagnostics.length === 0) {
        return (
            <div className={classes.root}>
                <MessageBar intent="success">
                    {locConstants.schemaDesigner.dabConfigValid}
                </MessageBar>
            </div>
        );
    }

    if (diagnostics.length === 0) {
        return <div className={classes.root} />;
    }

    return (
        <div className={classes.root}>
            <div ref={scrollRef} className={classes.list}>
                <div
                    className={classes.listInner}
                    style={{ height: `${virtualizer.getTotalSize()}px` }}>
                    {virtualizer.getVirtualItems().map((item) => {
                        const diagnostic = diagnostics[item.index];
                        const hasLocation =
                            diagnostic.line !== undefined && diagnostic.column !== undefined;
                        return (
                            <div
                                key={item.key}
                                className={classes.row}
                                ref={virtualizer.measureElement}
                                data-index={item.index}
                                style={{ transform: `translateY(${item.start}px)` }}>
                                <span className={classes.severity}>
                                    {diagnostic.severity === "error" ? (
                                        <ErrorCircle16Regular className={classes.errorIcon} />
                                    ) : (
                                        <Warning16Regular className={classes.warningIcon} />
                                    )}
                                    <Text className={classes.severityLabel}>
                                        {diagnostic.severity === "error"
                                            ? locConstants.schemaDesigner.dabValidationError
                                            : locConstants.schemaDesigner.dabValidationWarning}
                                    </Text>
                                </span>
                                <Text className={classes.message}>{diagnostic.message}</Text>
                                {hasLocation && (
                                    <Text className={classes.location}>
                                        {locConstants.schemaDesigner.dabValidationLocation(
                                            diagnostic.line!,
                                            diagnostic.column!,
                                        )}
                                    </Text>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
