var gulp = require('gulp');
var del = require('del');
var jeditor = require("gulp-json-editor");
var istanbulReport = require('gulp-istanbul-report');

gulp.task('cover:clean', function (done) {
	return del('coverage', done);
});

gulp.task('cover:enableconfig', () => {
	return gulp.src("./coverconfig.json")
		.pipe(jeditor(function (json) {
			json.enabled = true;
			return json; // must return JSON object.
		}))
		.pipe(gulp.dest("./out", { 'overwrite': true }));
});

gulp.task('cover:enable', gulp.series('cover:clean', 'cover:enableconfig'));

gulp.task('cover:disable', () => {
	return gulp.src("./coverconfig.json")
		.pipe(jeditor(function (json) {
			json.enabled = false;
			return json; // must return JSON object.
		}))
		.pipe(gulp.dest("./out", { 'overwrite': true }));
});

gulp.task('cover:combine-json', () => {
	return gulp.src(['./coverage/coverage.json'])
		.pipe(istanbulReport({
			reporterOpts: {
				dir: './coverage'
			},
			reporters: [
				{ 'name': 'lcovonly' }, // -> ./coverage/report.txt
				{ 'name': 'cobertura' } // -> ./jsonCov/cov.json
			]
		}));
});

gulp.task('cover:combine-html', () => {
	return gulp.src(['**/*.html'])
		.pipe(istanbulReport({
			reporterOpts: {
				dir: './coverage'
			},
			reporters: [
				{ 'name': 'html' }
			]
		}));
});

// for running on the jenkins build system
gulp.task('cover:jenkins', gulp.series('cover:clean', 'cover:enableconfig', 'test', 'cover:combine-json'));