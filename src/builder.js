var As      = require(__dirname + '/async.js'),
    Repo    = require(__dirname + '/repo.js'),
    Rebuildd = require(__dirname + '/rebuildd.js'),
    Path    = require('path'),
    Cp      = require('child_process'),
    Fs      = require('fs');


exports.Builder = function (priority, rebuildd, tmprepo, repo, inputDir, outputDir) {
  this.queue = [];
  this.status = [];
  this.dists = [];
  this.priority = priority;
  this.inputDir = inputDir;
  this.outputDir = outputDir;
  this.as = new As.State;
  this.tmprepo = tmprepo;
  this.repo = repo;
  this.rebuildd = rebuildd;
}

exports.Builder.prototype.getStatus = function (dist) {
  return this.status[dist];
}

exports.Builder.prototype.getQueue = function (dist) {
  return this.queue[dist];
}

exports.Builder.prototype.getDists = function () {
  return this.dists;
}

exports.Builder.prototype.reset = function () {
  var builder = this;
  builder.dists.forEach(function(dist) {
    delete builder.queue[dist];
    delete builder.status[dist];
  });
  builder.queue = [];
  builder.status = [];
  builder.dists = [];
}

exports.Builder.prototype.init = function (dep, dists, pkglist, callback) {
  var builder = this;
  
  console.log('Build init');
  if(pkglist.length == 0) {
    console.log('nothing to do');
    callback(1, {});
    return;
  }
  if(builder.dists.length > 0) {
    var msg = 'already locked';
    console.log(msg);
    callback(2, {message: msg});
    return;
  }
  builder.dists = dists;
  dists.forEach(function(dist) {
    builder.queue[dist] = [];
    builder.status[dist] = 0;
  });
  builder.getBuildList(dep, dists[0], pkglist, function(error, list) {
    if(error) {
      builder.dists = [];
      console.log('Error: generating buildlist');
      console.log(error.message);
      callback(3, error);
      return;
    }
    builder.preparePkgs(list, function(error, pkgs) {
      if(error) {
        builder.dists = [];
        console.log('Error: preparing packages');
        console.log(error.message);
        callback(4, error);
        return;
      }
      console.log('dumping build list');
      dists.push('tmp');
      builder.queue['tmp'] = [];
      for(var i=pkgs.length-1; pkgs.length > 0; i--) {
        var pkg = pkgs.pop();
        console.log(i+':', pkg.name);
        dists.forEach(function(dist) {
          builder.queue[dist].push(clone(pkg));
        });
      }
      dists.pop();
      builder.start(dists);
      callback(0, {});
    });
  });
}

exports.Builder.prototype.start = function (dists) {
  var builder = this;
  console.log('Build start for', dists);
  dists.forEach(function(dist) {
    if(builder.queue[dist].length == 0) {
      console.log('Error: build queue for', dist, 'empty');
    } else {
      var pkg = builder.queue[dist].pop();
      builder.status[dist] = 1;
      builder.rebuildd.queuePackage(pkg.name, pkg.version, dist, builder.priority);
    }
  });
}

