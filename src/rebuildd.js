var Net = require('net');

exports.queuePackage = function (pkgname, version, options, callback) {
  var priority = options['priority'] || 'high';
  var socket   = new Net.Socket();
  var netError = null;

  socket.on('connect', function () {
    socket.setNoDelay();
    options.distributions.forEach(function (dist) {
      line = ['job', 'add', pkgname, version, priority, dist].join(' ');
      socket.write(line + '\n');
    });
    socket.write('job reload\n');
    socket.destroy();
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

  socket.connect(options.port, options.host);
}
