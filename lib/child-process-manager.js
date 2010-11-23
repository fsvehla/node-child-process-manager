var net          = require('net'),
    childProcess = require('child_process'),
    events       = require('events'),
    sys          = require('sys');

POLL_INTERVAL = 20; /* in ms */

var processes = [];

process.on('exit', function() {
  /* TODO: kill the processes in processes */
});

var spawnMultiple = function (processDicts, callback) {
  var ready = [],
      checkCompletion = function () {
        if(ready.length == processDicts.length) {
          callback.call()
        };
      };

  processDicts.forEach(function (processDict) {
    var connection = net.createConnection(processDict.port, '127.0.0.1');

    connection.on('connect', function () {
      ready.push(processDict);

      checkCompletion();
    });

    connection.once('error', function () {
      /* we’ll need to spawn a child process */

      var cmdArgs = processDict.cmd.split(' '),
          cmdName = cmdArgs.shift();

      var child = childProcess.spawn(cmdName, cmdArgs);
      processes.push(child);

      connection.connect(processDict.port, '127.0.0.1');

      connection.on('error', function (error) {
        setTimeout(function () {
          connection.connect(processDict.port, '127.0.0.1')
        }, POLL_INTERVAL);
      });
    });
  });

  return null;
};

module.exports = {'spawnMultiple': spawnMultiple};

