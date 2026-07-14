/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Command-scoped legacy handoff (SV-R8; addendum §8, §6.5–§6.7). THE ONLY
 * DOOR to STS v1 in the visualizer: browse never crosses it (§8.6 —
 * tripwire-enforced), and a publish crosses it exactly as:
 *
 *   refreshingBaseline → resolvingClassicConnection → creatingSession →
 *   correlating → generatingReport → awaitingConfirmation → publishing →
 *   refreshingAfterPublish → idle
 *
 * with EVERY exit path (cancel, conflict, failure, close) routed through
 * disposingSession — a created v1 session is disposed exactly once (§8.5;
 * created/disposed counters are exposed so the leak test can assert it).
 *
 * The preview token (§8.4) pins WHAT the report described: same v1
 * session, same edit revision, same normalized-op hash, same catalog
 * fingerprint. `publish` refuses anything else (`previewInvalidated`),
 * and a §6.7 forced live refresh re-checks the catalog fingerprint right
 * before publishSession — the report-review race closes to the final
 * DacFx apply window, whose failure is handled, disposed, and retryable.
 *
 * Pure orchestration: dependencies are ports (fake-v1 tested §17.4);
 * vscode/ConnectionManager appear only behind the resolver seam (§8.1).
 */

import { createHash } from "crypto";
import { SchemaDesigner } from "../../sharedInterfaces/schemaDesigner";
import { SchemaVisualizerEditOp } from "../model/schemaVisualizerEdit";
import { normalizeOperations, rebaseOperations } from "../model/schemaVisualizerEditReducer";
import { SchemaVisualizerCatalogModel } from "../model/schemaVisualizerModel";
import { computeVisualizerFingerprint } from "../model/visualizerFingerprint";
import { ReplayConflict, replayEditsToLegacySchema } from "./replayEditsToLegacySchema";

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** §8.1: dedicated resolver seam — NOT the OE v2 owner-URI handoff. */
export interface SchemaVisualizerClassicPublishResolver {
    resolve(input: { database: string }): Promise<ResolvedClassicConnection>;
}

export interface ResolvedClassicConnection {
    connectionString: string;
    accessToken?: string;
    /** Credentials must not outlive session creation (§8.1). */
    dispose(): void;
}

/** Structural subset of the legacy ISchemaDesignerService (fakeable). */
export interface LegacySchemaDesignerPort {
    createSession(input: {
        connectionString: string;
        accessToken?: string;
        database: string;
    }): Promise<{ sessionId: string; schema: SchemaDesigner.Schema }>;
    getReport(input: {
        sessionId: string;
        updatedSchema: SchemaDesigner.Schema;
    }): Promise<SchemaDesigner.GetReportResponse>;
    publishSession(input: { sessionId: string }): Promise<void>;
    disposeSession(input: { sessionId: string }): Promise<void>;
}

/** The visualizer session facts the handoff needs (§6.5/§6.7). */
export interface VisualizerBaselineSource {
    /** FORCED live refresh; returns the pinned full model + fingerprint. */
    refreshLive(): Promise<{ model: SchemaVisualizerCatalogModel; complete: boolean }>;
}

export interface HandoffEvents {
    onStateChange?(state: HandoffState): void;
}

// ---------------------------------------------------------------------------
// States / outcomes
// ---------------------------------------------------------------------------

export type HandoffState =
    | "idle"
    | "refreshingBaseline"
    | "resolvingClassicConnection"
    | "creatingSession"
    | "correlating"
    | "generatingReport"
    | "awaitingConfirmation"
    | "publishing"
    | "refreshingAfterPublish"
    | "disposingSession"
    | "failed";

export type HandoffErrorCode =
    | "baselineIncomplete"
    | "baselineChanged"
    | "rebaseConflict"
    | "correlationNotFound"
    | "correlationAmbiguous"
    | "classicHandoffUnavailable"
    | "reportFailed"
    | "previewInvalidated"
    | "publishFailed"
    | "refreshAfterPublishFailed"
    | "sessionDisposed"
    | "busy";

export interface PublishPreviewToken {
    sessionId: string;
    editRevision: number;
    normalizedOperationsHash: string;
    catalogFingerprint: string;
    report: SchemaDesigner.GetReportResponse;
}

export type PreviewOutcome =
    | { ok: true; token: PublishPreviewToken }
    | { ok: false; code: HandoffErrorCode; message: string; conflict?: ReplayConflict };

export type PublishOutcome =
    | { ok: true; refreshFailed?: boolean }
    | { ok: false; code: HandoffErrorCode; message: string };

