var PkgWatcher = require(__dirname + '/pkgwatcher.js'),
    Rebuildd   = require(__dirname + '/rebuildd.js'),
    Builder    = require(__dirname + '/builder.js'),
    Repo       = require(__dirname + '/repo.js'),
    CLI        = require(__dirname + '/cli.js'),
    As         = require('async'),
    Nopt       = require('nopt'),
    Path       = require('path'),
    Cp         = require('child_process'),
    Fs         = require('fs');

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
  'incoming-dir': Path,
  'working-dir': Path,
  'repo-dir': Path,
  'batch-dir': Path,
  'base-dir': Path,
  'link-dir': Path,
  'out-dir': Path,
  'repo-script': Path,
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

var dists;
var builder, repo;
var readyList = [], processList = [];

var incomingDir;

var modes = ['nodep', 'dep', 'rebuild'], distlen = 0;

exports.main = function () {
  var options = Nopt(options, {}, process.argv, 2),
      rbhost = options['rbhost'] || '127.0.0.1',
      rbport = options['rbport'] || '9999',
      chost = options['chost'] || '127.0.0.1',
      cport = options['cport'] || '9997',
      workingDir = options['working-dir'] && Path.resolve(options['working-dir']),
      repoDir = options['repo-dir'] || '',
      batchDir = options['batch-dir'] || '',
      baseDir = options['base-dir'] || '',
      linkDir = options['link-dir'] || '',
      outDir = options['out-dir'] || '',
      arch = options['arch'] || 'amd64',
      priority = options['priority'] || 'high',
      repoScript = options['repo-script'] || '';

  incomingDir = (options['incoming-dir'] && Path.resolve(options['incoming-dir'])) || Path.resolve('.');

  if (options.help) {
    usage(0);
  }

  if (!workingDir) {
    console.log('Error: No working directory specified');
    usage(1);
  } else {
    if (workingDir == incomingDir) {
      console.log('Error: You cannot use the same directory for incoming and working');
      usage(1);
    }
  }

  if (!Path.existsSync(incomingDir)) {
    console.log('Error: Incoming Directory ' + incomingDir + ' does not exist.');
    process.exit(1);
  }

  if (!Path.existsSync(workingDir)) {
    console.log('Error: Working Directory ' + workingDir + ' does not exist.');
    process.exit(1);
  }
  
  if (!Path.existsSync(repoScript)) {
    console.log('Error: Repo script ' + repoScript + ' does not exist.');
    process.exit(1);
  }
  
  if(!Path.existsSync(repoDir)) {
    console.log('Error: Repository Directory ' + repoDir + ' does not exist.');
    process.exit(1);
  }

  if(!Path.existsSync(batchDir)) {
    console.log('Error: Batch Directory ' + batchDir + ' does not exist.');
    process.exit(1);
  }
  
  if(!Path.existsSync(baseDir)) {
    console.log('Error: Base Directory ' + baseDir + ' does not exist.');
    process.exit(1);
  }
  
  if(!Path.existsSync(linkDir)) {
    console.log('Error: Repo link Directory ' + linkDir + ' does not exist.');
    process.exit(1);
  }
  
  if(!Path.existsSync(outDir)) {
    console.log('Error: Rebuildd out Directory ' + outDir + ' does not exist.');
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
  
  console.log('Watching Directory:', incomingDir);
  PkgWatcher.watchDir(incomingDir).on('package', function(pkg) {
    if(readyList.every(function(p) { return p.name != pkg.name; })) {
      pkg.newpkg = true;
      readyList.push(pkg);
    }
  });
  
  var repo = [];
  dists.forEach(function(dist) {
    var dir = Path.join(repoDir, dist);
    repo[dist] = new Repo.Manager('main', dir, dist, arch, repoScript);
    if(dist.length > distlen) distlen = dist.length;
  });
  distlen++;
  
  builder = new Builder.Builder(incomingDir, workingDir, batchDir, baseDir, linkDir, outDir,
    repoScript, arch, repo, rebuildd, priority);
  
  builder.recover(function(err) {
    if(err) {
      console.log('Error: Failed to read batches.');
      console.log(err.message);
      process.exit(1);
    }
  });
  
}

function cli(data, callback) {
  var waitprompt = false;
  var cmd = data.slice(0,-1).split(' ');
  switch(cmd[0]) {
    case "done":
      builder.processBatch(cmd[1], cmd[2]);
      return;
    case "list":
      var showPkg = function(pkg, info) {
        callback(pkg.name + ' ' + pkg.version + ' [');
        if(pkg.bins.length > 0) {
          callback(pkg.bins[0]);
          pkg.bins.slice(1).forEach(function(bin) {
            callback(', ' + bin);
          });
        }
        callback('] '+info+'\n');
      }
      if(cmd[1] == undefined) readyList.forEach(function(pkg) { showPkg(pkg, ''); });
      else {
        var batch = undefined;
        builder.getBatch().every(function(b) {
            if(b.id == cmd[1]) {
            batch = b;
            return false;
            }
            return true;
        });
        if(!batch) callback({message: 'No batch with ID '+cmd[1]});
        else {
          batch.done.forEach(function(pkg) {
            if(pkg == batch.pkg) showPkg(pkg, batch.status);
            else showPkg(pkg, 'done');
          });
          batch.list.forEach(function(pkg) { showPkg(pkg, 'todo'); });
        }
      }
      break;
    case "select":
      switch(cmd[1]) {
        case "pkg":
          readyList = readyList.filter(function(pkg) {
            var regexp = new RegExp(cmd[2]);
            if(pkg.name.search(regexp) != -1) {
              processList.push(pkg);
              callback(pkg.name + ' ' + pkg.version + ' added\n');
              return false;
            }
            return true;
          });
          break;
        case "all":
          readyList.forEach(function(pkg) {
            processList.push(pkg);
            callback(pkg.name + ' ' + pkg.version + ' added\n');
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
        case "rebuild": // dep = 2; break
          callback('not implemented\n');
          valid = false;
          break;
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
      error = undefined;
      var packet = builder.getPacketNum();
      As.forEachSeries(build_dists, function(dist, callback1) {
        builder.init(dist, dep, processList, packet, function(err) {
          parseRet(err, dist+': ', callback);
          error = err;
          callback1(undefined);
        });
      }, function(bla) {
        if(!error) {
          builder.cleanIncoming(processList, function(err) {
            if(err) {
              callback('warning: failed to clean incoming\n');
              callback(err.message+'\n');
            }
          });
          processList = [];
        }
        callback('> ');
      });
      break;
    case "continue":
      if(cmd[1] == undefined) {
        callback('invalid parameter\n');
        break;
      }
      waitprompt = true;
      var ids = [];
      cmd[1].split(',').forEach(function(num) {
        if(num.substr(0, 1) == 'p')
          builder.getBatchIds(num.substr(1)).forEach(function(id) {
            ids.push(id);
          });
        else
          ids.push(num);
      });
      builder.cont(ids, processList, function(err) {
        parseRet(err, '', callback);
        if(!err) {
          builder.cleanIncoming(processList, function(err) {
            if(err) {
              callback('warning: failed to clean incoming\n');
              callback(err.message+'\n');
            }
          });
          processList = [];
        }
        callback('> ');
      });
      break;
    case "stop":
      if(cmd[1] == undefined) {
        callback('invalid parameter\n');
        break;
      }
      waitprompt = true;
      var ids = [];
      cmd[1].split(',').forEach(function(num) {
        if(num.substr(0, 1) == 'p')
          builder.getBatchIds(num.substr(1)).forEach(function(id) {
            ids.push(id);
          });
        else
          ids.push(num);
      });
      builder.stop(ids, function(err) {
        if(err) callback(err.message+'\n');
        else callback('stopped\n');
        callback('> ');
      });
      break;
    case "cancel":
      if(cmd[1] == undefined) {
        callback('invalid parameter\n');
        break;
      }
      waitprompt = true;
      var ids = [];
      cmd[1].split(',').forEach(function(num) {
        if(num.substr(0, 1) == 'p')
          builder.getBatchIds(num.substr(1)).forEach(function(id) {
            ids.push(id);
          });
        else
          ids.push(num);
      });
      builder.cancel(ids, function(err) {
        if(err) callback(err.message+'\n');
        else callback('canceled\n');
        callback('> ');
      });
      break;
    case "deps":
      waitprompt = true;
      builder.getBuildList(3, dists[0], processList, function(error, list) {
        if(error) {
          callback('error during dependency generation\n'+error.message+'\n');
        } else {
          builder.showPackages(list, function(pkg, str) {
            if(pkg.newpkg) callback(' new: '+str+'\n');
            else callback('repo: '+str+'\n');
          });
        }
        callback('> ');
      });
      break;
    case "reset":
      readyList = [];
      processList = [];
      builder.reset();
      builder.recover(function(err) {
        if(err) {
          callback('Batch recover failed\n');
          callback(err.message+'\n');
        }
      });
      Cp.exec('find '+incomingDir+' -exec touch {} \\;', function (error, stdout, stderr) {});
      break;
    case "status":
      callback('id\tdist');
      callback(genChars(distlen-'dist'.length, ' '));
      callback('mode\tstatus\tleft\tcurrent\n');
      callback('--------');
      callback(genChars(distlen-4, '-'));
      callback('----------------------------------------\n');
      builder.getBatch().forEach(function(batch) {
        var name = batch.pkg ? batch.pkg.name : "";
        var dist = batch.dist+genChars(distlen-batch.dist.length, ' ');
        var mode = modes[batch.mode];
        if(mode.length < 4) mode += '\t';
        callback('p'+batch.packet+':'+batch.id+'\t'+dist+mode+'\t'+batch.status);
        callback('\t'+batch.list.length+'\t'+name+'\n');
      });
      break;
    case "help":
      callback('done <dist> <status>              - internal cmd\n');
      callback('list [<id>]                       - list incoming/batch packages\n');
      callback('select pkg <name>                 - select package\n');
      callback('       all                        - select all packages\n');
      callback('       list                       - list selected packages\n');
      callback('       clear                      - clear selected packages\n');
      callback('start nodep   all|<dist[,dist..]> - just build\n');
      callback('      dep     all|<dist[,dist..]> - build in right order\n');
      callback('      rebuild all|<dist[,dist..]> - build new and rebuild paternal\n');
      callback('stop <id>                         - temporarily stop batch (and switch to next waiting)\n');
      callback('cancel <id[,id..]>                - delete batch (and switch to next waiting)\n');
      callback('continue <id[,id..]>              - merge selected new packages into batch and continue stopped/failed batch\n');
      callback('deps                              - list packages to be rebuild\n');
      callback('reset                             - clears queues, recover batches, unlock builder, rereads incoming dir\n');
      callback('status                            - status about current batches\n');
      break;
    default:
      callback('invalid cmd\n');
  }
  if(!waitprompt) callback('> ');
}

function parseRet(err, prefix, callback) {
  if(!err) callback(prefix+'ok: batch started\n');
  else if(!err.ret) callback(prefix+err.message+'\n');
  else switch(err.ret) {
    case 1:
      callback(prefix+'ok: nothing to do\n');
      break;
    case 2:
      callback(prefix+'failed: error during batch setup\n');
      callback(err.message+'\n');
      break;
    case 3:
      callback(prefix+'failed: error during buildlist generation\n');
      callback(err.message+'\n');
      break;
    case 4:
      callback(prefix+'failed: error during preparing package files\n');
      callback(err.message+'\n');
      break;
    case 5:
      callback(prefix+'failed: error during starting batch\n');
      callback(err.message+'\n');
      break;
    case 6:
      callback(prefix+'failed: error during cleaning batchrepo\n');
      callback(err.message+'\n');
      break;
  }
}

function genChars(count, char) {
  var str = '';
  while(count--) str += char;
  return str;
}

function usage(exitStatus) {
  console.log('Usage: rebuildd-incoming <options>');
  console.log('Options:');
  console.log('  --dists <Distributions>    -- (required) space-separated list of distributions');
  console.log('  --working-dir <WorkDir>    -- (required) move uploaded packages to <WorkDir>');
  console.log('  --incoming-dir <Directory> -- (required) watch for packages in <Directory> (defaults to the current directory)');
  console.log('  --repo-dir <Directory>     -- (required) check repository for dependencies');
  console.log('  --repo-script <Path>       -- (required) script for inserting/removing packages into/from repository');
  console.log('  --batch-dir <Directory>    -- temporary store batches');
  console.log('  --base-dir <Directory>     -- directory of batch base images');
  console.log('  --link-dir <Directory>     -- dist specific repo symlinks');
  console.log('  --out-dir <Directory>      -- dist specific rebuildd output directories');
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
