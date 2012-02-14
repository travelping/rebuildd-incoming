var Fs      = require('fs'),
    Path    = require('path'),
    Cp      = require('child_process'),
    As      = require(__dirname + '/async.js');

exports.Manager = function (name, baseDir, dists, arch, repoScript) {
  this.name = name;
  this.dir = baseDir;
  this.dists = dists;
  this.arch = arch;
  this.repoScript = repoScript;
  this.debug = false;
}

exports.Manager.prototype.setDebug = function (debug) {
  this.debug = debug;
}

exports.Manager.prototype.getName = function () {
  return this.name;
}

exports.Manager.prototype.getDir = function () {
  return this.dir;
}

exports.Manager.prototype.getArch = function () {
  return this.arch;
}

exports.Manager.prototype.cleanIncoming = function (dists, callbackFin) {
  var mgr = this;
  
  As.forEach(dists, function(dist, callback1) {
  
    console.log('cleaning incoming dirs of repo "'+mgr.name+'" dist "'+dist+'"');
    
    var path = [ Path.join(mgr.dir, dist, 'incoming'),
                 Path.join(mgr.dir, dist, 'tmp-incoming') ];
    
    As.forEach(path, function(dir, callback2) {
      Fs.readdir(dir, function(err, files) {
        if(err) {
          if(err.code != 'ENOENT') callback2(err);
          else callback2(undefined);
        } else if(files == "") {
          console.log('nothing to clean in "'+dir+'"');
          callback2(undefined);
        } else {
          As.forEach(files, function(file, callback3) {
            if(mgr.debug) console.log('debug: clean: "'+dist+'" remove '+file);
            Fs.unlink(Path.join(dir, file), callback3);
          }, callback2);
        }
      });
    }, callback1);
  }, callbackFin);
}

exports.Manager.prototype.cleanRepo = function (dists, callbackFin) {
  var mgr = this;
  
  As.forEach(dists, function(dist, callback1) {
    
    console.log('cleaning repo "'+mgr.name+'" dist "'+dist+'"');
      
    var base = Path.join(mgr.dir, dist);
    var cmd_list = 'reprepro --basedir ' + base + ' --architecture ' + mgr.arch + ' list ' + dist;
    var cmd_del = 'reprepro --basedir ' + base + ' remove ' + dist;
    
    Cp.exec(cmd_list + ' | cut -d " " -f2', function (error, stdout, stderr) {
      if(error) {
        callback({message: stderr});
      } else {  
        var lines = stdout.split('\n').slice(0, -1);
        As.forEachSeries(lines, function(pkg, callback2) {
          Cp.exec(cmd_del + ' ' + pkg, function (error, stdout, stderr) {
            if(error) {
              callback({message: stderr});
            }
            callback2(error);
          });
        }, callback1);
      }
    });
  }, callbackFin);
}

exports.Manager.prototype.clean = function (dists, callbackFin) {
  var mgr = this;
  mgr.cleanIncoming(dists, function(err) {
    if(err) callbackFin(err);
    else mgr.cleanRepo(dists, callbackFin);
  });
}

exports.Manager.prototype.move = function (dstRepo, dists, dir, callbackFin) {
  var mgr = this;
  
  As.forEach(dists, function(dist, callback1) {
    var dst = Path.join(dstRepo.getDir(), dist, 'incoming');
    console.log('moving packages from repo "'+mgr.name+'" to repo "'+dstRepo.getName()+'"');
    var src = Path.join(mgr.dir, dist, dir);
    Fs.readdir(src, function(err, files) {
      if(err) {
        callback1(err);
      } else if(files == "") {
        var msg = 'no packages to move';
        console.log(msg);
        callback1({message: msg});
      } else {
        As.forEach(files, function(file, callback2) {
          Fs.rename(Path.join(src, file), Path.join(dst, file), callback2);
        }, callback1)
      }
    });
  }, callbackFin);
}

exports.Manager.prototype.insert = function (dists, callbackFin) {
  var mgr = this;
  
  console.log('insert new packages into repo "'+mgr.name+'"');
  As.forEach(dists, function(dist, callback) {
    var repo = Path.join(mgr.dir, dist);
    Cp.execFile(mgr.repoScript, [repo, 'processincoming', 'rebuildd'],
      function (error, stdout, stderr) {
        if(mgr.debug) {
          console.log('debug: insert: "'+repo+'"\n### stdout:\n'+stdout+'\n### stderr:\n'+stderr+'\n### done');
        }
        if(error) {
          Cp.execFile("echo \""+stderr+"\" | grep \"already registered\"", [],
            function (error, stdout2, stderr2) {
              if(error) callback({message: stderr});
              else {
                console.log('warning: skip existing package');
                callback(undefined);
              }
            });
        } else {
          callback(undefined);
        }
    });
  }, callbackFin);
}

exports.Manager.prototype.remove = function (name, dists, callbackFin) {
  var mgr = this;
  
  console.log('remove package "'+name+'" from repo "'+mgr.name+'"');
  As.forEach(dists, function(dist, callback) {
    var repo = Path.join(mgr.dir, dist);
    Cp.execFile(mgr.repoScript, [repo, 'remove', dist, name],
      function (error, stdout, stderr) {
        if(mgr.debug) {
          console.log('debug: remove: "'+name+'"\n### stdout:\n'+stdout+'\n### stderr:\n'+stderr+'\n### done');
        }
        if(error) {
          callback({message: stderr});
        }
        callback(error);
    });
  }, callbackFin);
}

exports.Manager.prototype.list = function (dists, dir, callback) {
  var mgr = this;
  dists.forEach(function(dist) {
    var base = Path.join(mgr.dir, dist, dir);
    console.log(base);
    callback(dist+'\n');
    Fs.readdirSync(base).forEach(function(file) {
      callback('  '+file+'\n');
    });
  });
}
