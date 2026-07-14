/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Table properties pane (SV-R4, read-only). Availability-aware rendering
 * (addendum §15): unknown facts display as "Unknown" — never a fabricated
 * value, never NO_ACTION for an unknown FK action, never an empty string
 * presented as "no default".
 */

import {
    Badge,
    makeStyles,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Text,
    tokens,
} from "@fluentui/react-components";
import {
    Available,
    availableValue,
    SchemaVisualizerCatalogModel,
    VisualizerColumn,
    VisualizerForeignKey,
    VisualizerTable,
} from "../../../schemaVisualizer/model/schemaVisualizerModel";
import { generateTableScript } from "../../../schemaVisualizer/scripting/schemaVisualizerSqlGenerator";

const useStyles = makeStyles({
    section: {
        marginBottom: "16px",
    },
    heading: {
        display: "block",
        fontWeight: "600",
        marginBottom: "6px",
    },
    subheading: {
        display: "block",
        color: tokens.colorNeutralForeground3,
        marginBottom: "8px",
    },
    factRow: {
        display: "flex",
        gap: "6px",
        alignItems: "baseline",
        marginBottom: "2px",
    },
});

const UNKNOWN = "Unknown";

function availableText<T>(
    available: Available<T | null>,
    render: (value: T) => string,
    whenNone: string,
): string {
    if (available.state === "unknown") {
        return available.reason === "notApplicable" ? whenNone : UNKNOWN;
    }
    return available.value === null ? whenNone : render(available.value);
}

function columnFacts(column: VisualizerColumn): string[] {
    const facts: string[] = [];
    if (column.isIdentity) {
        const spec = availableValue(column.identitySpec);
        facts.push(
            spec ? `identity(${spec.seedText}, ${spec.incrementText})` : `identity (${UNKNOWN})`,
        );
    }
    const computedText = availableText(
        column.computed,
        (v) => `computed: ${v.definition}${v.persisted ? " (persisted)" : ""}`,
        "",
    );
    if (computedText) {
        facts.push(computedText);
    }
    const defaultText = availableText(
        column.defaultConstraint,
        (v) => `default: ${v.definition}`,
        "",
    );
    if (defaultText) {
        facts.push(defaultText);
    }
    const description = availableValue(column.description);
    if (description) {
        facts.push(description);
    }
    return facts;
}

export const SchemaVisualizerProperties = ({
    table,
    foreignKeys,
    capabilities,
    model,
}: {
    table: VisualizerTable;
    foreignKeys: VisualizerForeignKey[];
    capabilities: SchemaVisualizerCatalogModel["capabilities"];
    /** Full (subset) model — FK targets + capabilities for the script. */
    model: SchemaVisualizerCatalogModel;
}) => {
    const styles = useStyles();
    const keysLimited = capabilities.keyProperties.state !== "available";
    const script = generateTableScript(table, model);
    return (
        <div>
            <div className={styles.section}>
                <Text className={styles.heading} size={400}>
                    {`${table.schema}.${table.name}`}
                </Text>
                <Text className={styles.subheading} size={200}>
                    {availableText(table.description, (d) => d, "No description")}
                </Text>
            </div>
            <div className={styles.section}>
                <Text className={styles.heading}>Columns ({table.columns.length})</Text>
                <Table size="extra-small" aria-label="Columns">
                    <TableHeader>
                        <TableRow>
                            <TableHeaderCell>Name</TableHeaderCell>
                            <TableHeaderCell>Type</TableHeaderCell>
                            <TableHeaderCell>Nullable</TableHeaderCell>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {table.columns.map((column) => {
                            const facts = columnFacts(column);
                            return (
                                <TableRow key={column.graphId}>
                                    <TableCell>
                                        {column.name}
                                        {availableValue(column.inPrimaryKey) === true && (
                                            <Badge size="small" appearance="outline">
                                                PK
                                            </Badge>
                                        )}
                                        {facts.length > 0 && (
                                            <Text
                                                size={100}
                                                block
                                                style={{
                                                    color: tokens.colorNeutralForeground3,
                                                }}>
                                                {facts.join(" · ")}
                                            </Text>
                                        )}
                                    </TableCell>
                                    <TableCell>{column.typeDisplay}</TableCell>
                                    <TableCell>{column.nullable ? "yes" : "no"}</TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>
            <div className={styles.section}>
                <Text className={styles.heading}>Keys</Text>
                {keysLimited ? (
                    <Text size={200}>{UNKNOWN} — key metadata did not load.</Text>
                ) : table.keyConstraints.length === 0 ? (
                    <Text size={200}>No key constraints.</Text>
                ) : (
                    table.keyConstraints.map((constraint) => (
                        <div key={constraint.name} className={styles.factRow}>
                            <Badge size="small" appearance="outline">
                                {constraint.kind === "primaryKey" ? "PK" : "UQ"}
                            </Badge>
                            <Text size={200}>
                                {constraint.name} ({constraint.columns.join(", ")})
                            </Text>
                        </div>
                    ))
                )}
            </div>
            <div className={styles.section}>
                <Text className={styles.heading}>Script (informational)</Text>
                <Text size={200} block style={{ color: tokens.colorNeutralForeground3 }}>
                    Generated from cached metadata — not a publish artifact.
                </Text>
                {script.warnings.map((warning) => (
                    <Text
                        key={warning}
                        size={200}
                        block
                        style={{ color: tokens.colorPaletteYellowForeground2 }}>
                        ⚠ {warning}
                    </Text>
                ))}
                <pre
                    style={{
                        fontSize: "11px",
                        overflowX: "auto",
                        userSelect: "text",
                        whiteSpace: "pre",
                    }}>
                    {script.text}
                </pre>
            </div>
            <div className={styles.section}>
                <Text className={styles.heading}>Foreign keys ({foreignKeys.length})</Text>
                {foreignKeys.map((fk) => (
                    <div key={fk.graphId} style={{ marginBottom: "8px" }}>
                        <Text size={200} weight="semibold" block>
                            {fk.name}
                        </Text>
                        <Text size={200} block>
                            {fk.columnPairs
                                .map((pair) => `${pair.fromColumnName} → ${pair.toColumnName}`)
                                .join(", ")}
                        </Text>
                        <Text size={200} block>
                            on delete: {availableValue(fk.onDelete) ?? UNKNOWN} · on update:{" "}
                            {availableValue(fk.onUpdate) ?? UNKNOWN}
                        </Text>
                    </div>
                ))}
            </div>
        </div>
    );
};
