var Repo        = require(__dirname + '/repo.js'),
    Rebuildd    = require(__dirname + '/rebuildd.js'),
    PkgWatcher  = require(__dirname + '/pkgwatcher.js'),
    Builder     = require(__dirname + '/builder.js'),
    As          = require('async'),
    Path        = require('path'),
    Cp          = require('child_process'),
    Fs          = require('fs.extra'),
    Wrench      = require('wrench');


exports.Builder = function (incomedir, workdir, batchdir, basedir, linkdir, outdir,
    reposcript, arch, repo, rebuildd, priority) {
  
  this.incomedir = incomedir;   // incoming directory
  this.workdir = workdir;       // working directory
  this.batchdir = batchdir;     // batch directory
  this.basedir = basedir;       // dist specific batch images
  this.linkdir = linkdir;       // dist specific repo links
  this.outdir = outdir;         // dist specific rebuildd output directories
  this.batch = [];              // list of active batches
  this.current = [];            // current batch per dist
  this.idcounter = 0;           // batchid counter
  this.pcounter = 0;            // packet counter
  this.status = [];             // build status per dist
  this.reposcript = reposcript; // repo incoming script
  this.arch = arch;             // for use with incoming script
  this.repo = repo;             // main repository per dist
  this.rebuildd = rebuildd;     // rebuildd interface
  this.priority = priority;     // build priority for rebuildd
  this.locked = false;          // lock start/cancel/stop/cont until done
  
  var builder = this;
  rebuildd.setCallback(
    function(output, callback) { builder.rebuilddCallback(output, callback); });
}

exports.Builder.prototype.getBatch = function () {
  return this.batch;
}

exports.Builder.prototype.getPacketNum = function () {
  return ++this.pcounter;
}

exports.Builder.prototype.getBatchIds = function (packet) {
  var ids = [];
  this.batch.forEach(function(batch) {
    if(batch.packet == packet)
      ids.push(batch.id);
  });
  return ids;
}

exports.Builder.prototype.reset = function () {
  this.batch.length = 0;
  this.current.length = 0;
  this.idcounter = 0;
  this.pcounter = 0;
  this.status.length = 0;
  this.locked = false;
}

exports.Builder.prototype.lock = function (callback, callbackFin) {
  var builder = this;
  if(!builder.locked) {
    builder.locked = true;
    callback(function(err) {
      builder.locked = false;
      callbackFin(err);
    });
  } else
    setTimeout(function() { builder.lock(callback, callbackFin); }, 500);
}

exports.Builder.prototype.rebuilddCallback = function (output, callback) {
  if(output.match(/^<< "I: job (.*) \((.*)\) added"$/)) {
    if(!this.current[RegExp['$2']]) {
      var msg = 'Error: no batch for '+RegExp['$2']+'running';
      console.log(msg);
      callback({message: msg, code: 'NOTRUNNING'});
      return;
    }
    this.current[RegExp['$2']].job = RegExp['$1'];
    callback(undefined);
  } else if(output == '<< "E: unknown job"') {
    var msg = 'Error: rebuildd: unknown job';
    console.log(msg);
    callback({message: msg, code: 'UNKNOWNJOB'});
  } else if(output == '<< "I: job canceled"') {
    callback(undefined);
  } else {
    var msg = 'Error: wrong rebuildd output format';
    console.log(msg);
    callback({message: msg, code: 'WRONGFORMAT'});
  }
}

