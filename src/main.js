var Nopt = require('nopt'),
    Path = require('path'),
    PkgWatcher = require(__dirname + '/pkgwatcher.js'),
    Rebuildd = require(__dirname + '/rebuildd.js');

var knownOptions = { 'input-dir': Path,
                     'output-dir': Path,
                     'dists': String,
                     'dont-queue': Boolean,
                     'help': Boolean
                   };
var shortcuts = { 'h': ['--help'] };

exports.main = function () {
  var options = Nopt(options, {}, process.argv, 2),
      inputDir = (options['input-dir'] && Path.resolve(options['input-dir'])) || Path.resolve('.'),
      outputDir = options['output-dir'] && Path.resolve(options['output-dir']),
      dists = [];

  if (options.help) {
    usage(0);
  }

  if (!outputDir) {
    console.log('Error: No output directory specified');
    usage(1);
  } else {
    if (outputDir == inputDir) {
      console.log('Error: You cannot use the same directory for input and output');
      usage(1);
    }
  }

  if (!options['dists']) {
    console.log('Error: --dists is required');
    usage(1);
  }

  if (options.dists == '') {
    console.log('Error: Argument to --dists must not be empty');
    usage(1);
  } else {
    dists = options.dists.split(' ');
    console.log('Distributions: ', dists);
  }

  if (!Path.existsSync(inputDir)) {
    console.log('Error: Input Directory ' + inputDir + ' does not exist.');
    process.exit(1);
  }

  if (!Path.existsSync(outputDir)) {
    console.log('Error: Output Directory ' + outputDir + ' does not exist.');
    process.exit(1);
  }

  /* If we're still alive, options should be correct' */
  console.log('Watching Directory: ' + inputDir);
  watcher = PkgWatcher.watchDir(inputDir, outputDir);
  watcher.on('package', function (pkg) {
    var pkgstr = pkg.packageName + ' ' + pkg.version;
    if (options['dont-queue']) {
      console.log('Would\'ve queued package ' + pkgstr);
    } else {
      Rebuildd.queuePackage(pkg.packageName, pkg.version, dists, function (error, code) {
        if (error) {
	  console.log('Error (' + code + ') queueing package: ' + pkgstr);
        } else {
          console.log('Queued package: ' + pkgstr);
        }
      });
    }
  });
}

function usage(exitStatus) {
  console.log('Usage: rebuildd-incoming <options>');
  console.log('Options:');
  console.log('  --dists <Distributions>  -- (required) space-separated list of distributions');
  console.log('  --output-dir <OutDir>    -- (required) move uploaded packages to <OutDir>');
  console.log('  --input-dir <Directory>  -- watch for packages in <Directory> (defaults to cwd)');
  console.log('  --dont-queue             -- don\'t submit to rebuildd, just print');
  console.log('  --help, -h               -- show usage');
  process.exit(exitStatus);
}
