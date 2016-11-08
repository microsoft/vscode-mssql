/**
 * System configuration for Angular 2 samples
 * Adjust as necessary for your application needs.
 */
(function(global) {
  var paths = {
    'npm:': 'lib/js/'
  }
  // map tells the System loader where to look for things
  var map = {
    'app':                        'dist/js', // 'dist',
    '@angular':                   'npm:@angular',
    'rxjs':                       'npm:rxjs',
    'json':                       'npm:json.js',
    'angular2-slickgrid':         'npm:angular2-slickgrid'
  };
  // packages tells the System loader how to load when no filename and/or no extension
  var packages = {
    'app':                        { main: 'main.js',  defaultExtension: 'js' },
    '':                           { main: 'constants.js', defaultExtension: 'js'},
    'rxjs':                       { main: 'Rx.js', defaultExtension: 'js' },
    'angular2-in-memory-web-api': { main: 'index.js', defaultExtension: 'js' },
    'angular2-slickgrid':         { main: 'index.js', defaultExtension: 'js'}
  };
  var ngPackageNames = [
    '@angular/common',
    '@angular/compiler',
    '@angular/core',
    '@angular/forms',
    '@angular/http',
    '@angular/platform-browser',
    '@angular/platform-browser-dynamic',
    '@angular/router',
    '@angular/testing',
    '@angular/upgrade'
  ];
  var meta = {
    '**/*.json' : {
      loader: 'json'
    }
  }
  // add package entries for angular packages in the form '@angular/common': { main: 'index.js', defaultExtension: 'js' }
  ngPackageNames.forEach(function(pkgName) {
    packages[pkgName] = { main: 'index.js', defaultExtension: 'js' };
  });
  var config = {
    paths: paths,
    map: map,
    packages: packages,
    meta: meta
  };
  System.config(config);
})(this);
