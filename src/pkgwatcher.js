var FS      = require('fs'),
    Path    = require('path'),
    Events  = require('events'),
    Inotify = require('inotify').Inotify;

var inotify = new Inotify();

/* returns an event emitter
 * watch inputDir for source packages
 * when a package is fully uploaded (all files specified in the dsc file
 * are present), move the files to outputDir and emit the 'package' event with
 * an object { name: ..., version: ..., files: [...] } as the argument
 */
exports.watchDir = function (inputDir, outputDir) {
  var emitter = new Events.EventEmitter;
  var watchDir = {
    path: inputDir,
    callback: function (evt) { handleFSEvent(evt, inputDir, outputDir, emitter); },
    watch_for: Inotify.IN_CLOSE_WRITE | Inotify.IN_MOVED_TO,
  };
  inotify.addWatch(watchDir);
  return emitter;
}

/* holds the dsc files that are currently being added */
var currentPackages = {};

function handleFSEvent (event, inputDir, outputDir, emitter) {
  var mask = event.mask;
  var name = event.name;
  var isDir = mask & Inotify.IN_ISDIR;

  if (!isDir) {
    var path = Path.join(inputDir, name);
    console.log('new file: ' + path);

    switch (Path.extname(name)) {
      case '.dsc':
	dscFileComponents(inputDir, path, function (comps) {
	  currentPackages[name] = comps;
          processPackages(inputDir, outputDir, currentPackages, emitter);
        });
	break;

      case '.gz':
	processPackages(inputDir, outputDir, currentPackages, emitter);
        break;

      default:
        console.log('unknown file type (ignored): ' + Path.extname(name));
    }
  }
}

function processPackages (inputDir, outputDir, packages, emitter) {
  completedPackages(inputDir, packages, function (complete) {
    complete.forEach(function (dsc) {
      // move package files
      var pkgFiles = [];
      dsc.files.forEach(function (f) {
        var newPath = Path.join(outputDir, Path.basename(f.file));
        FS.renameSync(f.file, newPath);
        pkgFiles.push(newPath);
      });

      // move the dsc file itself
      var newDscPath = Path.join(outputDir, dsc.name);
      FS.renameSync(Path.join(inputDir, dsc.name), newDscPath);
      pkgFiles.push(newDscPath);

      // announce the package
      emitter.emit('package', {
        packageName: dsc.packageName,
        version: dsc.version,
        files: pkgFiles
      });
    });
  });
}

function completedPackages (dir, packages, callback) {
  var ready = [];
  for (var dsc in packages) {
    var pkgReady = packages[dsc].files.every(function (f) { return Path.existsSync(f.file) });
    if (pkgReady) {
      packages[dsc]['name'] = dsc;
      ready.push(packages[dsc]);
      delete packages[dsc];
    }
  }
  callback(ready);
}

function dscFileComponents (dir, file, callback) {
  FS.readFile(file, 'utf8', function (err, content) {
    if (err) throw err;

    Path.basename(file).match(/^([^_]+)_(.*)\.dsc$/);
    var pkgObj = { files: [], packageName: RegExp['$1'], version: RegExp['$2'] };
    var lines = content.split('\n');
    var inFileSection = false;

    lines.forEach(function (line) {
      if (line.match(/^Files: *$/)) {
	inFileSection = true;
      }
      if (inFileSection && line.match(/^ +[0-9a-f]{32} ([0-9]+) (.*) *$/)) {
        var size = parseInt(RegExp['$1']), name = RegExp['$2'];
        pkgObj.files.push({file: Path.join(dir, name), size: size});
      }
      if (inFileSection && line.match('/^\S')) {
	inFileSection = false;
      }
    });

    callback(pkgObj);
  });
}
