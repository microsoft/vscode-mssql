import VscodeWrapper from "../controllers/vscodeWrapper";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import { Logger } from "../models/logger";
import { Deferred } from "../protocol";
import * as fb from "../sharedInterfaces/fileBrowser";

export class FileBrowserService {
    private _client: SqlToolsServiceClient;
    private _logger: Logger;
    fileBrowserState: fb.FileBrowserState;

    /**
     * Map of pending opens
     */
    private _pendingFileBrowserOpens: Map<string, Deferred<fb.FileBrowserOpenResponse>> = new Map<
        string,
        Deferred<fb.FileBrowserOpenResponse>
    >();
    /**
     * Map of pending expands
     */
    private _pendingFileBrowserExpands: Map<string, Deferred<fb.FileBrowserExpandResponse>> =
        new Map<string, Deferred<fb.FileBrowserExpandResponse>>();

    constructor(
        private _vscodeWrapper: VscodeWrapper,
        _client: SqlToolsServiceClient,
    ) {
        this._client = _client;
        this._logger = Logger.create(this._vscodeWrapper.outputChannel, "FileBrowserService");

        this._client.onNotification(fb.FileBrowserOpenNotification.type, (e) =>
            this.handleFileBrowserOpenNotification(e),
        );

        this._client.onNotification(fb.FileBrowserExpandNotification.type, (e) =>
            this.handleFileBrowserExpandNotification(e),
        );
    }

    /**
     * Handles the file browser open notification from the SQL Tools Service.
     * @param result The result of the file browser open request.
     */
    public handleFileBrowserOpenNotification(result: fb.FileBrowserOpenResponse): void {
        const promise = this._pendingFileBrowserOpens.get(result.ownerUri);
        if (promise) {
            promise.resolve(result);
        } else {
            this._logger.error(
                `File Browser Open notification received for ownerUri ${result.ownerUri} but no promise found.`,
            );
        }
    }

    /**
     * Handles the file browser expand notification from the SQL Tools Service.
     * @param result The result of the file browser expand request.
     */
    public handleFileBrowserExpandNotification(result: fb.FileBrowserExpandResponse): void {
        const promise = this._pendingFileBrowserExpands.get(result.ownerUri);
        if (promise) {
            promise.resolve(result);
        } else {
            this._logger.error(
                `File Browser Expand notification received for ownerUri ${result.ownerUri} but no promise found.`,
            );
        }
    }

    public async openFileBrowser(
        connectionUri: string,
        expandPath: string,
        fileFilters: string[],
        changeFilter: boolean,
        showFoldersOnly?: boolean,
    ): Promise<fb.FileBrowserOpenResponse | undefined> {
        const openFileBrowserParams: fb.FileBrowserOpenParams = {
            ownerUri: connectionUri,
            expandPath: expandPath,
            fileFilters: fileFilters,
            changeFilter: changeFilter,
            showFoldersOnly: showFoldersOnly,
        };

        const fileBrowserOpenedResponse: Deferred<fb.FileBrowserOpenResponse> =
            new Deferred<fb.FileBrowserOpenResponse>();

        this._pendingFileBrowserOpens.set(
            openFileBrowserParams.ownerUri,
            fileBrowserOpenedResponse,
        );

        const openFileBrowserResponse = await this._client.sendRequest(
            fb.FileBrowserOpenRequest.type,
            openFileBrowserParams,
        );

        if (openFileBrowserResponse) {
            const fileBrowserResult = await fileBrowserOpenedResponse;
            if (fileBrowserResult.succeeded) {
                this._logger.verbose(
                    `File browser opened successfully with owner uri ${fileBrowserResult.ownerUri}`,
                );
                this._pendingFileBrowserOpens.delete(fileBrowserResult.ownerUri);

                this.fileBrowserState = {
                    ownerUri: fileBrowserResult.ownerUri,
                    fileTree: fileBrowserResult.fileTree,
                    fileFilters: fileFilters,
                    showFoldersOnly: !!showFoldersOnly,
                    selectedPath: expandPath,
                };

                return fileBrowserResult;
            } else {
                this._logger.error(
                    `File browser open failed with error: ${fileBrowserResult.message}`,
                );

                return {
                    ownerUri: fileBrowserResult.ownerUri,
                    fileTree: undefined,
                    succeeded: false,
                    message: fileBrowserResult.message,
                };
            }
        } else {
            return undefined;
        }
    }

    public async expandFilePath(
        connectionUri: string,
        expandPath: string,
    ): Promise<fb.FileBrowserExpandResponse | undefined> {
        const expandFileBrowserParams: fb.FileBrowserExpandParams = {
            ownerUri: connectionUri,
            expandPath: expandPath,
        };

        const fileBrowserExpandedResponse: Deferred<fb.FileBrowserExpandResponse> =
            new Deferred<fb.FileBrowserExpandResponse>();

        this._pendingFileBrowserExpands.set(
            expandFileBrowserParams.ownerUri,
            fileBrowserExpandedResponse,
        );

        const expandFileBrowserResponse = await this._client.sendRequest(
            fb.FileBrowserExpandRequest.type,
            expandFileBrowserParams,
        );

        if (expandFileBrowserResponse) {
            const fileBrowserResult = await fileBrowserExpandedResponse;
            if (fileBrowserResult.succeeded) {
                this._logger.verbose(
                    `File browser expanded successfully with owner uri ${fileBrowserResult.ownerUri}`,
                );
                this._pendingFileBrowserExpands.delete(fileBrowserResult.ownerUri);

                this.updateNodeChildren(
                    this.fileBrowserState.fileTree.rootNode.children[0],
                    expandPath,
                    fileBrowserResult.children,
                );

                this.fileBrowserState = {
                    ...this.fileBrowserState,
                };

                return fileBrowserResult;
            } else {
                this._logger.error(
                    `File browser expand failed with error: ${fileBrowserResult.message}`,
                );

                return {
                    ownerUri: fileBrowserResult.ownerUri,
                    expandPath: fileBrowserResult.expandPath,
                    children: undefined,
                    succeeded: false,
                    message: fileBrowserResult.message,
                };
            }
        } else {
            return undefined;
        }
    }

    public async closeFileBrowser(connectionUri: string): Promise<fb.FileBrowserCloseResponse> {
        try {
            let params: fb.FileBrowserCloseParams = {
                ownerUri: connectionUri,
            };
            const result = await this._client.sendRequest(fb.FileBrowserCloseRequest.type, params);
            this.fileBrowserState = undefined;
            return result;
        } catch (e) {
            this._client.logger.error(e);
            throw e;
        }
    }

    private updateNodeChildren(
        currentNode: fb.FileTreeNode,
        targetNodePath: string,
        children: fb.FileTreeNode[],
    ): boolean {
        if (currentNode.fullPath === targetNodePath) {
            currentNode.children = children;
            currentNode.isExpanded = true;
            return true;
        }

        if (!currentNode.children?.length) {
            return false;
        }

        if (!targetNodePath.startsWith(currentNode.fullPath)) {
            return false;
        }

        for (const child of currentNode.children) {
            if (this.updateNodeChildren(child, targetNodePath, children)) {
                return true;
            }
        }

        return false;
    }
}
