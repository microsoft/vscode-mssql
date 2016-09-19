var gulp = require('gulp');
var rename = require('gulp-rename');
var install = require('gulp-install');
var tslint = require('gulp-tslint');
var ts = require('gulp-typescript');
var tsProject = ts.createProject('tsconfig.json');
var del = require('del');
var srcmap = require('gulp-sourcemaps');
var config = require('./tasks/config');
var request = require('request');
var fs = require('fs');
var gutil = require('gulp-util');
var through = require('through2');
var cproc = require('child_process');
var os = require('os');
const path = require('path');

require('./tasks/htmltasks')
require('./tasks/packagetasks')

gulp.task('ext:lint', () => {
    return gulp.src([
        config.paths.project.root + '/src/**/*.ts',
        '!' + config.paths.project.root + '/src/views/htmlcontent/**/*',
        config.paths.project.root + '/test/**/*.ts'
    ])
    .pipe((tslint({
        formatter: "verbose"
    })))
    .pipe(tslint.report());
});

gulp.task('ext:compile-src', (done) => {
    return gulp.src([
                config.paths.project.root + '/src/**/*.ts',
                config.paths.project.root + '/src/**/*.js',
                config.paths.project.root + '/typings/**/*.ts',
                '!' + config.paths.project.root + '/src/views/htmlcontent/**/*'])
                .pipe(srcmap.init())
                .pipe(ts(tsProject))
                .on('error', function() {
                    if (process.env.BUILDMACHINE) {
                        done('Extension Tests failed to build. See Above.');
                        process.exit(1);
                    }
                })
                .pipe(srcmap.write('.', {
                   sourceRoot: function(file){ return file.cwd + '/src'; }
                }))
                .pipe(gulp.dest('out/src/'));
});

gulp.task('ext:compile-tests', (done) => {
    return gulp.src([
                config.paths.project.root + '/test/**/*.ts',
                config.paths.project.root + '/typings/**/*.ts'])
                .pipe(srcmap.init())
                .pipe(ts(tsProject))
                .on('error', function() {
                    if (process.env.BUILDMACHINE) {
                        done('Extension Tests failed to build. See Above.');
                        process.exit(1);
                    }
                })
                .pipe(srcmap.write('.', {
                   sourceRoot: function(file){ return file.cwd + '/test'; }
                }))
                .pipe(gulp.dest('out/test/'));

});

gulp.task('ext:compile', gulp.series('ext:compile-src', 'ext:compile-tests'));

gulp.task('ext:copy-tests', () => {
    return gulp.src(config.paths.project.root + '/test/resources/**/*')
            .pipe(gulp.dest(config.paths.project.root + '/out/test/resources/'))
});

gulp.task('ext:copy-config', () => {
    var env = process.env.VsMsSqlEnv;
    env = env == undefined ? "dev" : env;
    return gulp.src(config.paths.project.root + '/src/configurations/' + env + '.config.json')
            .pipe(rename('config.json'))
            .pipe(gulp.dest(config.paths.project.root + '/out/src'));
});

gulp.task('ext:copy-js', () => {
    return gulp.src([
            config.paths.project.root + '/src/**/*.js',
            '!' + config.paths.project.root + '/src/views/htmlcontent/**/*'])
        .pipe(gulp.dest(config.paths.project.root + '/out/src'))
});

gulp.task('ext:copy', gulp.series('ext:copy-tests', 'ext:copy-js', 'ext:copy-config'));

gulp.task('ext:build', gulp.series('ext:lint', 'ext:compile', 'ext:copy'));

gulp.task('clean', function (done) {
    return del('out', done);
});

gulp.task('build', gulp.series('clean', 'html:build', 'ext:build', 'ext:install-service'));

gulp.task('install', function(){
    return gulp.src(['./package.json', './src/views/htmlcontent/package.json'])
                .pipe(install());
});

gulp.task('watch', function(){
    return gulp.watch(config.paths.project.root + '/src/**/*', gulp.series('build'))
});
