var gulp = require('gulp');
var cproc = require('child_process');
var jeditor = require("gulp-json-editor");
var os = require('os');

// Sets a global environment variable
function setGlobalEnv(name, value) {
    var setCommand;
    var getCommand;
    if (os.platform() === 'win32') {
        setCommand = `SETX ${name} ${value}`;
        getCommand = `SET ${name}`;
    } else if (os.platform() === 'darwin') {
        setCommand =  `launchctl setenv ${name} ${value}`;
        getCommand =  `launchctl getenv ${name}`;
    } else {
        setCommand =  `export ${name}=${value}`;
        getCommand =  `export -n ${name}`;
    }
    console.log(setCommand);
    cproc.execSync(setCommand);
    var valueAfterSet = cproc.execSync(getCommand);
    console.log(`actual value: ${valueAfterSet}`);
}

// gulp.task('cover:enable', (done) => {
//     setGlobalEnv('SQLTOOLSCOVER', 'true');
//     done();
// });
// gulp.task('cover:disable', (done) => {
//     setGlobalEnv('SQLTOOLSCOVER', 'false');
//     done();
// });

gulp.task('cover:enable', () => {
    return gulp.src("./coverconfig.json")
    .pipe(jeditor(function(json) {
        json.enabled = true;
        return json; // must return JSON object.
    }))
    .pipe(gulp.dest("./out", {'overwrite':true}));
});
gulp.task('cover:disable', () => {
    return gulp.src("./coverconfig.json")
    .pipe(jeditor(function(json) {
        json.enabled = false;
        return json; // must return JSON object.
    }))
    .pipe(gulp.dest("./out", {'overwrite':true}));
});