exports.Builder.prototype.recover = function (callbackFin) {
  var builder = this;
  builder.idcounter = 0;
  builder.pcounter = 0;
  Fs.readdir(builder.batchdir, function(err, files) {
    if(err) { callbackFin(err); return; }
    builder.batch.length = 0;
    As.forEach(files, function(file, callback1) {
      var info = Path.join(builder.batchdir, file, 'info');
      Fs.readFile(info, 'utf8', function (err, content) {
        if(err) { callback1(err); return; }
        var count = 0;
        var batch = {
          id: parseInt(file),
          dir: Path.join(builder.batchdir, file),
          dist: undefined,
          status: undefined,
          job: undefined,
          pkg: undefined,
          packet: undefined,
          mode: 0,
          list: [],
          done: [],
          repo: undefined};
        content.split('\n').forEach(function(line) {
          switch(count) {
            case 0:
                batch.dist = line;
                ++count;
                break;
            case 1:
                if(line == "build" || line == "wait") batch.status = 'stopped';
                else batch.status = line;
                ++count;
                break;
            case 2:
                batch.mode = parseInt(line);
                ++count;
                break;
            case 3:
                batch.packet = parseInt(line);
                ++count;
          }
        });
        if(count != 4) { callback1({message: "info incomplete"}); return; }
        var incoming = Path.join(builder.batchdir, file, 'incoming');
        Fs.readdir(incoming, function(err, files) {
          if(err) { callback1(err); return; }
          As.forEach(files, function(file, callback2) {
            if(Path.extname(file) == '.dsc') {
              PkgWatcher.analyzeDSC(Path.join(incoming, file), function(err, pkg) {
                if(err) { callback2(err); return; }
                pkg.newpkg = true;
                batch.list.push(pkg);
                callback2(undefined);
              });
            } else callback2(undefined);
          }, function(bla) {
            var repo = Path.join(builder.batchdir, file, 'repo');
            batch.repo = new Repo.Manager(batch.id, repo, batch.dist, builder.arch, builder.reposcript);
            builder.batch.push(batch);
            if(batch.id > builder.idcounter)
              builder.idcounter = batch.id;
            if(batch.packet > builder.pcounter)
              builder.pcounter = batch.packet;
            callback1(undefined);
          });
        });
      });
    }, function(err) {
      if(err) {
        callbackFin(err);
      } else {
        builder.batch = builder.batch.sort(function(a, b) { return a.id - b.id });
        callbackFin(undefined);
      }
    });
  });
}

// init and start batch, lock builder during operation

exports.Builder.prototype.init = function (dist, mode, pkglist, packet, callbackFin) {
  var builder = this;
  builder.lock(function(callback) {
    console.log('Build init');
    if(pkglist.length == 0) {
      console.log('nothing to do');
      callback({ret: 1});
      return;
    }
    builder.initBatch(dist, mode, packet, function(err, batch) {
      if(err) {
        console.log('Error: init batch');
        console.log(err.message);
        err.ret = 2;
        callback(err);
        return;
      }
      builder.startNoInit(batch, pkglist, false, callback);
    });
  }, callbackFin);
}

// start batch, lock builder during operation

exports.Builder.prototype.start = function (batch, pkglist, callbackFin) {
  var builder = this;
  builder.lock(function(callback) {
    startNoInit(batch, pkglist, false, callback);
  }, callbackFin);
}

// start batch

exports.Builder.prototype.startNoInit = function (batch, pkglist, restart, callback) {
  var builder = this;
  var removeBatch = function() {
    Wrench.rmdirSyncRecursive(batch.dir, true);
    builder.idcounter--;
  }
  var returnError = function(msg, code, err, callback1) {
    console.log(msg);
    console.log(err.message);
    err.ret = code;
    callback1(err);
  }
  builder.getBuildList(batch.mode, batch.dist, pkglist, function(err, list) {
    if(err) {
      if(!restart) removeBatch();
      returnError('Error: generating buildlist', 3, err, callback);
      return;
    }
    builder.preparePkgs(batch, list, function(err, pkgs) {
      if(err) {
        if(!restart) removeBatch();
        returnError('Error: preparing packages', 4, err, callback);
        return;
      }
      console.log('dumping build list');
      for(var i=0; i < pkgs.length; i++) {
        console.log(i+':', pkgs[i].name);
      }
      batch.list = pkgs;
      batch.done = [];
      if(!restart)
        builder.batch.push(batch);
      builder.startBatch(batch, function(err) {
        if(err) {
          if(!restart) {
            removeBatch();
            builder.batch.pop();
          }
          returnError('Error: starting batch', 5, err, callback);
          return;
        }
        callback(undefined);
      });
    });
  });
}

exports.Builder.prototype.cont = function (ids, pkglist, callbackFin) {
  var builder = this;
  var batch = undefined;
  builder.lock(function(callback1) {
    As.forEach(ids, function(id, callback2) {
      builder.batch.every(function(b) {
        if(b.id == id) {
          batch = b;
          return false;
        }
        return true;
      });
      if(!batch)
        callback2({message: 'Error: No batch with ID '+id});
      else {
        if(batch.status == 'stopped' || batch.status == 'failed') {
          var list = batch.list.concat(batch.done);
          batch.list = [];
          batch.done = [];
          // remove pkgs from old buildlist which are in new buildlist
          list = list.filter(function(opkg) {
            var found = false;
            pkglist.every(function(npkg) {
              if(opkg.name == npkg.name) found = true;
              return !found;
            });
            return !found;
          });
          builder.startNoInit(batch, list.concat(pkglist), true, callback2);
        }
      }
    }, callback1);
  }, callbackFin);
}

