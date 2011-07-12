var Net = require('net');

exports.Server = function (host, port) {
  this.socket   = Net.createConnection(port, host);
  this.addQueue = [];
  var netError;

  this.socket.on('data', function (data) {
    var output = stripPrompt(data, "<< ");
    if (output != '') { console.log(output); }
  });

  this.socket.on('error', function (exn) {
    console.log('' + exn);
  });
}

exports.Server.prototype.sendCmd = function (cmd) {
  console.log(">>", cmd);
  this.socket.write(cmd + "\n");
}

exports.Server.prototype.queuePackage = function (pkgname, version, options) {
  var server = this;
  var priority = options['priority'] || 'high';

  slowForeach(500, options.distributions, function (dist) {
    server.sendCmd(['job', 'add', pkgname, version, priority, dist].join(' '));
  });
}

function stripPrompt(data, prefix) {
  var lines = data.toString().split(/\n/);
  var lastLine = lines[lines.length - 1];

  if (/^.*->\s*$/.test(lastLine)) {
    lines = lines.slice(0, lines.length - 1);
  }

  lines = lines.filter(function (l) { return ! /^\s*$/.test(l) });

  return lines.map(function (l) { return prefix + '"' + l + '"'; }).join("\n");
}

function slowForeach(delay, arr, callback) {
  if (arr.length != 0) {
    callback(arr[0]);
    setTimeout(function () {
       slowForeach(delay, arr.slice(1), callback);
    }, delay);
  }
}
