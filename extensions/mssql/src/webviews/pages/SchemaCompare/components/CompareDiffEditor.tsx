/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useSchemaCompareSelector } from "../schemaCompareSelector";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import {
    SchemaCompareReducers,
    SchemaCompareWebViewState,
    SchemaUpdateAction,
} from "../../../../sharedInterfaces/schemaCompare";
import { Button, makeStyles, Text, Tooltip } from "@fluentui/react-components";
import { ArrowLeft16Regular, ArrowRight16Regular, Info16Regular } from "@fluentui/react-icons";
import { locConstants as loc } from "../../../common/locConstants";
import { getDiffEditorModels, groupConstraintChildrenByAction } from "./compareDiffEditorUtils";
import { DefinitionPanel } from "../../../common/definitionPanel";
import { SchemaCompareMonacoDiffEditor } from "./SchemaCompareMonacoDiffEditor";

const useStyles = makeStyles({
    editorContainer: {
        height: "100%",
        width: "100%",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
    },
    editorHost: {
        flexGrow: 1,
        flexBasis: 0,
        minHeight: 0,
        overflow: "hidden",
    },
    deploymentDirectionIndicators: {
        // Monaco labels a left-to-right insertion with its Add codicon. Schema Compare
        // deploys in the opposite direction, so swap only the two indicator glyphs.
        "& .codicon-diff-insert::before": {
            content: '"\\eb3b"', // Codicon.remove
        },
        "& .codicon-diff-remove::before": {
            content: '"\\ea60"', // Codicon.add
        },
    },
    affectedChildrenContainer: {
        display: "flex",
        alignItems: "flex-start",
        gap: "8px",
        padding: "8px 14px",
        backgroundColor: "var(--vscode-textBlockQuote-background)",
        borderBottom: "1px solid var(--vscode-editorGroup-border)",
        borderLeft: "2px solid var(--vscode-charts-yellow)",
    },
    affectedChildrenIcon: {
        flex: "0 0 auto",
        marginTop: "1px",
        color: "var(--vscode-charts-yellow)",
    },
    affectedChildrenLines: {
        minWidth: 0,
    },
    affectedChildrenLine: {
        display: "block",
        fontSize: "12px",
        lineHeight: "1.5",
    },
    affectedChildrenLabel: {
        fontWeight: 600,
    },
    affectedChildrenNames: {
        fontFamily: "var(--vscode-editor-font-family)",
        fontSize: "11.5px",
        color: "var(--vscode-descriptionForeground)",
    },
    selectedDifferenceName: {
        maxWidth: "320px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontFamily: "var(--vscode-editor-font-family)",
        color: "var(--vscode-descriptionForeground)",
    },
    differencePosition: {
        whiteSpace: "nowrap",
        color: "var(--vscode-descriptionForeground)",
        fontVariantNumeric: "tabular-nums",
    },
});

interface Props {
    selectedDiffId: number;
    renderSideBySide?: boolean;
    onClose: () => void;
    onPrevious: () => void;
    onNext: () => void;
    hasPrevious: boolean;
    hasNext: boolean;
    currentPosition: number;
    totalDifferences: number;
}

const COMPARISON_DETAILS_TAB_ID = "comparisonDetails";

