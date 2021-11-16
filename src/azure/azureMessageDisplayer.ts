import { MessageDisplayer } from '@microsoft/ads-adal-library';

export class AzureMessageDisplayer implements MessageDisplayer {
    async displayInfoMessage(msg: string): Promise<void> {
        return;
    }
    async displayErrorMessage(msg: string): Promise<void> {
        return;
    }
}
