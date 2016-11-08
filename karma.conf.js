// #docregion
module.exports = function(config) {

  var appBase    = 'out/src/views/htmlcontent/dist/';       // transpiled app JS and map files
  var appSrcBase = 'src/views/htmlcontent/src/js/';       // app source TS files
  var appAssets  = 'base/app/'; // component assets fetched by Angular's compiler

  var testBase    = 'out/test/angular/';       // transpiled test JS and map files
  var testSrcBase = 'test/angular/';       // test source TS files

  config.set({
    basePath: '',
    frameworks: ['mocha'],
    plugins: [
      require('karma-mocha'),
      require('karma-chrome-launcher'),
    ],

    customLaunchers: {
      // From the CLI. Not used here but interesting
      // chrome setup for travis CI using chromium
      Chrome_travis_ci: {
        base: 'Chrome',
        flags: ['--no-sandbox']
      }
    },
    files: [
      // System.js for module loading
      'out/src/views/htmlcontent/lib/js/vendors.min.js',

      // RxJs
      { pattern: 'out/src/views/htmlcontent/lib/js/rxjs/**/*.js', included: false, watched: false },
      { pattern: 'out/src/views/htmlcontent/lib/js/rxjs/**/*.js.map', included: false, watched: false },

      // Paths loaded via module imports:
      // Angular itself
      { pattern: 'out/src/views/htmlcontent/lib/js/@angular/**/*.js', included: false, watched: false },
      { pattern: 'out/src/views/htmlcontent/lib/js/@angular/**/*.js.map', included: false, watched: false },

      { pattern: 'systemjs.config.js', included: false, watched: false },
      { pattern: 'systemjs.config.extras.js', included: false, watched: false },
      'karma-test-shim.js',

      // transpiled application & spec code paths loaded via module imports
      { pattern: appBase + '**/*.js', included: false, watched: false },
      { pattern: testBase + '**/*.js', included: false, watched: false },


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
      "/app/": appAssets
    },

    exclude: [],
    preprocessors: {},
    // disabled HtmlReporter; suddenly crashing w/ strange socket error
    // reporters: ['progress', 'kjhtml'],//'html'],

    // HtmlReporter configuration
    htmlReporter: {
      // Open this file to see results in browser
      outputFile: '_test-output/tests.html',

      // Optional
      pageTitle: 'Unit Tests',
      subPageTitle: __dirname
    },

    port: 9876,
    colors: true,
    logLevel: config.LOG_INFO,
    autoWatch: true,
    browsers: ['Chrome'],
    singleRun: false
  })
}