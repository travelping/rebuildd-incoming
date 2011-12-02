var Nopt = require('nopt'),
    Path = require('path'),
    Cp = require('child_process'),
    PkgWatcher = require(__dirname + '/pkgwatcher.js'),
    Rebuildd = require(__dirname + '/rebuildd.js'),
    Builder = require(__dirname + '/builder.js'),
    Repo = require(__dirname + '/repo.js'),
    CLI = require(__dirname + '/cli.js');

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
  'repo-dir': Path,
  'tmp-repo-dir': Path,
  'incoming-script': Path,
  'rbhost': String,
  'whost': String,
  'rbport': 'PosInteger',
  'wport': 'PosInteger',
  'priority': ['high', 'low'],
  'dists': String,
  'arch': String,
  'queue': Boolean,
  'help': Boolean
};
var shortcuts = { 'h': ['--help'] };

var builder;
var readyList = [], processList = [];

var inputDir;

exports.main = function () {
  var options = Nopt(options, {}, process.argv, 2),
      rbhost = options['rbhost'] || '127.0.0.1',
      rbport = options['rbport'] || '9999',
      chost = options['chost'] || '127.0.0.1',
      cport = options['cport'] || '9997',
      outputDir = options['output-dir'] && Path.resolve(options['output-dir']),
      repoDir = options['repo-dir'] || '',
      tmpRepoDir = options['tmp-repo-dir'] || '',
      arch = options['arch'] || 'amd64',
      priority = options['priority'] || 'high',
      incomingScript = options['incoming-script'] || '';

  inputDir = (options['input-dir'] && Path.resolve(options['input-dir'])) || Path.resolve('.');

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
  
  if (!Path.existsSync(incomingScript)) {
    console.log('Error: Incoming script ' + incomingScript + ' does not exist.');
    process.exit(1);
  }
  
  if(!Path.existsSync(repoDir)) {
    console.log('Error: Repository Directory ' + repoDir + ' does not exist.');
    process.exit(1);
  }

  if(!Path.existsSync(tmpRepoDir)) {
    console.log('Error: Tmp Repository Directory ' + tmpRepoDir + ' does not exist.');
    process.exit(1);
  }
  
  if (!options['dists']) {
    console.log('Error: --dists is required');
    usage(1);
  }
  
  dists = options.dists.split(' ');
  console.log('Distributions:', dists);
  
  /* If we're still alive, options should be correct' */
  
  console.log('Connecting to rebuildd:', rbhost + ':' + rbport);
  var rebuildd = new Rebuildd.Server(rbhost, rbport);
  
  console.log('Starting cli:', chost + ':' + cport);
  new CLI.Server(chost, cport, cli);
  
  console.log('Watching Directory:', inputDir);
  PkgWatcher.watchDir(inputDir, outputDir).on('package', function(pkg) {
    pkg.newpkg = true;
    readyList.push(pkg);
  });
  
  var tmprepo = new Repo.Manager('tmp', tmpRepoDir, dists, arch, incomingScript);
  var repo = new Repo.Manager('main', repoDir, dists, arch, incomingScript);
  
  builder = new Builder.Builder(priority, rebuildd, tmprepo, repo, inputDir, outputDir);
  
  console.log('Clearing tmp repositories');
  tmprepo.clean(dists);
  
}

