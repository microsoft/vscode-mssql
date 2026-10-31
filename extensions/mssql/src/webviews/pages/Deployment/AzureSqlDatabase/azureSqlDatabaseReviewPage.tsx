/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useRef, useState } from "react";
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Link,
    makeStyles,
    mergeClasses,
    SearchBox,
    Text,
    tokens,
} from "@fluentui/react-components";
import {
    ArrowRight24Regular,
    Cloud24Regular,
    Database24Regular,
    Info20Regular,
} from "@fluentui/react-icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import { KnownFreeLimitExhaustionBehavior } from "@azure/arm-sql";
import {
    AzureSqlDatabaseState,
    LocalDatabaseCompatibilityResult,
    LocalDatabaseSource,
} from "../../../../sharedInterfaces/azureSqlDatabase";
import { locConstants } from "../../../common/locConstants";

const cardBackground =
    "color-mix(in srgb, var(--vscode-editor-foreground) 4%, var(--vscode-editor-background))";

const useStyles = makeStyles({
    content: {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        width: "100%",
        maxWidth: "1080px",
        minWidth: 0,
    },
    introduction: { display: "flex", flexDirection: "column", gap: "8px" },
    heading: { margin: 0 },
    secondary: { color: "var(--vscode-descriptionForeground)", lineHeight: "20px" },
    card: {
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: "12px",
        backgroundColor: cardBackground,
        overflow: "hidden",
    },
    mapping: {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
        "@media (max-width: 600px)": { gridTemplateColumns: "minmax(0, 1fr)" },
    },
    database: {
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "16px",
        minWidth: 0,
    },
    databaseText: {
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        minWidth: 0,
        overflowWrap: "anywhere",
    },
    sourceIcon: { color: tokens.colorBrandForeground1, flexShrink: 0 },
    targetIcon: { color: "var(--vscode-testing-iconPassed)", flexShrink: 0 },
    target: {
        backgroundColor:
            "color-mix(in srgb, var(--vscode-editorGutter-addedBackground) 15%, var(--vscode-editor-background))",
    },
    arrow: {
        alignSelf: "center",
        marginRight: "12px",
        color: "var(--vscode-descriptionForeground)",
        "@media (max-width: 600px)": {
            justifySelf: "center",
            transform: "rotate(90deg)",
            marginRight: 0,
            marginBottom: "12px",
        },
    },
    summary: { margin: 0, padding: "0 16px" },
    row: {
        display: "grid",
        alignItems: "center",
        gridTemplateColumns: "160px minmax(0, 1fr)",
        gap: "8px",
        padding: "10px 0",
        borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
        ":last-child": { borderBottom: "none" },
        "@media (max-width: 600px)": { gridTemplateColumns: "minmax(0, 1fr)", gap: "4px" },
    },
    value: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: "8px 12px",
        margin: 0,
        minWidth: 0,
        textAlign: "right",
        overflowWrap: "anywhere",
        "@media (max-width: 600px)": { justifyContent: "flex-start", textAlign: "left" },
    },
    compatible: { color: "var(--vscode-testing-iconPassed)" },
    warning: { color: "var(--vscode-editorWarning-foreground)" },
    notice: { display: "flex", alignItems: "center", gap: "12px" },
    noticeIcon: { flexShrink: 0 },
    dialog: { maxWidth: "calc(100vw - 48px)", width: "640px" },
    objectContent: { display: "flex", flexDirection: "column", gap: "12px" },
    search: { maxWidth: "unset" },
    list: { height: "min(360px, 40vh)", overflowY: "auto", position: "relative" },
    object: {
        height: "28px",
        lineHeight: "28px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontFamily: "var(--vscode-editor-font-family), monospace",
        fontSize: "12px",
    },
});

