/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Deterministic migration-risk projection over a closed EF semantic diff.
 * It does not infer rename choices, generate SQL, inspect data, or claim that
 * a reviewed change is safe to apply. */

import * as crypto from "crypto";
import { canonicalRunbookJson } from "../runbookDigest";
import type { LocalEfRelationalChange, LocalEfRelationalDiff } from "./localEfRelationalModel";

export const LOCAL_EF_MIGRATION_RISK_SCHEMA_VERSION = 1 as const;

export type LocalEfMigrationRiskSeverity = "info" | "review" | "block";

export interface LocalEfMigrationRiskItem {
    code:
        | "modelIncomparable"
        | "renameDecisionRequired"
        | "objectDrop"
        | "columnConversion"
        | "constraintChange"
        | "temporalChange"
        | "operationReview";
    severity: LocalEfMigrationRiskSeverity;
    objectType: string;
    path: string;
    changeKind: string;
    potentialDataLoss: boolean;
    detail: string;
}

export interface LocalEfMigrationRiskDocument {
    schemaVersion: typeof LOCAL_EF_MIGRATION_RISK_SCHEMA_VERSION;
    diffSha256: string;
    comparable: boolean;
    status: "safe" | "reviewRequired" | "blocked";
    potentialDataLoss: boolean;
    requiresRenameDecision: boolean;
    blockerCount: number;
    reviewCount: number;
    items: LocalEfMigrationRiskItem[];
    riskSha256: string;
}

export function analyzeLocalEfMigrationRisk(
    diff: LocalEfRelationalDiff,
): LocalEfMigrationRiskDocument {
    const items: LocalEfMigrationRiskItem[] = [];
    if (!diff.comparable) {
        items.push({
            code: "modelIncomparable",
            severity: "block",
            objectType: "model",
            path: "(model)",
            changeKind: "compare",
            potentialDataLoss: false,
            detail: diff.reason,
        });
    }
    for (const candidate of diff.renameCandidates) {
        items.push({
            code: "renameDecisionRequired",
            severity: "block",
            objectType: candidate.objectType,
            path: candidate.toPath,
            changeKind: "renameCandidate",
            potentialDataLoss: true,
            detail: `${candidate.fromPath} -> ${candidate.toPath} (${candidate.similarity.toFixed(4)})`,
        });
    }
    for (const change of diff.changes) {
        const item = riskForChange(change);
        if (item) {
            items.push(item);
        }
    }
    items.sort((left, right) =>
        `${left.path}\0${left.code}\0${left.changeKind}`.localeCompare(
            `${right.path}\0${right.code}\0${right.changeKind}`,
        ),
    );
    const blockerCount = items.filter((item) => item.severity === "block").length;
    const reviewCount = items.filter((item) => item.severity === "review").length;
    const facts = {
        diffSha256: diff.diffSha256,
        comparable: diff.comparable,
        status: (blockerCount > 0
            ? "blocked"
            : reviewCount > 0
              ? "reviewRequired"
              : "safe") as LocalEfMigrationRiskDocument["status"],
        potentialDataLoss: diff.potentialDataLoss || items.some((item) => item.potentialDataLoss),
        requiresRenameDecision: diff.requiresRenameDecision,
        blockerCount,
        reviewCount,
        items,
    };
    return {
        schemaVersion: LOCAL_EF_MIGRATION_RISK_SCHEMA_VERSION,
        ...facts,
        riskSha256: crypto.createHash("sha256").update(canonicalRunbookJson(facts)).digest("hex"),
    };
}

function riskForChange(change: LocalEfRelationalChange): LocalEfMigrationRiskItem | undefined {
    if (change.kind === "dropTable" || change.kind === "dropColumn") {
        return item(change, "objectDrop", "review", true, "dropMayDiscardData");
    }
    if (change.kind === "alterColumn" && change.risk !== "safe") {
        return item(
            change,
            "columnConversion",
            "review",
            true,
            change.changedProperties.join(",") || "columnFacetsChanged",
        );
    }
    if (change.kind === "alterTemporal") {
        return item(change, "temporalChange", "review", false, "temporalConfigurationChanged");
    }
    if (
        change.objectType === "primaryKey" ||
        change.objectType === "uniqueConstraint" ||
        change.objectType === "foreignKey" ||
        change.objectType === "check"
    ) {
        if (change.risk !== "safe") {
            return item(
                change,
                "constraintChange",
                "review",
                false,
                change.changedProperties.join(",") || "constraintSemanticsChanged",
            );
        }
        return undefined;
    }
    return change.risk === "review"
        ? item(
              change,
              "operationReview",
              "review",
              false,
              change.changedProperties.join(",") || "operationRequiresReview",
          )
        : undefined;
}

function item(
    change: LocalEfRelationalChange,
    code: LocalEfMigrationRiskItem["code"],
    severity: LocalEfMigrationRiskSeverity,
    potentialDataLoss: boolean,
    detail: string,
): LocalEfMigrationRiskItem {
    return {
        code,
        severity,
        objectType: change.objectType,
        path: change.path,
        changeKind: change.kind,
        potentialDataLoss,
        detail,
    };
}
