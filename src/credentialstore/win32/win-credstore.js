/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/
'use strict';

// This code is originally from https://github.com/microsoft/vsts-vscode
// License: https://github.com/Microsoft/vsts-vscode/blob/master/LICENSE.txt

//
// Wrapper module around Windows credential store.
// Uses the creds.exe program.
//

var _ = require('underscore');
var childProcess = require('child_process');
var es = require('event-stream');
var path = require('path');

var parser = require('./win-credstore-parser');

var credExePath = path.join(__dirname, '../bin/win32/creds.exe');

var targetNamePrefix = '';

// Allow callers to set their own prefix
function setPrefix(prefix) {
  targetNamePrefix = prefix;
}

function ensurePrefix(targetName) {
  if (targetName.slice(targetNamePrefix.length) !== targetNamePrefix) {
    targetName = targetNamePrefix + targetName;
  }
  return targetName;
}

function removePrefix(targetName) {
  return targetName.slice(targetNamePrefix.length);
}

/**
 * list the contents of the credential store, parsing each value.
 *
 * We ignore everything that wasn't put there by us, we look
 * for target names starting with the target name prefix.
 *
 *
 * @return {Stream} object mode stream of credentials.
 */
function list() {
  var credsProcess = childProcess.spawn(credExePath,['-s', '-g', '-t', targetNamePrefix + '*']);
  return credsProcess.stdout
    .pipe(parser())
    .pipe(es.mapSync(function (cred) {
      cred.targetName = removePrefix(cred.targetName);
      return cred;
    }));
}

/**
 * Get details for a specific credential. Assumes generic credential.
 *
 * @param {string} targetName target name for credential
 * @param {function (err, credential)} callback callback function that receives
 *                                              returned credential.
 */
function get(targetName, callback) {
  var args = [
    '-s',
    '-t', ensurePrefix(targetName)
  ];

  var credsProcess = childProcess.spawn(credExePath, args);
  var result = null;
  var errors = [];

  credsProcess.stdout.pipe(parser())
    .on('data', function (credential) {
      result = credential;
      result.targetName = removePrefix(result.targetName);
    });

  credsProcess.stderr.pipe(es.split())
    .on('data', function (line) {
      errors.push(line);
    });

  credsProcess.on('exit', function (code) {
    if (code === 0) {
      callback(null, result);
    } else {
      callback(new Error('Getting credential failed, exit code ' + code + ': ' + errors.join(', ')));
    }
  });
}

/**
 * Set the credential for a given key in the credential store.
 * Creates or updates, assumes generic credential.
 * If credential is buffer, stores buffer contents as binary directly.
 * If credential is string, stores UTF-8 encoded binary.
 *
 * @param {String} targetName target name for entry
 * @param {Buffer|String} credential the credential
 * @param {Function(err)} callback completion callback
 */
 function set(targetName, credential, callback) {
  if (_.isString(credential)) {
    credential = new Buffer(credential, 'utf8');
  }
  var args = [
    '-a',
    '-t', ensurePrefix(targetName),
    '-p', credential.toString('hex')
  ];

  childProcess.execFile(credExePath, args,
    function (err) {
      callback(err);
    });
 }

 /**
  * Remove the given key from the credential store.
  *
  * @param {string} targetName target name to remove.
  *                            if ends with "*" character,
  *                            will delete all targets
  *                            starting with that prefix
  * @param {Function(err)} callback completion callback
  */
function remove(targetName, callback) {
  var args = [
    '-d',
    '-t', ensurePrefix(targetName)
  ];

  if (targetName.slice(-1) === '*') {
    args.push('-g');
  }

  childProcess.execFile(credExePath, args,
    function (err) {
      callback(err);
    });
}

_.extend(exports, {
  list: list,
  set: set,
  get: get,
  remove: remove,
  setPrefix: setPrefix
});
