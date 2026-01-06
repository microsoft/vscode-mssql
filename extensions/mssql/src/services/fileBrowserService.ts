import VscodeWrapper from "../controllers/vscodeWrapper";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import { Logger } from "../models/logger";
import { Deferred } from "../protocol";
import * as fb from "../sharedInterfaces/fileBrowser";

export class FileBrowserService {
    private _client: SqlToolsServiceClient;
    private _logger: Logger;

    /**
     * Map of pending session creations
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

    public async closeFileBrowser(connectionUri: string): Promise<fb.FileBrowserCloseResponse> {
        try {
            let params: fb.FileBrowserCloseParams = {
                ownerUri: connectionUri,
            };
            return await this._client.sendRequest(fb.FileBrowserCloseRequest.type, params);
        } catch (e) {
            this._client.logger.error(e);
            throw e;
        }
    }
}