exports.Builder.prototype.stop = function (ids, callbackFin) {
  var builder = this;
  var batch = undefined;
  builder.lock(function(callback1) {
    As.forEach(ids, function(id, callback2) {
      builder.batch.every(function(b) {
        if(b.id == id) {
          batch = b;
          return false;
        }
        return true;
      });
      if(!batch)
        callback2({message: 'Error: No batch with ID '+id});
      else {
        if(batch.status == 'build') {
          builder.rebuildd.cancelJob(batch.job, function(err) {
            if(err) callback2(err);
            else builder.switchBatch(batch.dist, 'stopped', callback2);
          });
        } else if(batch.status == 'wait') {
          batch.status = 'stopped';
          callback2(undefined);
        }
      }
    }, callback1);
  }, callbackFin);
}

exports.Builder.prototype.cancel = function (ids, callbackFin) {
  var builder = this;
  var batch = undefined;
  builder.lock(function(callback1) {
    As.forEach(ids, function(id, callback2) {
      builder.batch.every(function(b) {
        if(b.id == id) {
          batch = b;
          return false;
        }
        return true;
      });
      if(!batch)
        callback2({message: 'Error: No batch with ID '+id});
      else {
        if(batch.status == 'build') {
          builder.rebuildd.cancelJob(batch.job, function(err) {
            if(err) callback2(err);
            else builder.finishBatch(batch.dist, callback2);
          });
        } else {
          builder.deleteBatch(batch);
          callback2(undefined);
        }
      }
    }, callback1);
  }, callbackFin);
}

exports.Builder.prototype.initBatch = function (dist, mode, packet, callback) {
  this.idcounter++;
  var batchsrc = Path.join(this.basedir, dist);
  var batchdst = Path.join(this.batchdir, ''+this.idcounter);
  var repodir  = Path.join(batchdst, 'repo');
  var err = Wrench.copyDirSyncRecursive(batchsrc, batchdst);
  if(err) {
    console.log('Error: copy batch-base failed');
    callback(err, {});
  } else {
    var batch = {
      id: this.idcounter,
      dir: batchdst,
      dist: dist,
      status: "wait",
      job: undefined,
      mode: mode,
      pkg: undefined,
      packet: packet,
      list: [],
      done: [],
      repo: new Repo.Manager(this.idcounter, repodir, dist, this.arch, this.reposcript)
    };
    this.updateBatch(batch, function(err) {
      if(err) console.log('Error: update batch failed');
      callback(err, batch);
    });
  }
}

exports.Builder.prototype.linkBatch = function(batch, callback) {
  var link = Path.join(this.linkdir, batch.dist);
  var repo = Path.join(batch.dir, 'repo');
  var builder = this;
  
  Fs.readlink(link, function(err, str) {
    if(err && err.code == 'ENOENT') Fs.symlink(repo, link, callback);
    else if(err) callback(err);
    else {
      Fs.unlink(link, function(err) {
        if(err) callback(err);
        else Fs.symlink(repo, link, callback);
      });
    }
  });
}

exports.Builder.prototype.updateBatch = function (batch, callback) {
  var info = Path.join(batch.dir, 'info');
  Fs.writeFile(info, batch.dist+'\n'+batch.status+'\n'+batch.mode+'\n'+batch.packet, callback);
}

exports.Builder.prototype.startBatch = function (batch, callbackFin) {
  builder = this;
  if(builder.current[batch.dist] == batch) {
    var msg = 'Error: batch already in progress';
    console.log(msg);
    callbackFin({message: msg});
    return;
  }
  if(builder.status[batch.dist] > 0) {
    callbackFin(undefined);
    return;
  }
  if(batch.list.length == 0) {
    var msg = 'Error: build queue for '+batch.id+' empty';
    console.log(msg);
    callbackFin({message: msg});
    var i = builder.batch.indexOf(batch);
    builder.batch.splice(i, 1);
    return;
  }
  As.forEach(batch.list, function(pkg, callback1) {
    As.series([
      // copy package files
      function(callback2) {
        As.forEach(pkg.files, function (f, callback3) {
          var workdir = Path.join(builder.workdir, f.file);
          var batchdir = Path.join(batch.dir, 'incoming', f.file);
          Fs.stat(workdir, function(err, stat) {
            if(err && err.code == 'ENOENT') Fs.copy(batchdir, workdir, callback3);
            else callback3(err);
          });
        }, callback2);
      },
      // copy the dsc file itself
      function(callback2) {
        var workdir = Path.join(builder.workdir, pkg.filename);
        var batchdir = Path.join(batch.dir, 'incoming', pkg.filename);
        Fs.stat(workdir, function(err, stat) {
          if(err && err.code == 'ENOENT') Fs.copy(batchdir, workdir, callback2);
          else callback2(err);
        });
      }],
    function(err, results) {
      callback1(err);
    });
  }, function(err) {
    if(err) {
      console.log('Error: copying files to working dir');
      callbackFin(err);
    } else {
      builder.linkBatch(batch, function(err) {
        if(err) {
          console.log('Error: creating symlink to batch repo');
          callbackFin(err);
        } else {
          console.log('Batch', batch.id, '('+batch.dist+')', 'started');
          builder.current[batch.dist] = batch;
          builder.queueBatch(batch, callbackFin);
        }
      });
    }
  });
}