const CompareDiffEditor = ({
    selectedDiffId,
    renderSideBySide,
    onClose,
    onPrevious,
    onNext,
    hasPrevious,
    hasNext,
    currentPosition,
    totalDifferences,
}: Props) => {
    const classes = useStyles();
    const schemaCompareResult = useSchemaCompareSelector((s) => s.schemaCompareResult);
    const { themeKind } = useVscodeWebview<SchemaCompareWebViewState, SchemaCompareReducers>();
    const compareResult = schemaCompareResult;
    const diff = compareResult?.differences[selectedDiffId];
    const { original, modified } = getDiffEditorModels(diff);
    const selectedDifferenceName = (
        diff?.sourceValue?.length ? diff.sourceValue : diff?.targetValue
    )?.join(".");

    const affectedChildrenByAction = groupConstraintChildrenByAction(diff);
    const hasAffectedChildren = (Object.values(affectedChildrenByAction) as string[][]).some(
        (names) => names && names.length > 0,
    );

    const content = (
        <div
            className={classes.editorContainer}
            data-schema-compare-details
            role="region"
            tabIndex={-1}
            aria-label={loc.schemaCompare.compareDetails}>
            {hasAffectedChildren && (
                <div
                    className={classes.affectedChildrenContainer}
                    role="region"
                    aria-label={loc.schemaCompare.affectedChildrenRegionLabel}>
                    <Info16Regular className={classes.affectedChildrenIcon} aria-hidden />
                    <div className={classes.affectedChildrenLines}>
                        {!!affectedChildrenByAction[SchemaUpdateAction.Add]?.length && (
                            <Text className={classes.affectedChildrenLine}>
                                <span className={classes.affectedChildrenLabel}>
                                    {loc.schemaCompare.constraintsAddedLabel}:{" "}
                                </span>
                                <span className={classes.affectedChildrenNames}>
                                    {affectedChildrenByAction[SchemaUpdateAction.Add]!.join(", ")}
                                </span>
                            </Text>
                        )}
                        {!!affectedChildrenByAction[SchemaUpdateAction.Change]?.length && (
                            <Text className={classes.affectedChildrenLine}>
                                <span className={classes.affectedChildrenLabel}>
                                    {loc.schemaCompare.constraintsChangedLabel}:{" "}
                                </span>
                                <span className={classes.affectedChildrenNames}>
                                    {affectedChildrenByAction[SchemaUpdateAction.Change]!.join(
                                        ", ",
                                    )}
                                </span>
                            </Text>
                        )}
                        {!!affectedChildrenByAction[SchemaUpdateAction.Delete]?.length && (
                            <Text className={classes.affectedChildrenLine}>
                                <span className={classes.affectedChildrenLabel}>
                                    {loc.schemaCompare.constraintsDroppedLabel}:{" "}
                                </span>
                                <span className={classes.affectedChildrenNames}>
                                    {affectedChildrenByAction[SchemaUpdateAction.Delete]!.join(
                                        ", ",
                                    )}
                                </span>
                            </Text>
                        )}
                    </div>
                </div>
            )}
            <div className={`${classes.editorHost} ${classes.deploymentDirectionIndicators}`}>
                <SchemaCompareMonacoDiffEditor
                    height="100%"
                    width="100%"
                    language="sql"
                    original={original}
                    modified={modified}
                    themeKind={themeKind}
                    options={{
                        automaticLayout: true,
                        renderSideBySide: renderSideBySide ?? true,
                        renderIndicators: true,
                        renderOverviewRuler: true,
                        overviewRulerLanes: 0,
                        readOnly: true,
                    }}
                />
            </div>
        </div>
    );

    return (
        <DefinitionPanel<typeof COMPARISON_DETAILS_TAB_ID>
            defaultSize={40}
            activeTab={COMPARISON_DETAILS_TAB_ID}
            customTabs={[
                {
                    id: COMPARISON_DETAILS_TAB_ID,
                    label: loc.schemaCompare.compareDetails,
                    content,
                    headerActions: (
                        <>
                            {selectedDifferenceName && (
                                <Text className={classes.selectedDifferenceName}>
                                    {selectedDifferenceName}
                                </Text>
                            )}
                            <Tooltip content={loc.common.previous} relationship="label">
                                <Button
                                    size="small"
                                    appearance="subtle"
                                    aria-label={loc.common.previous}
                                    icon={<ArrowLeft16Regular />}
                                    disabled={!hasPrevious}
                                    onClick={onPrevious}
                                />
                            </Tooltip>
                            {totalDifferences > 0 && (
                                <Text className={classes.differencePosition}>
                                    {loc.schemaCompare.differencePosition(
                                        currentPosition,
                                        totalDifferences,
                                    )}
                                </Text>
                            )}
                            <Tooltip content={loc.common.next} relationship="label">
                                <Button
                                    size="small"
                                    appearance="subtle"
                                    aria-label={loc.common.next}
                                    icon={<ArrowRight16Regular />}
                                    disabled={!hasNext}
                                    onClick={onNext}
                                />
                            </Tooltip>
                        </>
                    ),
                },
            ]}
            onClose={onClose}
        />
    );
};

export default CompareDiffEditor;
