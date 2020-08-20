import { MessageDisplayer } from 'aad-library';

export class AzureMessageDisplayer implements MessageDisplayer {
    displayInfoMessage(msg: string): Promise<void> {
        return;
    }
    displayErrorMessage(msg: string): Promise<void> {
        return;
    }
}