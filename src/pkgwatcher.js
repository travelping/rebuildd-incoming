var FS      = require('fs'),
    Path    = require('path'),
    Events  = require('events');

/* returns an event emitter
 * watch inputDir for source packages
 * when a package is fully uploaded (all files specified in the dsc file
 * are present), move the files to outputDir and emit the 'package' event with
 * an object { name: ..., version: ..., files: [...] } as the argument
 */
exports.watchDir = function (inputDir) {
  var emitter = new Events.EventEmitter;
  FS.watch(inputDir, function(evt, name) {
    if(name && evt == "change")
      handleFSEvent(inputDir, name, emitter);
  });
  return emitter;
}

/* holds the dsc files that are currently being added */
var currentPackages = {};

function handleFSEvent (inputDir, name, emitter) {
  var path = Path.join(inputDir, name);
  var stat = FS.statSync(path);
  if(!stat.isDirectory()) {
    console.log('new file: ' + path);

    switch (Path.extname(name)) {
      case '.dsc':
	    dscFileComponents(path, function (err, comps) {
          if(err) console.log(err.message);
	      currentPackages[name] = comps;
          processPackages(inputDir, currentPackages, emitter);
        });
        break;

      case '.gz':
        processPackages(inputDir, currentPackages, emitter);
        break;

      case '.bz2':
        processPackages(inputDir, currentPackages, emitter);
        break;

      default:
        console.log('unknown file type (ignored): ' + Path.extname(name));
    }
  }
}

function processPackages (inputDir, packages, emitter) {
  for (var dsc in packages) {
    var pkgReady = packages[dsc].files.every(function (f) {
      return Path.existsSync(Path.join(inputDir, f.file))
    });
    if (pkgReady) {
      emitter.emit('package', packages[dsc]);
      delete packages[dsc];
    }
  }
}

function dscFileComponents (file, callback) {
  FS.readFile(file, 'utf8', function (err, content) {
    if(err) {
      callback(err, undefined);
      return;
    }
    
    var filename = Path.basename(file);
    filename.match(/^([^_]+)_(.*)\.dsc$/);
    var pkgObj = { files: [], deps: [], bins: [], name: RegExp['$1'], filename: filename, version: RegExp['$2'] };
    var lines = content.split('\n');
    var inFileSection = false;

    lines.forEach(function (line) {
      if (line.match(/^Build-Depends: (.*)$/)) {
	    pkgObj.deps = RegExp['$1'];
      }
      else if (line.match(/^Binary: (.*)$/)) {
	    pkgObj.bins = RegExp['$1'].split(', ');
      }
      else if (line.match(/^Files: *$/)) {
	    inFileSection = true;
      }
      else if (inFileSection && line.match(/^ +[0-9a-f]{32} ([0-9]+) (.*) *$/)) {
        var size = parseInt(RegExp['$1']), name = RegExp['$2'];
        pkgObj.files.push({file: name, size: size});
      }
      else if (inFileSection && line.match('/^\S')) {
	    inFileSection = false;
      }
    });
    
    callback(undefined, pkgObj);
  });
}

exports.analyzeDSC = function (file, callback) {
  dscFileComponents (file, callback);
}
