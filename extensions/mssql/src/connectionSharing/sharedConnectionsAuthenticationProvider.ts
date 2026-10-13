/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomBytes, randomUUID } from "crypto";
import * as vscode from "vscode";
import { Disposable } from "extension-toolkit/base";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import { ILogger } from "../sharedInterfaces/logger";
import { logger } from "../models/logger";
import { sendActionEvent } from "extension-toolkit/vscode";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";

const SESSION_STORAGE_KEY = "mssql.sharedConnections.session";

/** How long an access token stays valid after it's issued. */
export const ACCESS_TOKEN_LIFETIME_MS = 60 * 60 * 1000;

interface StoredSession {
    id: string;
    /** When the session was created, in milliseconds since the epoch. */
    createdAt?: number;
}

interface IssuedAccessToken {
    sessionId: string;
    expiresAt: number;
}

/** Why an access token was rejected, reported in telemetry. */
export type AccessTokenRejection = "unknown" | "expired" | "sessionEnded";

/** The session an access token belongs to, or why it was rejected. */
export type AccessTokenCheck = { sessionId: string } | { rejection: AccessTokenRejection };

/**
 * Lets other extensions request access to mssql connections through VS Code's authentication API.
 * VS Code identifies the requesting extension and asks the user for consent before handing it a
 * session, so holding one of the session's access tokens shows that the user approved the caller.
 * All approved extensions share one session; signing out of it revokes access for all of them.
 *
 * VS Code asks this provider for the session each time an extension requests it, and checks that
 * the extension is still approved before passing it on. Each request therefore gets a new access
 * token that expires after {@link ACCESS_TOKEN_LIFETIME_MS}, so an extension the user stops
 * trusting loses access once its last token expires. The tokens are kept only in this window's
 * memory; secret storage holds just the session ID, which all windows share.
 */
