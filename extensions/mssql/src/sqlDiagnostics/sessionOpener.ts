/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Opens a SQL data-plane session for the diagnostics and profiler panels.
 *
 * Both panels need the same thing: a session on a server the user has already connected to,
 * chosen without making them retype a connection. Candidates are the connections open in the
 * editor first, then saved profiles, so the common case is a single obvious choice.
 *
 * Secrets never pass through here. `prepareConnection` builds providers that resolve the
 * password or token at open time and keeps them inside closures.
 */

import * as vscode from "vscode";

import { ISqlConnectionService, ISqlSession } from "../services/sqlDataPlane/api";
import {
    ProfileSecretSource,
    ProfileTokenSource,
    StoredConnectionProfile,
    prepareConnection,
    resolveAuthKind,
    stableProfileId,
} from "../services/metadata/profileAuthAdapter";
import { SqlDataPlaneService } from "../services/sqlDataPlane/sqlDataPlaneService";
import { acquireSqlAccessTokenFromVscodeAccount } from "../connectionconfig/azureHelpers";
import { SqlFeatures } from "../constants/locConstants";

/** Reported to the panels, which key their state by server. */
export interface OpenedDiagnosticsSession {
    readonly session: ISqlSession;
    /** Reuses the selected connection's authentication without sending it through the webview. */
    readonly openDatabase: (database: string) => Promise<OpenedDiagnosticsSession | undefined>;
    /** Saved/runtime connection identity, independent of its display label. */
    readonly connectionKey: string;
    /** Human label for the panel title. */
    readonly label: string;
    /** Server-scoped identity, used to scope profiler session claims. */
    readonly serverKey: string;
}

/** Application name so these sessions are identifiable in DMV output. */
const APPLICATION_NAME = "vscode-mssql (diagnostics)";

/** Resolves an Entra token through the VS Code account, matching the rest of the extension. */
const vscodeTokenSource: ProfileTokenSource = {
    async acquireSqlAccessToken(profile: StoredConnectionProfile): Promise<string | undefined> {
        const info = await acquireSqlAccessTokenFromVscodeAccount(
            profile.accountId,
            profile.tenantId,
        );
        return info.token.token;
    },
};

export class DiagnosticsSessionOpener {
    constructor(
        private readonly _secrets: ProfileSecretSource,
        /** Profiles for connections currently open in the editor. */
        private readonly _activeProfiles: () => StoredConnectionProfile[],
    ) {}

    /**
     * Picks a connection and opens a session on it. Returns undefined when the user cancels or
     * there is nothing to connect to; callers report that, since it is not a failure.
     */
    async open(
        profile?: StoredConnectionProfile,
        /** Overrides the profile's default database, for a panel opened on a specific one. */
        database?: string,
    ): Promise<OpenedDiagnosticsSession | undefined> {
        const chosen = profile ?? (await this.pick());
        if (!chosen) {
            return undefined;
        }

        const prepared = prepareConnection(chosen, this._secrets, vscodeTokenSource);
        const service: ISqlConnectionService = await SqlDataPlaneService.get().serviceForProfile(
            prepared.profileRef.profileFingerprint,
        );

        const targetDatabase = database ?? prepared.defaultDatabase;
        const session = await service.openSession({
            profile: prepared.profileRef,
            applicationName: APPLICATION_NAME,
            auth: prepared.auth,
            ...(targetDatabase ? { database: targetDatabase } : {}),
        });

        return {
            session,
            openDatabase: (database) => this.open(chosen, database),
            connectionKey: stableProfileId(chosen),
            label: describeProfile(chosen),
            serverKey: prepared.serverFingerprint,
        };
    }

    /** Offers open connections first, then saved profiles, deduplicated. */
    private async pick(): Promise<StoredConnectionProfile | undefined> {
        const candidates = this.candidates();
        if (candidates.length === 0) {
            const action = await vscode.window.showInformationMessage(
                SqlFeatures.connectFirst,
                SqlFeatures.connect,
            );
            if (action === SqlFeatures.connect) {
                await vscode.commands.executeCommand("mssql.connect");
                const connected = this.candidates();
                if (connected.length === 1) return connected[0].profile;
                if (connected.length > 1) return this.pick();
            }
            return undefined;
        }
        if (candidates.length === 1) {
            return candidates[0].profile;
        }

        const picked = await vscode.window.showQuickPick(candidates, {
            title: SqlFeatures.selectConnection,
            placeHolder: SqlFeatures.selectConnectionPlaceholder,
            matchOnDescription: true,
        });
        return picked?.profile;
    }

    private candidates(): (vscode.QuickPickItem & { profile: StoredConnectionProfile })[] {
        const saved =
            vscode.workspace
                .getConfiguration("mssql")
                .get<StoredConnectionProfile[]>("connections") ?? [];

        const items: (vscode.QuickPickItem & { profile: StoredConnectionProfile })[] = [];
        const seen = new Set<string>();

        const push = (profile: StoredConnectionProfile, description: string) => {
            // Offering a profile the data plane cannot open would fail only after the user
            // picked it, so unsupported authentication is filtered out here instead.
            if (!profile?.server || !supportsDataPlane(profile)) {
                return;
            }
            const id = stableProfileId(profile);
            if (seen.has(id)) {
                return;
            }
            seen.add(id);
            items.push({ label: describeProfile(profile), description, profile });
        };

        for (const profile of this._activeProfiles()) {
            push(profile, SqlFeatures.connected);
        }
        for (const profile of saved) {
            push(profile, SqlFeatures.savedConnection);
        }
        return items;
    }
}

/** True when the data plane can open this profile's authentication type. */
function supportsDataPlane(profile: StoredConnectionProfile): boolean {
    try {
        resolveAuthKind(profile);
        return true;
    } catch {
        return false;
    }
}

/** Label a profile the way the connection list does: name if it has one, else server/database. */
export function describeProfile(profile: StoredConnectionProfile): string {
    if (profile.profileName?.trim()) {
        return profile.profileName.trim();
    }
    const server = profile.server ?? "";
    return profile.database?.trim() ? `${server}, ${profile.database.trim()}` : server;
}
