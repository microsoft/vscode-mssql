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
import { Button, makeStyles, Text, Tooltip, tokens } from "@fluentui/react-components";
import { ArrowLeft16Regular, ArrowRight16Regular } from "@fluentui/react-icons";
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
        // Subtle banner above the diff editor that lists the names of the diff's
        // hierarchical-child changes (constraints under a table, columns under a view, etc.)
        // so the user can see what other objects this diff will touch when applied.
        padding: "4px 12px",
        backgroundColor: tokens.colorNeutralBackground2,
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    affectedChildrenLine: {
        display: "block",
        fontSize: "12px",
        lineHeight: "1.5",
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
}: Props) => {
    const classes = useStyles();
    const schemaCompareResult = useSchemaCompareSelector((s) => s.schemaCompareResult);
    const { themeKind } = useVscodeWebview<SchemaCompareWebViewState, SchemaCompareReducers>();
    const compareResult = schemaCompareResult;
    const diff = compareResult?.differences[selectedDiffId];
    const { original, modified } = getDiffEditorModels(diff);

    const affectedChildrenByAction = groupConstraintChildrenByAction(diff);
    const hasAffectedChildren = (Object.values(affectedChildrenByAction) as string[][]).some(
        (names) => names && names.length > 0,
    );

    const content = (
        <div className={classes.editorContainer}>
            {hasAffectedChildren && (
                <div
                    className={classes.affectedChildrenContainer}
                    role="region"
                    aria-label={loc.schemaCompare.affectedChildrenRegionLabel}>
                    {!!affectedChildrenByAction[SchemaUpdateAction.Add]?.length && (
                        <Text className={classes.affectedChildrenLine}>
                            {loc.schemaCompare.affectedChildrenAdded(
                                affectedChildrenByAction[SchemaUpdateAction.Add]!.join(", "),
                            )}
                        </Text>
                    )}
                    {!!affectedChildrenByAction[SchemaUpdateAction.Change]?.length && (
                        <Text className={classes.affectedChildrenLine}>
                            {loc.schemaCompare.affectedChildrenChanged(
                                affectedChildrenByAction[SchemaUpdateAction.Change]!.join(", "),
                            )}
                        </Text>
                    )}
                    {!!affectedChildrenByAction[SchemaUpdateAction.Delete]?.length && (
                        <Text className={classes.affectedChildrenLine}>
                            {loc.schemaCompare.affectedChildrenDropped(
                                affectedChildrenByAction[SchemaUpdateAction.Delete]!.join(", "),
                            )}
                        </Text>
                    )}
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
