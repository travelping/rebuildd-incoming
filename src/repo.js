var Fs      = require('fs'),
    Path    = require('path'),
    Cp      = require('child_process'),
    As      = require(__dirname + '/async.js');

function repreproError (err) {
  console.log('reprepro START');
  console.log(err);
  console.log('reprepro END');
}

exports.Manager = function (name, baseDir, dists, arch, incomingScript) {
  this.name = name;
  this.dir = baseDir;
  this.dists = dists;
  this.arch = arch;
  this.incomingScript = incomingScript;
  this.as = new As.State;
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

exports.Manager.prototype.clean = function (dists, callbackFin) {
  var mgr = this;
  var uid = 'clean_' + JSON.stringify(dists);
  
  mgr.as.forEachParallel(uid, dists, function(dist, callback1) {
  
    console.log('cleaning incoming dirs of repo "'+mgr.name+'" dist "'+dist+'"');
    
    var path = [ Path.join(mgr.dir, dist, 'incoming'),
                 Path.join(mgr.dir, dist, 'tmp-incoming') ];
    
    mgr.as.forEachParallel(uid+'_'+dist, path, function(dir, callback2) {
      Fs.readdir(dir, function(err, files) {
        mgr.as.forEachParallel(uid+'_sub_'+dist, files, function(file, callback3) {
          Fs.unlink(Path.join(dir, file), callback3);
        }, callback2);
      });
    }, function(err) {
      if(err) {
        callback1(err);
        return;
      }
      
      console.log('cleaning repo "'+mgr.name+'"');
      
      var base = Path.join(mgr.dir, dist);
      var cmd_list = 'reprepro --basedir ' + base + ' --architecture ' + mgr.arch + ' list ' + dist;
      var cmd_del = 'reprepro --basedir ' + base + ' remove ' + dist;
      
      Cp.exec(cmd_list + ' | cut -d " " -f2', function (error, stdout, stderr) {
        if(error) {
          repreproError(stderr);
          callback1(error);
        } else {  
          var lines = stdout.split('\n').slice(0, -1);
          mgr.as.forEachSerial(uid+'_'+dist, lines, function(pkg, callback2) {
            Cp.exec(cmd_del + ' ' + pkg, function (error, stdout, stderr) {
              if(error) {
                repreproError(stderr);
              }
              callback2(error);
            });
          }, callback1);
        }
      });
    });
  }, callbackFin);
}

exports.Manager.prototype.move = function (dstRepo, dists, callbackFin) {
  var mgr = this;
  var uid = 'move_' + JSON.stringify(dists);
  mgr.as.forEachParallel(uid, dists, function(dist, callback1) {
    var dst = Path.join(dstRepo.getDir(), dist, 'incoming');
    console.log('moving packages from repo "'+mgr.name+'" to repo "'+dstRepo.getName()+'"');
    var src = Path.join(mgr.dir, dist, 'tmp-incoming');
    Fs.readdir(src, function(err, files) {
      if(err) {
        callback1(err);
      } else {
        mgr.as.forEachParallel(uid+'_'+dist, files, function(file, callback2) {
          Fs.rename(Path.join(src, file), Path.join(dst, file), callback2);
        }, callback1)
      }
    });
  }, callbackFin);
}

exports.Manager.prototype.insert = function (dists, callbackFin) {
  var mgr = this;
  var uid = 'insert_' + JSON.stringify(dists);
  console.log('insert new packages into repo "'+mgr.name+'"');
  mgr.as.forEachParallel(uid, dists, function(dist, callback) {
    var repo = Path.join(mgr.dir, dist);
    Cp.execFile(mgr.incomingScript, [repo, 'processincoming', 'rebuildd'],
      function (error, stdout, stderr) {
        if(error) {
          repreproError(stderr);
        }
        callback(error);
    });
  }, callbackFin);
}

