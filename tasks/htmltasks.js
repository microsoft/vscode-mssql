'use strict';
var gulp = require('gulp');
var gulpTsLint = require('gulp-tslint');
var ts = require('gulp-typescript');
var concat = require('gulp-concat');
var del = require('del');
var srcmap = require('gulp-sourcemaps');
var config = require('./config');
var uglifyjs = require('uglify-js');
var minifier = require('gulp-uglify/minifier');
var tsProject = ts.createProject(config.paths.html.root + '/tsconfig.json');
var sysBuilder = require('systemjs-builder');
var cleanCSS = require('gulp-clean-css');
var argv = require('yargs').argv;
var Server = require('karma').Server;
var tslint = require('tslint');

var min = (argv.min === undefined) ? false : true;

gulp.task('html:lint', () => {
    // !! If updating this make sure to check if you need to update the TSA Scan task in ADO !!
    var program = tslint.Linter.createProgram(config.paths.html.root + '/tsconfig.json');
    return gulp.src([
        config.paths.html.root + '/src/**/*.ts',
        config.paths.html.root + '/test/**/*.ts'
    ])
    .pipe((gulpTsLint({
        program,
        formatter: "verbose",
        rulesDirectory: "node_modules/tslint-microsoft-contrib"
    })))
    .pipe(gulpTsLint.report())
});

// Compile TypeScript to JS
gulp.task('html:compile-src', () => {
  return gulp
    .src([config.paths.html.root + '/src/js/**/*.ts',
    config.paths.html.root + '/typings/**/*.d.ts',
    '!../../../../node_modules/@types/**/node_modules/**/index.d.ts'])
    .pipe(srcmap.init())
    .pipe(tsProject())
    .pipe(srcmap.write('.', {
        sourceRoot: function(file){ return file.cwd + '/src/views/htmlcontent'; }
    }))
    .pipe(gulp.dest(config.paths.html.out + '/dist/js'));
});

gulp.task('html:compile-test', () => {
  return gulp
    .src([config.paths.html.root + '/test/**/*.ts',
        config.paths.html.root + '/typings/**/*.d.ts'])
    .pipe(srcmap.init())
    .pipe(tsProject())
    .pipe(srcmap.write('.', {
        sourceRoot: function(file){ return file.cwd + '/src/views/htmlcontent'; }
    }))
    .pipe(gulp.dest(config.paths.html.out + '/test'));
});

// Generate systemjs-based builds
gulp.task('html:bundle:app', (done) => {
    if (min) {
        var builder = new sysBuilder('./out/src/views/htmlcontent', './src/views/htmlcontent/systemjs.config.js');
        return builder.buildStatic('app', './out/src/views/htmlcontent/dist/js/app.min.js')
            .then(function () {
            return del(['./out/src/views/htmlcontent/dist/js/**/*', '!' + './out/src/views/htmlcontent/dist/js/app.min.js']);
            })
            .catch(function(err) {
            console.error('>>> [systemjs-builder] Bundling failed'.bold.green, err);
            });
    } else {
        done();
    }
});

gulp.task('html:min-js', (done) => {
    if (min) {
        return gulp.src(config.paths.html.out + '/dist/js/app.min.js')
                .pipe(minifier({mangle: false}, uglifyjs))
                .pipe(gulp.dest(config.paths.html.out + '/dist/js'));
    } else {
        done();
    }
});

gulp.task('html:bundle:css', () => {
    return new Promise((resolve, reject) => {
        gulp.src([config.paths.html.out + '/dist/css/flexbox.css',
                config.paths.html.out + '/dist/css/styles.css'])
            .pipe(cleanCSS())
            .pipe(concat('styles.min.css'))
            .pipe(gulp.dest(config.paths.html.out + '/dist/css'))
            .on('end', resolve);
    }).then(() => {
        return del([config.paths.html.out + '/dist/css/flexbox.css',
                    config.paths.html.out + '/dist/css/styles.css']);
    });
});

