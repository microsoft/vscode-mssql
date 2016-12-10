// #docregion
// /*global jasmine, __karma__, window*/
Error.stackTraceLimit = 0; // "No stacktrace"" is usually best for app testing.

// Uncomment to get full stacktrace output.
// Error.stackTraceLimit = Infinity; //

var builtPath = '/base/out/src/views/htmlcontent/dist/js/';

__karma__.loaded = function () { };

function isJsFile(path) {
  return path.slice(-3) == '.js';
}

function isSpecFile(path) {
  return /\.spec\.(.*\.)?js$/.test(path);
}

function isBuiltFile(path) {
  return isJsFile(path) && (path.substr(0, builtPath.length) == builtPath);
}

var allSpecFiles = Object.keys(window.__karma__.files)
  .filter(isSpecFile);

System.config({
  baseURL: 'base/out/src/views/htmlcontent',
  // Extend usual application package list with test folder
  packages: { 'testing': { main: 'index.js', defaultExtension: 'js' } },

  // Assume npm: is set in `paths` in systemjs.config
  // Map the angular testing umd bundles
  map: {
    '@angular/core/testing': 'lib/js/@angular/core/bundles/core-testing.umd.js',
    '@angular/common/testing': 'lib/js/@angular/common/bundles/common-testing.umd.js',
    '@angular/compiler/testing': 'lib/js/@angular/compiler/bundles/compiler-testing.umd.js',
    '@angular/platform-browser/testing': 'lib/js/@angular/platform-browser/bundles/platform-browser-testing.umd.js',
    '@angular/platform-browser-dynamic/testing': 'lib/js/@angular/platform-browser-dynamic/bundles/platform-browser-dynamic-testing.umd.js',
    '@angular/http/testing': 'lib/js/@angular/http/bundles/http-testing.umd.js',
    '@angular/router/testing': 'lib/js/@angular/router/bundles/router-testing.umd.js',
    '@angular/forms/testing': 'ib/js/@angular/forms/bundles/forms-testing.umd.js',
  },
});

System.import('lib/js/systemjs.config.js')
  .then(initTestBed)
  .then(initTesting);

function initTestBed(){
  return Promise.all([
    System.import('@angular/core/testing'),
    System.import('@angular/platform-browser-dynamic/testing')
  ])

  .then(function (providers) {
    var coreTesting    = providers[0];
    var browserTesting = providers[1];

    jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;

    coreTesting.TestBed.initTestEnvironment(
      browserTesting.BrowserDynamicTestingModule,
      browserTesting.platformBrowserDynamicTesting());
  })
}

// Import all spec files and start karma
function initTesting () {
  return Promise.all(
    allSpecFiles.map(function (moduleName) {
      return System.import(moduleName);
    })
  )
  .then(__karma__.start, __karma__.error);
}
