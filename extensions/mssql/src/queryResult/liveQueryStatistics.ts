/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import {
    EndLiveExecutionPlanRequest,
    GetLiveExecutionPlanRequest,
} from "../models/contracts/executionPlan";
import { getLogger } from "../models/logger";
import { ExecutionPlanGraph } from "../sharedInterfaces/executionPlan";
import { getErrorMessage } from "../utils/utils";
import { addLiveExecutionPlanStatistics } from "./liveExecutionPlanStatistics";

const logger = getLogger("LiveQueryStatistics");

/** How often the in-flight plan is read while a query runs. */
export const liveQueryStatisticsPollIntervalMs = 1000;

export interface LiveQueryStatisticsCallbacks {
    /** Called with the parsed plans each time a read returns one. */
    onPlans: (graphs: ExecutionPlanGraph[]) => void;
    /** Called once when a read fails. Monitoring has stopped by then. */
    onError: (message: string) => void;
}

/**
 * Polls the in-flight plan of one running query until disposed. SQL Tools Service reads it on a
 * monitoring connection that stays open between reads, and disposing closes that connection.
 */
export class LiveQueryStatisticsMonitor implements vscode.Disposable {
    // STS owns one monitoring connection per client/editor, so a new generation must wait for
    // the previous generation's read and close before it can open that connection again.
    private static readonly _closingConnections = new WeakMap<
        SqlToolsServiceClient,
        Map<string, Promise<void>>
    >();
    private _closed: Promise<void> | undefined;
    private _startBarrier: Promise<void> | undefined;
    private _timer: ReturnType<typeof setTimeout> | undefined;
    private _pendingRead: Promise<void> | undefined;
    private _isDisposed = false;
    private readonly _progressByStatement = new Map<
        string,
        { progress: number; elapsedTimeInMs?: number }
    >();

    constructor(
        private readonly _ownerUri: string,
        private readonly _sessionId: number,
        private readonly _callbacks: LiveQueryStatisticsCallbacks,
        private readonly _client: SqlToolsServiceClient = SqlToolsServiceClient.instance,
        private readonly _pollIntervalMs: number = liveQueryStatisticsPollIntervalMs,
    ) {}

    public start(after?: Promise<void>): void {
        this._startBarrier = after;
        this.read();
    }

    /** Settles after disposal has finished closing this generation's monitoring connection. */
    public get closed(): Promise<void> {
        return this._closed ?? Promise.resolve();
    }

    private get closingConnections(): Map<string, Promise<void>> {
        let connections = LiveQueryStatisticsMonitor._closingConnections.get(this._client);
        if (!connections) {
            connections = new Map();
            LiveQueryStatisticsMonitor._closingConnections.set(this._client, connections);
        }
        return connections;
    }

    public dispose(): void {
        if (this._isDisposed) {
            return;
        }
        this._isDisposed = true;
        clearTimeout(this._timer);
        this._timer = undefined;

        const connections = this.closingConnections;
        const previousClose = connections.get(this._ownerUri);
        this._closed = this.closeConnection(previousClose).finally(() => {
            if (connections.get(this._ownerUri) === this._closed) {
                connections.delete(this._ownerUri);
            }
        });
        connections.set(this._ownerUri, this._closed);
    }

    /**
     * Closes the monitoring connection after any read in flight, so that read can't reopen it.
     */
    private async closeConnection(previousClose?: Promise<void>): Promise<void> {
        await Promise.all([previousClose, this._pendingRead]);
        try {
            await this._client.sendRequest(EndLiveExecutionPlanRequest.type, {
                ownerUri: this._ownerUri,
            });
        } catch (error) {
            logger.warn(
                `Failed to close the live query statistics connection: ${getErrorMessage(error)}`,
            );
        }
    }

    private read(): void {
        const previousClose = this.closingConnections.get(this._ownerUri);
        this._pendingRead = Promise.all([this._startBarrier, previousClose])
            .then(() => {
                if (!this._isDisposed) {
                    return this.readPlan();
                }
            })
            .finally(() => {
                this._pendingRead = undefined;
                if (!this._isDisposed) {
                    this._timer = setTimeout(() => this.read(), this._pollIntervalMs);
                }
            });
    }

    private async readPlan(): Promise<void> {
        try {
            const result = await this._client.sendRequest(GetLiveExecutionPlanRequest.type, {
                ownerUri: this._ownerUri,
                sessionId: this._sessionId,
            });
            if (!this._isDisposed && result?.graphs?.length > 0) {
                this._callbacks.onPlans(
                    result.graphs.map((graph, index) => {
                        const annotated = addLiveExecutionPlanStatistics(graph);
                        const statistics = annotated.liveQueryStatistics;
                        if (statistics?.estimatedProgress === undefined) {
                            return annotated;
                        }
                        const key = `${graph.graphFile?.planIndexInFile ?? index}:${graph.query}`;
                        const previous = this._progressByStatement.get(key);
                        // Refining a cardinality estimate can lower the current sample. Keep the
                        // displayed estimate monotonic, but reset when a statement starts again.
                        const restarted =
                            previous?.elapsedTimeInMs !== undefined &&
                            statistics.elapsedTimeInMs !== undefined &&
                            statistics.elapsedTimeInMs < previous.elapsedTimeInMs;
                        statistics.estimatedProgress = Math.max(
                            statistics.estimatedProgress,
                            restarted ? 0 : (previous?.progress ?? 0),
                        );
                        this._progressByStatement.set(key, {
                            progress: statistics.estimatedProgress,
                            elapsedTimeInMs: statistics.elapsedTimeInMs,
                        });
                        return annotated;
                    }),
                );
            }
        } catch (error) {
            if (!this._isDisposed) {
                logger.warn(`Live query statistics stopped: ${getErrorMessage(error)}`);
                this.dispose();
                this._callbacks.onError(getErrorMessage(error));
            }
        }
    }
}
