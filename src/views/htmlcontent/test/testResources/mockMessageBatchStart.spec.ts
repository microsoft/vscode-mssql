import { IMessage, WebSocketEvent } from './../../src/js/interfaces';

const message: WebSocketEvent = {
    type: 'message',
    data: <IMessage> {
        batchId: undefined,
        isError: false,
        link: {
            text: 'Line 2',
            uri: '/editorSelection?uri=123&startLine=1&endLine=2&startColumn=1&endColumn=3'
        },
        message: 'Started query execution at ',
        time: '12:01:01 PM'
    }
};

export default message;
