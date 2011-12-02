var Net = require('net');

exports.Server = function (host, port, callback) {
  var server = Net.createServer(function (socket) {
    socket.setEncoding('utf8');
    socket.write('> ');
    socket.on('data', function (data) {
      callback(data, function(msg) {
        socket.write(msg);
      });
    });
  });
  
  server.listen(port, host, function() {
    console.log('cli bound');
  });
}