export const AzureSqlDatabaseReviewPage = ({
    source,
    result,
    azureState,
}: {
    source: LocalDatabaseSource;
    result: LocalDatabaseCompatibilityResult;
    azureState: AzureSqlDatabaseState;
}) => {
    const classes = useStyles();
    const strings = locConstants.azureSqlDatabase;
    const heading = useRef<HTMLHeadingElement>(null);
    const list = useRef<HTMLDivElement>(null);
    const [showObjects, setShowObjects] = useState(false);
    const [search, setSearch] = useState("");
    const objects = useMemo(() => {
        const query = search.trim().toLocaleLowerCase();
        return (
            result.schemaObjects?.filter((name) => name.toLocaleLowerCase().includes(query)) ?? []
        );
    }, [result.schemaObjects, search]);
    const virtualizer = useVirtualizer({
        count: objects.length,
        getScrollElement: () => list.current,
        estimateSize: () => 28,
        overscan: 4,
    });
    useEffect(() => {
        heading.current?.focus({ preventScroll: true });
    }, []);

    const form = azureState.formState;
    const subscription =
        azureState.formComponents.subscriptionId?.options?.find(
            (option) => option.value === form.subscriptionId,
        )?.displayName ||
        azureState.subscriptionName ||
        form.subscriptionId;
    const content =
        result.deploymentContent === "schemaOnly" ? strings.schemaOnly : strings.schemaAndData;
    const objectCount = result.schemaObjects?.length ?? result.objectsValidated;
    const warningCount = result.diagnostics.filter(({ severity }) => severity === "warning").length;
    const freeLimit =
        form.freeLimitBehavior === KnownFreeLimitExhaustionBehavior.AutoPause
            ? strings.reviewPauseUntilNextMonth
            : form.freeLimitBehavior === KnownFreeLimitExhaustionBehavior.BillOverUsage
              ? strings.continueChargesOption
              : strings.sourceVersionUnavailable;

    return (
        <section className={classes.content} aria-label={strings.reviewAndDeploy}>
            <div className={classes.introduction}>
                <Text
                    as="h2"
                    size={400}
                    weight="semibold"
                    className={classes.heading}
                    ref={heading}
                    tabIndex={-1}>
                    {strings.reviewAndDeploy}
                </Text>
                <Text className={classes.secondary}>{strings.reviewDescription}</Text>
            </div>
            <div className={mergeClasses(classes.card, classes.mapping)}>
                <div className={classes.database}>
                    <Database24Regular className={classes.sourceIcon} aria-hidden />
                    <div className={classes.databaseText}>
                        <Text size={400} weight="semibold">
                            {source.database}
                        </Text>
                        <Text className={classes.secondary}>
                            {source.serverVersion
                                ? strings.reviewSourceDescription(
                                      source.isAzureSql
                                          ? strings.sourceSqlAzure
                                          : strings.sourceSqlServer,
                                      source.serverVersion,
                                  )
                                : strings.localDatabase}
                        </Text>
                    </div>
                </div>
                <ArrowRight24Regular className={classes.arrow} aria-hidden />
                <div className={mergeClasses(classes.database, classes.target)}>
                    <Cloud24Regular className={classes.targetIcon} aria-hidden />
                    <div className={classes.databaseText}>
                        <Text size={400} weight="semibold">
                            {form.databaseName}
                        </Text>
                        <Text className={classes.secondary}>{strings.reviewTargetDescription}</Text>
                    </div>
                </div>
            </div>
            <dl className={mergeClasses(classes.card, classes.summary)}>
                <div className={classes.row}>
                    <dt className={classes.secondary}>{strings.reviewIncludes}</dt>
                    <dd className={classes.value}>
                        <span>
                            {objectCount === undefined
                                ? content
                                : strings.reviewIncludesObjects(content, objectCount)}
                        </span>
                        {result.schemaObjects !== undefined && (
                            <Link
                                as="button"
                                aria-haspopup="dialog"
                                onClick={() => setShowObjects(true)}>
                                {strings.reviewViewObjects}
                            </Link>
                        )}
                    </dd>
                </div>
                <div className={classes.row}>
                    <dt className={classes.secondary}>{strings.compatibilityStep}</dt>
                    <dd
                        className={mergeClasses(
                            classes.value,
                            warningCount > 0 ? classes.warning : classes.compatible,
                        )}>
                        {warningCount > 0
                            ? strings.reviewCompatibilityWarnings(warningCount)
                            : strings.reviewCompatibilityPassed}
                    </dd>
                </div>
                <div className={classes.row}>
                    <dt className={classes.secondary}>{strings.reviewFreeLimit}</dt>
                    <dd className={classes.value}>{freeLimit}</dd>
                </div>
                <div className={classes.row}>
                    <dt className={classes.secondary}>{strings.reviewAzureLocation}</dt>
                    <dd className={classes.value}>
                        {strings.reviewAzureDestination(
                            subscription,
                            form.resourceGroup,
                            form.serverName,
                        )}
                    </dd>
                </div>
            </dl>
            <div className={mergeClasses(classes.notice, classes.secondary)}>
                <Info20Regular className={classes.noticeIcon} aria-hidden />
                <Text>
                    {result.deploymentContent === "schemaOnly"
                        ? strings.reviewSchemaNotice
                        : strings.reviewDataNotice}
                </Text>
            </div>
            <Dialog open={showObjects} onOpenChange={(_, data) => setShowObjects(data.open)}>
                <DialogSurface className={classes.dialog}>
                    <DialogBody>
                        <DialogTitle>{strings.reviewSchemaObjects}</DialogTitle>
                        <DialogContent className={classes.objectContent}>
                            <SearchBox
                                className={classes.search}
                                aria-label={strings.reviewSearchObjects}
                                placeholder={strings.reviewSearchObjects}
                                value={search}
                                onChange={(_, data) => {
                                    setSearch(data.value);
                                    virtualizer.scrollToOffset(0);
                                }}
                            />
                            {objects.length > 0 ? (
                                <div
                                    ref={list}
                                    role="list"
                                    aria-label={strings.reviewSchemaObjects}
                                    className={classes.list}>
                                    <div
                                        style={{
                                            height: virtualizer.getTotalSize(),
                                            position: "relative",
                                        }}>
                                        {virtualizer.getVirtualItems().map((item) => (
                                            <div
                                                key={item.key}
                                                role="listitem"
                                                aria-posinset={item.index + 1}
                                                aria-setsize={objects.length}
                                                title={objects[item.index]}
                                                className={classes.object}
                                                style={{
                                                    position: "absolute",
                                                    top: 0,
                                                    left: 0,
                                                    width: "100%",
                                                    transform: `translateY(${item.start}px)`,
                                                }}>
                                                {objects[item.index]}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <Text role="status">
                                    {result.schemaObjects?.length
                                        ? strings.reviewNoMatchingObjects
                                        : strings.reviewNoObjects}
                                </Text>
                            )}
                        </DialogContent>
                        <DialogActions>
                            <Button onClick={() => setShowObjects(false)}>
                                {locConstants.common.close}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </section>
    );
};
