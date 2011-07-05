var Net = require('net');

exports.queuePackage = function (pkgname, version, options, callback) {
  var priority = options['priority'] || 'high';
  var socket   = Net.createConnection(options.port, options.host);
  var netError = null;

  socket.on('connect', function () {
    options.distributions.forEach(function (dist) {
      line = ['job', 'add', pkgname, version, priority, dist].join(' ');
      socket.write(line + '\n');
    });
    socket.end('job reload\n');
  });

  socket.on('error', function (exn) {
    netError = '' + exn;
  })

  socket.on('close', function (had_error) {
    if (had_error) {
      callback(true, netError);
    } else {
      callback(false, null);
    }
  });
}
