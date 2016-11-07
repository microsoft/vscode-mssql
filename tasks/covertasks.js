var gulp = require('gulp');
var jeditor = require("gulp-json-editor");

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