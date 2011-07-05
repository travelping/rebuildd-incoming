var ChildProcess = require('child_process');

exports.queuePackage = function (pkgname, version, distributions, callback) {
  var priority = 'high';
  var proc     = ChildProcess.spawn('rebuildd-job', ['add']);

  distributions.forEach(function (dist) {
    line = [pkgname, version, priority, dist].join(' ');
    proc.stdin.write(line + '\n');
  });

  proc.on('exit', function (code) {
    if (code == 0) {
      callback(false, 0);
    } else {
      callback(true, code);
    }
  });

  proc.stdin.end();
}
