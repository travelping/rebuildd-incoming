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

      case '.bz2':
        processPackages(inputDir, outputDir, currentPackages, emitter);
        break;

      default:
        console.log('unknown file type (ignored): ' + Path.extname(name));
    }
  }
}

function processPackages (inputDir, outputDir, packages, emitter) {
  for (var dsc in packages) {
    var pkgReady = packages[dsc].files.every(function (f) { return Path.existsSync(f.file) });
    if (pkgReady) {
      emitter.emit('package', packages[dsc]);
      delete packages[dsc];
    }
  }
}

function dscFileComponents (dir, file, callback) {
  FS.readFile(file, 'utf8', function (err, content) {
    if (err) throw err;
    
    var filename = Path.basename(file);
    filename.match(/^([^_]+)_(.*)\.dsc$/);
    var pkgObj = { files: [], deps: [], name: RegExp['$1'], filename: filename, version: RegExp['$2'] };
    var lines = content.split('\n');
    var inFileSection = false;

    lines.forEach(function (line) {
      if (line.match(/^Build-Depends: (.*)$/)) {
	    pkgObj.deps = RegExp['$1'].split(', ');
      }
      else if (line.match(/^Files: *$/)) {
	    inFileSection = true;
      }
      else if (inFileSection && line.match(/^ +[0-9a-f]{32} ([0-9]+) (.*) *$/)) {
        var size = parseInt(RegExp['$1']), name = RegExp['$2'];
        pkgObj.files.push({file: Path.join(dir, name), size: size});
      }
      else if (inFileSection && line.match('/^\S')) {
	    inFileSection = false;
      }
    });

    callback(pkgObj);
  });
}
