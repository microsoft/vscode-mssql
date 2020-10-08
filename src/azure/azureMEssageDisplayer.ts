import { MessageDisplayer } from 'ads-adal-library';

export class AzureMessageDisplayer implements MessageDisplayer {
    displayInfoMessage(msg: string): Promise<void> {
        return;
    }
    displayErrorMessage(msg: string): Promise<void> {
        return;
    }
}