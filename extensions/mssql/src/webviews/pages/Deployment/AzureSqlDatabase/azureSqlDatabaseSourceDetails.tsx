/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    makeStyles,
    mergeClasses,
    Spinner,
    Text,
    tokens,
} from "@fluentui/react-components";
import { Database20Regular, Table20Regular } from "@fluentui/react-icons";
import { useEffect, useRef, useState } from "react";
import {
    AzureSqlDatabaseRequests,
    LocalDatabaseSource,
    LocalDatabaseDeploymentContent,
} from "../../../../sharedInterfaces/azureSqlDatabase";
import { locConstants } from "../../../common/locConstants";
import {
    DeploymentReducers,
    DeploymentWebviewState,
} from "../../../../sharedInterfaces/deployment";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";

const useStyles = makeStyles({
    details: {
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: "8px",
        backgroundColor: tokens.colorNeutralBackground2,
    },
    header: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "16px 20px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    heading: { margin: 0, flexGrow: 1, fontSize: "16px", lineHeight: "24px" },
    icon: { color: tokens.colorBrandForeground1, flexShrink: 0 },
    fields: {
        display: "grid",
        gridTemplateColumns: "minmax(90px, 140px) minmax(0, 1fr)",
        gap: "12px 20px",
        padding: "20px",
        margin: 0,
        "& dt": { color: "var(--vscode-descriptionForeground)" },
        "& dd": { margin: 0, overflowWrap: "anywhere" },
    },
    connected: { color: "var(--vscode-testing-iconPassed)" },
    notConnected: { color: "var(--vscode-errorForeground)" },
    secondary: { color: "var(--vscode-descriptionForeground)" },
    connecting: { justifyContent: "flex-start" },
    options: { border: "none", padding: 0, margin: 0, minWidth: 0 },
    legend: { padding: 0, marginBottom: "12px", fontWeight: tokens.fontWeightSemibold },
    option: {
        display: "grid",
        gridTemplateColumns: "20px minmax(0, 1fr)",
        gap: "12px",
        padding: "16px 20px",
        marginBottom: "12px",
        border: `2px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: "8px",
        backgroundColor: tokens.colorNeutralBackground2,
        cursor: "pointer",
        ":focus-within": { outline: "1px solid var(--vscode-focusBorder)", outlineOffset: "2px" },
    },
    selected: {
        border: "2px solid var(--vscode-focusBorder)",
        backgroundColor:
            "color-mix(in srgb, var(--vscode-focusBorder) 8%, var(--vscode-editor-background))",
    },
    radio: {
        margin: "3px 0 0",
        width: "16px",
        height: "16px",
        accentColor: "var(--vscode-button-background)",
    },
    optionContent: { display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 },
    optionTitle: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" },
    description: { color: "var(--vscode-descriptionForeground)", lineHeight: "22px" },
});

export const AzureSqlDatabaseSourceDetails = ({
    source,
    onChange,
    deploymentContent,
    onDeploymentContentChange,
    onConnectionChange,
}: {
    source: LocalDatabaseSource;
    onChange: () => void;
    deploymentContent: LocalDatabaseDeploymentContent;
    onDeploymentContentChange: (content: LocalDatabaseDeploymentContent) => void;
    onConnectionChange: (connection: LocalDatabaseSource | undefined) => void;
}) => {
    const classes = useStyles();
    const strings = locConstants.azureSqlDatabase;
    const { extensionRpc } = useVscodeWebview<DeploymentWebviewState, DeploymentReducers>();
    const [connection, setConnection] = useState(source);
    const [isConnecting, setIsConnecting] = useState(true);
    const headingRef = useRef<HTMLHeadingElement>(null);

    useEffect(() => {
        headingRef.current?.focus({ preventScroll: true });
    }, []);

    useEffect(() => {
        let cancelled = false;
        setIsConnecting(true);
        onConnectionChange(undefined);
        void extensionRpc
            .sendRequest(AzureSqlDatabaseRequests.ConnectLocalDatabaseSource, {
                id: source.id,
            })
            .then((result) => {
                if (!cancelled) {
                    setConnection({
                        ...result,
                        profileName: result.profileName || source.profileName,
                    });
                    onConnectionChange(result);
                }
            })
            .catch((error) => {
                extensionRpc.log.error("Failed to connect to the selected local database", error);
                if (!cancelled) {
                    setConnection({ ...source, isConnected: false, serverVersion: undefined });
                    onConnectionChange(undefined);
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setIsConnecting(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [extensionRpc, source, onConnectionChange]);

    return (
        <>
            <section className={classes.details} aria-labelledby="local-database-details-heading">
                <div className={classes.header}>
                    <Database20Regular className={classes.icon} aria-hidden="true" />
                    <h3
                        id="local-database-details-heading"
                        ref={headingRef}
                        tabIndex={-1}
                        className={classes.heading}>
                        {strings.localDatabase}
                    </h3>
                    <Button onClick={onChange}>{strings.changeLocalDatabase}</Button>
                </div>
                <dl className={classes.fields}>
                    <dt>{strings.sourceConnection}</dt>
                    <dd>{source.profileName || source.server}</dd>
                    <dt>{strings.sourceServer}</dt>
                    <dd>{source.server}</dd>
                    <dt>{strings.sourceDatabase}</dt>
                    <dd>{source.database}</dd>
                    <dt>
                        {connection.isAzureSql ? strings.sourceSqlAzure : strings.sourceSqlServer}
                    </dt>
                    <dd>
                        {(!isConnecting && connection.serverVersion) ||
                            strings.sourceVersionUnavailable}
                    </dd>
                    <dt>{strings.sourceStatus}</dt>
                    <dd
                        role="status"
                        className={
                            isConnecting
                                ? classes.secondary
                                : connection.isConnected
                                  ? classes.connected
                                  : classes.notConnected
                        }>
                        {isConnecting ? (
                            <Spinner
                                size="tiny"
                                label={strings.sourceConnecting}
                                className={classes.connecting}
                            />
                        ) : connection.isConnected ? (
                            strings.sourceConnected
                        ) : (
                            strings.sourceNotConnected
                        )}
                    </dd>
                </dl>
            </section>
            <fieldset className={classes.options}>
                <legend className={classes.legend}>{strings.whatToDeploy}</legend>
                <label
                    className={mergeClasses(
                        classes.option,
                        deploymentContent === "schemaAndData" && classes.selected,
                    )}>
                    <input
                        className={classes.radio}
                        type="radio"
                        name="deploymentContent"
                        value="schemaAndData"
                        checked={deploymentContent === "schemaAndData"}
                        onChange={() => onDeploymentContentChange("schemaAndData")}
                        aria-labelledby="schema-and-data-label"
                        aria-describedby="schema-and-data-description"
                    />
                    <span className={classes.optionContent}>
                        <span className={classes.optionTitle}>
                            <Database20Regular className={classes.icon} aria-hidden="true" />
                            <Text id="schema-and-data-label" weight="semibold">
                                {strings.schemaAndData}
                            </Text>
                            <Badge appearance="outline" color="brand">
                                {strings.recommended}
                            </Badge>
                        </span>
                        <Text id="schema-and-data-description" className={classes.description}>
                            {strings.schemaAndDataDescription(source.database)}
                        </Text>
                    </span>
                </label>
                <label
                    className={mergeClasses(
                        classes.option,
                        deploymentContent === "schemaOnly" && classes.selected,
                    )}>
                    <input
                        className={classes.radio}
                        type="radio"
                        name="deploymentContent"
                        value="schemaOnly"
                        checked={deploymentContent === "schemaOnly"}
                        onChange={() => onDeploymentContentChange("schemaOnly")}
                        aria-labelledby="schema-only-label"
                        aria-describedby="schema-only-description"
                    />
                    <span className={classes.optionContent}>
                        <span className={classes.optionTitle}>
                            <Table20Regular className={classes.secondary} aria-hidden="true" />
                            <Text id="schema-only-label" weight="semibold">
                                {strings.schemaOnly}
                            </Text>
                        </span>
                        <Text id="schema-only-description" className={classes.description}>
                            {strings.schemaOnlyDescription}
                        </Text>
                    </span>
                </label>
            </fieldset>
        </>
    );
};
