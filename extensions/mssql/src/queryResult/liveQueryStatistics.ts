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
    private _timer: ReturnType<typeof setTimeout> | undefined;
    private _pendingRead: Promise<void> | undefined;
    private _isDisposed = false;

    constructor(
        private readonly _ownerUri: string,
        private readonly _sessionId: number,
        private readonly _callbacks: LiveQueryStatisticsCallbacks,
        private readonly _client: SqlToolsServiceClient = SqlToolsServiceClient.instance,
        private readonly _pollIntervalMs: number = liveQueryStatisticsPollIntervalMs,
    ) {}

    public start(): void {
        this.read();
    }

    public dispose(): void {
        if (this._isDisposed) {
            return;
        }
        this._isDisposed = true;
        clearTimeout(this._timer);
        this._timer = undefined;

        void this.closeConnection();
    }

    /**
     * Closes the monitoring connection after any read in flight, so that read can't reopen it.
     */
    private async closeConnection(): Promise<void> {
        await this._pendingRead;
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
        this._pendingRead = this.readPlan().finally(() => {
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
                this._callbacks.onPlans(result.graphs.map(addLiveExecutionPlanStatistics));
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