function cli(data, callback) {
  var waitprompt = false;
  var cmd = data.slice(0,-1).split(' ');
  switch(cmd[0]) {
    case "done":
      builder.processBatch(cmd[1], cmd[2], cmd[3]);
      return;
    case "list":
      readyList.forEach(function(pkg) {
        callback(pkg.name + ' ' + pkg.version + '\n');
      });
      break;
    case "select":
      switch(cmd[1]) {
        case "pkg":
          readyList = readyList.filter(function(pkg) {
            var regexp = new RegExp(cmd[2]);
            if(pkg.name.search(regexp) != -1) {
              processList.push(pkg);
              callback(pkg.name + ' added\n');
              return false;
            }
            return true;
          });
          break;
        case "all":
          readyList.forEach(function(pkg) {
            processList.push(pkg);
            callback(pkg.name + ' added\n');
          });
          readyList = [];
          break;
        case "list":
          processList.forEach(function(pkg) {
            callback(pkg.name + ' ' + pkg.version + '\n');
          });
          break;
        case "clear":
          processList.forEach(function(pkg) {
            readyList.push(pkg);
          });
          processList = [];
          callback('select list cleared\n');
          break;
        default:
          callback('invalid parameter\n');
      }
      break;
    case "start":
      var dep, valid = true;
      switch(cmd[1]) {
        case "nodep":   dep = 0; break;
        case "dep":     dep = 1; break;
        case "rebuild": dep = 2; break
        default:
          callback('invalid parameter\n');
          valid = false;
      }
      if(!valid) break;
      var build_dists = [];
      valid = false;
      switch(cmd[2]) {
        case undefined:
          break;
        case "all":
          build_dists = dists;
          valid = true;
          break;
        default:
          cmd[2].split(',').every(function(ndist) {
            dists.forEach(function(dist) {
              if(dist == ndist) valid = true;
            });
            if(!valid) return false;
            build_dists.push(ndist);
            return true;
          });
      }
      if(!valid) {
        callback('invalid parameter\n');
        break;
      }
      waitprompt = true;
      builder.init(dep, build_dists, processList, function(ret, error) {
        switch(ret) {
          case 0: callback('ok: batch started\n'); break;
          case 1: callback('failed: batch in process\n'); break;
          case 2: callback('failed: error during batch setup\n');
                  callback(error.message+'\n'); break;
          case 3: callback('failed: error during moving package files\n');
                  callback(error.message+'\n'); break;
        }
        processList = [];
        callback('> ');
      });
      break;
    case "deps":
      waitprompt = true;
      builder.getBuildList(3, dists[0], processList, function(error, list) {
        if(error) {
          callback('error during dependency generation\n'+error.message+'\n');
        } else {
          list.forEach(function(pkg) {
            if(pkg.newpkg) callback(' new: ');
            else callback('repo: ');
            callback(pkg.name+' [');
            if(pkg.depssave.length > 0) {
              if(pkg.depssave[0].name) callback(pkg.depssave[0].name+' ('+pkg.depssave[0].op+' '+pkg.depssave[0].version+')');
              else callback(pkg.depssave[0]);
              pkg.depssave.slice(1).forEach(function(dep) {
                if(dep.name) callback(', '+dep.name+' ('+dep.op+' '+dep.version+')');
                else callback(', '+dep);
              });
            }
            callback(']\n');
          });
        }
        callback('> ');
      });
      break;
    case "reset":
      readyList = [];
      processList = [];
      builder.reset();
      Cp.exec('touch '+inputDir+'/*', function (error, stdout, stderr) {});
      break;
    case "status":
      builder.getDists().forEach(function(dist) {
        callback(dist+': ');
        switch(builder.getStatus(dist)) {
          case 0: callback('Build ready'); break;
          case 1: callback('Build in process'); break;
          case 2: callback('Build done'); break;
        }
        callback(', '+builder.getQueue(dist).length+' in queue\n');
      });
      break;
    case "help":
      callback('done <dist> <status>              - internal cmd\n');
      callback('list                              - list ready packages\n');
      callback('select pkg <name>                 - select package\n');
      callback('       all                        - select all packages\n');
      callback('       list                       - list selected packages\n');
      callback('       clear                      - clear selected packages\n');
      callback('start nodep   all|<dist[,dist..]> - just build\n');
      callback('      dep     all|<dist[,dist..]> - build in right order\n');
      callback('      rebuild all|<dist[,dist..]> - build new and rebuild paternal\n');
      callback('deps                              - list packages to be rebuild\n');
      callback('reset                             - clears queues, unlocks, rereads incoming dir\n');
      callback('status                            - status about current batches\n');
      break;
    default:
      callback('invalid cmd\n');
  }
  if(!waitprompt) callback('> ');
}

function usage(exitStatus) {
  console.log('Usage: rebuildd-incoming <options>');
  console.log('Options:');
  console.log('  --dists <Distributions>    -- (required) space-separated list of distributions');
  console.log('  --output-dir <OutDir>      -- (required) move uploaded packages to <OutDir>');
  console.log('  --input-dir <Directory>    -- (required) watch for packages in <Directory> (defaults to the current directory)');
  console.log('  --repo-dir <Directory>     -- (required) check repository for dependencies');
  console.log('  --incoming-script <Path>   -- (required) script for inserting new packages into repository');
  console.log('  --tmp-repo-dir <Directory> -- temporary repository during dependency build');
  console.log('  --arch <Directory>         -- architecture to check with dependency check (defaults to amd64)');
  console.log('  --rbhost <Host>            -- connect to rebuildd on <Host> (defaults to 127.0.0.1)');
  console.log('  --rbport <Port>            -- assume rebuildd is listening on <Port> (defaults to 9999)');
  console.log('  --chost <Host>             -- start CLI on <Host> (defaults to 127.0.0.1)');
  console.log('  --cport <Port>             -- let CLI listen on <Port> (defaults to 9997)');
  console.log('  --priority (high | low)    -- if specified, enqueue packages with the given priority (defaults to high)');
  console.log('  --queue                    -- if true, packages are submitted to the rebuildd queue (defaults to false)');
  console.log('  --rebuild                  -- if true, packages which depend on this on are rebuild (defaults to false)');
  console.log('  --help, -h                 -- show usage');
  process.exit(exitStatus);
}
