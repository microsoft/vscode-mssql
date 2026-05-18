/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dab } from "../sharedInterfaces/dab";
import { SchemaDesigner } from "../sharedInterfaces/schemaDesigner";
import {
    NoopStateCommandDiagnosticsSink,
    StateCommandDiagnosticsSink,
    StateCommandSource,
} from "../platform/stateCommands/stateCommandDiagnostics";
import { applyDabCommands, getDabToolStateFromConfig } from "./dabCommandEngine";
import { DabSnapshot } from "./dabSessionRpc";

export interface DabSessionContext {
    schemaDesignerKey: string;
    sessionId?: string;
    config?: Dab.DabConfig;
    schemaTables: SchemaDesigner.Table[];
}

interface DabSession {
    id: string;
    schemaDesignerKey: string;
    config: Dab.DabConfig;
    version: string;
    schemaTables: SchemaDesigner.Table[];
    lastUpdatedAt: number;
}

export class DabSessionService {
    private readonly sessionsByKey = new Map<string, DabSession>();

    constructor(
        private readonly diagnostics: StateCommandDiagnosticsSink = NoopStateCommandDiagnosticsSink,
    ) {}

    public async getOrCreateSession(context: DabSessionContext): Promise<DabSnapshot> {
        const existing = this.sessionsByKey.get(context.schemaDesignerKey);
        if (existing) {
            const schemaChanged = existing.schemaTables !== context.schemaTables;
            if (schemaChanged) {
                existing.schemaTables = context.schemaTables;
            }
            if (context.config) {
                existing.config = context.config;
            }
            return this.refreshSession(existing);
        }

        const state = await getDabToolStateFromConfig(
            context.config ?? null,
            context.schemaTables,
            this.diagnostics,
            context.sessionId || context.schemaDesignerKey,
            "host",
        );
        const session: DabSession = {
            id: context.sessionId || context.schemaDesignerKey,
            schemaDesignerKey: context.schemaDesignerKey,
            config: state.config,
            version: state.response.version,
            schemaTables: context.schemaTables,
            lastUpdatedAt: Date.now(),
        };
        this.sessionsByKey.set(context.schemaDesignerKey, session);
        return this.toSnapshot(session, state.response);
    }

    public async getState(
        schemaDesignerKey: string,
        source: StateCommandSource = "unknown",
    ): Promise<Dab.GetDabToolStateResponse> {
        const session = this.getExistingSession(schemaDesignerKey);
        const state = await getDabToolStateFromConfig(
            session.config,
            session.schemaTables,
            this.diagnostics,
            session.id,
            source,
        );
        session.config = state.config;
        session.version = state.response.version;
        session.lastUpdatedAt = Date.now();
        return state.response;
    }

    public async applyCommands(
        schemaDesignerKey: string,
        params: Dab.ApplyDabToolChangesParams,
        source: StateCommandSource = params.options?.source ?? "unknown",
    ): Promise<Dab.ApplyDabToolChangesResponse> {
        const session = this.getExistingSession(schemaDesignerKey);
        const result = await applyDabCommands({
            baseConfig: session.config,
            schemaTables: session.schemaTables,
            expectedVersion: params.expectedVersion,
            commands: params.changes,
            returnState: params.options?.returnState,
            sessionId: session.id,
            source,
            diagnostics: this.diagnostics,
        });

        if (result.shouldCommit) {
            session.config = result.config;
            session.version = result.response.version;
            session.lastUpdatedAt = Date.now();
        }

        return result.response;
    }

    public async updateSchema(
        schemaDesignerKey: string,
        schemaTables: SchemaDesigner.Table[],
        source: StateCommandSource = "ux",
    ): Promise<DabSnapshot> {
        const session = this.getExistingSession(schemaDesignerKey);
        session.schemaTables = schemaTables;
        return this.refreshSession(session, source);
    }

    public getConfig(schemaDesignerKey: string): Dab.DabConfig | undefined {
        return this.sessionsByKey.get(schemaDesignerKey)?.config;
    }

    public setConfig(schemaDesignerKey: string, config: Dab.DabConfig): void {
        const session = this.sessionsByKey.get(schemaDesignerKey);
        if (!session) {
            return;
        }
        session.config = config;
        session.lastUpdatedAt = Date.now();
    }

    private async refreshSession(
        session: DabSession,
        source: StateCommandSource = "unknown",
    ): Promise<DabSnapshot> {
        const state = await getDabToolStateFromConfig(
            session.config,
            session.schemaTables,
            this.diagnostics,
            session.id,
            source,
        );
        session.config = state.config;
        session.version = state.response.version;
        session.lastUpdatedAt = Date.now();
        return this.toSnapshot(session, state.response);
    }

    private getExistingSession(schemaDesignerKey: string): DabSession {
        const session = this.sessionsByKey.get(schemaDesignerKey);
        if (!session) {
            throw new Error("DAB session has not been initialized.");
        }
        return session;
    }

    private toSnapshot(session: DabSession, response: Dab.GetDabToolStateResponse): DabSnapshot {
        return {
            sessionId: session.id,
            version: response.version,
            summary: response.summary,
            config: response.config,
            stateOmittedReason: response.stateOmittedReason,
        };
    }
}
