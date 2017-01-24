"use strict"
var gulp = require('gulp');
var rename = require('gulp-rename');
var install = require('gulp-install');
var tslint = require('gulp-tslint');
var filter = require('gulp-filter');
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
var jeditor = require("gulp-json-editor");
var path = require('path');
var nls = require('vscode-nls-dev');

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
    let filterSrc = filter(['**/*.ts', '**/*.js'], {restore: true});
    let filterLocaleDef = filter(['**', '!**/controllers/*.json']);

    return gulp.src([
                config.paths.project.root + '/src/**/*.ts',
                config.paths.project.root + '/src/**/*.js',
                config.paths.project.root + '/typings/**/*.ts',
                config.paths.project.root + '/localization/i18n/**/*.json',
                '!' + config.paths.project.root + '/src/views/htmlcontent/**/*'])
                .pipe(srcmap.init())
                .pipe(filterSrc)
                .pipe(tsProject()).js
                .pipe(filterSrc.restore)
                .pipe(nls.rewriteLocalizeCalls())
                .pipe(filterLocaleDef)
                .pipe(nls.createAdditionalLanguageFiles(nls.coreLanguages, config.paths.project.root + '/localization/i18n'))
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

gulp.task('ext:compile-nls', (done) => {
    return gulp.src(config.paths.project.root + '/localization/i18n/**/*.json')
        .pipe(nls.createAdditionalLanguageFiles(nls.coreLanguages, config.paths.project.root + '/localization/i18n'));
});

gulp.task('ext:compile-tests', (done) => {
    return gulp.src([
                config.paths.project.root + '/test/**/*.ts',
                config.paths.project.root + '/typings/**/*.ts'])
                .pipe(srcmap.init())
                .pipe(tsProject())
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

gulp.task('ext:copy-nls', () => {
    return gulp.src(config.paths.project.root + '/localization/i18n/**/out/*.nls.json')
        .pipe(gulp.dest(config.paths.project.root + '/out/localization'))
});

// The version of applicationinsights the extension needs is 0.15.19 but the version vscode-telemetry dependns on is 0.15.6
// so we need to manually overwrite the version in package.json inside vscode-extension-telemetry module.
gulp.task('ext:appinsights-version', () => {
    return gulp.src("./node_modules/vscode-extension-telemetry/package.json")
    .pipe(jeditor(function(json) {
        json.dependencies.applicationinsights = "0.15.19";
        return json; // must return JSON object.
    }))
     .pipe(gulp.dest("./node_modules/vscode-extension-telemetry", {'overwrite':true}));
});

gulp.task('ext:copy-appinsights', () => {
    var filesToMove = [
        './node_modules/applicationinsights/**/*.*',
        './node_modules/applicationinsights/*.*'
    ];
    return gulp.src(filesToMove, { base: './' })
     .pipe(gulp.dest("./node_modules/vscode-extension-telemetry", {'overwrite':true}));
});

gulp.task('ext:copy', gulp.series('ext:copy-tests', 'ext:copy-js', 'ext:copy-config', 'ext:copy-nls'));

gulp.task('ext:build', gulp.series('ext:lint', 'ext:compile', 'ext:copy'));

gulp.task('ext:test', (done) => {
    let workspace = process.env['WORKSPACE'];
    process.env.JUNIT_REPORT_PATH = workspace + '/test-reports/ext_xunit.xml';
    cproc.exec(`code --extensionDevelopmentPath="${workspace}" --extensionTestsPath="${workspace}/out/test" --verbose`, (error, stdout, stderr) => {
        if (error) {
            console.error(`exec error: ${error}`);
            process.exit(1);
        }
        console.log(`stdout: ${stdout}`);
        console.log(`stderr: ${stderr}`);
        done();
    });
});

gulp.task('ext:localize', (done) => {
    return gulp.src(['./localization/package.nls.json'])
        .pipe(nlsDev.rewriteLocalizeCalls())
        .pipe(nlsDev.createAdditionalLanguageFiles(nlsDev.coreLanguages, 'i18n'/*, './out/localization/i18n'*/))
        .pipe(gulp.dest(config.paths.project.root + '/out/localization'));
});

gulp.task('test', gulp.series('html:test', 'ext:test'));

require('./tasks/covertasks');

gulp.task('clean', function (done) {
    return del('out', done);
});

gulp.task('add-i18n', function() {
	return gulp.src(['package.nls.json'])
		.pipe(nls.createAdditionalLanguageFiles(nls.coreLanguages, 'localization/i18n'))
		.pipe(gulp.dest('.'));
});

gulp.task('build', gulp.series('clean', 'html:build', 'ext:build', 'ext:install-service', 'ext:appinsights-version'));

gulp.task('install', function() {
    return gulp.src(['./package.json', './src/views/htmlcontent/package.json'])
                .pipe(install());
});

gulp.task('watch', function(){
    return gulp.watch(config.paths.project.root + '/src/**/*', gulp.series('build'))
});

gulp.task('nls-compile', function(done) {
	compileNls();
    done();
});

function compileNls() {
	let inlineMap = true;
    let inlineSource = false;

    let r = tsProject.src()
		.pipe(srcmap.init())
		.pipe(tsProject()).js
		.pipe(nls.rewriteLocalizeCalls())
		.pipe(nls.createAdditionalLanguageFiles(nls.coreLanguages, 'i18n', 'out'));

	if (inlineMap && inlineSource) {
		r = r.pipe(srcmap.write());
	} else {
		r = r.pipe(srcmap.write("../out", {
			// no inlined source
			includeContent: inlineSource,
			// Return relative source map root directories per file.
			sourceRoot: "../src"
		}));
	}

	return r.pipe(gulp.dest('out'));
}

gulp.task('nls-build', gulp.series('nls-compile', 'ext:copy-nls'));