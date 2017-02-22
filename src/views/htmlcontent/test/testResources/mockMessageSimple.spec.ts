import { IMessage, WebSocketEvent } from './../../src/js/interfaces';

const message: WebSocketEvent = {
    type: 'message',
    data: <IMessage> {
        batchId: undefined,             // Should not be indented
        isError: false,                 // Should not have error class
        link: undefined,                // Should not have link
        message: '(123 Rows Affected)',
        time: '12:01:01'                // Should be displayed b/c it does not have a batchId
    }
};

export default message;
