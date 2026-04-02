/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useMemo } from "react";
import { makeStyles, tokens, Text, Button } from "@fluentui/react-components";
import { Dismiss12Regular } from "@fluentui/react-icons";
import {
    FilterClause,
    FilterOperator,
    ProfilerColumnDef,
} from "../../../sharedInterfaces/profiler";
import { locConstants } from "../../common/locConstants";

export interface ActiveFiltersBarProps {
    /** Current filter clauses */
    clauses: FilterClause[];
    /** Column definitions (to look up header names) */
    columns: ProfilerColumnDef[];
    /** Callback to remove a specific column's filter */
    onRemoveFilter: (field: string) => void;
}

/**
 * Returns a short human-readable description of the filter clause.
 */
function describeClause(clause: FilterClause): string {
    const loc = locConstants.profiler;
    if (clause.operator === FilterOperator.In && clause.values) {
        const count = clause.values.length;
        return count === 0 ? loc.filterNoneSelected : loc.filterCountSelected(count);
    }
    const opLabel = getShortOperatorLabel(clause.operator);
    const val = clause.value !== undefined ? String(clause.value) : "";
    return `${opLabel} "${val}"`;
}

function getShortOperatorLabel(op: FilterOperator): string {
    const loc = locConstants.profiler;
    switch (op) {
        case FilterOperator.Equals:
            return loc.operatorEquals;
        case FilterOperator.NotEquals:
            return loc.operatorNotEquals;
        case FilterOperator.LessThan:
            return loc.operatorLessThan;
        case FilterOperator.LessThanOrEqual:
            return loc.operatorLessThanOrEqual;
        case FilterOperator.GreaterThan:
            return loc.operatorGreaterThan;
        case FilterOperator.GreaterThanOrEqual:
            return loc.operatorGreaterThanOrEqual;
        case FilterOperator.Contains:
            return loc.operatorContains;
        case FilterOperator.NotContains:
            return loc.operatorNotContains;
        case FilterOperator.StartsWith:
            return loc.operatorStartsWith;
        case FilterOperator.NotStartsWith:
            return loc.operatorNotStartsWith;
        case FilterOperator.EndsWith:
            return loc.operatorEndsWith;
        case FilterOperator.NotEndsWith:
            return loc.operatorNotEndsWith;
        case FilterOperator.IsNull:
            return loc.operatorIsNull;
        case FilterOperator.IsNotNull:
            return loc.operatorIsNotNull;
        case FilterOperator.In:
            return loc.operatorIn;
        default:
            return op;
    }
}

/**
 * Displays active column filters as removable badges below the toolbar.
 * Only renders when there are active filter clauses.
 */
export const ProfilerActiveFiltersBar: React.FC<ActiveFiltersBarProps> = ({
    clauses,
    columns,
    onRemoveFilter,
}) => {
    const classes = useStyles();
    const loc = locConstants.profiler;

    const badges = useMemo(() => {
        return clauses.map((clause) => {
            const col = columns.find((c) => c.field === clause.field);
            const columnName = col?.header ?? clause.field;
            const description = describeClause(clause);
            return {
                field: clause.field,
                label: loc.filterBadge(columnName, description),
                ariaLabel: loc.removeFilter(columnName),
            };
        });
    }, [clauses, columns, loc]);

    if (clauses.length === 0) {
        // eslint-disable-next-line no-restricted-syntax -- React components return null to render nothing
        return null;
    }

    return (
        <div className={classes.bar}>
            <Text size={200} weight="semibold" className={classes.label}>
                {loc.activeFiltersLabel}
            </Text>
            {badges.map((badge) => (
                <span key={badge.field} className={classes.badge}>
                    <Text size={200} className={classes.badgeText}>
                        {badge.label}
                    </Text>
                    <Button
                        appearance="transparent"
                        size="small"
                        icon={<Dismiss12Regular />}
                        onClick={() => onRemoveFilter(badge.field)}
                        aria-label={badge.ariaLabel}
                        className={classes.badgeRemove}
                    />
                </span>
            ))}
        </div>
    );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

/** Color to match the active filter funnel icon color */
const FILTER_ACTIVE_COLOR = "#75BEFF";
const FILTER_ACTIVE_COLOR_LIGHT = "#007ACC";

const useStyles = makeStyles({
    bar: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "4px 8px",
        flexWrap: "wrap",
        flexShrink: 0,
    },
    label: {
        color: tokens.colorNeutralForeground3,
        whiteSpace: "nowrap",
    },
    badge: {
        display: "inline-flex",
        alignItems: "center",
        gap: "2px",
        backgroundColor: FILTER_ACTIVE_COLOR + "22",
        border: `1px solid ${FILTER_ACTIVE_COLOR}`,
        borderRadius: tokens.borderRadiusMedium,
        padding: "1px 4px 1px 8px",
        "@media (prefers-color-scheme: light)": {
            backgroundColor: FILTER_ACTIVE_COLOR_LIGHT + "18",
            border: `1px solid ${FILTER_ACTIVE_COLOR_LIGHT}`,
        },
    },
    badgeText: {
        color: FILTER_ACTIVE_COLOR,
        whiteSpace: "nowrap",
        "@media (prefers-color-scheme: light)": {
            color: FILTER_ACTIVE_COLOR_LIGHT,
        },
    },
    badgeRemove: {
        minWidth: "auto",
        padding: "1px",
        color: FILTER_ACTIVE_COLOR,
        "@media (prefers-color-scheme: light)": {
            color: FILTER_ACTIVE_COLOR_LIGHT,
        },
    },
});
