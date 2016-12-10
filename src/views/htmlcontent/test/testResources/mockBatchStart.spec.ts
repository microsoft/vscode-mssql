import { WebSocketEvent } from './../../src/js/interfaces';


// NOTE: nulls are used here because those are the same as what comes back from the service
const batchStart: WebSocketEvent = {
    type: 'batchStart',
    data: {
        'executionElapsed': null,   // tslint:disable-line:no-null-keyword
        'executionEnd': null,       // tslint:disable-line:no-null-keyword
        'executionStart': '2016-11-10T17:39:27.8014040-08:00',
        'hasError': false,
        'id': 0,
        'selection': {
            'endColumn': 1,
            'endLine': 5,
            'startColumn': 0,
            'startLine': 3
        },
        'messages': null,           // tslint:disable-line:no-null-keyword
        'resultSetSummaries': null  // tslint:disable-line:no-null-keyword
    }
};

export default batchStart;
