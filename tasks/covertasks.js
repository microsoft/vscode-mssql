var gulp = require('gulp');
var del = require('del');
var istanbulReport = require('gulp-istanbul-report');
var remapIstanbul = require('remap-istanbul/lib/gulpRemapIstanbul');

gulp.task('cover:clean', function (done) {
	return del('coverage', done);
});

gulp.task('remap-coverage', function () {
	return gulp.src('./coverage/coverage.json')
		.pipe(remapIstanbul())
		.pipe(gulp.dest('coverage-remapped'));
});

gulp.task('cover:combine-json', () => {
	return gulp.src(['./coverage-remapped/coverage.json'])
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

// for running on the ADO build system
gulp.task('test:cover', gulp.series('cover:clean', 'test'));