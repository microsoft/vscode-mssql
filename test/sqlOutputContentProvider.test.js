"use strict";
// The module 'assert' provides assertion methods from node
var assert = require('assert');
var vscode = require('vscode');
// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
var sqlOutputContentProvider_1 = require('../src/models/sqlOutputContentProvider');
var localWebService_1 = require('../src/controllers/localWebService');
var Interfaces = require('../src/models/interfaces');
var Constants = require('../src/models/constants');
var results = require('resources/results.json');
var messages = require('resources/messages.json');
var metadata = [
    {
        "columnsUri": "/" + Constants.outputContentTypeColumns + "?id=0",
        "rowsUri": "/" + Constants.outputContentTypeRows + "?id=0"
    }
];
var fs = require('fs');
var request = require('request');
var TextContext = (function () {
    function TextContext(path) {
        this.extensionPath = path;
    }
    TextContext.prototype.asAbsolutePath = function (relativePath) {
        return '';
    };
    return TextContext;
}());
suite("SqlOutputProvider Tests", function () {
    var contentProvider;
    var path;
    var port;
    var file = "/test/sqlTest.sql";
    function openSQLFile() {
        return vscode.workspace.openTextDocument(vscode.Uri.parse("file:" + path + file)).then(function (document) {
            vscode.window.showTextDocument(document).then(function (editor) {
            });
        });
    }
    setup(function () {
        path = vscode.extensions.getExtension("microsoft.vscode-mssql").extensionPath;
        contentProvider = new sqlOutputContentProvider_1.SqlOutputContentProvider(new TextContext(path));
        port = localWebService_1.default._servicePort;
        return openSQLFile();
    });
    test("Initial Server Responses", function () {
        var url = 'http://localhost:' + port + '/' + Interfaces.ContentTypes[Interfaces.ContentType.Root];
        console.log(process.cwd());
        var htmlbuf = fs.readFileSync(path + '/src/views/htmlcontent/sqlOutput.ejs');
        return request.get(url, function (err, res, body) {
            assert.equal(res.statusCode, 200);
            assert.equal(htmlbuf.toString(), body);
        });
    });
    test("Correctly Delievers MetaData", function () {
        var uri = contentProvider.updateContent(messages, results);
        var url = 'http://localhost:' + port + '/' + Interfaces.ContentTypes[Interfaces.ContentType.ResultsetsMeta] + '?uri=' + uri;
        return request.get(url, function (err, res, body) {
            assert.equal(res.statusCode, 200);
            assert.equal(body, JSON.stringify(metadata));
        });
    });
    test("Correctly Delievers Messages", function () {
        var uri = contentProvider.updateContent(messages, results);
        var url = 'http://localhost:' + port + '/' + Interfaces.ContentTypes[Interfaces.ContentType.Messages] + '?uri=' + uri;
        return request.get(url, function (err, res, body) {
            assert.equal(res.statusCode, 200);
            assert.equal(body, JSON.stringify(messages));
        });
    });
    test("Correctly Delivers Columns", function () {
        var uri = contentProvider.updateContent(messages, results);
        var url = 'http://localhost:' + port + '/' + Interfaces.ContentTypes[Interfaces.ContentType.Columns] + '?id=0&uri=' + uri;
        return request.get(url, function (err, res, body) {
            assert.equal(res.statusCode, 200);
            assert.equal(body, JSON.stringify(results[0].columns));
        });
    });
    test("Correctly Delievers Rows", function () {
        var uri = contentProvider.updateContent(messages, results);
        var url = 'http://localhost:' + port + '/' + Interfaces.ContentTypes[Interfaces.ContentType.Rows] + '?id=0&uri=' + uri;
        return request.get(url, function (err, res, body) {
            assert.equal(res.statusCode, 200);
            assert.equal(body, JSON.stringify(results[0].rows));
        });
    });
});
//# sourceMappingURL=sqlOutputContentProvider.test.js.map