// Copy and bundle dependencies into one file (vendor/vendors.js)
// system.config.js can also bundled for convenience
gulp.task('html:vendor', (done) => {
    gulp.src([config.paths.html.root + '/node_modules/rxjs/**/*'])
    .pipe(gulp.dest(config.paths.html.out + '/lib/js/rxjs'));

    gulp.src([config.paths.html.root + '/node_modules/angular-in-memory-web-api/**/*'])
        .pipe(gulp.dest(config.paths.html.out + '/lib/js/angular-in-memory-web-api'));

    // concatenate non-angular2 libs, shims & systemjs-config
    if (min) {
        gulp.src([
            config.paths.html.root + '/node_modules/slickgrid/lib/jquery-1.8.3.js',
            config.paths.html.root + '/node_modules/slickgrid/lib/jquery.event.drag-2.2.js',
            config.paths.html.root + '/node_modules/slickgrid/lib/jquery-ui-1.9.2.js',
            config.paths.html.root + '/node_modules/underscore/underscore-min.js',
            config.paths.html.root + '/node_modules/slickgrid/slick.core.js',
            config.paths.html.root + '/node_modules/slickgrid/slick.grid.js',
            config.paths.html.root + '/node_modules/slickgrid/slick.editors.js',
            config.paths.html.root + '/node_modules/core-js/client/shim.min.js',
            config.paths.html.root + '/node_modules/zone.js/dist/zone.js',
            config.paths.html.root + '/node_modules/rangy/lib/rangy-core.js',
            config.paths.html.root + '/node_modules/rangy/lib/rangy-textrange.js',
            config.paths.html.root + '/node_modules/reflect-metadata/Reflect.js',
            config.paths.html.root + '/node_modules/systemjs/dist/system.src.js',
            config.paths.html.root + '/systemjs.config.js'
        ])
            .pipe(concat('vendors.min.js'))
            .pipe(minifier({}, uglifyjs))
            .pipe(gulp.dest(config.paths.html.out + '/lib/js'));
    } else {
        gulp.src([
            config.paths.html.root + '/node_modules/slickgrid/lib/jquery-1.8.3.js',
            config.paths.html.root + '/node_modules/slickgrid/lib/jquery.event.drag-2.2.js',
            config.paths.html.root + '/node_modules/slickgrid/lib/jquery-ui-1.9.2.js',
            config.paths.html.root + '/node_modules/underscore/underscore-min.js',
            config.paths.html.root + '/node_modules/slickgrid/slick.core.js',
            config.paths.html.root + '/node_modules/slickgrid/slick.grid.js',
            config.paths.html.root + '/node_modules/slickgrid/slick.editors.js',
            config.paths.html.root + '/node_modules/core-js/client/shim.min.js',
            config.paths.html.root + '/node_modules/rangy/lib/rangy-core.js',
            config.paths.html.root + '/node_modules/rangy/lib/rangy-textrange.js',
            config.paths.html.root + '/node_modules/reflect-metadata/Reflect.js',
            config.paths.html.root + '/node_modules/systemjs/dist/system.src.js',
            config.paths.html.root + '/systemjs.config.extras.js',
            config.paths.html.root + '/systemjs.config.js'
        ])
            .pipe(gulp.dest(config.paths.html.out + '/lib/js'));

        gulp.src([config.paths.html.root + '/node_modules/zone.js/**/*'])
        .pipe(gulp.dest(config.paths.html.out + '/lib/js/zone.js'));
    }


    // copy source maps
    gulp.src([
        // config.paths.html.root + '/node_modules/es6-shim/es6-shim.map',
        config.paths.html.root + '/node_modules/reflect-metadata/Reflect.js.map',
        config.paths.html.root + '/node_modules/systemjs/dist/system-polyfills.js.map',
        config.paths.html.root + '/node_modules/systemjs-plugin-json/json.js'
    ]).pipe(gulp.dest(config.paths.html.out + '/lib/js'));

    gulp.src([
        config.paths.html.root + '/node_modules/angular2-slickgrid/components/css/SlickGrid.css',
        config.paths.html.root + '/node_modules/slickgrid/slick.grid.css'
    ]).pipe(gulp.dest(config.paths.html.out + '/lib/css'));

    gulp.src([
        config.paths.html.root + '/node_modules/angular2-slickgrid/index.js',
        config.paths.html.root + '/node_modules/angular2-slickgrid/components/**/*.js'
    ], { base: config.paths.html.root + '/node_modules/angular2-slickgrid' }).pipe(gulp.dest(config.paths.html.out + '/lib/js/angular2-slickgrid'));

    return gulp.src([config.paths.html.root + '/node_modules/@angular/**/*'])
        .pipe(gulp.dest(config.paths.html.out + '/lib/js/@angular'));
});

gulp.task('html:copy:assets', (done) => {
    let promises = [];
    promises.push(new Promise((resolve) => {
            gulp.src([
                        config.paths.html.root + '/src/html/*'
                    ])
                .pipe(gulp.dest(config.paths.html.out + '/dist/html'))
                .on('end', () => {
                    resolve();
                })
        })
    );

    promises.push(new Promise((resolve) => {
            gulp.src([
                    config.paths.html.root + '/src/css/**/*'
                ])
                .pipe(gulp.dest(config.paths.html.out + '/dist/css'))
                .on('end', () => {
                    resolve();
                })
        })
    );

    promises.push(new Promise((resolve) => {
            gulp.src([
                config.paths.html.root + '/src/images/*'
            ])
            .pipe(gulp.dest(config.paths.html.out + '/dist/images'))
            .on('end', () => {
                resolve();
            })
        })
    );

    promises.push(new Promise((resolve) => {
            gulp.src([
                config.paths.html.root + '/src/js/**/*.json',
            ])
            .pipe(gulp.dest(config.paths.html.out + '/dist/js'))
            .on('end', () => {
                resolve();
            })
        })
    );

    Promise.all(promises).then(() => done());
});

gulp.task('html:test', function (done) {
  new Server({
    configFile: __dirname + '/../karma.conf.js',
    singleRun: true
  }, done).start();
});

gulp.task('html:compile', gulp.series('html:compile-src', 'html:compile-test'));

gulp.task('html:app', gulp.series(['html:compile', 'html:copy:assets', 'html:bundle:app', 'html:min-js', 'html:bundle:css']));

gulp.task('html:bundle', (done) => {
    if (min) {
        return gulp.src([
            config.paths.html.out + '/lib/js/vendors.min.js',
            config.paths.html.out + '/dist/js/app.min.js'
            ])
        .pipe(concat('app.bundle.js'))
        .pipe(gulp.dest(config.paths.html.out + '/dist/js'));
    } else {
        done();
    }
});

gulp.task('html:build', gulp.series('html:lint', 'html:vendor', 'html:app', 'html:bundle'));
