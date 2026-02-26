/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Fragment, useContext, useEffect, useMemo, useState } from "react";
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
import {
    SqlCodeAnalysisRule,
    CodeAnalysisRuleSeverity,
} from "../../../sharedInterfaces/codeAnalysis";
import { ChevronDown20Regular, ChevronRight20Regular } from "@fluentui/react-icons";
import { DialogHeader } from "../../common/dialogHeader.component";
import { DialogMessage } from "../../common/dialogMessage";
import { ConfirmationDialog } from "../../common/confirmationDialog";

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

    // --- Category row ---
    groupHeaderCell: {
        padding: "3px 8px",
        fontSize: tokens.fontSizeBase200,
        fontWeight: tokens.fontWeightSemibold,
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    categoryHeaderCellClickable: {
        cursor: "pointer",
        userSelect: "none",
    },
    categoryHeaderContent: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
    },
    categoryToggleButton: {
        minWidth: "20px",
        padding: "0px 2px",
        fontSize: tokens.fontSizeBase400,
        fontWeight: tokens.fontWeightSemibold,
        lineHeight: "1",
    },

    // --- Rule row ---
    childRuleContent: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        paddingLeft: "56px",
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

    const context = useContext(CodeAnalysisContext);
    const projectName = useCodeAnalysisSelector((s) => s.projectName);
    const isLoading = useCodeAnalysisSelector((s) => s.isLoading);
    const rules = useCodeAnalysisSelector((s) => s.rules);
    const dacfxStaticRules = useCodeAnalysisSelector((s) => s.dacfxStaticRules);
    const message = useCodeAnalysisSelector((s) => s.message);

    const [localRules, setLocalRules] = useState<SqlCodeAnalysisRule[]>(rules);
    const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
    const [showUnsavedChangesDialog, setShowUnsavedChangesDialog] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    // Remembers per-category severities before a category is fully disabled,
    // so they can be restored when the category is re-enabled.
    const [categoryPreviousSeverities, setCategoryPreviousSeverities] = useState<
        Map<string, Map<string, string>>
    >(new Map());

    useEffect(() => {
        setLocalRules(rules);
    }, [rules]);

    // Reset isSaving when the save completes: the reducer updates `rules` on
    // success and `message` on error — either signals the round-trip is done.
    useEffect(() => {
        setIsSaving(false);
    }, [rules, message]);

    // True when localRules diverges from the saved rules (different severity or enabled state),
    // used to enable/disable the Apply, OK, and unsaved-changes prompt.
    const isDirty = useMemo(() => {
        if (localRules.length !== rules.length) return true;
        const rulesMap = new Map(rules.map((rule) => [rule.ruleId, rule]));
        return localRules.some((local) => {
            const original = rulesMap.get(local.ruleId);
            return (
                !original ||
                original.severity !== local.severity ||
                original.enabled !== local.enabled
            );
        });
    }, [localRules, rules]);

    // --- Grouping ---
    const groupedRuleEntries = useMemo(() => {
        const groupedRules = new Map<string, SqlCodeAnalysisRule[]>();
        localRules.forEach((rule) => {
            const bucket = groupedRules.get(rule.category) ?? [];
            bucket.push(rule);
            groupedRules.set(rule.category, bucket);
        });
        return Array.from(groupedRules.entries()).sort(([a], [b]) => a.localeCompare(b));
    }, [localRules]);

    // --- Handlers ---
    /**
     * Determines the visual/interactive state of the category checkbox:
     *  - true    → all rules in the category have a non-Disabled severity  (checkbox: checked, enabled)
     *  - false   → all rules in the category have Disabled severity         (checkbox: unchecked, enabled)
     *  - "mixed" → at least one Disabled AND at least one non-Disabled      (checkbox: indeterminate solid, DISABLED)
     */
    const getCategoryCheckedState = (
        categoryRules: SqlCodeAnalysisRule[],
    ): true | false | "mixed" => {
        const disabledCount = categoryRules.filter(
            (rule) => rule.severity === CodeAnalysisRuleSeverity.Disabled,
        ).length;
        if (disabledCount === 0) return true;
        if (disabledCount === categoryRules.length) return false;
        return "mixed";
    };

    /**
     * Handles a category checkbox click.
     *  - currentState === true  → user is unchecking: save severities, set all to Disabled.
     *  - currentState === false → user is checking: restore saved severities (or default to Warning).
     *  - currentState === "mixed" → no-op; the checkbox is disabled in this state.
     */
    const toggleCategoryRules = (category: string, currentState: true | false | "mixed") => {
        if (currentState === "mixed") return;

        if (currentState === true) {
            // Save current (non-Disabled) severities before disabling the whole category.
            const snapshot = new Map<string, string>();
            localRules
                .filter((rule) => rule.category === category)
                .forEach((rule) => snapshot.set(rule.ruleId, rule.severity));
            setCategoryPreviousSeverities((prev) => new Map(prev).set(category, snapshot));

            setLocalRules((prev) =>
                prev.map((rule) =>
                    rule.category === category
                        ? { ...rule, severity: CodeAnalysisRuleSeverity.Disabled, enabled: false }
                        : rule,
                ),
            );
        } else {
            // Restore previously saved severities, falling back to Warning if none recorded.
            const snapshot = categoryPreviousSeverities.get(category);
            setLocalRules((prev) =>
                prev.map((rule) => {
                    if (rule.category !== category) return rule;
                    // snapshot only contains non-Disabled values (category was fully enabled
                    // when the snapshot was taken; "mixed" state blocks this code path).
                    const severity = snapshot?.get(rule.ruleId) ?? CodeAnalysisRuleSeverity.Warning;
                    return { ...rule, severity, enabled: true };
                }),
            );
        }
    };

    const toggleCategoryCollapsed = (category: string) => {
        setCollapsedCategories((prev) => {
            const next = new Set(prev);
            next.has(category) ? next.delete(category) : next.add(category);
            return next;
        });
    };

    const resetToDefaults = () => {
        setLocalRules(dacfxStaticRules);
    };

    const changeSeverity = (ruleId: string, severity: string) => {
        setLocalRules((prev) =>
            prev.map((rule) =>
                rule.ruleId === ruleId
                    ? { ...rule, severity, enabled: severity !== CodeAnalysisRuleSeverity.Disabled }
                    : rule,
            ),
        );
    };

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

            {/* Error message bar */}
            {message && (
                <DialogMessage
                    message={message}
                    onMessageButtonClicked={() => {}}
                    onCloseMessage={() => context.closeMessage()}
                />
            )}

            {/* Rules table */}
            <div className={styles.rulesContainer}>
                {isLoading ? (
                    loadingSpinner
                ) : localRules.length === 0 ? (
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
                            {groupedRuleEntries.map(([category, categoryRules]) => (
                                <Fragment key={category}>
                                    {/* Category row */}
                                    <TableRow>
                                        <TableCell
                                            className={`${styles.groupHeaderCell} ${styles.categoryHeaderCellClickable}`}
                                            onDoubleClick={() => toggleCategoryCollapsed(category)}>
                                            <div className={styles.categoryHeaderContent}>
                                                <Button
                                                    appearance="subtle"
                                                    aria-label={
                                                        collapsedCategories.has(category)
                                                            ? loc.expandCategory(category)
                                                            : loc.collapseCategory(category)
                                                    }
                                                    className={styles.categoryToggleButton}
                                                    icon={
                                                        collapsedCategories.has(category) ? (
                                                            <ChevronRight20Regular />
                                                        ) : (
                                                            <ChevronDown20Regular />
                                                        )
                                                    }
                                                    onDoubleClick={(e) => e.stopPropagation()}
                                                    onClick={() =>
                                                        toggleCategoryCollapsed(category)
                                                    }
                                                />
                                                <Checkbox
                                                    aria-label={loc.enableCategory(category)}
                                                    checked={getCategoryCheckedState(categoryRules)}
                                                    disabled={
                                                        getCategoryCheckedState(categoryRules) ===
                                                        "mixed"
                                                    }
                                                    onDoubleClick={(e) => e.stopPropagation()}
                                                    onChange={() =>
                                                        toggleCategoryRules(
                                                            category,
                                                            getCategoryCheckedState(categoryRules),
                                                        )
                                                    }
                                                />
                                                <Text weight="semibold">{category}</Text>
                                            </div>
                                        </TableCell>
                                        <TableCell className={styles.groupHeaderCell} />
                                    </TableRow>

                                    {/* Rule rows */}
                                    {!collapsedCategories.has(category) &&
                                        categoryRules.map((rule) => (
                                            <TableRow key={rule.ruleId}>
                                                <TableCell className={styles.tableCell}>
                                                    <div className={styles.childRuleContent}>
                                                        <Checkbox
                                                            aria-hidden={true}
                                                            checked={rule.enabled}
                                                            disabled={!rule.enabled}
                                                            style={{ pointerEvents: "none" }}
                                                            tabIndex={-1}
                                                        />
                                                        <Text>
                                                            {rule.shortRuleId}: {rule.displayName}
                                                        </Text>
                                                    </div>
                                                </TableCell>
                                                <TableCell className={styles.tableCell}>
                                                    <Dropdown
                                                        aria-label={loc.severityForRule(
                                                            rule.shortRuleId,
                                                        )}
                                                        value={rule.severity}
                                                        selectedOptions={[rule.severity]}
                                                        onOptionSelect={(_e, data) =>
                                                            changeSeverity(
                                                                rule.ruleId,
                                                                data.optionValue ?? rule.severity,
                                                            )
                                                        }>
                                                        {SEVERITY_OPTIONS.map((severity) => (
                                                            <Option key={severity} value={severity}>
                                                                {severity}
                                                            </Option>
                                                        ))}
                                                    </Dropdown>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                </Fragment>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </div>

            {/* Footer */}
            <div className={styles.footer}>
                <Text className={styles.statusText}>{loc.rulesCount(localRules?.length ?? 0)}</Text>
                <div className={styles.footerButtons}>
                    {/* Reset button with co-located confirm dialog */}
                    <ConfirmationDialog
                        trigger={
                            <Button appearance="subtle" disabled={isLoading || isSaving}>
                                {loc.reset}
                            </Button>
                        }
                        title={loc.resetConfirmTitle}
                        message={loc.resetConfirmMessage}
                        actions={[
                            {
                                label: loc.reset,
                                appearance: "primary",
                                onClick: resetToDefaults,
                            },
                        ]}
                        cancelLabel={commonLoc.cancel}
                    />
                    <Button
                        appearance="secondary"
                        disabled={isSaving}
                        onClick={() =>
                            isDirty ? setShowUnsavedChangesDialog(true) : context.close()
                        }>
                        {commonLoc.cancel}
                    </Button>
                    <Button
                        appearance="secondary"
                        disabled={!isDirty || isLoading || isSaving}
                        onClick={() => {
                            setIsSaving(true);
                            context.saveRules(localRules, false);
                        }}>
                        {commonLoc.apply}
                    </Button>
                    <Button
                        appearance="primary"
                        disabled={!isDirty || isLoading || isSaving}
                        onClick={() => {
                            setIsSaving(true);
                            context.saveRules(localRules, true);
                        }}>
                        {commonLoc.ok}
                    </Button>
                </div>
            </div>

            {/* Unsaved changes confirmation dialog (controlled — triggered conditionally on isDirty) */}
            <ConfirmationDialog
                open={showUnsavedChangesDialog}
                onClose={() => setShowUnsavedChangesDialog(false)}
                title={loc.unsavedChangesTitle}
                message={loc.unsavedChangesMessage}
                actions={[
                    {
                        label: commonLoc.save,
                        appearance: "primary",
                        disabled: isSaving || isLoading,
                        onClick: () => {
                            setIsSaving(true);
                            setShowUnsavedChangesDialog(false);
                            context.saveRules(localRules, true);
                        },
                    },
                    {
                        label: loc.dontSave,
                        appearance: "secondary",
                        onClick: () => context.close(),
                    },
                ]}
                cancelLabel={commonLoc.cancel}
            />
        </div>
    );
};

export default function CodeAnalysisPage() {
    return <CodeAnalysisDialog />;
}
