/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

// TODO: Move URI ownership core/coordinator logic to a shared package.
const PACKAGE_JSON_COMMON_FEATURES_KEY = "vscode-sql-common-features";
const SET_CONTEXT_COMMAND = "setContext";

interface UriOwnershipApi {
    ownsUri(uri: vscode.Uri): boolean;
    onDidChangeUriOwnership: vscode.Event<void>;
}

interface CoordinatingExtensionInfo {
    extensionId: string;
    displayName: string;
}

interface SqlExtensionCommonFeaturesContribution {
    uriOwnershipApi?: boolean;
}

export interface UriOwnershipConfig {
    hideUiContextKey: string;
    ownsUri?: (uri: string) => boolean;
    onDidChangeOwnership?: vscode.Event<void>;
    releaseUri?: (uri: string) => void | Promise<void>;
    fileOwnedByOtherExtensionMessage?: (extensionName: string) => string;
}

export interface UriOwnershipDeferredConfig {
    ownsUri: (uri: string) => boolean;
    onDidChangeOwnership: vscode.Event<void>;
    releaseUri?: (uri: string) => void | Promise<void>;
}

function discoverCoordinatingExtensions(selfExtensionId: string): CoordinatingExtensionInfo[] {
    const coordinatingExtensions: CoordinatingExtensionInfo[] = [];

    for (const extension of vscode.extensions.all) {
        if (extension.id.toLowerCase() === selfExtensionId.toLowerCase()) {
            continue;
        }

        const commonFeatures = extension.packageJSON?.contributes?.[
            PACKAGE_JSON_COMMON_FEATURES_KEY
        ] as SqlExtensionCommonFeaturesContribution | undefined;

        if (commonFeatures?.uriOwnershipApi) {
            coordinatingExtensions.push({
                extensionId: extension.id,
                displayName: extension.packageJSON?.displayName || extension.id,
            });
        }
    }

    return coordinatingExtensions;
}

function getExtensionDisplayName(
    extensionId: string,
    coordinatingExtensions: CoordinatingExtensionInfo[],
): string {
    const extension = coordinatingExtensions.find(
        (ext) => ext.extensionId.toLowerCase() === extensionId.toLowerCase(),
    );
    return extension?.displayName || extensionId;
}

export class UriOwnershipCoordinator {
    public readonly uriOwnershipApi: UriOwnershipApi;
    public readonly onCoordinatingOwnershipChanged: vscode.Event<void>;

    private readonly _context: vscode.ExtensionContext;
    private readonly _hideUiContextKey: string;
    private readonly _fileOwnedByOtherExtensionMessage?: (extensionName: string) => string;
    private readonly _coordinatingExtensionApis: Map<string, UriOwnershipApi> = new Map();
    private readonly _coordinatingOwnershipChangedEmitter = new vscode.EventEmitter<void>();
    private readonly _uriOwnershipChangedEmitter = new vscode.EventEmitter<void>();

    private _coordinatingExtensions: CoordinatingExtensionInfo[] = [];
    private _ownsUri: ((uri: string) => boolean) | undefined;
    private _releaseUri: ((uri: string) => void | Promise<void>) | undefined;
    private _initialized = false;

    constructor(context: vscode.ExtensionContext, config: UriOwnershipConfig) {
        this._context = context;
        this._hideUiContextKey = config.hideUiContextKey;
        this._fileOwnedByOtherExtensionMessage = config.fileOwnedByOtherExtensionMessage;

        this._context.subscriptions.push(this._coordinatingOwnershipChangedEmitter);
        this._context.subscriptions.push(this._uriOwnershipChangedEmitter);

        this.uriOwnershipApi = {
            ownsUri: (uri: vscode.Uri): boolean => {
                return this._ownsUri?.(uri.toString(true)) ?? false;
            },
            onDidChangeUriOwnership: this._uriOwnershipChangedEmitter.event,
        };

        this.onCoordinatingOwnershipChanged = this._coordinatingOwnershipChangedEmitter.event;

        if (config.ownsUri && config.onDidChangeOwnership) {
            this._initializeCallbacks({
                ownsUri: config.ownsUri,
                onDidChangeOwnership: config.onDidChangeOwnership,
                releaseUri: config.releaseUri,
            });
        }

        this._discoverAndRegisterExtensions();
        this._registerActiveEditorListener();
        this._registerExtensionChangeListener();
    }

    public initialize(config: UriOwnershipDeferredConfig): void {
        if (this._initialized) {
            return;
        }
        this._initializeCallbacks(config);
    }

