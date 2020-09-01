import UserInteraction from '@cssuh/ads-adal-library';
import * as vscode from 'vscode';

export class AzureUserInteraction implements UserInteraction {

    port: string;
    nonce: string;
    state: string;
    constructor(
        state: string
    ) {
        let arr = state.split(',');
        this.port = arr[0];
        this.nonce = arr[1];

    }

    public askForConsent(msg: string): Promise<boolean> {
        return;
    }

    public async openUrl(signInUrl): Promise<void> {
        await vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${this.port}/signin?nonce=${encodeURIComponent(this.nonce)}`));
        // need to open window here and also be able to capture the auth code via redirect to the local web server
        return;
    }
}
