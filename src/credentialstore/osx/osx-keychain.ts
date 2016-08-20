/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/
'use strict';

// This code is originally from https://github.com/microsoft/vsts-vscode
// License: https://github.com/Microsoft/vsts-vscode/blob/master/LICENSE.txt

//
// Access to the OSX keychain - list, add, get password, remove
//
import _ = require('underscore');
import childProcess = require('child_process');

let es = require('event-stream');
let parser = require('./osx-keychain-parser');

let securityPath = '/usr/bin/security';

let targetNamePrefix = '';

// Allow callers to set their own prefix
export function setPrefix(prefix): void {
  targetNamePrefix = prefix;
}

export function ensurePrefix(targetName): string {
  if (targetName.slice(targetNamePrefix.length) !== targetNamePrefix) {
    targetName = targetNamePrefix + targetName;
  }
  return targetName;
}

export function removePrefix(targetName): string {
  return targetName.slice(targetNamePrefix.length);
}

/**
 * List contents of default keychain, no passwords.
 *
 * @return {Stream} object mode stream of parsed results.
 */
export function list(): any {
  let securityProcess = childProcess.spawn(securityPath, ['dump-keychain']);

  return securityProcess.stdout
    .pipe(es.split())
    .pipe(es.mapSync(function (line): string {
      return line.replace(/\\134/g, '\\');
    }))
    .pipe(new parser.ParsingStream());
}

/**
 * Get the password for a given key from the keychain
 * Assumes it's a generic credential.
 *
 * @param {string} userName user name to look up
 * @param {string} service service identifier
 * @param {Function(err, string)} callback callback receiving
 *                                returned result.
 */
export function get(userName, service, callback): any {
  let args = [
    'find-generic-password',
    '-a', userName,
    '-s', ensurePrefix(service),
    '-g'
  ];

  childProcess.execFile(securityPath, args, function (err, stdout, stderr): any {
    if (err) { return callback(err); }
    let match = /^password: (?:0x[0-9A-F]+  )?"(.*)"$/m.exec(stderr);
    if (match) {
      let password = match[1].replace(/\\134/g, '\\');
      return callback(undefined, password);
    }
    return callback(new Error('Password in invalid format'));
  });
}

/**
 * Set the password for a given key in the keychain.
 * Will overwrite password if the key already exists.
 *
 * @param {string} userName
 * @param {string} service
 * @param {string} description
 * @param {string} password
 * @param {function(err)} callback called on completion.
 */
export function set(userName, service, description, password, callback): void {
  let args = [
    'add-generic-password',
    '-a', userName,
    '-D', description,
    '-s', ensurePrefix(service),
    '-w', password,
    '-U'
  ];

  childProcess.execFile(securityPath, args, function (err, stdout, stderr): any {
    if (err) {
      return callback(new Error('Could not add password to keychain: ' + stderr));
    }
    return callback();
  });
}

/**
 * Remove the given account from the keychain
 *
 * @param {string} userName
 * @param {string} service
 * @param {string} description
 * @param {function (err)} callback called on completion
 */
export function remove(userName, service, description, callback): void {
  let args = ['delete-generic-password'];
  if (userName) {
    args = args.concat(['-a', userName]);
  }
  if (service) {
    args = args.concat(['-s', ensurePrefix(service)]);
  }
  if (description) {
    args = args.concat(['-D', description]);
  }

  childProcess.execFile(securityPath, args, function (err, stdout, stderr): any {
    if (err) {
      return callback(err);
    }
    return callback();
  });
}

_.extend(exports, {
  list: list,
  set: set,
  get: get,
  remove: remove,
  setPrefix: setPrefix
});
