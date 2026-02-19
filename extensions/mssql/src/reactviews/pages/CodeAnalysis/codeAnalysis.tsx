/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import {
    Button,
    Checkbox,
    Dropdown,
    Spinner,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Text,
    makeStyles,
    tokens,
    Option,
} from "@fluentui/react-components";
import { CodeAnalysisContext } from "./codeAnalysisStateProvider";
import { useCodeAnalysisSelector } from "./codeAnalysisSelector";
import { LocConstants } from "../../common/locConstants";
import { CodeAnalysisRuleSeverity } from "../../../sharedInterfaces/codeAnalysis";
import { DialogHeader } from "../../common/dialogHeader.component";

const codeAnalysisIconLight = require("../../../../media/codeAnalysis_light.svg");
const codeAnalysisIconDark = require("../../../../media/codeAnalysis_dark.svg");

const codeAnalysisSeverityOptions = Object.values(CodeAnalysisRuleSeverity);

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        boxSizing: "border-box",
        padding: "16px 16px 4px 16px",
        gap: "12px",
        overflow: "hidden",
    },
    rulesContainer: {
        flexGrow: 1,
        flexShrink: 1,
        minHeight: 0,
        overflow: "auto",
    },
    table: {
        width: "100%",
        borderCollapse: "collapse",
        tableLayout: "fixed",
    },
    tableHeaderCell: {
        textAlign: "left",
        fontWeight: tokens.fontWeightSemibold,
        padding: "8px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground3,
    },
    checkboxCell: {
        width: "44px",
    },
    severityCell: {
        width: "180px",
    },
    tableCell: {
        padding: "8px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        fontSize: tokens.fontSizeBase200,
    },
    spinnerContainer: {
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100%",
    },
    emptyState: {
        padding: "12px",
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground3,
    },
    footer: {
        display: "flex",
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingTop: "10px",
        paddingBottom: "4px",
        borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
        flexShrink: 0,
        minHeight: "48px",
    },
    footerButtons: {
        display: "flex",
        flexDirection: "row",
        gap: "8px",
    },
    statusText: {
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground3,
    },
});

function CodeAnalysisDialog() {
    const styles = useStyles();
    const locConstants = LocConstants.getInstance();
    const loc = locConstants.codeAnalysis;
    const commonLoc = locConstants.common;
    const schemaCompareLoc = locConstants.schemaCompare;
    const context = useContext(CodeAnalysisContext);
    const headerColumns = [
        // Column: rule enabled state
        {
            key: "enabledRule",
            label: loc.enabledColumnLabel,
            className: `${styles.tableHeaderCell} ${styles.checkboxCell}`,
        },
        // Column: rule identifier and display name
        { key: "rule", label: loc.ruleColumnLabel, className: styles.tableHeaderCell },
        // Column: configured rule severity
        {
            key: "severity",
            label: loc.severityColumnLabel,
            className: `${styles.tableHeaderCell} ${styles.severityCell}`,
        },
    ];

    const projectName = useCodeAnalysisSelector((s) => s.projectName);
    const isLoading = useCodeAnalysisSelector((s) => s.isLoading);
    const rules = useCodeAnalysisSelector((s) => s.rules);
    if (!context) {
        return <div>Loading...</div>;
    }

    return (
        <div className={styles.root}>
            {/* Header */}
            <DialogHeader
                iconLight={codeAnalysisIconLight}
                iconDark={codeAnalysisIconDark}
                title={loc.codeAnalysisTitle(projectName)}
                themeKind={context.themeKind}
            />

            {/* Rules table */}
            <div className={styles.rulesContainer}>
                {isLoading ? (
                    <div className={styles.spinnerContainer}>
                        <Spinner label={loc.loadingCodeAnalysisRules} />
                    </div>
                ) : rules.length === 0 ? (
                    <div className={styles.emptyState}>No code analysis rules available.</div>
                ) : (
                    <Table className={styles.table}>
                        <TableHeader>
                            <TableRow>
                                {headerColumns.map((column) => (
                                    <TableHeaderCell key={column.key} className={column.className}>
                                        {column.label}
                                    </TableHeaderCell>
                                ))}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rules.map((rule) => (
                                <TableRow key={rule.ruleId}>
                                    {/* Cell: Whether the current rule is enabled */}
                                    <TableCell className={styles.tableCell}>
                                        <Checkbox checked={rule.enabled} disabled />
                                    </TableCell>
                                    {/* Cell: Rule */}
                                    <TableCell className={styles.tableCell}>
                                        {rule.shortRuleId}: {rule.displayName}
                                    </TableCell>
                                    {/* Cell: Configured severity for the current rule */}
                                    <TableCell className={styles.tableCell}>
                                        <Dropdown value={rule.severity}>
                                            {codeAnalysisSeverityOptions.map((severity) => (
                                                <Option key={severity} value={severity}>
                                                    {severity}
                                                </Option>
                                            ))}
                                        </Dropdown>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </div>

            {/* Footer */}
            <div className={styles.footer}>
                <Text className={styles.statusText}>{rules?.length ?? 0} rules</Text>
                <div className={styles.footerButtons}>
                    <Button appearance="subtle" disabled onClick={() => undefined}>
                        {schemaCompareLoc.reset}
                    </Button>
                    <Button appearance="secondary" onClick={() => context.close()}>
                        {commonLoc.cancel}
                    </Button>
                    <Button appearance="primary" disabled onClick={() => undefined}>
                        {commonLoc.save}
                    </Button>
                </div>
            </div>
        </div>
    );
}

export default function CodeAnalysisPage() {
    return <CodeAnalysisDialog />;
}
