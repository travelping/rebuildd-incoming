var Net = require('net');

exports.Server = function (host, port) {
  this.host = host;
  this.port = port;
  this.queue = [];
  this.lock = false;
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
    console.log('Connected to rebuildd');
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
    console.log('Connection to rebuildd closed');
  });

  self.socket.on('timeout', function() {
    console.log('rebuildd timeout, reconnect in 1s');
    setTimeout(self.reconnect(), 1000);
  });
}

exports.Server.prototype.sendCmd = function (cmd) {
  console.log(">>", cmd);
  this.socket.write(cmd + "\n");
}

exports.Server.prototype.queuePackage = function (name, version, dist, priority) {
  this.queue.push({name: name, version: version, dist: dist, priority: priority});
  if(this.lock) return;
  this.addJob();
}

exports.Server.prototype.addJob = function () {
  if(this.queue.length == 0) {
    this.lock = false;
    return;
  }
  this.lock = true;
  var pkg = this.queue.pop();
  var server = this;
  server.sendCmd(['job', 'add', pkg.name, pkg.version, pkg.priority, pkg.dist].join(' '));
  setTimeout(function() { server.addJob(); }, 500);
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