exports.Builder.prototype.queueBatch = function (batch, callbackFin) {
  var builder = this;
  var pkg;
  var testDone = function(p, callback) {
    var version2 = p.version.replace(/[^:]*:/, "");
    var bins = clone(p.bins);
    Fs.readdir(Path.join(batch.dir, "done"), function(err, files) {
      if(err) { callback(err, false); return; }
      files.forEach(function(file) {
        if(file.match(/^([^_]+)_([^_]+)_[^_]+\.deb$/)) {
          var r1 = RegExp['$1'], r2 = RegExp['$2'];
          bins = bins.map(function(bin) {
            if(!bin) return false;
            if(bin == r1 && (p.version == r2 || version2 == r2)) return false;
            return bin;
          });
        }
      });
      callback(undefined, bins.every(function(b) { return !b; }));
    });
  };
  var exec = function() {
    pkg = batch.list.shift();
    batch.done.push(pkg);
    testDone(pkg, function(err, done) {
      if(err) {
        callbackFin(err);
        return;
      }
      if(done)
        exec ();
      else {
        batch.status = 'build';
        batch.pkg = pkg;
        batch.job = undefined;
        builder.status[batch.dist] = 1;
        builder.rebuildd.addJob(pkg.name, pkg.version, batch.dist, builder.priority, function(err) {
          if(err) { callbackFin(err); return; }
          builder.updateBatch(batch, callbackFin);
        });
      }
    });
  }
  exec();
}

exports.Builder.prototype.switchBatch = function (dist, status, callback) {
  var builder = this;
  var batch = builder.current[dist];
  builder.status[dist] = 0;
  batch.status = status;
  batch.list.unshift(batch.done.pop());
  builder.updateBatch(batch, function(err) {
    if(err) { callback(err); return; }
    for(var i=0; i<builder.batch.length; i++) {
      var b = builder.batch[i];
      if(b.dist == dist && b.status == 'wait') {
        builder.current[dist] = b
        builder.startBatch(b, callback);
        return;
      }
    }
    console.log('All batches done for', dist);
    builder.current[dist] = undefined;
    callback(undefined);
  });
}

exports.Builder.prototype.deleteBatch = function (batch) {
  Wrench.rmdirSyncRecursive(batch.dir, true);
  var i = this.batch.indexOf(batch);
  this.batch.splice(i, 1);
}

exports.Builder.prototype.finishBatch = function (dist, callback) {
  var builder = this;
  var batch = builder.current[dist];
  this.deleteBatch(batch);
  builder.status[dist] = 0;
  for(var i=0; i<builder.batch.length; i++) {
    var b = builder.batch[i];
    if(b.dist == dist && b.status == 'wait') {
      builder.current[dist] = b
      builder.startBatch(b, callback);
      return;
    }
  }
  console.log('All batches done for', dist);
  builder.current[dist] = undefined;
  callback(undefined);
}

