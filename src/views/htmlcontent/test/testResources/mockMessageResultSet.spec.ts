import { IMessage, WebSocketEvent } from './../../src/js/interfaces';

const message: WebSocketEvent = {
    type: 'message',
    data: <IMessage> {
        batchId: 0,
        isError: false,
        link: undefined,
        message: '(123 Rows Affected)',
        time: '12:01:01'
    }
};

export default message;
