/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Central-store upload card (central design §8.3): the preview is the exact
 * policy-filtered projection dry-run; upload streams the same item stream and
 * is idempotent (duplicates land as alreadyPresent, canceled uploads resume).
 * Nothing uploads without the preview having been rendered.
 */

import { useEffect, useState } from "react";
import {
    CentralPreviewInfo,
    CentralTargetInfo,
    DcCentralPreviewRequest,
    DcCentralUploadProgressNotification,
    DcCentralUploadRequest,
} from "../../../sharedInterfaces/debugConsole";
import { useDc } from "./state";

export function CentralUploadCard() {
    const { rpc, activeSourceId } = useDc();
    const [target, setTarget] = useState<CentralTargetInfo | undefined>(undefined);
    const [preview, setPreview] = useState<CentralPreviewInfo | undefined>(undefined);
    const [message, setMessage] = useState<string | undefined>(undefined);
    const [progress, setProgress] = useState<string | undefined>(undefined);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        setPreview(undefined);
        setMessage(undefined);
        setProgress(undefined);
    }, [activeSourceId]);

    useEffect(() => {
        rpc.onNotification(DcCentralUploadProgressNotification.type, (p) => {
            if (p.sourceId === activeSourceId) {
                setProgress(`uploading item ${p.done}/${p.total}…`);
            }
        });
    }, [rpc, activeSourceId]);

    const doPreview = () => {
        setBusy(true);
        setMessage(undefined);
        void rpc
            .sendRequest(DcCentralPreviewRequest.type, { sourceId: activeSourceId })
            .then((result) => {
                setTarget(result.target);
                setPreview(result.preview);
                if (result.error) {
                    setMessage(result.error);
                }
            })
            .finally(() => setBusy(false));
    };

    const doUpload = () => {
        setBusy(true);
        setMessage(undefined);
        setProgress(undefined);
        void rpc
            .sendRequest(DcCentralUploadRequest.type, { sourceId: activeSourceId })
            .then((result) => {
                setProgress(undefined);
                if (result.receipt) {
                    setMessage(
                        `${result.receipt.outcome}: batch ${result.receipt.uploadBatchId}, ` +
                            `${result.receipt.totalRows} rows, policy ${result.receipt.policyId}, ` +
                            `projection ${result.receipt.projectionDigest}`,
                    );
                } else if (result.error) {
                    setMessage(`${result.outcome}: ${result.error}`);
                } else {
                    setMessage(
                        result.reasonCode
                            ? `${result.outcome}: ${result.reasonCode}`
                            : result.outcome,
                    );
                }
            })
            .finally(() => setBusy(false));
    };

    return (
        <div className="dc-card">
            <div className="dc-card-title">Upload to shared server</div>
            <p className="dc-muted" style={{ marginTop: 0 }}>
                Uploads the selected STORED session to the team central store over the
                extension&apos;s own SQL connection. The preview below is the exact projection that
                would leave this machine — policy-filtered, idempotent, auditable.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
                <button className="dc-btn" disabled={busy} onClick={doPreview}>
                    Preview upload
                </button>
                <button
                    className="dc-btn primary"
                    disabled={busy || !preview || preview.refused.length > 0}
                    onClick={doUpload}>
                    ⇧ Upload previewed projection
                </button>
            </div>
            {target ? (
                <div className="dc-mono dc-muted" style={{ marginTop: 8 }}>
                    target:{" "}
                    {target.configured
                        ? `${target.profileLabel ?? "?"} / ${target.database ?? "?"} · policy ${target.policyId}`
                        : (target.error ?? "not configured")}
                </div>
            ) : null}
            {preview ? (
                <div style={{ marginTop: 8 }}>
                    <table className="dc-table">
                        <thead>
                            <tr>
                                <th>table</th>
                                <th>rows</th>
                                <th>~bytes</th>
                            </tr>
                        </thead>
                        <tbody>
                            {preview.tables.map((row) => (
                                <tr key={row.name}>
                                    <td className="dc-mono">{row.name}</td>
                                    <td>{row.rows}</td>
                                    <td>{row.bytesEstimate}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="dc-mono dc-muted" style={{ marginTop: 6 }}>
                        digested:{" "}
                        {preview.digested.map((d) => `${d.field}(${d.count})`).join(", ") || "—"}
                    </div>
                    <div className="dc-mono dc-muted">
                        dropped:{" "}
                        {preview.dropped.map((d) => `${d.field}(${d.count})`).join(", ") || "—"}
                    </div>
                    {preview.refused.map((r) => (
                        <div
                            key={r.field}
                            className="dc-mono"
                            style={{ color: "var(--vscode-errorForeground)" }}>
                            REFUSED: {r.field} [{r.cls}] {r.reason}
                        </div>
                    ))}
                    {preview.warnings.map((w) => (
                        <div key={w} className="dc-mono dc-muted">
                            warning: {w}
                        </div>
                    ))}
                </div>
            ) : null}
            {progress ? (
                <div className="dc-mono dc-muted" style={{ marginTop: 6 }}>
                    {progress}
                </div>
            ) : null}
            {message ? (
                <div className="dc-mono" style={{ marginTop: 6 }}>
                    {message}
                </div>
            ) : null}
        </div>
    );
}
