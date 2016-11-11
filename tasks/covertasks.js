var gulp = require('gulp');
var del = require('del');
var jeditor = require("gulp-json-editor");
var Server = require('karma').Server;
var istanbulReport = require('gulp-istanbul-report');

gulp.task('cover:clean', function (done) {
    return del('coverage', done);
});

gulp.task('cover:enableconfig',() => {
    return gulp.src("./coverconfig.json")
    .pipe(jeditor(function(json) {
        json.enabled = true;
        return json; // must return JSON object.
    }))
    .pipe(gulp.dest("./out", {'overwrite':true}));
});

gulp.task('cover:html', function (done) {
  new Server({
    configFile: __dirname + '/../karma.conf.js',
    singleRun: true
  }, done).start();
});

gulp.task('cover:enable', gulp.series('cover:clean', 'cover:html', 'cover:enableconfig'));

gulp.task('cover:disable', () => {
    return gulp.src("./coverconfig.json")
    .pipe(jeditor(function(json) {
        json.enabled = false;
        return json; // must return JSON object.
    }))
    .pipe(gulp.dest("./out", {'overwrite':true}));
});

gulp.task('cover:combine', () => {
    return gulp.src(['./coverage/coverage-final.json', './coverage/coverage-html.json'])
    .pipe(istanbulReport({
        reporterOpts: {
            dir: './coverage'
        },
        reporters: [
            {'name': 'lcov'}, // -> ./coverage/report.txt
            {'name': 'cobertura'} // -> ./jsonCov/cov.json
        ]
    }));
});