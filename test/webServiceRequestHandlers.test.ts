// TODO: rewrite all the outputprovider handle tests (old ones kept for reference)
// Tracked by issue #625
/*
// Imports used by previous tests

import LocalWebService from '../src/controllers/localWebService';
import Interfaces = require('../src/models/interfaces');
let results = require('./resources/results.json');
let messages = require('./resources/messages.json');
const pd = require('pretty-data').pd;
const fs = require('fs');
let request = require('request');
let metadata = [
    {
        'columnsUri': '/' + Constants.outputContentTypeColumns + '?id=0',
        'rowsUri': '/' + Constants.outputContentTypeRows + '?id=0'
    }
]

    // Old Decleration area
    // let port: string;
    // let file = '/out/test/resources/sqlTest.sql';
    // let path: string;

    // Old Setup Area
    // port = LocalWebService._servicePort;
    // path = vscode.extensions.getExtension('microsoft.vscode-mssql').extensionPath;

    test("Initial Server Responses", () => {
        let uri = contentProvider.updateContent(messages, results);
        let url = 'http://localhost:' + port + '/' + Interfaces.ContentTypes[Interfaces.ContentType.Root] + '?uri=' + uri;
        let htmlbuf = fs.readFileSync(path +'/src/views/htmlcontent/sqlOutput.ejs')
        htmlbuf = htmlbuf.toString();
        htmlbuf = htmlbuf.replace('<%=uri%>', uri);
        return request.get(url, function(err, res, body){
            assert.equal(res.statusCode, 200);
            assert.equal(htmlbuf.toString(), body);
        });
    });

    test("Correctly Delievers MetaData", () => {
        let uri = contentProvider.updateContent(messages, results);
        let url = 'http://localhost:' + port + '/' + Interfaces.ContentTypes[Interfaces.ContentType.ResultsetsMeta] + '?uri=' + uri;
        return request.get(url, function(err, res, body){
            assert.equal(res.statusCode, 200);
            assert.equal(body, JSON.stringify(metadata));
        });
    });

    test("Correctly Delievers Messages", () => {
        let uri = contentProvider.updateContent(messages, results);
        let url = 'http://localhost:' + port + '/' + Interfaces.ContentTypes[Interfaces.ContentType.Messages] + '?uri=' + uri;
        return request.get(url, function(err, res, body){
            assert.equal(res.statusCode, 200);
            assert.equal(body, JSON.stringify(messages));
        });
    });

    test("Correctly Delivers Columns", () => {
        let uri = contentProvider.updateContent(messages, results);
        let url = 'http://localhost:' + port + '/' + Interfaces.ContentTypes[Interfaces.ContentType.Columns] + '?id=0&uri=' + uri;
        return request.get(url, function(err, res, body){
            assert.equal(res.statusCode, 200);
            assert.equal(body, JSON.stringify(results[0].columns));
        });
    });

    test("Correctly Delievers Rows", () => {
        let uri = contentProvider.updateContent(messages, results);
        let url = 'http://localhost:' + port + '/' + Interfaces.ContentTypes[Interfaces.ContentType.Rows] + '?id=0&uri=' + uri;
        return request.get(url,(err, res, body) => {
            assert.equal(res.statusCode, 200);
            assert.equal(body, JSON.stringify(results[0].rows));
        });
    });
*/
