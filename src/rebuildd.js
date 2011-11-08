var Net = require('net');

exports.Server = function (host, port) {
  this.host = host;
  this.port = port;
  this.reconnect();
}

exports.Server.prototype.reconnect = function () {
  var self = this;
  if (self.socket != undefined) {
    self.socket.destroy();
  }

  self.socket = Net.createConnection(self.port, self.host);
  self.socket.setKeepAlive(true, 1000);

  self.socket.on('connect', function() {
    console.log('Connected');
  });

  self.socket.on('data', function (data) {
    var output = stripPrompt(data, "<< ");
    if (output != '') { console.log(output); }
  });
  
  self.socket.on('error', function (exn) {
    console.log(exn);
    setTimeout(self.reconnect(), 1000);
  });
  
  self.socket.on('end', function() {
    console.log('Connection lost');
  });

  self.socket.on('timeout', function() {
    console.log('Timeout, reconnect in 1s');
    setTimeout(self.reconnect(), 1000);
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
