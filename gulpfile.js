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
var clean = require('gulp-clean');

require('./tasks/htmltasks')

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

gulp.task('ext:install-service', () => {
    return installSqlToolsService();
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

function installSqlToolsService(platform) {
   var install = require('./out/src/languageservice/serviceInstallerUtil');
   return install.installService(platform);
}

function doPackageSync(packageName) {

    var vsceArgs = [];
    vsceArgs.push('vsce');
    vsceArgs.push('package'); // package command

    if (packageName !== undefined) {
        vsceArgs.push('-o');
        vsceArgs.push(packageName);
    }
    var command = vsceArgs.join(' ');
    console.log(command);
    return cproc.execSync(command);
}

function cleanServiceInstallFolder() {
    var install = require('./out/src/languageservice/serviceInstallerUtil');
    var serviceInstallFolder = install.getServiceInstallDirectoryRoot();
    console.log('Deleting Service Install folder: ' + serviceInstallFolder);
    return del(serviceInstallFolder + '/*');
}

function doOfflinePackage(runtimeId, platform, packageName) {
    return installSqlToolsService(platform).then(() => {
       return doPackageSync(packageName + '-' + runtimeId + '.vsix');
    });
}

//Install vsce to be able to run this task: npm install -g vsce
gulp.task('package:online', function (done) {
    return cleanServiceInstallFolder().then(() => {
         doPackageSync();
         done();
    });
});

//Install vsce to be able to run this task: npm install -g vsce
gulp.task('package:offline', () => {
    const platform = require('./out/src/models/platform');
    const Platform = platform.Platform;
    var json = JSON.parse(fs.readFileSync('package.json'));
    var name = json.name;
    var version = json.version;
    var packageName = name + '.' + version;

    var packages = [];
    packages.push({rid: 'win7-x64', platform: Platform.Windows});
    packages.push({rid: 'osx.10.11-x64', platform: Platform.OSX});
    packages.push({rid: 'centos.7-x64', platform: Platform.CentOS});
    packages.push({rid: 'debian.8-x64', platform: Platform.Debian});
    packages.push({rid: 'fedora.23-x64', platform: Platform.Fedora});
    packages.push({rid: 'opensuse.13.2-x64', platform:Platform.OpenSUSE});
    packages.push({rid: 'rhel.7.2-x64', platform: Platform.RHEL});
    packages.push({rid: 'ubuntu.14.04-x64', platform: Platform.Ubuntu14});
    packages.push({rid: 'ubuntu.16.04-x64', platform:  Platform.Ubuntu16});

    var promise = Promise.resolve();
    cleanServiceInstallFolder().then(() => {
            packages.forEach(data => {
              promise = promise.then(() => {
                 return doOfflinePackage(data.rid, data.platform, packageName).then(() => {
                        return cleanServiceInstallFolder();
                 });
              });
        });
    });

    return promise;
});

gulp.task('watch', function(){
    return gulp.watch(config.paths.project.root + '/src/**/*', gulp.series('build'))
});
