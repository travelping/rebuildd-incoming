var Nopt = require('nopt'),
    Path = require('path'),
    PkgWatcher = require(__dirname + '/pkgwatcher.js'),
    Rebuildd = require(__dirname + '/rebuildd.js');

Nopt.typeDefs['PosInteger'] = {
  type: 'PosInteger',
  validate: function (data, key, val) {
    var i = parseInt(val);
    if (i == Nan || i <= 0) {
      return false;
    } else {
      data[key] = i;
    }
  }
};

var knownOptions = {
  'input-dir': Path,
  'output-dir': Path,
  'host': String,
  'port': 'PosInteger',
  'priority': ['high', 'low'],
  'dists': String,
  'queue': Boolean,
  'help': Boolean
};
var shortcuts = { 'h': ['--help'] };

exports.main = function () {
  var options = Nopt(options, {}, process.argv, 2),
      inputDir = (options['input-dir'] && Path.resolve(options['input-dir'])) || Path.resolve('.'),
      outputDir = options['output-dir'] && Path.resolve(options['output-dir']),
      host = options['host'] || '127.0.0.1';
      port = options['port'] || '9999';
      priority = options['priority'] || 'high';
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

  if (!Path.existsSync(inputDir)) {
    console.log('Error: Input Directory ' + inputDir + ' does not exist.');
    process.exit(1);
  }

  if (!Path.existsSync(outputDir)) {
    console.log('Error: Output Directory ' + outputDir + ' does not exist.');
    process.exit(1);
  }

  if (!options['dists']) {
    console.log('Error: --dists is required');
    usage(1);
  } else {
    dists = options.dists.split(' ');
    console.log('Distributions: ', dists);
  }

  /* If we're still alive, options should be correct' */
  console.log('Watching Directory:', inputDir);
  var watcher = PkgWatcher.watchDir(inputDir, outputDir);

  console.log('Connecting to rebuildd:', host + ':' + port);
  var rebuildd = new Rebuildd.Server(host, port);

  watcher.on('package', function (pkg) {
    var pkgstr = pkg.packageName + ' ' + pkg.version;
    if (options['queue']) {
      rebuilddOpts = { priority: priority, distributions: dists };
      rebuildd.queuePackage(pkg.packageName, pkg.version, rebuilddOpts);
    } else {
      console.log('Would\'ve queued package ' + pkgstr);
    }
  });
}

function usage(exitStatus) {
  console.log('Usage: rebuildd-incoming <options>');
  console.log('Options:');
  console.log('  --dists <Distributions>  -- (required) space-separated list of distributions');
  console.log('  --output-dir <OutDir>    -- (required) move uploaded packages to <OutDir>');
  console.log('  --input-dir <Directory>  -- watch for packages in <Directory> (defaults to the current directory)');
  console.log('  --host <Host>            -- connect to rebuildd on <Host> (defaults to 127.0.0.1)');
  console.log('  --port <Port>            -- assume rebuildd is listening on <Port> (defaults to 9999)');
  console.log('  --priority (high | low)  -- if specified, enqueue packages with the given priority (defaults to high)');
  console.log('  --[no-]queue             -- if true, packages are submitted to the rebuildd queue (defaults to false)');
  console.log('  --help, -h               -- show usage');
  process.exit(exitStatus);
}