    private _initializeCallbacks(config: UriOwnershipDeferredConfig): void {
        if (this._initialized) {
            return;
        }

        this._ownsUri = config.ownsUri;
        this._releaseUri = config.releaseUri;
        this._initialized = true;

        this._context.subscriptions.push(
            config.onDidChangeOwnership(() => {
                this._uriOwnershipChangedEmitter.fire();
            }),
        );

        this._updateUriOwnershipContext();
    }

    public getOwningCoordinatingExtension(uri: vscode.Uri): string | undefined {
        for (const [extensionId, api] of this._coordinatingExtensionApis.entries()) {
            if (api.ownsUri(uri)) {
                return extensionId;
            }
        }
        return undefined;
    }

    public isOwnedByCoordinatingExtension(uri: vscode.Uri): boolean {
        return this.getOwningCoordinatingExtension(uri) !== undefined;
    }

    public isActiveEditorOwnedByOtherExtensionWithWarning(warningMessage?: string): boolean {
        const activeUri = vscode.window.activeTextEditor?.document?.uri;
        if (activeUri) {
            const owningExtensionId = this.getOwningCoordinatingExtension(activeUri);
            if (owningExtensionId) {
                const extensionName = getExtensionDisplayName(
                    owningExtensionId,
                    this._coordinatingExtensions,
                );
                const message =
                    warningMessage ||
                    this._fileOwnedByOtherExtensionMessage?.(extensionName) ||
                    `This file is connected to ${extensionName}. Please use ${extensionName} commands for this file.`;
                void vscode.window.showInformationMessage(message);
                return true;
            }
        }
        return false;
    }

    public getCoordinatingExtensions(): ReadonlyArray<CoordinatingExtensionInfo> {
        return this._coordinatingExtensions;
    }

    private _discoverAndRegisterExtensions(): void {
        this._coordinatingExtensions = discoverCoordinatingExtensions(this._context.extension.id);

        for (const extInfo of this._coordinatingExtensions) {
            const extension = vscode.extensions.getExtension(extInfo.extensionId);
            if (!extension) {
                continue;
            }

            if (!extension.isActive) {
                extension.activate().then(
                    (exports) => {
                        this._registerCoordinatingExtensionApi(extInfo.extensionId, exports);
                    },
                    (err) => {
                        console.error(
                            `[${this._context.extension.id}] Error activating coordinating extension ${extInfo.extensionId}: ${err}`,
                        );
                    },
                );
            } else {
                this._registerCoordinatingExtensionApi(extInfo.extensionId, extension.exports);
            }
        }
    }

    private _registerCoordinatingExtensionApi(extensionId: string, exports: unknown): void {
        const api = (exports as { uriOwnershipApi?: UriOwnershipApi })?.uriOwnershipApi;
        if (api) {
            this._coordinatingExtensionApis.set(extensionId, api);

            if (api.onDidChangeUriOwnership) {
                this._context.subscriptions.push(
                    api.onDidChangeUriOwnership(() => {
                        this._updateUriOwnershipContext();
                    }),
                );
            }
        }
    }

    private _registerActiveEditorListener(): void {
        this._context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(() => {
                this._updateUriOwnershipContext();
            }),
        );

        this._updateUriOwnershipContext();
    }

    private _registerExtensionChangeListener(): void {
        this._context.subscriptions.push(
            vscode.extensions.onDidChange(() => {
                this._refreshCoordinatingExtensions();
            }),
        );
    }

    private _refreshCoordinatingExtensions(): void {
        const newExtensions = discoverCoordinatingExtensions(this._context.extension.id);

        for (const extInfo of newExtensions) {
            if (!this._coordinatingExtensionApis.has(extInfo.extensionId)) {
                const extension = vscode.extensions.getExtension(extInfo.extensionId);
                if (extension?.isActive) {
                    this._registerCoordinatingExtensionApi(extInfo.extensionId, extension.exports);
                }
            }
        }

        this._coordinatingExtensions = newExtensions;
    }

    private _updateUriOwnershipContext(): void {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            void vscode.commands.executeCommand(SET_CONTEXT_COMMAND, this._hideUiContextKey, false);
            return;
        }

        const uri = activeEditor.document.uri;
        const uriString = uri.toString(true);
        const isOwnedByOther = this.isOwnedByCoordinatingExtension(uri);
        const isOwnedBySelf = this._ownsUri?.(uriString) ?? false;

        if (isOwnedByOther && isOwnedBySelf && this._releaseUri) {
            void Promise.resolve(this._releaseUri(uriString));
        }

        void vscode.commands.executeCommand(
            SET_CONTEXT_COMMAND,
            this._hideUiContextKey,
            isOwnedByOther,
        );

        this._coordinatingOwnershipChangedEmitter.fire();
    }
}
