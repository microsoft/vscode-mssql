/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SQL Data Plane composition root: one service instance per extension host,
 * backend selected by `mssql.sqlDataPlane.backend` (the ONLY data-plane
 * switches are sqlDataPlane.* — addendum §2.2). The STS2 binding shares the
 * legacy service's stdio through the StdioMultiplexer v2 lane: the transport
 * wraps SqlToolsServiceClient sendRequest/onNotification with `v2/*` methods
 * (which also gives every wire call the standard rpc.* diagnostic span).
 */

import * as vscode from "vscode";
import { RequestType, NotificationType } from "vscode-languageclient";
import SqlToolsServiceClient from "../../languageservice/serviceclient";
import { DataPlaneAvailability, ISqlConnectionService } from "./api";
import { FakeBackend } from "./fakeBackend";
import { Sts2Backend, Sts2Rpc, DEFAULT_DEADLINES, Sts2Deadlines } from "../sts2/sts2Backend";

function deadlinesFromConfig(): Sts2Deadlines {
    const config = vscode.workspace.getConfiguration();
    return {
        openMs: config.get<number>("mssql.sqlDataPlane.timeouts.openMs", DEFAULT_DEADLINES.openMs),
        cancelAckMs: config.get<number>(
            "mssql.sqlDataPlane.timeouts.cancelAckMs",
            DEFAULT_DEADLINES.cancelAckMs,
        ),
        closeMs: config.get<number>(
            "mssql.sqlDataPlane.timeouts.closeMs",
            DEFAULT_DEADLINES.closeMs,
        ),
        disposeDrainMs: config.get<number>(
            "mssql.sqlDataPlane.timeouts.disposeDrainMs",
            DEFAULT_DEADLINES.disposeDrainMs,
        ),
        completeAfterCancelMs: DEFAULT_DEADLINES.completeAfterCancelMs,
    };
}

/** Transport over the shared STS stdio (multiplexer v2 lane). */
class ServiceClientRpc implements Sts2Rpc {
    private client = SqlToolsServiceClient.instance;

    sendRequest<R>(method: string, params: unknown): Promise<R> {
        const type = new RequestType<unknown, R, void>(method);
        return Promise.resolve(this.client.sendRequest(type, params));
    }

    sendNotification(method: string, params: unknown): void {
        const type = new NotificationType<unknown>(method);
        void this.client.sendNotification(type, params);
    }

    onNotification(method: string, handler: (params: unknown) => void): { dispose(): void } {
        const type = new NotificationType<unknown>(method);
        this.client.onNotification(type, handler);
        // The language client keeps handlers for its lifetime; per-handler
        // disposal is not exposed — the backend subscribes once.
        return { dispose: () => undefined };
    }
}

let instance: SqlDataPlaneService | undefined;

export class SqlDataPlaneService {
    private backend: ISqlConnectionService | undefined;
    private sts2: Sts2Backend | undefined;

    static get(): SqlDataPlaneService {
        instance ??= new SqlDataPlaneService();
        return instance;
    }

    get enabled(): boolean {
        return vscode.workspace
            .getConfiguration()
            .get<boolean>("mssql.sqlDataPlane.enabled", false);
    }

    /** Resolve (and lazily start) the configured backend. */
    async service(): Promise<ISqlConnectionService> {
        if (this.backend) {
            return this.backend;
        }
        const kind = vscode.workspace
            .getConfiguration()
            .get<string>("mssql.sqlDataPlane.backend", "sts2-jsonrpc");
        if (kind === "fake") {
            this.backend = new FakeBackend({});
            return this.backend;
        }
        this.sts2 = new Sts2Backend(new ServiceClientRpc(), deadlinesFromConfig());
        await this.sts2.start();
        this.backend = this.sts2;
        return this.backend;
    }

    availability(): DataPlaneAvailability {
        return this.backend?.availability ?? { state: "unknown" };
    }

    /** Safe status dump for the command palette. */
    statusSummary(): Record<string, unknown> {
        return {
            enabled: this.enabled,
            backend:
                vscode.workspace
                    .getConfiguration()
                    .get<string>("mssql.sqlDataPlane.backend", "sts2-jsonrpc") ?? "sts2-jsonrpc",
            availability: this.availability(),
            ...(this.sts2 ? this.sts2.status() : {}),
        };
    }
}

export function registerSqlDataPlane(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand("mssql.sqlDataPlane.showStatus", async () => {
            const service = SqlDataPlaneService.get();
            if (service.enabled) {
                // Surface live availability (starts the backend if needed).
                await service.service().catch(() => undefined);
            }
            const summary = JSON.stringify(service.statusSummary(), undefined, 2);
            const doc = await vscode.workspace.openTextDocument({
                language: "json",
                content: summary,
            });
            await vscode.window.showTextDocument(doc, { preview: true });
        }),
    );
}