exports.Builder.prototype.processBatch = function (type, dist, status) {
  var builder = this;
  var success = status == 0;
  switch(builder.status[dist]) {
    case undefined:
      console.log('Error: No batch for', dist);
      break;
    case 0:
      console.log('Error: Batch not started');
      break;
    case 1:
      switch(type) {
        case "build":
          console.log('Build for', dist, success ? 'succeeded' : 'failed');
          if(!success) {
            delete builder.queue[dist];
            delete builder.status[dist];
            builder.dists = builder.dists.filter(function(d) { return d != dist; });
            builder.tmprepo.clean([dist], function(err) {
              if(err) {
                console.log('Error: cleaning tmp repo');
                console.log(err.message);
              }
            });
            console.log('Batch for', dist, 'canceled');
          } else  {
            builder.status[dist] = 2;
          }
          break;
        case "post":
          console.log('Error: Postbuild finished before build');
          break;
        default:
          console.log('Error: Invalid build type', type);
      }
      break;
    case 2:
      switch(type) {
        case "build":
          console.log('Error: Multiple build finished');
          break;
        case "post":
          console.log('PostBuild for', dist, success ? 'succeeded' : 'failed');
          if(!success) {
            delete builder.queue[dist];
            delete builder.status[dist];
            builder.dists = builder.dists.filter(function(d) { return d != dist; });
            builder.tmprepo.clean([dist], function(err) {
              if(err) {
                console.log('Error: cleaning tmp repo');
                console.log(err.message);
              }
            });
            console.log('Batch for', dist, 'canceled');
          } else if(builder.queue[dist].length == 0) {
            console.log('Batch for', dist, 'finished');
            delete builder.queue[dist];
            delete builder.status[dist];
            builder.dists = builder.dists.filter(function(d) { return d != dist; });
            builder.tmprepo.move(builder.repo, [dist], function(err) {
              if(err) {
                console.log('Error: moving files from tmp repo to main repo');
                console.log(err.message);
              } else {
                builder.as.forEachSerial('rem_'+dist, builder.queue['tmp'], function(pkg, callback) {
                  builder.repo.remove(pkg.name, [dist], callback);
                }, function(err) {
                  if(err) {
                    console.log('Error: removing old packages from main repo');
                    console.log(err.message);
                  } else {
                    if(builder.dists.length == 0) delete builder.queue['tmp'];
                    builder.repo.insert([dist], function(err) {
                      if(err) {
                        console.log('Error: inserting packages into main repo');
                        console.log(err.message);
                      } else {
                        builder.tmprepo.clean([dist], function(err) {
                          if(err) {
                            condsole.log('Error: cleaning tmp repo');
                            console.log(err.message);
                          } 
                        });
                      }
                    });
                  }
                });
              }
            });
          } else {
            builder.start([dist]);
          }
          break;
        default:
          console.log('Error: Invalid build type', type);
      }
      break;
    default:
      console.log('Error: Invalid build status');
  }
}

