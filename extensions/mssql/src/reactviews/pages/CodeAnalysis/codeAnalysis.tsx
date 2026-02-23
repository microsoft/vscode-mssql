/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import {
    Button,
    Checkbox,
    Dropdown,
    Option,
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
} from "@fluentui/react-components";
import { CodeAnalysisContext } from "./codeAnalysisStateProvider";
import { useCodeAnalysisSelector } from "./codeAnalysisSelector";
import { LocConstants } from "../../common/locConstants";
import { CodeAnalysisRuleSeverity } from "../../../sharedInterfaces/codeAnalysis";
import { DialogHeader } from "../../common/dialogHeader.component";

const codeAnalysisIconLight = require("../../../../media/codeAnalysis_light.svg");
const codeAnalysisIconDark = require("../../../../media/codeAnalysis_dark.svg");

const SEVERITY_OPTIONS = Object.values(CodeAnalysisRuleSeverity);

const useStyles = makeStyles({
    // --- Layout ---
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

    // --- Table ---
    table: {
        width: "100%",
        borderCollapse: "collapse",
        tableLayout: "fixed",
    },
    tableHeaderCell: {
        textAlign: "left",
        fontWeight: tokens.fontWeightSemibold,
        padding: "3px 8px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground3,
    },
    severityCell: {
        width: "30%",
    },
    tableCell: {
        padding: "2px 8px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        fontSize: tokens.fontSizeBase200,
    },

    // --- States ---
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

    // --- Footer ---
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

export const CodeAnalysisDialog = () => {
    const styles = useStyles();
    const locConstants = LocConstants.getInstance();
    const loc = locConstants.codeAnalysis;
    const commonLoc = locConstants.common;
    const schemaCompareLoc = locConstants.schemaCompare;

    const context = useContext(CodeAnalysisContext);
    const projectName = useCodeAnalysisSelector((s) => s.projectName);
    const isLoading = useCodeAnalysisSelector((s) => s.isLoading);
    const rules = useCodeAnalysisSelector((s) => s.rules);

    const loadingSpinner = (
        <div className={styles.spinnerContainer}>
            <Spinner label={loc.loadingCodeAnalysisRules} />
        </div>
    );

    if (!context) {
        return loadingSpinner;
    }

    return (
        <div className={styles.root}>
            {/* Dialog Header */}
            <DialogHeader
                iconLight={codeAnalysisIconLight}
                iconDark={codeAnalysisIconDark}
                title={loc.codeAnalysisTitle(projectName)}
                themeKind={context.themeKind}
            />

            {/* Rules table */}
            <div className={styles.rulesContainer}>
                {isLoading ? (
                    loadingSpinner
                ) : rules.length === 0 ? (
                    <div className={styles.emptyState}>{loc.noCodeAnalysisRulesAvailable}</div>
                ) : (
                    <Table className={styles.table}>
                        <colgroup>
                            <col />
                            <col className={styles.severityCell} />
                        </colgroup>
                        <TableHeader>
                            <TableRow>
                                <TableHeaderCell className={styles.tableHeaderCell}>
                                    {loc.rules}
                                </TableHeaderCell>
                                <TableHeaderCell
                                    className={`${styles.tableHeaderCell} ${styles.severityCell}`}>
                                    {loc.severity}
                                </TableHeaderCell>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rules.map((rule) => (
                                <TableRow key={rule.ruleId}>
                                    <TableCell className={styles.tableCell}>
                                        <Checkbox
                                            checked={rule.enabled}
                                            aria-label={loc.enableRule(rule.shortRuleId)}
                                            disabled
                                        />
                                        <Text>
                                            {rule.shortRuleId}: {rule.displayName}
                                        </Text>
                                    </TableCell>
                                    <TableCell className={styles.tableCell}>
                                        <Dropdown
                                            value={rule.severity}
                                            selectedOptions={[rule.severity]}
                                            aria-label={loc.severityForRule(rule.shortRuleId)}
                                            disabled>
                                            {SEVERITY_OPTIONS.map((severity) => (
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
                <Text className={styles.statusText}>{loc.rulesCount(rules?.length ?? 0)}</Text>
                <div className={styles.footerButtons}>
                    <Button appearance="subtle" disabled onClick={() => undefined}>
                        {schemaCompareLoc.reset}
                    </Button>
                    <Button appearance="secondary" onClick={() => context.close()}>
                        {commonLoc.cancel}
                    </Button>
                    <Button appearance="primary" disabled onClick={() => undefined}>
                        {commonLoc.apply}
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default function CodeAnalysisPage() {
    return <CodeAnalysisDialog />;
}
