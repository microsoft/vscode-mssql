/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useState } from "react";
import { locConstants } from "../../common/locConstants";
import {
    RbsOutputArtifactAction,
    RbsOutputArtifactRequest,
    RunbookPlanNode,
    RunbookRunSnapshot,
} from "../../../sharedInterfaces/runbookStudio";
import { useRbs } from "./state";
import { projectResultArtifacts, ResultArtifactCandidate } from "./resultArtifacts";

interface ArtifactAvailability {
    status: "checking" | "available" | "unavailable";
    fileName?: string;
    error?: string;
}

const EMPTY_PLAN_NODES: RunbookPlanNode[] = [];

function artifactTypeLabel(contract: string): string {
    const loc = locConstants.runbookStudio;
    switch (contract) {
        case "dacpacArtifact/1":
            return loc.dacpacArtifactType;
        case "schemaDiff/1":
        case "schemaCompareDocument/1":
            return loc.schemaComparisonArtifactType;
        case "xelArtifact/1":
            return loc.xelArtifactType;
        default:
            return contract;
    }
}

export function ResultArtifactsPanel({
    run,
    planNodes,
}: {
    run: RunbookRunSnapshot;
    planNodes?: RunbookPlanNode[];
}) {
    const { rpc } = useRbs();
    const loc = locConstants.runbookStudio;
    const projection = useMemo(
        () => projectResultArtifacts(run, planNodes ?? EMPTY_PLAN_NODES),
        [run, planNodes],
    );
    const [availability, setAvailability] = useState<Record<string, ArtifactAvailability>>({});
    const [active, setActive] = useState<{ handleId: string; action: RbsOutputArtifactAction }>();

    useEffect(() => {
        let cancelled = false;
        const initial = Object.fromEntries(
            projection.artifacts.map((artifact) => [
                artifact.handleId,
                {
                    status: artifact.expired ? "unavailable" : "checking",
                } satisfies ArtifactAvailability,
            ]),
        );
        setAvailability(initial);
        for (const artifact of projection.artifacts) {
            if (artifact.expired) {
                continue;
            }
            void rpc
                .sendRequest(RbsOutputArtifactRequest.type, { handleId: artifact.handleId })
                .then((result) => {
                    if (cancelled) {
                        return;
                    }
                    setAvailability((current) => ({
                        ...current,
                        [artifact.handleId]: result.available
                            ? {
                                  status: "available",
                                  fileName: result.fileName,
                              }
                            : { status: "unavailable" },
                    }));
                })
                .catch(() => {
                    if (!cancelled) {
                        setAvailability((current) => ({
                            ...current,
                            [artifact.handleId]: { status: "unavailable" },
                        }));
                    }
                });
        }
        return () => {
            cancelled = true;
        };
    }, [projection, rpc]);

    if (projection.artifacts.length === 0) {
        return null;
    }

    const perform = async (artifact: ResultArtifactCandidate, action: RbsOutputArtifactAction) => {
        setActive({ handleId: artifact.handleId, action });
        setAvailability((current) => ({
            ...current,
            [artifact.handleId]: {
                ...(current[artifact.handleId] ?? { status: "available" }),
                error: undefined,
            },
        }));
        try {
            const result = await rpc.sendRequest(RbsOutputArtifactRequest.type, {
                handleId: artifact.handleId,
                action,
            });
            if (result.error) {
                setAvailability((current) => ({
                    ...current,
                    [artifact.handleId]: {
                        ...(current[artifact.handleId] ?? { status: "unavailable" }),
                        error: result.error?.message,
                    },
                }));
            }
        } catch {
            setAvailability((current) => ({
                ...current,
                [artifact.handleId]: {
                    ...(current[artifact.handleId] ?? { status: "unavailable" }),
                    error: loc.dataExpiredDetail,
                },
            }));
        } finally {
            setActive(undefined);
        }
    };

    return (
        <section className="rbs-result-artifacts" aria-label={loc.runArtifacts}>
            <div className="rbs-result-artifacts-head">
                <div>
                    <strong>{loc.runArtifacts}</strong>
                    <div className="rbs-muted">{loc.runArtifactsDetail}</div>
                </div>
                <span className="rbs-chip">
                    {projection.artifacts.length + projection.omittedCount}
                </span>
            </div>
            <div className="rbs-result-artifact-list">
                {projection.artifacts.map((artifact) => {
                    const current: ArtifactAvailability = availability[artifact.handleId] ?? {
                        status: "checking",
                    };
                    const isBusy = active?.handleId === artifact.handleId;
                    return (
                        <div className="rbs-result-artifact" key={artifact.handleId}>
                            <div className="rbs-result-artifact-identity">
                                <strong>
                                    {current.fileName ?? artifactTypeLabel(artifact.contract)}
                                </strong>
                                <span className="rbs-muted">
                                    {loc.artifactProducedBy(artifact.nodeLabel)}
                                </span>
                                {artifact.truncated ? (
                                    <span className="rbs-chip rbs-chip-warn">
                                        {loc.artifactMetadataTruncated}
                                    </span>
                                ) : null}
                            </div>
                            {current.status === "checking" ? (
                                <span className="rbs-muted">{loc.loading}</span>
                            ) : current.status === "unavailable" ? (
                                <span className="rbs-muted">{loc.artifactUnavailable}</span>
                            ) : (
                                <span
                                    className="rbs-widget-artifact-actions"
                                    role="group"
                                    aria-label={
                                        current.fileName ?? artifactTypeLabel(artifact.contract)
                                    }>
                                    <button
                                        type="button"
                                        className="rbs-btn rbs-btn-quiet"
                                        disabled={isBusy}
                                        onClick={() => void perform(artifact, "open")}>
                                        {isBusy && active?.action === "open"
                                            ? loc.artifactActionInProgress
                                            : artifact.contract === "xelArtifact/1"
                                              ? loc.viewXelEvents
                                              : loc.openArtifact}
                                    </button>
                                    <button
                                        type="button"
                                        className="rbs-btn rbs-btn-quiet"
                                        disabled={isBusy}
                                        onClick={() => void perform(artifact, "reveal")}>
                                        {isBusy && active?.action === "reveal"
                                            ? loc.artifactActionInProgress
                                            : loc.revealArtifact}
                                    </button>
                                    <button
                                        type="button"
                                        className="rbs-btn rbs-btn-quiet"
                                        disabled={isBusy}
                                        onClick={() => void perform(artifact, "exportCopy")}>
                                        {isBusy && active?.action === "exportCopy"
                                            ? loc.artifactActionInProgress
                                            : loc.exportArtifactCopy}
                                    </button>
                                </span>
                            )}
                            {current.error ? (
                                <span className="rbs-error-text" role="alert">
                                    {current.error}
                                </span>
                            ) : null}
                        </div>
                    );
                })}
            </div>
            {projection.omittedCount > 0 ? (
                <div className="rbs-muted">
                    {loc.additionalArtifactsOmitted(projection.omittedCount)}
                </div>
            ) : null}
        </section>
    );
}
