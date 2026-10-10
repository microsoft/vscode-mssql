/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomBytes, randomUUID } from "crypto";
import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import { ILogger } from "../sharedInterfaces/logger";
import { logger } from "../models/logger";

const SESSION_STORAGE_KEY = "mssql.connectionSharing.authenticationSession";

interface StoredSession {
    id: string;
    accessToken: string;
}

/**
 * Lets other extensions request access to mssql connections through VS Code's authentication API.
 * VS Code identifies the requesting extension and asks the user for consent before handing it a
 * session, so holding the session's access token shows that the user approved the caller. All
 * approved extensions share one session; signing out of it revokes access for all of them.
 */
export class ConnectionSharingAuthenticationProvider
    implements vscode.AuthenticationProvider, vscode.Disposable
{
    private readonly _logger: ILogger;
    private readonly _onDidChangeSessions =
        new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
    public readonly onDidChangeSessions = this._onDidChangeSessions.event;
    private readonly _disposables: vscode.Disposable[] = [this._onDidChangeSessions];
    private _storedSession: Promise<StoredSession | undefined>;

    constructor(private readonly _secrets: vscode.SecretStorage) {
        this._logger = logger.withPrefix("ConnectionSharingAuthenticationProvider");
        this._storedSession = this.readStoredSession();
        this._disposables.push(
            // Other windows share the stored session, so pick up the sessions they create or remove.
            this._secrets.onDidChange((event) => {
                if (event.key === SESSION_STORAGE_KEY) {
                    void this.reloadStoredSession();
                }
            }),
            vscode.authentication.registerAuthenticationProvider(
                Constants.connectionSharingAuthenticationProviderId,
                LocalizedConstants.ConnectionSharing.authenticationProviderLabel,
                this,
                { supportsMultipleAccounts: false },
            ),
        );
    }

    public async getSessions(): Promise<vscode.AuthenticationSession[]> {
        const stored = await this._storedSession;
        return stored ? [toAuthenticationSession(stored)] : [];
    }

    public async createSession(): Promise<vscode.AuthenticationSession> {
        const previous = await this._storedSession;
        const stored: StoredSession = {
            id: randomUUID(),
            accessToken: randomBytes(32).toString("hex"),
        };

        // Update the cache before storing so the resulting secret change isn't treated as external.
        this._storedSession = Promise.resolve(stored);
        try {
            await this._secrets.store(SESSION_STORAGE_KEY, JSON.stringify(stored));
        } catch (error) {
            this._storedSession = Promise.resolve(previous);
            throw error;
        }

        const session = toAuthenticationSession(stored);
        this._onDidChangeSessions.fire({
            added: [session],
            removed: previous ? [toAuthenticationSession(previous)] : [],
            changed: [],
        });
        return session;
    }

    public async removeSession(sessionId: string): Promise<void> {
        const stored = await this._storedSession;
        if (stored?.id !== sessionId) {
            return;
        }

        this._storedSession = Promise.resolve(undefined);
        await this._secrets.delete(SESSION_STORAGE_KEY);
        this._onDidChangeSessions.fire({
            added: [],
            removed: [toAuthenticationSession(stored)],
            changed: [],
        });
    }

    /**
     * Returns the ID of the session that issued the access token, or undefined when the token
     * doesn't belong to the current session.
     */
    public async getSessionIdForAccessToken(accessToken: string): Promise<string | undefined> {
        const stored = await this._storedSession;
        return stored && accessToken === stored.accessToken ? stored.id : undefined;
    }

    public dispose(): void {
        this._disposables.forEach((disposable) => disposable.dispose());
    }

    private async reloadStoredSession(): Promise<void> {
        const previous = await this._storedSession;
        const nextRead = this.readStoredSession();
        this._storedSession = nextRead;
        const next = await nextRead;
        if (previous?.id === next?.id) {
            return;
        }

        this._onDidChangeSessions.fire({
            added: next ? [toAuthenticationSession(next)] : [],
            removed: previous ? [toAuthenticationSession(previous)] : [],
            changed: [],
        });
    }

    private async readStoredSession(): Promise<StoredSession | undefined> {
        try {
            const serialized = await this._secrets.get(SESSION_STORAGE_KEY);
            if (!serialized) {
                return undefined;
            }

            const stored = JSON.parse(serialized) as Partial<StoredSession>;
            if (typeof stored.id === "string" && typeof stored.accessToken === "string") {
                return { id: stored.id, accessToken: stored.accessToken };
            }
            this._logger.warn("Ignoring a malformed connection-sharing session.");
        } catch (error) {
            this._logger.error("Failed to read the connection-sharing session.", error);
        }
        return undefined;
    }
}

function toAuthenticationSession(stored: StoredSession): vscode.AuthenticationSession {
    return {
        id: stored.id,
        accessToken: stored.accessToken,
        account: {
            id: Constants.connectionSharingAuthenticationProviderId,
            label: LocalizedConstants.ConnectionSharing.authenticationAccountLabel,
        },
        scopes: [],
    };
}
