/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as crypto from "crypto";
import { IConnectionInfo } from "vscode-mssql";
import { LocalCacheService } from "./localCacheService";
import { GitStatusService } from "./gitStatusService";
import { DdlDetectionService } from "./ddlDetectionService";
import { sendActionEvent } from "../telemetry/telemetry";
import { TelemetryViews, TelemetryActions } from "../sharedInterfaces/telemetry";
import ConnectionManager from "../controllers/connectionManager";

/**
 * Debounce timer information for a connection
 */
interface DebounceTimerInfo {
    /** The timer handle */
    timer: NodeJS.Timeout;
    /** Connection credentials */
    credentials: IConnectionInfo;
    /** Owner URI for the connection */
    ownerUri: string;
    /** Count of DDL statements detected during debounce period */
    ddlCount: number;
    /** DDL statement types detected */
    ddlTypes: Set<string>;
}

/**
 * Service for automatically refreshing local cache when DDL statements are executed
 */
export class AutoCacheRefreshService {
    private static _instance: AutoCacheRefreshService;

    private _localCacheService: LocalCacheService;
    private _gitStatusService: GitStatusService;
    private _connectionManager: ConnectionManager;
    private _debounceTimers: Map<string, DebounceTimerInfo> = new Map();
    private _debounceDelayMs: number = 2000; // 2 seconds default
    private _isEnabled: boolean = true;