export function hashNormalizedOperations(ops: SchemaVisualizerEditOp[]): string {
    const digest = createHash("sha256").update(JSON.stringify(ops), "utf8").digest("base64url");
    return `svo_${digest.slice(0, 22)}`;
}

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export class SchemaVisualizerHandoff {
    private state: HandoffState = "idle";
    private activeSessionId: string | undefined;
    private token: PublishPreviewToken | undefined;
    private editRevision = 0;
    /** §8.5 leak accounting — the test asserts created === disposed. */
    public createdSessions = 0;
    public disposedSessions = 0;

    constructor(
        private readonly deps: {
            resolver: SchemaVisualizerClassicPublishResolver;
            legacy: LegacySchemaDesignerPort;
            baseline: VisualizerBaselineSource;
            database: string;
            newId: () => string;
            events?: HandoffEvents;
        },
    ) {}

    currentState(): HandoffState {
        return this.state;
    }

    private setState(state: HandoffState): void {
        this.state = state;
        this.deps.events?.onStateChange?.(state);
    }

    /** Any edit invalidates a held preview (§8.4/§8.5). */
    async notifyEdited(): Promise<void> {
        this.editRevision++;
        await this.invalidatePreview("edit");
    }

    /** Catalog drift while a preview is held invalidates it (§8.5). */
    async notifyDrift(): Promise<void> {
        await this.invalidatePreview("drift");
    }

    private async invalidatePreview(_reason: "edit" | "drift" | "replaced"): Promise<void> {
        this.token = undefined;
        if (this.activeSessionId !== undefined) {
            await this.disposeActiveSession();
            this.setState("idle");
        }
    }

    private async disposeActiveSession(): Promise<void> {
        const sessionId = this.activeSessionId;
        if (sessionId === undefined) {
            return;
        }
        this.activeSessionId = undefined;
        this.setState("disposingSession");
        try {
            await this.deps.legacy.disposeSession({ sessionId });
        } catch {
            // Disposal is best-effort; the server reaps orphans. Counted
            // regardless so the leak ledger reflects our intent.
        } finally {
            this.disposedSessions++;
        }
    }

    /**
     * Preview Changes (§6.5 exact sequence). On success the machine holds
     * the v1 session open in awaitingConfirmation with a token.
     */
    async previewChanges(ops: SchemaVisualizerEditOp[]): Promise<PreviewOutcome> {
        if (this.state !== "idle" && this.state !== "awaitingConfirmation") {
            return { ok: false, code: "busy", message: `Handoff is ${this.state}.` };
        }
        // A second preview replaces the first (§8.5).
        await this.invalidatePreview("replaced");
        const revisionAtStart = this.editRevision;

        // 1–4: forced live baseline, refuse incomplete, pin, fingerprint.
        this.setState("refreshingBaseline");
        let baseline: { model: SchemaVisualizerCatalogModel; complete: boolean };
        try {
            baseline = await this.deps.baseline.refreshLive();
        } catch (error) {
            this.setState("failed");
            return {
                ok: false,
                code: "baselineChanged",
                message: `Live metadata refresh failed: ${error instanceof Error ? error.message : "unknown"}`,
            };
        }
        if (!baseline.complete) {
            this.setState("failed");
            return {
                ok: false,
                code: "baselineIncomplete",
                message:
                    "Required metadata sections are unavailable — cannot build a publish baseline.",
            };
        }
        const fingerprint = computeVisualizerFingerprint(baseline.model);

        // 5–6: rebase the log onto the live model; stop on conflict.
        const normalized = normalizeOperations(ops);
        const rebase = rebaseOperations(baseline.model, normalized);
        if (rebase.state === "conflict") {
            this.setState("failed");
            return {
                ok: false,
                code: "rebaseConflict",
                message: rebase.conflict.message,
                conflict: { code: "correlationNotFound", message: rebase.conflict.message },
            };
        }

        // 7: only now resolve classic credentials + create the v1 session.
        this.setState("resolvingClassicConnection");
        let resolved: ResolvedClassicConnection;
        try {
            resolved = await this.deps.resolver.resolve({ database: this.deps.database });
        } catch (error) {
            this.setState("failed");
            return {
                ok: false,
                code: "classicHandoffUnavailable",
                message: error instanceof Error ? error.message : "Classic connection unavailable.",
            };
        }
        this.setState("creatingSession");
        let created: { sessionId: string; schema: SchemaDesigner.Schema };
        try {
            created = await this.deps.legacy.createSession({
                connectionString: resolved.connectionString,
                ...(resolved.accessToken !== undefined
                    ? { accessToken: resolved.accessToken }
                    : {}),
                database: this.deps.database,
            });
            this.createdSessions++;
        } catch (error) {
            this.setState("failed");
            return {
                ok: false,
                code: "classicHandoffUnavailable",
                message: error instanceof Error ? error.message : "createSession failed.",
            };
        } finally {
            resolved.dispose(); // credentials never outlive session creation
        }
        this.activeSessionId = created.sessionId;

        try {
            // Correlate + replay onto the FRESH v1 baseline (§6.6).
            this.setState("correlating");
            const replay = replayEditsToLegacySchema(created.schema, normalized, {
                caseSensitive: baseline.model.caseSensitive,
                newId: this.deps.newId,
            });
            if (replay.ok === false) {
                await this.disposeActiveSession();
                this.setState("failed");
                return {
                    ok: false,
                    code:
                        replay.conflict.code === "correlationAmbiguous"
                            ? "correlationAmbiguous"
                            : "correlationNotFound",
                    message: replay.conflict.message,
                    conflict: replay.conflict,
                };
            }

            this.setState("generatingReport");
            const report = await this.deps.legacy.getReport({
                sessionId: created.sessionId,
                updatedSchema: replay.schema,
            });
            if (this.editRevision !== revisionAtStart) {
                await this.disposeActiveSession();
                this.setState("failed");
                return {
                    ok: false,
                    code: "previewInvalidated",
                    message: "Edits changed while the preview was being generated.",
                };
            }
            this.token = {
                sessionId: created.sessionId,
                editRevision: this.editRevision,
                normalizedOperationsHash: hashNormalizedOperations(normalized),
                catalogFingerprint: fingerprint.hash,
                report,
            };
            this.setState("awaitingConfirmation");
            return { ok: true, token: this.token };
        } catch (error) {
            await this.disposeActiveSession();
            this.setState("failed");
            return {
                ok: false,
                code: "reportFailed",
                message: error instanceof Error ? error.message : "getReport failed.",
            };
        }
    }

    /** User declined the report (§8.6 canceled-preview sequence). */
    async cancelPreview(): Promise<void> {
        this.token = undefined;
        await this.disposeActiveSession();
        this.setState("idle");
    }

    /**
     * Publish the EXACT previewed state (§8.4 token gate + §6.7 final
     * drift check), then force a metadata refresh.
     */
    async publish(token: PublishPreviewToken): Promise<PublishOutcome> {
        if (
            this.state !== "awaitingConfirmation" ||
            this.token === undefined ||
            this.activeSessionId === undefined ||
            token.sessionId !== this.token.sessionId ||
            token.editRevision !== this.editRevision ||
            token.normalizedOperationsHash !== this.token.normalizedOperationsHash
        ) {
            return {
                ok: false,
                code: "previewInvalidated",
                message: "The preview is no longer valid — generate a new report.",
            };
        }

        // §6.7: force live metadata, recompute the fingerprint, compare.
        try {
            const fresh = await this.deps.baseline.refreshLive();
            const freshFingerprint = computeVisualizerFingerprint(fresh.model);
            if (!fresh.complete || freshFingerprint.hash !== token.catalogFingerprint) {
                await this.disposeActiveSession();
                this.token = undefined;
                this.setState("idle");
                return {
                    ok: false,
                    code: "previewInvalidated",
                    message: "The database schema changed after the report — preview again.",
                };
            }
        } catch (error) {
            await this.disposeActiveSession();
            this.token = undefined;
            this.setState("failed");
            return {
                ok: false,
                code: "previewInvalidated",
                message: `Pre-publish metadata check failed: ${error instanceof Error ? error.message : "unknown"}`,
            };
        }

        this.setState("publishing");
        try {
            await this.deps.legacy.publishSession({ sessionId: this.activeSessionId });
        } catch (error) {
            // §6.7: a last-instant external DDL can still race — dispose,
            // surface an actionable retry, keep the log intact.
            await this.disposeActiveSession();
            this.token = undefined;
            this.setState("failed");
            return {
                ok: false,
                code: "publishFailed",
                message: error instanceof Error ? error.message : "publishSession failed.",
            };
        }
        this.token = undefined;
        await this.disposeActiveSession();

        this.setState("refreshingAfterPublish");
        let refreshFailed = false;
        try {
            await this.deps.baseline.refreshLive();
        } catch {
            refreshFailed = true; // publish SUCCEEDED — report separately (§15)
        }
        this.setState("idle");
        return refreshFailed ? { ok: true, refreshFailed: true } : { ok: true };
    }

    /** Panel close / deactivation (§8.5). */
    async dispose(): Promise<void> {
        this.token = undefined;
        await this.disposeActiveSession();
        this.setState("idle");
    }
}
