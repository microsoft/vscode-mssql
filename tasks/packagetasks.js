var gulp = require('gulp');
var fs = require('fs');
var gutil = require('gulp-util');
var cproc = require('child_process');
var os = require('os');
var del = require('del');
const path = require('path');

function installSqlToolsService(platform) {
   var install = require('../out/src/languageservice/serviceInstallerUtil');
   return install.installService(platform);
}

gulp.task('ext:install-service', () => {
    return installSqlToolsService();
});

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
    var install = require('../out/src/languageservice/serviceInstallerUtil');
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
    const platform = require('../out/src/models/platform');
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