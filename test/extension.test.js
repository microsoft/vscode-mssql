//
// Note: This example test is leveraging the Mocha test framework.
// Please refer to their documentation on https://mochajs.org/ for help.
//
"use strict";
// The module 'assert' provides assertion methods from node
var assert = require('assert');
// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
var vscode = require('vscode');
// Defines a Mocha test suite to group tests of similar kind together
suite("Extension Tests", function () {
    function assertEditor(done) {
        vscode.workspace.openTextDocument(vscode.Uri.parse("untitled:c:new.js")).then(function (document) {
            vscode.window.showTextDocument(document).then(function (editor) {
                editor.edit(function (builder) {
                    builder.insert(new vscode.Position(0, 0), "Hello, World!");
                }).then(function () {
                    try {
                        assert.equal(document.getText(), "this test should fail");
                        done();
                    }
                    catch (e) {
                        done(e);
                    }
                });
            });
        });
    }
    test("Test Editor Async", function (done) {
        assertEditor(done);
    });
});
//# sourceMappingURL=extension.test.js.map