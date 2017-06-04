const gulp = require("gulp");
const concat = require("gulp-concat");
const rename = require("gulp-rename");

gulp.task("build", function()
{
	return gulp.src
	([
		"src/audio.js",
		"src/pitch_detection.js",
		"src/visualization.js",
	])
		.pipe(concat("pitch_detection.js"))
		.pipe(gulp.dest("dist/"));
});
