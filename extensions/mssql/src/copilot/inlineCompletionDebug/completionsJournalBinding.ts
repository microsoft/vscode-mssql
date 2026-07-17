/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Completions wiring for the feature-capture journal binding (WI-2.4/2.6).
 * DiagnosticsManager calls `initializeCompletionsCaptureJournal` once the
 * store root and bundle manager exist (mirroring the bundle-manager wiring);
 * everything here is optional and failure-isolated — if the journal cannot
 * start, completions and the ring are untouched (M2 dual-write: the legacy
 * save-on-deactivate trace file keeps working unchanged).
 *
 * Owns:
 * - the module singleton binding over `inlineCompletionDebugStore`;
 * - live reaction to the Amendment C settings (`trace.captureEnabled` →
 *   start/stop, `trace.redactPrompts` → policy roll);
 * - the stored-session provider configuration (WI-2.5 current-epoch
 *   exclusion rides the live store's captureSessionId);
 * - the developer reconciliation command
 *   `mssql.copilot.completions.journal.reconcile` (WI-2.6): flush barrier →
 *   read the current epoch's stream(s) → compare per §10.3 → summary
 *   message + full JSON report at `<stream>/reconciliation.json`;
 * - the deactivate flush barrier, called from mainController.deactivate
 *   right after the legacy trace save.
 */

import * as vscode from "vscode";
import { FeatureCaptureJournalBinding } from "../../diagnostics/featureCapture/captureJournalBinding";
import {
    CaptureReconciliationReport,
    reconcileCaptureSession,
} from "../../diagnostics/featureCapture/journalReconciliation";
import {
    FeatureCaptureJournalReadResult,
    readFeatureCaptureJournal,
} from "../../diagnostics/featureCapture/journal/journalReader";
import {
    JournalFsLike,
    NodeJournalFs,
    joinPath,
} from "../../diagnostics/featureCapture/journal/journalWriter";
import { ObservabilityBundleManager } from "../../diagnostics/sessionBundle/bundleManager";
import { logger2 } from "../../models/logger2";
import * as Constants from "../../constants/constants";
import {
    InlineCompletionDebugEvent,
    InlineCompletionDebugOverrides,
} from "../../sharedInterfaces/inlineCompletionDebug";
import { inlineCompletionDebugStore } from "./inlineCompletionDebugStore";
import {
    COMPLETIONS_ACCEPTANCE_MUTATION_KIND,
    COMPLETIONS_JOURNAL_EVENT_SCHEMA,
    COMPLETIONS_JOURNAL_OVERRIDES_SCHEMA,
    buildCompletionsCapturePolicy,
    completionsReconciliationAdapter,
    createCompletionAcceptanceValue,
    isTerminalCompletionResult,
    redactCompletionEventForJournal,
} from "./completionsJournalProjection";
import { configureCompletionsStoredSessions } from "./storedSessionProvider";
import { getTraceCaptureEnabledSetting, getTraceRedactPromptsSetting } from "./tracePersistence";

export const RECONCILE_COMPLETIONS_JOURNAL_COMMAND = "mssql.copilot.completions.journal.reconcile";
export const RECONCILIATION_REPORT_FILE = "reconciliation.json";

const bindingLogger = logger2.withPrefix("CompletionsJournal");

type CompletionsJournalBinding = FeatureCaptureJournalBinding<
    InlineCompletionDebugEvent,
    InlineCompletionDebugOverrides
>;

let activeBinding: CompletionsJournalBinding | undefined;
let activeFs: JournalFsLike | undefined;

export interface InitializeCompletionsCaptureJournalDeps {
    storeRoot: string;
    hostSessionId: string;
    bundleManager: ObservabilityBundleManager;
    /** Injectable for tests; NodeJournalFs in the product. */
    fs?: JournalFsLike;
}

export function getCompletionsJournalBinding(): CompletionsJournalBinding | undefined {
    return activeBinding;
}

/**
 * The filesystem the active binding writes through (tests inject a fake via
 * initializeCompletionsCaptureJournal). WI-2.7 journal-primary reads must go
 * through the SAME seam or test journals would be invisible to the export.
 */
export function getCompletionsJournalFs(): JournalFsLike | undefined {
    return activeFs;
}

/**
 * Wire the completions journal binding (idempotent per activation). Never
 * throws — a failure leaves the binding off and the product unaffected.
 */
export function initializeCompletionsCaptureJournal(
    context: vscode.ExtensionContext,
    deps: InitializeCompletionsCaptureJournalDeps,
): void {
    if (activeBinding) {
        return;
    }
    try {
        const fs = deps.fs ?? new NodeJournalFs();
        activeFs = fs;
        const binding = new FeatureCaptureJournalBinding<
            InlineCompletionDebugEvent,
            InlineCompletionDebugOverrides
        >({
            store: inlineCompletionDebugStore,
            storeRoot: deps.storeRoot,
            hostSessionId: deps.hostSessionId,
            eventSchema: COMPLETIONS_JOURNAL_EVENT_SCHEMA,
            overridesSchema: COMPLETIONS_JOURNAL_OVERRIDES_SCHEMA,
            policyProvider: () =>
                buildCompletionsCapturePolicy({
                    traceCaptureEnabled: getTraceCaptureEnabledSetting(),
                    redactPrompts: getTraceRedactPromptsSetting(),
                    viewerArmed: inlineCompletionDebugStore.getActiveViewerCount() > 0,
                    activatedAt: Date.now(),
                }),
            redactEventValue: redactCompletionEventForJournal,
            isTerminal: (event) => isTerminalCompletionResult(event.result),
            acceptanceValue: (_event, mutationKind) =>
                mutationKind === COMPLETIONS_ACCEPTANCE_MUTATION_KIND
                    ? createCompletionAcceptanceValue(Date.now())
                    : undefined,
            bundleRegistrar: deps.bundleManager,
            fs,
        });
        activeBinding = binding;

        // WI-2.5: the Sessions dataset's stored-session provider shares the
        // store root; the current epoch (all its policy phases) is excluded
        // by the LIVE store's captureSessionId.
        configureCompletionsStoredSessions({
            storeRoot: deps.storeRoot,
            isCurrentEpoch: (captureSessionId) =>
                captureSessionId === inlineCompletionDebugStore.captureSessionId,
            fs,
        });

        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration((change) => {
                if (
                    change.affectsConfiguration(
                        Constants.configCopilotInlineCompletionsTraceCaptureEnabled,
                    ) ||
                    change.affectsConfiguration(
                        Constants.configCopilotInlineCompletionsTraceRedactPrompts,
                    )
                ) {
                    binding.refreshPolicy();
                }
            }),
            vscode.commands.registerCommand(RECONCILE_COMPLETIONS_JOURNAL_COMMAND, () =>
                runCompletionsJournalReconciliation(),
            ),
            {
                dispose: () => {
                    if (activeBinding === binding) {
                        activeBinding = undefined;
                        activeFs = undefined;
                        configureCompletionsStoredSessions(undefined);
                    }
                    void binding.dispose();
                },
            },
        );
        bindingLogger.info(
            `Completions capture journal wired (active: ${binding.isActive ? binding.activePolicy?.policyId : "off"}).`,
        );
    } catch (error) {
        // Observability failure never fails the product (§2.3).
        activeBinding = undefined;
        bindingLogger.warn(
            `Completions capture journal failed to initialize (isolated): ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

/**
 * Deactivate flush barrier — called from mainController.deactivate right
 * after the legacy save-on-deactivate (which stays untouched: M2 dual-write).
 * Never rejects.
 */
export async function flushCompletionsCaptureJournalOnDeactivate(): Promise<void> {
    const binding = activeBinding;
    if (!binding) {
        return;
    }
    try {
        await binding.dispose();
    } catch {
        // best effort — health/manifests already tell the honest story
    }
}

/**
 * The WI-2.6 developer command body: reconcile the CURRENT capture epoch's
 * ring against its journal stream(s), write the full report next to the
 * stream, and summarize via an information message. Returns the report for
 * tests; undefined when the journal is inactive or empty.
 */
export async function runCompletionsJournalReconciliation(): Promise<
    CaptureReconciliationReport | undefined
> {
    const binding = activeBinding;
    if (!binding || !binding.isActive) {
        void vscode.window.showInformationMessage(
            "Completions journal is not active — enable " +
                `"${Constants.configCopilotInlineCompletionsTraceCaptureEnabled}" to dual-write the capture journal.`,
        );
        return undefined;
    }
    try {
        await binding.flushBarrier();
        const directories = binding.currentEpochStreamDirectories;
        if (directories.length === 0) {
            void vscode.window.showInformationMessage(
                "Completions journal has no records for the current capture epoch yet.",
            );
            return undefined;
        }
        const fs = activeFs ?? new NodeJournalFs();
        const readResults: FeatureCaptureJournalReadResult<
            unknown,
            unknown,
            unknown,
            Record<string, unknown>
        >[] = [];
        for (const directory of directories) {
            readResults.push(await readFeatureCaptureJournal(directory, { fs }));
        }
        const report = await reconcileCaptureSession(
            inlineCompletionDebugStore.getEvents(),
            readResults,
            completionsReconciliationAdapter,
            {
                ringEvictedCount: inlineCompletionDebugStore.evictedEventCount,
                expectedFidelity: binding.activePolicy?.fidelity,
            },
        );
        binding.noteReconciliation(report);

        // Full report lands beside the CURRENT stream (the latest phase).
        const reportPath = joinPath(
            directories[directories.length - 1],
            RECONCILIATION_REPORT_FILE,
        );
        try {
            await fs.writeFile(reportPath, JSON.stringify(report, undefined, 2));
        } catch (error) {
            bindingLogger.warn(
                `Failed to write ${RECONCILIATION_REPORT_FILE}: ${error instanceof Error ? error.message : String(error)}`,
            );
        }

        const summary = report.matches
            ? `Completions journal reconciliation PASSED (${report.rows.length} checks, ` +
              `${report.digest.compared} event digest(s) compared).`
            : `Completions journal reconciliation FAILED: ${report.mismatches.length} mismatch(es) — ` +
              `${report.mismatches.slice(0, 3).join("; ")}${report.mismatches.length > 3 ? "; …" : ""}`;
        void vscode.window.showInformationMessage(`${summary} Full report: ${reportPath}`);
        return report;
    } catch (error) {
        bindingLogger.warn(
            `Journal reconciliation failed (isolated): ${error instanceof Error ? error.message : String(error)}`,
        );
        void vscode.window.showInformationMessage(
            `Completions journal reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
    }
}