exports.Builder.prototype.preparePkgs = function (pkgs, callbackFin) {
  var builder = this;
  console.log('prepare packages');
  builder.as.forEachParallel('prepare', pkgs, function(pkg, callback1) {
    if(pkg.newpkg) {
      // move package files
      builder.as.forEachParallel('prepare_'+pkg.name, pkg.files, function (f, callback2) {
        var newPath = Path.join(builder.outputDir, Path.basename(f.file));
        Fs.rename(f.file, newPath, function(err) {
          callback2(err, newPath);
        });
      }, function(err, pkgFiles) {
        if(err) {
          callback1(err);
          return;
        }
        // move the dsc file itself
        var newDscPath = Path.join(builder.outputDir, pkg.filename);
        pkgFiles.push(newDscPath);
        pkg.files = pkgFiles;
        Fs.rename(Path.join(builder.inputDir, pkg.filename), newDscPath, function(err) {
          callback1(err, pkg);
        });
      });
    } else {
      var pkgfilename = pkg.name+'_'+pkg.version+'.tar.gz';
      var pkgfile = Path.join(builder.outputDir, pkgfilename);
      var extdir = Path.join(builder.outputDir, pkg.name);
      
      var modifyDSC = function(tarfile, newname, version) {
        var oldname = pkg.name+'_'+pkg.version;
        var olddsc = Path.join(builder.outputDir, oldname+'.dsc');
        var newdsc = Path.join(builder.outputDir, newname+'.dsc');
        Fs.readFile(olddsc, 'utf8', function (err, content) {
          Cp.exec('md5sum '+tarfile, function (error, stdout, stderr) {
            if(error) callback1({message: stderr});
            else {
              stdout.slice(0, -1).match(/^(.*)  .*$/);
              var md5 = RegExp['$1'];
              Fs.stat(tarfile, function(err, stat) {
                if(err) callback1(err);
                else {
                  var tarline = ' '+md5+' '+stat.size+' '+newname+'.tar.gz';
                  content = content.split('\n').map(function(line) {
                    if(line.match(/^Version: .*$/)) return 'Version: '+version;
                    else if(line.match(new RegExp(oldname))) return tarline
                    else return line;
                  }).join('\n');
                  Fs.writeFile(newdsc, content, function(err) {
                    if(err) callback1(err);
                    else {
                      pkg.version = version;
                      callback1(false, pkg);
                    }
                  });
                }
              });
            }
          });
        });
      }
      
      var repack = function(subdir, version) {
        var newname = pkg.name+'_'+version;
        var newtar = Path.join(builder.outputDir, newname+'.tar.gz');
        Cp.exec('tar -czC '+extdir+' -f '+newtar+' '+subdir,
          function (error, stdout, stderr) {
            if(error) callback1({message: stderr});
            else modifyDSC(newtar, newname, version);
        });
      }
      
      var modifyAppSrcFile = function(subdir, version) {
        var ebin = Path.join(extdir, subdir, 'ebin');
        Fs.readdir(ebin, function(err, files) {
          if(err) callback1(err);
          else {
            var found = false;
            files.every(function(file) {
              if(file.match(/^.*\.app$/)) {
                found = true;
                var appfile = Path.join(ebin, file);
                Fs.readFile(appfile, 'utf8', function (err, content) {
                  if(err) callback1(err);
                  else {
                    content = content.split('\n').map(function(line) {
                      if(line.match(/^(.*{vsn,").*("}.*)$/))
                        return RegExp['$1']+version+RegExp['$2'];
                      else return line;
                    }).join('\n');
                    Fs.writeFile(appfile, content, function(err) {
                      if(err) callback1(err);
                      else repack(subdir, version);
                    });
                  }
                });
              }
              return !found;
            });
            if(!found) repack(subdir, version);
          }
        });
      }
      
      var modifyRules = function(subdir, version) {
        var rules = Path.join(extdir, subdir, 'debian', 'rules');
        Fs.readFile(rules, 'utf8', function (err, content) {
          if(err) callback1(err);
          else {
            content = content.split('\n').map(function(line) {
              return line.replace(pkg.name+'_'+pkg.version, pkg.name+'_'+version);
            }).join('\n');
            Fs.writeFile(rules, content, function(err) {
              if(err) callback1(err);
              else modifyAppSrcFile(subdir, version);
            });
          }
        });
      }
      
      var modifyChangelog = function(subdir) {
        var changelog = Path.join(extdir, subdir, 'debian', 'changelog');
        Fs.readFile(changelog, 'utf8', function (err, content) {
          if(err) callback1(err);
          else {
            var head = '';
            var version = '';
            content.split('\n').every(function(line) {
              if(line.match(/^(.* \()(.*~.*\.)(.*)(\) .*)$/)) {
                var count = parseInt(RegExp['$3'])+1;
                version = RegExp['$2']+count;
                head = RegExp['$1']+version+RegExp['$4'];
                return false;
              } else if(line.match(/^(.* \()(.*)(\) .*)$/)) {
                version = RegExp['$2']+'.0';
                head = RegExp['$1']+version+RegExp['$3'];
                return false;
              }
              return true;
            });
            var body = '  * auto rebuild due to rebuild of at least one of its dependencies';
            var foot = ' -- tpbuilder <tpbuilder@travelping.com>  '
            var date = (new Date()).toGMTString();
            date.match(/^(.*)(GMT|UTC)$/);
            foot = foot+RegExp['$1']+'+0000';
            Fs.writeFile(changelog, head+'\n'+body+'\n'+foot+'\n'+content, function(err) {
              if(err) callback1(err);
              else modifyRules(subdir, version);
            });
          }
        });
      };
      
      var extract = function() {
        Cp.exec('tar -xC '+extdir+' -f '+pkgfile, function (error, stdout, stderr) {
          if(error) callback1({message: stderr});
          else Fs.readdir(extdir, function(err, files) {
            if(err) callback1(err);
            else modifyChangelog(files[0]);
          });
        });
      }

      Path.exists(pkgfile, function(exists) {
        if(!exists) {
          callback1({message: 'Couldn\'t find pkg '+pkg.name+' in working dir'});
          return;
        }
        Path.exists(extdir, function(exists) {
          if(exists) {
            Fs.readdir(extdir, function(err, files) {
              if(err) callback1(err);
              else {
                Cp.exec('rm -rf '+extdir+'/*', function (error, stdout, stderr) {
                  if(error) callback1({message: stderr});
                  else extract();
                });
              }
            });
          } else {
            Fs.mkdir(extdir, 0755, function(err) {
              if(err) callback1(err);
              else extract();
            });
          }
        });
      });
    }
  }, callbackFin);
}

exports.Builder.prototype.getBuildList = function (dep, dist, pkgs, callback) {
  var builder = this;
  var buildlist = clone(pkgs);
  switch(dep) {
    case 0: // nodep
      console.log('Disabled dependency check');
      callback(false, buildlist);
      break;
    case 1: // dep
      console.log('Generating dependency list, but skipping repo');
      var list = sort(depdel(false, buildlist));
      if(!list) callback({message: 'dependency cycle'}, []);
      else callback(false, list);
      break;
    case 3: // show deps
    case 2: // rebuild
      console.log('Generating dependency list');
      getRepoPkgs(dist, builder.repo.getDir(), builder.repo.getArch(), function(err, repo) {
        if(err) {
          callback(err, []);
          return;
        }
        buildlist = getRebuildPkgs(repo, buildlist);
        var list = sort(depdel(dep==3?true:false, buildlist));
        if(!list) callback({message: 'dependency cycle'}, []);
        else callback(false, list);
      });
      break;
  }
}

