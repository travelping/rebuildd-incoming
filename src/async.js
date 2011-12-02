var Events  = require('events');

exports.State = function () {
  this.counter = [];
  this.results = [];
  this.emitter = new Events.EventEmitter;
}

// initialize counter and emitter for parallel function execution
// calls callback if counter equals zero

exports.State.prototype.initCounter = function (name, count, callback) {
  if(count == 0) {
    callback(false, []);
  } else {
    var state = this;
    state.counter[name] = count;
    state.results[name] = [];
    var emitcallback = function(err, result) {
      if(state.counter[name] == undefined) {
        console.log('### internal error, initCounter, ', name);
        callback({message: 'undefined internal callback called'}, []);
      } else {
        if(!err) {
          state.counter[name]--;
          state.results[name].push(result);
        }
        if(state.counter[name] == 0 || err) {
          var res = state.results[name];
          delete state.counter[name];
          delete state.results[name];
          state.emitter.removeListener(name, emitcallback);
          callback(err, res);
        }
      }
    }
    state.emitter.on(name, emitcallback);
  }
}

// executes parallel callback with every element of array
// if all function finished callbackFin is called
// the callback has to take 2 arguments (elem, callbackRet) and call
// callbackRet(error) at the end

exports.State.prototype.forEachParallel = function (id, array, callback, callbackFin) {
  if(callbackFin == undefined) {
    callbackFin = function(err, res) {};
  }
  if(array.length == 0) {
    callbackFin(false, []);
  } else {
    var state = this;
    state.initCounter(id, array.length, callbackFin);
    array.forEach(function(elem) {
      callback(elem, function(error, result) {
        state.emitter.emit(id, error, result);
      });
    });
  }
}

// executes serial callback with every element of array
// if the last function has finished callbackFin is called
// the callback has to take 2 arguments (elem, callbackRet) and call
// callbackRet(error) at the end

exports.State.prototype.forEachSerial = function (id, array, callback, callbackFin) {
  if(callbackFin == undefined) {
    callbackFin = function(err, res) {};
  }
  if(array.length == 0) {
    callbackFin(false, []);
  } else {
    var state = this;
    var emitcallback = function(err, array, results) {
      if(array.length == 0 || err) {
        state.emitter.removeListener(id, emitcallback);
        callbackFin(err, results);
      } else {
        callback(array[0], function(error, result) {
          if(results.constructor != Array) console.log('### internal error, forEachSerial,', results);
          else state.emitter.emit(id, error, array.slice(1), results.push(result));
        });
      }
    }
    state.emitter.on(id, emitcallback);
    callback(array[0], function(error, result) {
      state.emitter.emit(id, error, array.slice(1), [result]);
    });
  }
}