exports.Builder.prototype.processBatch = function (dist, status) {
  var builder = this;
  var success = status == 0;
  switch(builder.status[dist]) {
    case undefined:
    case 0:
      console.log('Error: No batch for', dist);
      break;
    case 1:
      var batch = builder.current[dist];
      console.log('Build for batch', batch.id, '('+dist+')', success ? 'succeeded' : 'failed');
      if(!success) {
        builder.switchBatch(dist, 'failed', function(err) {
          if(err) console.log('Error: Batch switch failed');
        });
      } else {
        builder.status[dist] = 0;
        var outdir = Path.join(builder.outdir, batch.dist);
        var donedir = Path.join(batch.dir, 'done');
        var repodir = Path.join(batch.dir, 'repo', 'incoming');
        Fs.readdir(outdir, function(err, files) {
          if(err) {
            console.log('Error: Pkg out listing failed');
            console.log(err.message);
          } else {
            console.log('Moving pkgs to done & repo dir');
            As.forEach(files, function(file, callback) {
              var f = Path.join(outdir, file);
              Fs.copy(f, Path.join(repodir, file), function(err) {
                if(err) {
                  console.log('Error: Pkg moving (repo) failed');
                  console.log(err.message);
                  callback(err);
                } else {
                  Fs.rename(f, Path.join(donedir, file), function(err) {
                    if(err) {
                      console.log('Error: Pkg moving (done) failed');
                      console.log(err.message);
                    }
                    callback(err);
                  });
                }
              });
            }, function(err) {
              if(err) return;
              if(batch.list.length > 0) {
                batch.repo.insert(function(err) {
                  if(err) {
                    console.log('Error: Repo insertion failed');
                    console.log(err.message);
                  } else {
                    builder.queueBatch(batch, function(err) {
                      if(err) {
                        console.log('Error: Batch update failed');
                        console.log(err.message);
                      }
                    })
                  }
                });
              } else {
                builder.repo[dist].cleanIncoming(function(err) {
                  if(err) {
                    console.log('Error: cleaning main repo incoming dirs');
                    console.log(err.message);
                  } else {
                    var donedir = Path.join(batch.dir, 'done');
                    var mainincoming = Path.join(builder.repo[dist].getDir(), 'incoming');
                    Fs.readdir(donedir, function(err, files) {
                      if(err) {
                        console.log('Error: done dir listing failed');
                        console.log(err.message);
                      } else {
                        As.forEach(files, function(file, callback) {
                          var from = Path.join(donedir, file);
                          var to = Path.join(mainincoming, file);
                          Fs.rename(from, to, function(err) {
                            if(err) {
                              console.log('Error: Pkg moving (mainrepo) failed');
                              console.log(err.message);
                            }
                            callback(err);
                          });
                        }, function(err) {
                          if(err) {
                            console.log('Error: Moving packages to main repo incoming');
                            console.log(err.message);
                          } else {
                            As.forEachSeries(batch.done, function(pkg, callback1) {
                              As.forEachSeries(pkg.bins, function(bin, callback2) {
                                builder.repo[dist].remove(bin, false, callback2);
                              }, function(err) {
                                if(err) callback1(err);
                                else builder.repo[dist].remove(pkg.name, false, callback1);
                              });
                            }, function(err) {
                              if(err) {
                                console.log('Error: removing old packages from main repo');
                                console.log(err.message);
                              } else {
                                builder.repo[dist].insert(function(err) {
                                  if(err) {
                                    console.log('Error: inserting packages into main repo');
                                    console.log(err.message);
                                  } else {
                                    builder.finishBatch(dist, function(err) {
                                      if(err) {
                                        console.log('Error: starting next batch');
                                        console.log(err.message);
                                      }
                                    })
                                  }
                                });
                              }
                            });
                          }
                        });
                      }
                    });
                  }
                });
              }
            });
          }
        });
      }
      break;
  }
}

exports.Builder.prototype.cleanIncoming = function (pkgs, callbackFin) {
  var builder = this;
  As.forEach(pkgs, function(pkg, callback1) {
    As.forEach(pkg.files, function (f, callback2) {
      var file = Path.join(builder.incomedir, f.file);
      Fs.unlink(file, callback2);
    }, function(err) {
      if(err) callback1(err);
      else {
        var file = Path.join(builder.incomedir, pkg.filename);
        Fs.unlink(file, callback1);
      }
    });
  }, callbackFin);
}

