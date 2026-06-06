/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    RpcCaptureEvent,
    RpcCaptureExport,
    RpcInspectorApplyFilterRequest,
    RpcInspectorApplyFilterParams,
    RpcInspectorClearRequest,
    RpcInspectorExportParams,
    RpcInspectorExportRequest,
    RpcInspectorImportRequest,
    RpcInspectorSaveExportParams,
    RpcInspectorSaveExportRequest,
    RpcInspectorStartSessionParams,
    RpcInspectorStartSessionRequest,
    RpcInspectorStopSessionParams,
    RpcInspectorStopSessionRequest,
    RpcInspectorWebviewState,
} from "../sharedInterfaces/rpcInspector";
import {
    rpcCaptureService,
    RpcCaptureService,
} from "../languageservice/rpcCapture/rpcCaptureService";
import VscodeWrapper from "./vscodeWrapper";
import { WebviewPanelController } from "./webviewPanelController";

export class RpcInspectorWebviewController extends WebviewPanelController<
    RpcInspectorWebviewState,
    void,
    void
> {
    private _stateUpdateHandle: ReturnType<typeof setTimeout> | undefined;

    public constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private readonly _captureService: RpcCaptureService = rpcCaptureService,
    ) {
        super(context, vscodeWrapper, "rpcInspector", "rpcInspector", _captureService.getState(), {
            title: "MSSQL RPC Inspector",
            viewColumn: vscode.ViewColumn.Active,
        });

        this.registerDisposable(
            this._captureService.onDidChange(() => {
                this.scheduleStateUpdate();
            }),
        );
        this.registerDisposable({
            dispose: () => {
                if (this._stateUpdateHandle !== undefined) {
                    clearTimeout(this._stateUpdateHandle);
                    this._stateUpdateHandle = undefined;
                }
            },
        });

        this.initialize();
    }

    private initialize(): void {
        this.onRequest(
            RpcInspectorStartSessionRequest.type,
            async (params: RpcInspectorStartSessionParams) => {
                const state = this._captureService.startSession(params?.name);
                this.state = state;
                return state;
            },
        );

        this.onRequest(
            RpcInspectorStopSessionRequest.type,
            async (params: RpcInspectorStopSessionParams) => {
                const state = this._captureService.stopSession(params.sessionId);
                this.state = state;
                return state;
            },
        );

        this.onRequest(
            RpcInspectorApplyFilterRequest.type,
            async (params: RpcInspectorApplyFilterParams) => {
                const state = this._captureService.setFilter(params.filter);
                this.state = state;
                return state;
            },
        );

        this.onRequest(RpcInspectorClearRequest.type, async () => {
            const state = this._captureService.clear();
            this.state = state;
            return state;
        });

        this.onRequest(RpcInspectorExportRequest.type, async (params: RpcInspectorExportParams) => {
            const captureExport =
                params.source === "session" && params.sessionId
                    ? this._captureService.exportSession(params.sessionId)
                    : this._captureService.exportVisibleEvents();

            if (!captureExport) {
                return undefined;
            }

            return await this.saveExport(captureExport);
        });

        this.onRequest(RpcInspectorImportRequest.type, async () => {
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: {
                    JSON: ["json"],
                },
                openLabel: "Open RPC Capture",
            });

            const uri = uris?.[0];
            if (!uri) {
                return undefined;
            }

            try {
                const fileContent = await vscode.workspace.fs.readFile(uri);
                const parsed = JSON.parse(Buffer.from(fileContent).toString("utf8"));
                const imported = this.parseImportedExport(parsed);
                if (!imported) {
                    void vscode.window.showWarningMessage(
                        "The selected file is not a supported MSSQL RPC capture export.",
                    );
                    return undefined;
                }

                return imported;
            } catch (error) {
                void vscode.window.showErrorMessage(`Failed to import RPC capture: ${error}`);
                return undefined;
            }
        });

        this.onRequest(
            RpcInspectorSaveExportRequest.type,
            async (params: RpcInspectorSaveExportParams) => {
                return (await this.saveExport(params.captureExport)) !== undefined;
            },
        );
    }

    private scheduleStateUpdate(): void {
        if (this._stateUpdateHandle !== undefined) {
            return;
        }

        this._stateUpdateHandle = setTimeout(() => {
            this._stateUpdateHandle = undefined;
            if (!this.isDisposed) {
                this.state = this._captureService.getState();
            }
        }, 250);
    }

    private async saveExport(
        captureExport: RpcCaptureExport,
    ): Promise<RpcCaptureExport | undefined> {
        const defaultFileName = `mssql-rpc-${captureExport.source}-${new Date()
            .toISOString()
            .replace(/[:.]/g, "-")}.json`;
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(defaultFileName),
            filters: {
                JSON: ["json"],
            },
            saveLabel: "Export RPC Capture",
        });

        if (!uri) {
            return undefined;
        }

        await vscode.workspace.fs.writeFile(
            uri,
            Buffer.from(JSON.stringify(captureExport, undefined, 2), "utf8"),
        );
        void vscode.window.showInformationMessage(`RPC capture exported to ${uri.fsPath}`);
        return captureExport;
    }

    private parseImportedExport(value: unknown): RpcCaptureExport | undefined {
        if (!value || typeof value !== "object") {
            return undefined;
        }

        const candidate = value as RpcCaptureExport;
        if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.events)) {
            return undefined;
        }

        return {
            ...candidate,
            source: "import",
            events: this.normalizeImportedEvents(candidate.events),
        };
    }

    private normalizeImportedEvents(events: unknown[]): RpcCaptureEvent[] {
        const usedEventIds = new Set<string>();
        const importedEventIdMap = new Map<string, string>();

        const normalizedEvents = events.map((value, index) => {
            const event =
                value && typeof value === "object"
                    ? ({ ...(value as Partial<RpcCaptureEvent>) } as RpcCaptureEvent)
                    : ({} as RpcCaptureEvent);
            const originalEventId =
                typeof event.eventId === "string" && event.eventId.length > 0
                    ? event.eventId
                    : undefined;

            if (!originalEventId || usedEventIds.has(originalEventId)) {
                event.eventId = this.createImportedEventId(index, usedEventIds);
            } else {
                event.eventId = originalEventId;
            }

            usedEventIds.add(event.eventId);
            if (originalEventId && !importedEventIdMap.has(originalEventId)) {
                importedEventIdMap.set(originalEventId, event.eventId);
            }

            return event;
        });

        return normalizedEvents.map((event) => {
            if (event.relatedEventId) {
                event.relatedEventId =
                    importedEventIdMap.get(event.relatedEventId) ?? event.relatedEventId;
            }

            return event;
        });
    }

    private createImportedEventId(index: number, usedEventIds: Set<string>): string {
        const baseEventId = `import-event-${index + 1}`;
        let eventId = baseEventId;
        let suffix = 1;
        while (usedEventIds.has(eventId)) {
            eventId = `${baseEventId}-${suffix}`;
            suffix++;
        }

        return eventId;
    }
}