    private constructor(
        localCacheService: LocalCacheService,
        gitStatusService: GitStatusService,
        connectionManager: ConnectionManager,
    ) {
        this._localCacheService = localCacheService;
        this._gitStatusService = gitStatusService;
        this._connectionManager = connectionManager;

        // Load settings
        this.loadSettings();

        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("mssql.gitIntegration.autoRefreshCacheOnDDL")) {
                this.loadSettings();
            }
        });
    }

    /**
     * Get or create the singleton instance
     */
    public static getInstance(
        localCacheService: LocalCacheService,
        gitStatusService: GitStatusService,
        connectionManager: ConnectionManager,
    ): AutoCacheRefreshService {
        if (!AutoCacheRefreshService._instance) {
            AutoCacheRefreshService._instance = new AutoCacheRefreshService(
                localCacheService,
                gitStatusService,
                connectionManager,
            );
        }
        return AutoCacheRefreshService._instance;
    }

    /**
     * Load settings from VS Code configuration
     */
    private loadSettings(): void {
        const config = vscode.workspace.getConfiguration("mssql.gitIntegration");
        this._isEnabled = config.get<boolean>("autoRefreshCacheOnDDL", true);
    }

    /**
     * Handle query completion - check for DDL and trigger cache refresh if needed
     * @param ownerUri The connection owner URI
     * @param queryText The executed query text
     * @param hasError Whether the query had errors
     * @param credentials The connection credentials
     */
    public async handleQueryCompletion(
        ownerUri: string,
        queryText: string,
        hasError: boolean,
        credentials: IConnectionInfo | undefined,
    ): Promise<void> {
        // Skip if feature is disabled
        if (!this._isEnabled) {
            return;
        }

        // Skip if query had errors
        if (hasError) {
            return;
        }

        // Skip if no credentials
        if (!credentials) {
            return;
        }

        // Skip if no query text
        if (!queryText || queryText.trim().length === 0) {
            return;
        }

        // Check if query contains DDL
        if (!DdlDetectionService.containsDdl(queryText)) {
            return;
        }

        // Check if database is linked to Git
        try {
            const gitInfo = await this._gitStatusService.getDatabaseGitInfo(credentials);
            if (!gitInfo.isLinked) {
                return; // Not linked to Git, no need to refresh
            }
        } catch (error) {
            console.error("[AutoCacheRefresh] Error checking Git link status:", error);
            return;
        }

        // Extract DDL types for telemetry
        const ddlTypes = DdlDetectionService.extractDdlTypes(queryText);

        // Trigger debounced refresh
        this.scheduleDebouncedRefresh(ownerUri, credentials, ddlTypes);
    }

    /**
     * Schedule a debounced cache refresh
     * If another DDL is executed within the debounce period, the timer is reset
     */
    private scheduleDebouncedRefresh(
        ownerUri: string,
        credentials: IConnectionInfo,
        ddlTypes: string[],
    ): void {
        const connectionKey = this.getConnectionKey(credentials);

        // Clear existing timer if present
        const existingTimer = this._debounceTimers.get(connectionKey);
        if (existingTimer) {
            clearTimeout(existingTimer.timer);
            existingTimer.ddlCount++;
            ddlTypes.forEach((type) => existingTimer.ddlTypes.add(type));
        }

        // Create new timer
        const timer = setTimeout(() => {
            void this.performRefresh(connectionKey);
        }, this._debounceDelayMs);

        // Store timer info
        const timerInfo: DebounceTimerInfo = existingTimer
            ? {
                  ...existingTimer,
                  timer,
              }
            : {
                  timer,
                  credentials,
                  ownerUri,
                  ddlCount: 1,
                  ddlTypes: new Set(ddlTypes),
              };

        this._debounceTimers.set(connectionKey, timerInfo);

        console.log(
            `[AutoCacheRefresh] Scheduled refresh for ${credentials.database} (${timerInfo.ddlCount} DDL statements)`,
        );
    }

    /**
     * Perform the actual cache refresh
     */
    private async performRefresh(connectionKey: string): Promise<void> {
        const timerInfo = this._debounceTimers.get(connectionKey);
        if (!timerInfo) {
            return;
        }

        // Remove from map
        this._debounceTimers.delete(connectionKey);

        const { credentials, ddlCount, ddlTypes } = timerInfo;

        console.log(
            `[AutoCacheRefresh] Performing refresh for ${credentials.database} (${ddlCount} DDL statements: ${Array.from(ddlTypes).join(", ")})`,
        );

        try {
            // Show subtle notification
            void vscode.window.setStatusBarMessage(
                `$(sync~spin) Refreshing cache for ${credentials.database}...`,
                3000,
            );

            // Generate connection hash and cache URI (same logic as LocalCacheService)
            const connectionHash = this.generateConnectionHash(credentials);
            const cacheOwnerUri = `vscode-mssql-cache://${connectionHash}`;

            // Ensure the cache connection exists
            if (!this._connectionManager.isConnected(cacheOwnerUri)) {
                console.log(
                    `[AutoCacheRefresh] Cache connection doesn't exist, creating it for ${credentials.database}...`,
                );
                const connected = await this._connectionManager.connect(
                    cacheOwnerUri,
                    credentials,
                    false, // Don't show error dialogs
                );

                if (!connected) {
                    console.error(
                        `[AutoCacheRefresh] Failed to create cache connection for ${credentials.database}`,
                    );
                    return;
                }
                console.log(`[AutoCacheRefresh] Cache connection created successfully`);
            }

            // Perform the refresh (no progress UI for automatic refresh)
            await this._localCacheService.updateCache(cacheOwnerUri, credentials);

            // Show completion message
            void vscode.window.setStatusBarMessage(
                `$(check) Cache refreshed for ${credentials.database}`,
                2000,
            );

            // Send telemetry
            sendActionEvent(TelemetryViews.LocalCache, TelemetryActions.UpdateCache, {
                automatic: "true",
                ddlCount: ddlCount.toString(),
                ddlTypes: Array.from(ddlTypes).join(","),
            });

            console.log(`[AutoCacheRefresh] Refresh completed for ${credentials.database}`);
        } catch (error) {
            console.error(`[AutoCacheRefresh] Refresh failed for ${credentials.database}:`, error);
            // Don't show error to user for automatic refresh - it's non-critical
        }
    }

    /**
     * Generate a unique key for a connection
     */
    private getConnectionKey(credentials: IConnectionInfo): string {
        return `${credentials.server}|${credentials.database}|${credentials.user || "integrated"}`;
    }

    /**
     * Generate a deterministic hash for a connection (same logic as LocalCacheService)
     */
    private generateConnectionHash(credentials: IConnectionInfo): string {
        const hashInput = `${credentials.server}|${credentials.database}|${credentials.user || "integrated"}`;
        return crypto.createHash("sha256").update(hashInput).digest("hex").substring(0, 16);
    }

    /**
     * Cancel all pending refreshes (for cleanup)
     */
    public cancelAllPendingRefreshes(): void {
        for (const [key, timerInfo] of this._debounceTimers.entries()) {
            clearTimeout(timerInfo.timer);
            console.log(`[AutoCacheRefresh] Cancelled pending refresh for ${key}`);
        }
        this._debounceTimers.clear();
    }

    /**
     * Get the number of pending refreshes (for testing/debugging)
     */
    public getPendingRefreshCount(): number {
        return this._debounceTimers.size;
    }
}