exports.Builder.prototype.preparePkgs = function (batch, pkgs, callbackFin) {
  var builder = this;
  console.log('prepare packages');
  
  As.map(pkgs, function(pkg, callback1) {
    if(pkg.newpkg) {
      
      var returnError = function(msg, err, callback) {
        console.log(msg);
        console.log(err.message);
        callback(err);
      }
      
      var copy = function(name, incoming, batchdir, callback) {
        Path.exists(batchdir, function(existsbatch) {
          if(existsbatch) {
            Path.exists(incoming, function(existsincoming) {
              if(existsincoming) {
                Fs.unlink(batchdir, function(err) {
                  if(err)
                    returnError('Error: failed to copy pkg', err, callback);
                  else {
                    Fs.copy(incoming, batchdir, function(err) {
                      if(err)
                        returnError('Error: failed to copy pkg', err, callback);
                      else
                        callback(undefined);
                    });
                  }
                });
              } else {
                // console.log('Warning:', name, 'not in incoming but batch dir');
                callback(undefined);
              }
            });
          } else {
            Path.exists(incoming, function(existsincoming) {
              if(existsincoming) {
                Fs.copy(incoming, batchdir, function(err) {
                  if(err)
                    returnError('Error: failed to copy pkg', err, callback);
                  else
                    callback(undefined);
                });
              } else {
                var msg = 'Error: '+name+' neither in incoming nor batch dir';
                returnError(msg, {message: msg}, callback);
              }
            });
          }
        })
      }
      
      As.series([
        // copy package files
        function(callback2) {
          As.forEach(pkg.files, function (f, callback3) {
            var incoming = Path.join(builder.incomedir, f.file);
            var batchdir = Path.join(batch.dir, 'incoming', f.file);
            copy(f.file, incoming, batchdir, callback3);
          }, callback2);
        },
        // copy the dsc file itself
        function(callback2) {
          var incoming = Path.join(builder.incomedir, pkg.filename);
          var batchdir = Path.join(batch.dir, 'incoming', pkg.filename);
          copy(pkg.filename, incoming, batchdir, callback2);
        }],
        function(err, results) {
          callback1(err, pkg);
        });
    } else {
      var pkgfilename = pkg.name+'_'+pkg.version+'.tar.gz';
      var pkgfile = Path.join(builder.workdir, pkgfilename);
      var extdir = Path.join(builder.workdir, pkg.name);
      
      var modifyDSC = function(tarfile, newname, version) {
        var oldname = pkg.name+'_'+pkg.version;
        var olddsc = Path.join(builder.workdir, oldname+'.dsc');
        var newdsc = Path.join(builder.workdir, newname+'.dsc');
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
                      callback1(undefined, pkg);
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
        var newtar = Path.join(builder.workdir, newname+'.tar.gz');
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

exports.Builder.prototype.getBuildList = function (mode, dist, pkgs, callback) {
  var builder = this;
  var buildlist;
  try {
    buildlist = clone(pkgs).map(function(pkg) {
      if(!isArray(pkg.deps)) {
        pkg.deps = parseDependencies(pkg.name, pkg.deps);
        if(isObject(pkg.deps))
          throw pkg.deps;
      }
      return pkg;
    });
  } catch(e) {
    callback(e, []);
    return;
  }
  switch(mode) {
    case 0: // nodep
      console.log('Disabled dependency check');
      callback(false, buildlist);
      break;
    case 1: // dep
      console.log('Generating dependency list, but skipping repo');
      var del = depdel(buildlist)
      var list = sort(del, builder);
      if(!list) callback({message: 'dependency cycle'}, []);
      else callback(false, list);
      break;
    case 3: // show deps
    case 2: // rebuild
      console.log('Generating dependency list');
      getRepoPkgs(dist, builder.repo[dist].getDir(), builder.repo[dist].getArch(), function(err, repopkgs) {
        if(err) {
          callback(err, []);
          return;
        }
        buildlist = getRebuildPkgs(repopkgs, buildlist);
        var del = depdel(buildlist);
        var list = sort(del, builder);
        if(!list) callback({message: 'dependency cycle'}, []);
        else callback(false, list);
      });
      break;
  }
}

exports.Builder.prototype.showPackages = function (list, callback) {
  list.forEach(function(pkg) {
    var str = pkg.name+' '+pkg.version+' - [';
    if(pkg.deps.length > 0) {
      if(pkg.deps[0].length > 0) {
        if(pkg.deps[0][0].version)
          str += pkg.deps[0][0].name+" ("+pkg.deps[0][0].op+" "+pkg.deps[0][0].version+")";
        else
          str += pkg.deps[0][0].name;
      }
      if(pkg.deps[0].length > 1) {
        pkg.deps[0].slice(1).forEach(function(alt) {
          if(alt.version)
            str += '|'+alt.name+" ("+alt.op+" "+alt.version+")";
          else
            str += '|'+alt.name;
        });
      }
    }
    if(pkg.deps.length > 1) {
      pkg.deps.slice(1).forEach(function(dep) {  
        str += ', ';
        if(dep.length > 0) {
          if(dep[0].version)
            str += dep[0].name+" ("+dep[0].op+" "+dep[0].version+")";
          else
            str += dep[0].name;
        }
        if(dep.length > 1) {
          dep.slice(1).forEach(function(alt) {
            if(alt.version)
              str += '|'+alt.name+" ("+alt.op+" "+alt.version+")";
            else
              str += '|'+alt.name;
          });
        }
      });
    }
    callback(pkg, str+']');
  });
}

function getRepoPkgs(dist, repoDir, arch, callback) {
  console.log('read repo content file');
  var contentfile = Path.join(repoDir, 'dists', dist, 'main', 'binary-'+arch, 'Packages');
  Fs.readFile(contentfile, 'utf8', function(err, data) {
    if(err) {
      callback(err, []);
      return;
    }
    console.log('parse packages and dependencies');
    var name, fname, farch, version, repo = [], deps = [], bins = [], gotpkg = false;
    try {
      data.split('\n').forEach(function(line) {
        if(gotpkg && line.match(/^[ ]*$/)) {
          var dsc = findDSC(name, fname, farch, dist, version, repoDir);
          if(isObject(dsc))
            throw dsc;
          Fs.readFileSync(dsc, 'utf8').split('\n').forEach(function(line) {
            if(line.match(/^Build-Depends: (.*)$/)) {
              deps = parseDependencies(name, RegExp['$1']);
              if(isObject(deps))
                throw deps;
            }
          });
          repo.push({name: name, version: version, deps: deps, bins: bins, newpkg: false});
          gotpkg = false;
          return;
        }
        line.match(/^([^:]+): (.*)/);
        switch(RegExp['$1']) {
          case 'Package': name = RegExp['$2']; gotpkg = true; break;
          case 'Version': version = RegExp['$2']; gotpkg = true; break;
          case 'Architecture': farch = RegExp['$2']; gotpkg = true; break;
          case 'Filename': fname = RegExp['$2']; gotpkg = true; break;
          case 'Binary': bins = RegExp['$2'].split(', '); gotpkg = true; break;
        }
      });
      callback(false, repo);
    } catch(e) {
      callback(e, []);
    }
  });
}

function findDSC(name, fname, farch, dist, version, repoDir) {
  var path = Path.join(repoDir, 'pool', 'main', name.substr(0, 1), name);
  var dsc = Path.join(path, name+"_"+version+".dsc");
  if(Path.existsSync(dsc))
    return dsc;
  dsc = Path.join(path, name+"_"+version.replace(/[^:]*:/, "")+".dsc");
  if(Path.exists(dsc))
    return dsc;
  dsc = Path.join(repoDir, fname.replace(new RegExp("_"+farch+".deb"), ".dsc"));
  if(Path.exists(dsc))
    return dsc;
  dsc = false;
  try {
    Fs.readdirSync(path).forEach(function(file) {
      if(file.match(/.*\.dsc$/)) {
        if(file.search(version) || file.search(version.replace(/[^:]*:/, "")))
          dsc = Path.join(path, file);
      }
    });
  } catch(e) {}
  if(dsc)
    return dsc;
  path = Path.join(repoDir, Path.dirname(fname));
  try {
    Fs.readdirSync(path).forEach(function(file) {
      if(file.match(/.*\.dsc$/)) {
        if(file.search(version) || file.search(version.replace(/[^:]*:/, "")))
          dsc = Path.join(path, file);
      }
    });
  } catch(e) {}
  if(dsc)
    return dsc;
  return {message: "Error: dsc for "+name+" not found"};
}

function getRebuildPkgs(repo, buildlist) {
  console.log('add successive packages to buildlist with dependencies in buildlist');
  // remove repopkgs which are in buildlist
  repo = repo.filter(function(repopkg) {
    var found = false;
    buildlist.every(function(pkg) {
      if(pkg.name == repopkg.name) {
        console.log(pkg.name, 'rebuild');
        found = true;
        return false;
      }
      return true;
    });
    return !found;
  });
  var depfound = true, error = false;
  while(depfound) {
    depfound = false;
    // check whether pkg is dep of repopkg
    repo = repo.filter(function(repopkg) {
      var found = false;
      buildlist.every(function(pkg) {
        groupDependencies(repopkg.deps).every(function(dep) {
          if(dep.name == pkg.name) {
            var cmds = dep.rules.map(function(rule) {
              if(!rule.version)
                return true;
              else
                return compareStr(pkg.version, rule.op, rule.version);
            });
            var res = syncExecs(cmds, "0");
            var match = res.every(function(ret) {
              return ret == "0";
            });
            if(match) {
              console.log('>', repopkg.name, 'found to rebuild for', pkg.name);
              found = true;
              depfound = true;
              buildlist.push(repopkg);
              return false;
            }
            return true;
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

// [[{name: "", op: "", version: ""}]] -> [{name: "", rules: [{op: "", version: ""}]}]

function groupDependencies(deps) {
  var grouped = [];
  deps.forEach(function(dep) {
    dep.forEach(function(alt) {
      var found = false;
      grouped = grouped.map(function(g) {
        if(g.name == alt.name) {
          g.rules.push({op: alt.op, version: alt.version});
          found = true;
        }
        return g;
      });
      if(!found)
        grouped.push({name: alt.name, rules: [{op: alt.op, version: alt.version}]});
    });
  });
  return grouped;
}

// "" -> {name: "", op: "", version: ""} | false

function parseDependency(string) {
  if(string.match(/^[ ]*([^ ]+)[ ]*(?:\[.*\])*[ ]*\([ ]*(<<|<|<=|=|>=|>|>>)[ ]*([^ ]+)[ ]*\)[ ]*(?:\[.*\])*[ ]*$/)) {
    var r1 = RegExp['$1'], r2 = RegExp['$2'], r3 = RegExp['$3'];
    return {name: r1, op: r2, version: r3};
  }
  if(string.match(/^[ ]*([^ \(]+)[ ]*(?:\[.*\])*[ ]*$/)) {
    var r1 = RegExp['$1'];
    return {name: r1, op: "", version: ""};
  }
  return false;
}

// "" -> [[{name: "", op: "", opf: fun, version: ""}]] | {message: ""}

function parseDependencies(pkgname, string) {
  try {
    return string.split(', ').map(function(dep) {
      var alts = [], last = "";
      while(true) {
        if(dep.match(/^([^|]*)\|(.*)$/)) {
          var r1 = RegExp['$1'], r2 = RegExp['$2'];
          var alt = parseDependency(r1);
          if(alt) {
            alts.push(alt);
            dep = r2;
            last = alt.name;
            continue;
          } else {
            throw r1;
          }
        }
        var alt = parseDependency(dep);
        if(alt) {
          alts.push(alt);
          break;
        } else {
          throw dep;
        }
      }
      return alts;
    });
  } catch(e) {
    return {message: 'Error: Malformed dependency for package '+pkgname+': '+e};
  }
}

function depdel(buildlist) {
  console.log('delete dependencies which are not in buildlist');
  return buildlist.map(function(pkg) {
    pkg.deps = pkg.deps.filter(function(dep) {
      var alts = dep.filter(function(alt) {
        var found = false;
        buildlist.every(function(subpkg) {
          if(alt.name == subpkg.name) {
            if(!alt.version) {
              found = true;
              return false;
            } else {
              var cmd = compareStr(subpkg.version, alt.op, alt.version);
              var res = syncExecs([cmd], "0");
              if(res == "0") {
                found = true;
                return false;
              }
            }
          }
          return true;
        });
        return found;
      });
      return alts.length > 0;
    });
    return pkg;
  });
}

function sort(tmpbuildlist, builder) {
  console.log('sort buildlist');
  var buildlist = [], removelist = [];
  tmpbuildlist = tmpbuildlist.map(function(pkg) {
    pkg.tmpdeps = pkg.deps;
    return pkg;
  });
  while(tmpbuildlist.length > 0) {
    var found = false;
    // collect all packages with no dependencies left
    tmpbuildlist = tmpbuildlist.filter(function(pkg) {
      if(pkg.tmpdeps.length == 0) {
        buildlist.push(pkg);
        removelist.push(pkg);
        found = true;
        return false;
      }
      return true;
    });
    // if no package is found we've got a dependency cycle
    if(!found) {
      console.log('dependency cycle with');
      builder.showPackages(tmpbuildlist, function(pkg, str) {
        console.log('> '+str);
      });
      return false;
    }
    // remove collected packages from dependencies
    tmpbuildlist = tmpbuildlist.map(function(pkg) {
      pkg.tmpdeps = pkg.tmpdeps.filter(function(dep) {
        var subfound = false;
        dep.every(function(alt) {
          removelist.every(function(rem) {
            if(alt.name == rem.name) {
              if(!alt.version)
                subfound = true;
              else {
                var cmd = compareStr(rem.version, alt.op, alt.version);
                var res = syncExecs([cmd], "0");
                if(res == "0")
                  subfound = true;
              }
            }
            return !subfound;
          });
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

function isObject(x) {
  return x.constructor == Object;
}

function isArray(x) {
  return x.constructor == Array;
}

function compareStr(v1, op, v2) {
    return 'dpkg --compare-versions "'+v1+'" "'+op+'" "'+v2+'"; echo -n $?';
}

function syncExecs(cmds, def) {
  var res = [];
  var count = cmds.length, done = 0;
  for(var i=0; i<count; i++) {
    if(cmds[i] == true) {
      res[i] = def;
      done++;
    } else {
      Cp.exec(cmds[i] + " > /tmp/pkg_stdout_"+i+"; echo done > /tmp/pkg_done_"+i);
      res[i] = false;
    }
  }
  count -= done;
  while(count > 0) {
    for(var i=0; i<cmds.length; i++) {
      if(!res[i]) {
        try {
          var status = Fs.readFileSync("/tmp/pkg_done_"+i, 'utf8');
          if(status.trim() == "done") {
            res[i] = Fs.readFileSync("/tmp/pkg_stdout_"+i, 'utf8');
            Fs.unlinkSync("/tmp/pkg_stdout_"+i);
            Fs.unlinkSync("/tmp/pkg_done_"+i);
            count--;
          }
        } catch(e) {}
      }
    }
  }
  return res;
}

