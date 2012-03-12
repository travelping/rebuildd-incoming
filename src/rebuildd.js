var Net = require('net');

exports.Server = function (host, port) {
  this.host = host;
  this.port = port;
  this.queue = [];
  this.lock = false;
  this.reconnect();
  this.callback = undefined;
  this.callbackData = undefined;
}

exports.Server.prototype.setCallback = function (callback) {
  this.callback = callback;
  console.log('registered rebuildd callback');
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
    if (output != '') {
      console.log(output);
      self.callback(output, self.callbackData);
    }
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

exports.Server.prototype.queueCmd = function (cmd) {
  this.queue.push(cmd);
  if(this.lock) return;
  this.sendCmd();
}

exports.Server.prototype.sendCmd = function () {
  if(this.queue.length == 0) {
    this.lock = false;
    return;
  }
  this.lock = true;
  var cmd = this.queue.pop();
  console.log(">>", cmd);
  this.socket.write(cmd + "\n");
  var server = this;
  setTimeout(function() { server.sendCmd(); }, 500);
}

exports.Server.prototype.addJob = function (name, version, dist, priority, callback) {
  var cmd = ['job', 'add', name, version, priority, dist].join(' ');
  this.callbackData = callback;
  this.queueCmd(cmd);
}

exports.Server.prototype.cancelJob = function (id, callback) {
  if(!id) return;
  var cmd = ['job', 'cancel', id].join(' ');
  this.callbackData = callback;
  this.queueCmd(cmd);
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

