// #docregion
const path = require('path');
const fs = require('fs');
var coverconfig;
if (fs.existsSync('./out/coverconfig.json')) {
  coverconfig = require('./out/coverconfig.json');
} else {
  coverconfig = false;
}

module.exports = function(config) {

  var appBase    = 'out/src/views/htmlcontent/dist/';       // transpiled app JS and map files
  var appSrcBase = 'src/views/htmlcontent/src/js/';       // app source TS files
  var appAssets  = 'base/out/src/views/htmlcontent/'; // component assets fetched by Angular's compiler

  var testBase    = 'out/src/views/htmlcontent/test/';       // transpiled test JS and map files
  var testSrcBase = 'src/views/htmlcontent/test/';       // test source TS files

  var configuration = {
    basePath: path.join(__dirname),
    frameworks: ['jasmine'],
    plugins: [
      require('karma-remap-istanbul'),
      require('karma-coverage'),
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'), // click "Debug" in browser to see it
      require('karma-junit-reporter')
    ],

    files: [
      'out/src/views/htmlcontent/lib/js/jquery-1.8.3.js',
      'out/src/views/htmlcontent/lib/js/jquery.event.drag-2.2.js',
      'out/src/views/htmlcontent/lib/js/jquery-ui-1.9.2.js',
      'out/src/views/htmlcontent/lib/js/underscore-min.js',
      'out/src/views/htmlcontent/lib/js/slick.core.js',
      'out/src/views/htmlcontent/lib/js/slick.grid.js',
      'out/src/views/htmlcontent/lib/js/slick.editors.js',
      'out/src/views/htmlcontent/dist/js/slick.autosizecolumn.js',
      'out/src/views/htmlcontent/dist/js/slick.dragrowselector.js',
      // System.js for module loading
      'out/src/views/htmlcontent/lib/js/system.src.js',

      // Polyfills
      'out/src/views/htmlcontent/lib/js/shim.min.js',
      'out/src/views/htmlcontent/lib/js/Reflect.js',

      // zone.js
      'out/src/views/htmlcontent/lib/js/zone.js/dist/zone.js',
      'out/src/views/htmlcontent/lib/js/zone.js/dist/long-stack-trace-zone.js',
      'out/src/views/htmlcontent/lib/js/zone.js/dist/proxy.js',
      'out/src/views/htmlcontent/lib/js/zone.js/dist/sync-test.js',
      'out/src/views/htmlcontent/lib/js/zone.js/dist/jasmine-patch.js',
      'out/src/views/htmlcontent/lib/js/zone.js/dist/async-test.js',
      'out/src/views/htmlcontent/lib/js/zone.js/dist/fake-async-test.js',

      // Rangy
      'out/src/views/htmlcontent/lib/js/rangy-core.js',
      'out/src/views/htmlcontent/lib/js/rangy-textrange.js',

      // RxJs
      { pattern: 'out/src/views/htmlcontent/lib/js/rxjs/**/*.js', included: false, watched: false },
      { pattern: 'out/src/views/htmlcontent/lib/js/rxjs/**/*.js.map', included: false, watched: false },


      { pattern: 'out/src/views/htmlcontent/lib/js/angular2-slickgrid/**/*.js', included: false, watched: false },
      { pattern: 'out/src/views/htmlcontent/lib/js/angular2-slickgrid/**/*.js.map', included: false, watched: false },

      { pattern: 'out/src/views/htmlcontent/lib/js/json.js', included: false, watched: false},

      // Paths loaded via module imports:
      // Angular itself
      { pattern: 'out/src/views/htmlcontent/lib/js/@angular/**/*.js', included: false, watched: false },
      { pattern: 'out/src/views/htmlcontent/lib/js/@angular/**/*.js.map', included: false, watched: false },

      { pattern: 'out/src/views/htmlcontent/lib/js/systemjs.config.js', included: false, watched: false },
      'karma-test-shim.js',

      // transpiled application & spec code paths loaded via module imports
      { pattern: appBase + '**/*.js', included: false, watched: true },
      { pattern: appBase + '**/*.json', included: false, watched: true },
      { pattern: testBase + '**/*.js', included: false, watched: true },


      // Asset (HTML & CSS) paths loaded via Angular's component compiler
      // (these paths need to be rewritten, see proxies section)
      { pattern: appBase + '**/*.html', included: false, watched: false },
      { pattern: appBase + '**/*.css', included: false, watched: false },

      // Paths for debugging with source maps in dev tools
      { pattern: appSrcBase + '**/*.ts', included: false, watched: false },
      { pattern: appBase + '**/*.js.map', included: false, watched: false },
      { pattern: testSrcBase + '**/*.ts', included: false, watched: false },
      { pattern: testBase + '**/*.js.map', included: false, watched: false }
    ],

    // Proxied base paths for loading assets
    proxies: {
      // required for component assets fetched by Angular's compiler
      "/dist/": 'base/out/src/views/htmlcontent/dist/',
      "/base/out/src/views/htmlcontent/src/": '/base/out/src/views/htmlcontent/dist/'
    },
    exclude: [],
    reporters: ['progress', 'junit'],
    customLaunchers: {
        Chrome_travis_ci: {
            base: 'Chrome',
            flags: ['--no-sandbox']
        }
    },
    junitReporter: {
      outputDir: __dirname + '/test-reports'
    },

    port: 9876,
    colors: true,
    logLevel: config.LOG_INFO,
    autoWatch: true,
    browsers: ['Chrome_travis_ci'],
    singleRun: true
  }

  if (coverconfig && coverconfig.enabled) {
    configuration.preprocessors = {
      'out/src/views/htmlcontent/dist/**/!(*spec)*.js': 'coverage'
    };
    configuration.reporters.push('coverage');
    configuration.reporters.push('karma-remap-istanbul')
    configuration.coverageReporter = {
      dir : 'coverage/',
      reporters: [
        {type: 'json'}
      ]
    };
    configuration.remapIstanbulReporter = {
      reports: {
        json: 'coverage/coverage-html.json',
        // uncomment below for html only coverage
        // html: 'coverage/htmlcoverage/'
      }
    }
  }

  if (process.env.TRAVIS) {
    configuration.browsers = ['Chrome_travis_ci'];
  }
  config.set(configuration);
}