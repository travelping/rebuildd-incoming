var Fs      = require('fs'),
    Path    = require('path'),
    Cp      = require('child_process'),
    As      = require('async');

exports.Manager = function (name, baseDir, dist, arch, repoScript) {
  this.name = name;
  this.dir = baseDir;
  this.dist = dist;
  this.arch = arch;
  this.repoScript = repoScript;
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

exports.Manager.prototype.cleanIncoming = function (callbackFin) {
  var mgr = this;
  console.log('cleaning incoming dirs of repo ', mgr.name);
  var incoming = Path.join(mgr.dir, 'incoming');
  Fs.readdir(incoming, function(err, files) {
    if(err) {
      if(err.code != 'ENOENT') callbackFin(err);
      else callbackFin(undefined);
    } else if(files == "") {
      console.log('nothing to clean in "'+incoming+'"');
      callbackFin(undefined);
    } else {
      As.forEach(files, function(file, callback) {
        if(mgr.debug) console.log('debug: clean: "'+mgr.name+'" remove '+file);
        Fs.unlink(Path.join(incoming, file), callback);
      }, callbackFin);
    }
  });
}

//~ exports.Manager.prototype.cleanRepo = function (callbackFin) {
  //~ var mgr = this;
  //~ console.log('cleaning repo ', mgr.name);
  //~ var cmd_list = 'reprepro --basedir ' + mgr.dir + ' --architecture ' + mgr.arch + ' list ' + mgr.dist;
  //~ var cmd_del = 'reprepro --basedir ' + mgr.dir + ' remove ' + mgr.dist;
  //~ 
  //~ Cp.exec(cmd_list + ' | cut -d " " -f2', function (error, stdout, stderr) {
    //~ if(error) {
      //~ callbackFin({message: stderr});
    //~ } else {  
      //~ var lines = stdout.split('\n').slice(0, -1);
      //~ As.forEachSeries(lines, function(pkg, callback) {
        //~ Cp.exec(cmd_del + ' ' + pkg, function (error, stdout, stderr) {
          //~ if(error) callback({message: stderr});
          //~ else callback(undefined);
        //~ });
      //~ }, callbackFin);
    //~ }
  //~ });
//~ }

exports.Manager.prototype.clean = function (callbackFin) {
  var mgr = this;
  mgr.cleanIncoming(function(err) {
    if(err) callbackFin(err);
    else mgr.cleanRepo(callbackFin);
  });
}

exports.Manager.prototype.insert = function (callbackFin) {
  var mgr = this;
  console.log('insert new packages into repo', mgr.name);
  Cp.execFile(mgr.repoScript, [mgr.dir, 'processincoming', 'rebuildd'],
    function (error, stdout, stderr) {
      if(error) {
        Cp.execFile("echo \""+stderr+"\" | grep \"already registered\"", [],
          function (error, stdout2, stderr2) {
            if(error) console.log(stderr);
            else console.log('warning: skip existing package');
          });
      }
      callbackFin(undefined);
  });
}

exports.Manager.prototype.remove = function (name, silent, callbackFin) {
  var mgr = this;
  console.log('remove package "'+name+'" from repo', mgr.name);
  Cp.execFile(mgr.repoScript, [mgr.dir, 'remove', mgr.dist, name],
    function (error, stdout, stderr) {
      if(error && !silent) callbackFin({message: stderr});
      else callbackFin(undefined);
  });
}
