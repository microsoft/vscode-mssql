import { WebSocketEvent } from './../../src/js/interfaces';

const batch: WebSocketEvent = {
  type: 'batch',
  data: {
  'executionElapsed': '00:00:00.1879820',
  'executionEnd': '2016-11-10T17:39:27.9893860-08:00',
  'executionStart': '2016-11-10T17:39:27.8014040-08:00',
  'hasError': false,
  'id': 0,
  'selection': {
    'endColumn': 1,
    'endLine': 5,
    'startColumn': 0,
    'startLine': 3
  },
  'messages': [
    {
      'time': '2016-11-10T17:39:27.9773300-08:00',
      'message': '(115 rows affected)'
    }
  ],
  'resultSetSummaries': [
    {
      'id': 0,
      'rowCount': 10,
      'columnInfo': [
        {
          'isBytes': false,
          'isChars': true,
          'isLong': false,
          'isSqlVariant': false,
          'isUdt': false,
          'isXml': false,
          'isJson': false,
          'columnName': 'name'
        },
        {
          'isBytes': false,
          'isChars': false,
          'isLong': false,
          'isSqlVariant': false,
          'isUdt': false,
          'isXml': false,
          'isJson': false,
          'columnName': 'object_id'
        },
        {
          'isBytes': false,
          'isChars': false,
          'isLong': false,
          'isSqlVariant': false,
          'isUdt': false,
          'isXml': false,
          'isJson': false,
          'columnName': 'principal_id'
        },
        {
          'isBytes': false,
          'isChars': false,
          'isLong': false,
          'isSqlVariant': false,
          'isUdt': false,
          'isXml': false,
          'isJson': false,
          'columnName': 'schema_id'
        },
        {
          'isBytes': false,
          'isChars': false,
          'isLong': false,
          'isSqlVariant': false,
          'isUdt': false,
          'isXml': false,
          'isJson': false,
          'columnName': 'parent_object_id'
        },
        {
          'isBytes': false,
          'isChars': false,
          'isLong': false,
          'isSqlVariant': false,
          'isUdt': false,
          'isXml': false,
          'isJson': false,
          'columnName': 'type'
        },
        {
          'isBytes': false,
          'isChars': true,
          'isLong': false,
          'isSqlVariant': false,
          'isUdt': false,
          'isXml': false,
          'isJson': false,
          'columnName': 'type_desc'
        },
        {
          'isBytes': false,
          'isChars': false,
          'isLong': false,
          'isSqlVariant': false,
          'isUdt': false,
          'isXml': false,
          'isJson': false,
          'columnName': 'create_date'
        },
        {
          'isBytes': false,
          'isChars': false,
          'isLong': false,
          'isSqlVariant': false,
          'isUdt': false,
          'isXml': false,
          'isJson': false,
          'columnName': 'modify_date'
        },
        {
          'isBytes': false,
          'isChars': false,
          'isLong': false,
          'isSqlVariant': false,
          'isUdt': false,
          'isXml': false,
          'isJson': false,
          'columnName': 'is_ms_shipped'
        },
        {
          'isBytes': false,
          'isChars': false,
          'isLong': false,
          'isSqlVariant': false,
          'isUdt': false,
          'isXml': false,
          'isJson': false,
          'columnName': 'is_published'
        },
        {
          'isBytes': false,
          'isChars': false,
          'isLong': false,
          'isSqlVariant': false,
          'isUdt': false,
          'isXml': false,
          'isJson': false,
          'columnName': 'is_schema_published'
        }
      ]
    }
  ]}
};

export default batch;
