/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef, forwardRef } from "react";
import { useSchemaCompareSelector } from "../schemaCompareSelector";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import {
    SchemaCompareReducers,
    SchemaCompareWebViewState,
    SchemaUpdateAction,
} from "../../../../sharedInterfaces/schemaCompare";
import { Divider, makeStyles, Text, tokens } from "@fluentui/react-components";
import { locConstants as loc } from "../../../common/locConstants";
import { VscodeDiffEditor } from "../../../common/vscodeMonaco";
import * as mssql from "vscode-mssql";
import "./compareDiffEditor.css";

const useStyles = makeStyles({
    dividerContainer: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyItems: "center",
        minHeight: "36px",
        backgroundColor: tokens.colorNeutralBackground1,
    },
    dividerFont: {
        fontSize: "14px",
        fontWeight: "bold",
    },
    editorContainer: {
        height: "100%",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
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

const getAggregatedScript = (diff: mssql.DiffEntry, getSourceScript: boolean): string => {
    let script = "";
    if (diff !== null) {
        let diffScript = getSourceScript
            ? formatScript(diff.sourceScript)
            : formatScript(diff.targetScript);
        if (diffScript) {
            script += diffScript + "\n\n";
        }

        diff.children.forEach((child) => {
            let childScript = getAggregatedScript(child, getSourceScript);
            script += childScript;
        });
    }

    return script;
};

const formatScript = (script: string): string => {
    if (!script) {
        return "";
    }

    return script;
};

/**
 * Collect the hierarchical-child diffs that represent constraint changes (PK / FK / UNIQUE /
 * CHECK / DEFAULT) under the selected parent diff, grouped by SchemaUpdateAction. Used to
 * render the "Constraints added / dropped / changed" banner above the diff editor.
 *
 * Filtered to constraint object types only so column-change children (which are already part
 * of the parent table's CREATE / ALTER script) do not get listed here. Reads the source name
 * when present and falls back to the target name so that Drop-only diffs still produce a label.
 */
const groupConstraintChildrenByAction = (
    diff: mssql.DiffEntry | undefined,
): { [action in SchemaUpdateAction]?: string[] } => {
    const grouped: { [action in SchemaUpdateAction]?: string[] } = {};
    if (!diff?.children) {
        return grouped;
    }
    for (const child of diff.children) {
        if (!isConstraintObjectType(child.sourceObjectType ?? child.targetObjectType)) {
            continue;
        }
        const name = formatChildName(child);
        if (!name) {
            continue;
        }
        const action = child.updateAction as SchemaUpdateAction;
        (grouped[action] ??= []).push(name);
    }
    return grouped;
};

// DacFx ObjectType TypeName values for the constraint kinds that can appear under a SqlTable
// in a Schema Compare diff. Match exactly the strings emitted by
// `SchemaComparisonExcludedObjectId(objectType, name).TypeName` in sqltoolsservice (see
// CreateDiffEntry in SchemaCompareUtils).
const CONSTRAINT_OBJECT_TYPE_SUFFIXES = [
    "PrimaryKeyConstraint",
    "ForeignKeyConstraint",
    "UniqueConstraint",
    "CheckConstraint",
    "DefaultConstraint",
];

const isConstraintObjectType = (objectType: string | undefined): boolean => {
    if (!objectType) {
        return false;
    }
    return CONSTRAINT_OBJECT_TYPE_SUFFIXES.some((suffix) => objectType.endsWith(suffix));
};

const formatChildName = (child: mssql.DiffEntry): string => {
    const parts = (child.sourceValue?.length ? child.sourceValue : child.targetValue) ?? [];
    return parts.length > 0 ? parts.join(".") : (child.name ?? "");
};

interface Props {
    selectedDiffId: number;
    renderSideBySide?: boolean;
}

const CompareDiffEditor = forwardRef<HTMLDivElement, Props>(
    ({ selectedDiffId, renderSideBySide }, ref) => {
        const classes = useStyles();
        const schemaCompareResult = useSchemaCompareSelector((s) => s.schemaCompareResult);
        const { themeKind } = useVscodeWebview<SchemaCompareWebViewState, SchemaCompareReducers>();
        const compareResult = schemaCompareResult;
        const diff = compareResult?.differences[selectedDiffId];
        const editorRef = useRef<any>(null);

        const original = diff?.sourceScript ? getAggregatedScript(diff, true) : "";
        const modified = diff?.targetScript ? getAggregatedScript(diff, false) : "";

        // Handle editor mount to store the reference
        const handleEditorDidMount = (editor: any) => {
            editorRef.current = editor;
        };

        // Update the editor layout when the container size changes
        useEffect(() => {
            const handleResize = () => {
                if (editorRef.current) {
                    editorRef.current.layout();
                }
            };

            window.addEventListener("resize", handleResize);

            // Clean up event listener on component unmount
            return () => {
                window.removeEventListener("resize", handleResize);
            };
        }, []);

        const affectedChildrenByAction = groupConstraintChildrenByAction(diff);
        const hasAffectedChildren = (Object.values(affectedChildrenByAction) as string[][]).some(
            (names) => names && names.length > 0,
        );

        return (
            <div ref={ref} className={classes.editorContainer}>
                <div className={classes.dividerContainer}>
                    <Divider className={classes.dividerFont} alignContent="start">
                        {loc.schemaCompare.compareDetails}
                    </Divider>
                </div>
                {hasAffectedChildren && (
                    <div
                        className={classes.affectedChildrenContainer}
                        role="region"
                        aria-label={loc.schemaCompare.affectedChildrenRegionLabel}>
                        {affectedChildrenByAction[SchemaUpdateAction.Add]?.length ? (
                            <Text className={classes.affectedChildrenLine}>
                                {loc.schemaCompare.affectedChildrenAdded(
                                    affectedChildrenByAction[SchemaUpdateAction.Add]!.join(", "),
                                )}
                            </Text>
                        ) : null}
                        {affectedChildrenByAction[SchemaUpdateAction.Change]?.length ? (
                            <Text className={classes.affectedChildrenLine}>
                                {loc.schemaCompare.affectedChildrenChanged(
                                    affectedChildrenByAction[SchemaUpdateAction.Change]!.join(", "),
                                )}
                            </Text>
                        ) : null}
                        {affectedChildrenByAction[SchemaUpdateAction.Delete]?.length ? (
                            <Text className={classes.affectedChildrenLine}>
                                {loc.schemaCompare.affectedChildrenDropped(
                                    affectedChildrenByAction[SchemaUpdateAction.Delete]!.join(", "),
                                )}
                            </Text>
                        ) : null}
                    </div>
                )}
                <VscodeDiffEditor
                    height="100%"
                    language="sql"
                    original={modified}
                    modified={original}
                    themeKind={themeKind}
                    options={{
                        renderSideBySide: renderSideBySide ?? true,
                        renderOverviewRuler: true,
                        overviewRulerLanes: 0,
                        readOnly: true,
                    }}
                    onMount={handleEditorDidMount}
                />
            </div>
        );
    },
);

export default CompareDiffEditor;