function getRepoPkgs(dist, repoDir, arch, callback) {
  console.log('read repo content file');
  var contentfile = Path.join(repoDir, dist, 'dists', dist, 'main', 'binary-'+arch, 'Packages');
  Fs.readFile(contentfile, 'utf8', function(err, data) {
    if(err) {
      callback(err, []);
      return;
    }
    console.log('parse packages and dependencies');
    var name, version, repo = [];
    data.split('\n').forEach(function(line) {
      line.match(/^([^:]+): (.*)/);
      switch(RegExp['$1']) {
        case 'Package': name = RegExp['$2']; break;
        case 'Version': version = RegExp['$2']; break;
        case 'Depends':
          var deps = RegExp['$2'].split(', ');
          deps = deps.map(function(dep) {
            if(dep.match(/^(.*) \((.*) (.*)\)$/))
              return {name: RegExp['$1'], op: RegExp['$2'], version: RegExp['$3']};
            else return dep;
          });
          repo.push({name: name, version: version, deps: deps, newpkg: false});
          break;
      }
    });
    callback(false, repo);
  });
}

function getRebuildPkgs(repo, buildlist) {
  console.log('add successive packages to buildlist with dependencies in buildlist');
  var depfound = true, error = false;
  while(depfound) {
    depfound = false;
    repo = repo.filter(function(repopkg) {
      var found = false;
      buildlist.every(function(pkg) {
        if(pkg.name == repopkg.name) {
          console.log(pkg.name, 'already in repo');
          found = true;
          return false;
        }
        repopkg.deps.every(function(dep) {
          if((dep.name && dep.name == pkg.name) || (!dep.name && dep == pkg.name)) { // todo: use version
            console.log('>', repopkg.name, 'found to rebuild for', pkg.name);
            found = true;
            depfound = true;
            buildlist.push(repopkg);
            return false;
          }
          return true;
        });
        return !found;
      });
      return !found;
    });
  }
  return buildlist;
}

function depdel(depssave, buildlist) {
  console.log('delete dependencies which are not in buildlist');
  return buildlist.map(function(pkg) {
    pkg.deps = pkg.deps.filter(function(dep) {
      var found = false;
      buildlist.every(function(pkg) {
        if((dep.name && dep.name == pkg.name) || (!dep.name && dep == pkg.name)) {
          found = true;
          return false;
        }
        return true;
      });
      return found;
    });
    if(depssave) pkg.depssave = pkg.deps;
    return pkg;
  });
}

function sort(tmpbuildlist) {
  console.log('sort tmpbuildlist');
  var buildlist = [], removelist = [];
  while(tmpbuildlist.length > 0) {
    var found = false;
    // collect all packages with no dependencies left
    tmpbuildlist = tmpbuildlist.filter(function(pkg) {
      if(pkg.deps.length == 0) {
        buildlist.push(pkg);
        removelist.push(pkg.name);
        found = true;
        return false;
      }
      return true;
    });
    // if no package is found we've got a dependency cycle
    if(!found) {
      console.log('dependency cycle with');
      tmpbuildlist.forEach(function(pkg) {
        var str = '> '+pkg.name+' - [';
        if(pkg.deps.length > 0) {
          if(pkg.deps[0].name) str += ', '+pkg.deps[0].name;
          else str += ', '+pkg.deps[0];
          pkg.deps.slice(1).forEach(function(dep) {
            if(dep.name) str += ', '+dep.name;
            else str += ', '+dep;
          });
        }
        console.log(str+']');
      });
      return false;
    }
    // remove collected packages from dependencies
    tmpbuildlist = tmpbuildlist.map(function(pkg) {
      pkg.deps = pkg.deps.filter(function(dep) {
        var subfound = false;
        removelist.every(function(rem) {
          if((dep.name && dep.name == rem) || (!dep.name && dep == rem))
            subfound = true;
          return !subfound;
        });
        return !subfound;
      });
      return pkg;
    });
    removelist = [];
  }
  return buildlist;
}

function clone(x) {
  if (x.clone) return x.clone();
  if(x.constructor == Array) {
    var r = [];
    x.forEach(function(e) { r.push(clone(e)) });
    return r;
  }
  if(x.constructor == Object) {
    var r = {};
    for(var e in x) r[e] =  clone(x[e]);
    return r;
  }
  return x;
}