export class SharedConnectionsAuthenticationProvider
    extends Disposable
    implements vscode.AuthenticationProvider
{
    private readonly _logger: ILogger;
    private readonly _onDidChangeSessions = this._register(
        new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>(),
    );
    public readonly onDidChangeSessions = this._onDidChangeSessions.event;
    private readonly _accessTokens = new Map<string, IssuedAccessToken>();
    private _storedSession: Promise<StoredSession | undefined>;

    constructor(private readonly _secrets: vscode.SecretStorage) {
        super();
        this._logger = logger.withPrefix("SharedConnectionsAuthenticationProvider");
        this._storedSession = this.readStoredSession();
        // Other windows share the stored session, so pick up the sessions they create or remove.
        this._register(
            this._secrets.onDidChange((event) => {
                if (event.key === SESSION_STORAGE_KEY) {
                    void this.reloadStoredSession();
                }
            }),
        );
        this._register(
            vscode.authentication.registerAuthenticationProvider(
                Constants.sharedConnectionsAuthenticationProviderId,
                LocalizedConstants.ConnectionSharing.authenticationProviderLabel,
                this,
                { supportsMultipleAccounts: false },
            ),
        );
    }

    public async getSessions(): Promise<vscode.AuthenticationSession[]> {
        const stored = await this._storedSession;
        return stored ? [this.issueSession(stored)] : [];
    }

    public async createSession(): Promise<vscode.AuthenticationSession> {
        const previous = await this._storedSession;
        const stored: StoredSession = { id: randomUUID(), createdAt: Date.now() };

        // Update the cache before storing so the resulting secret change isn't treated as external.
        this._storedSession = Promise.resolve(stored);
        try {
            await this._secrets.store(SESSION_STORAGE_KEY, JSON.stringify(stored));
        } catch (error) {
            this._storedSession = Promise.resolve(previous);
            sendSessionTelemetry("created", "failed");
            throw error;
        }

        sendSessionTelemetry("created", "succeeded", {
            replacedSession: String(previous !== undefined),
        });
        if (previous) {
            this.revokeAccessTokens(previous.id);
        }
        this._onDidChangeSessions.fire({
            added: [toAuthenticationSession(stored)],
            removed: previous ? [toAuthenticationSession(previous)] : [],
            changed: [],
        });
        return this.issueSession(stored);
    }

    public async removeSession(sessionId: string): Promise<void> {
        const stored = await this._storedSession;
        if (stored?.id !== sessionId) {
            return;
        }

        // Update the cache before deleting so the resulting secret change isn't treated as external,
        // and restore it if the delete fails so the session and its tokens stay usable.
        this._storedSession = Promise.resolve(undefined);
        try {
            await this._secrets.delete(SESSION_STORAGE_KEY);
        } catch (error) {
            this._storedSession = Promise.resolve(stored);
            sendSessionTelemetry("removed", "failed");
            throw error;
        }

        sendSessionTelemetry(
            "removed",
            "succeeded",
            {},
            stored.createdAt !== undefined ? { sessionAgeMs: Date.now() - stored.createdAt } : {},
        );
        this.revokeAccessTokens(stored.id);
        this._onDidChangeSessions.fire({
            added: [],
            removed: [toAuthenticationSession(stored)],
            changed: [],
        });
    }

    /**
     * Returns the session that issued the access token, or why the token was rejected: it was never
     * issued here or was revoked (`unknown`), it `expired`, or its session has since ended.
     */
    public async checkAccessToken(accessToken: string): Promise<AccessTokenCheck> {
        const issued = this._accessTokens.get(accessToken);
        if (!issued) {
            return { rejection: "unknown" };
        }
        if (Date.now() >= issued.expiresAt) {
            this._accessTokens.delete(accessToken);
            return { rejection: "expired" };
        }
        return (await this.isSessionActive(issued.sessionId))
            ? { sessionId: issued.sessionId }
            : { rejection: "sessionEnded" };
    }

    /** Returns whether the session is still the current one, regardless of token expiry. */
    public async isSessionActive(sessionId: string): Promise<boolean> {
        return (await this._storedSession)?.id === sessionId;
    }

    public override dispose(): void {
        this._accessTokens.clear();
        super.dispose();
    }

    private issueSession(stored: StoredSession): vscode.AuthenticationSession {
        // Every request issues a token, including those VS Code makes for its own UI, so drop the
        // expired ones here rather than letting them accumulate.
        const now = Date.now();
        for (const [token, issued] of this._accessTokens) {
            if (now >= issued.expiresAt) {
                this._accessTokens.delete(token);
            }
        }

        const accessToken = randomBytes(32).toString("hex");
        this._accessTokens.set(accessToken, {
            sessionId: stored.id,
            expiresAt: now + ACCESS_TOKEN_LIFETIME_MS,
        });
        return toAuthenticationSession(stored, accessToken);
    }

    private revokeAccessTokens(sessionId: string): void {
        for (const [token, issued] of this._accessTokens) {
            if (issued.sessionId === sessionId) {
                this._accessTokens.delete(token);
            }
        }
    }

    private async reloadStoredSession(): Promise<void> {
        const previous = await this._storedSession;
        // Keep the current session if storage can't be read: failing to read it doesn't mean
        // another window signed out, and treating it so would revoke tokens and close connections.
        const nextRead = this.loadStoredSession().catch((error) => {
            this._logger.error("Failed to reload the connection-sharing session.", error);
            return previous;
        });
        this._storedSession = nextRead;
        const next = await nextRead;
        if (previous?.id === next?.id) {
            return;
        }

        if (previous) {
            this.revokeAccessTokens(previous.id);
        }
        this._onDidChangeSessions.fire({
            added: next ? [toAuthenticationSession(next)] : [],
            removed: previous ? [toAuthenticationSession(previous)] : [],
            changed: [],
        });
    }

    private async readStoredSession(): Promise<StoredSession | undefined> {
        try {
            return await this.loadStoredSession();
        } catch (error) {
            this._logger.error("Failed to read the connection-sharing session.", error);
            return undefined;
        }
    }

    /** Returns the stored session, or undefined if there's none. Throws if storage can't be read. */
    private async loadStoredSession(): Promise<StoredSession | undefined> {
        const serialized = await this._secrets.get(SESSION_STORAGE_KEY);
        if (!serialized) {
            return undefined;
        }

        try {
            // Sessions stored by earlier builds also carry an access token, which is ignored.
            const stored = JSON.parse(serialized) as Partial<StoredSession>;
            if (typeof stored.id === "string") {
                return {
                    id: stored.id,
                    createdAt: typeof stored.createdAt === "number" ? stored.createdAt : undefined,
                };
            }
        } catch {
            // Treated as malformed below.
        }
        this._logger.warn("Ignoring a malformed connection-sharing session.");
        return undefined;
    }
}

/**
 * Reports a session being created, when the user allows an extension access, or removed, when the
 * user signs out. Only fixed values and durations are sent: nothing that identifies the user, the
 * session, or their connections.
 */
function sendSessionTelemetry(
    change: "created" | "removed",
    outcome: "succeeded" | "failed",
    additionalProps: Record<string, string> = {},
    additionalMeasurements: Record<string, number> = {},
): void {
    sendActionEvent(TelemetryViews.Connection, TelemetryActions.SharedConnectionsSession, {
        additionalProps: { change, outcome, ...additionalProps },
        additionalMeasurements,
    });
}

/**
 * Session change events carry no access token: tokens are issued only when an extension requests
 * the session.
 */
function toAuthenticationSession(
    stored: StoredSession,
    accessToken: string = "",
): vscode.AuthenticationSession {
    return {
        id: stored.id,
        accessToken,
        account: {
            id: Constants.sharedConnectionsAuthenticationProviderId,
            label: LocalizedConstants.ConnectionSharing.authenticationAccountLabel,
        },
        scopes: [],
    };
}
