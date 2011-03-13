var net          = require('net'),
    childProcess = require('child_process');

POLL_INTERVAL = 10; /* in ms */

var managedProcesses = [];

process.on('exit', function() {
  managedProcesses.forEach(function (childProcess) {
    process.kill(childProcess.pid);

    /* The node reactor is already shutting down, and won't
       fire timers that we now create. */
  });
});

// If an onConnect callback is passed in as an option,
// it is expected to call its callback function.
//
// In such a case, execution of the done callback is delayed
var spawnMultiple = function (processDicts, callback) {
  var ready = [],
      checkCompletion = function () {
        if(ready.length == processDicts.length) {
          process.nextTick(callback);
        }
      };

  processDicts.forEach(function (processDict) {
    var connection = net.createConnection(processDict.port, '127.0.0.1'),
        child,
        connected = false;

    connection.on('connect', function () {
      connected = true;

      if (processDict.onConnect) {
        processDict.onConnect(function () {
          ready.push(processDict);
          checkCompletion();
        });
      } else {
        ready.push(processDict);
      }

      checkCompletion();
    });

    connection.on('error', function () {
      if(child) {
        return;
      }

      /* we'll need to spawn a child process */

      var cmdArgs = processDict.cmd.split(' '),
          cmdName = cmdArgs.shift();

      child = childProcess.spawn(cmdName, cmdArgs);

      if (processDict.onStdout) {
        child.stdout.on('data', processDict.onStdout);
      }

      if (processDict.onStderr) {
        child.stderr.on('data', processDict.onStderr);
      }

      child.on('exit', function (exitStatus) {
        if (! connected) {
          throw('Process exited before even starting to listen(): ' + require('sys').inspect({
            process:    processDict,
            exitStatus: exitStatus
          }));
        }
      });

      managedProcesses.push(child);

      connection.connect(processDict.port, '127.0.0.1');

      connection.on('error', function (error) {
        setTimeout(function () {
          connection.connect(processDict.port, '127.0.0.1');
        }, POLL_INTERVAL);
      });
    });
  });

  return null;
};

module.exports = {'spawnMultiple': spawnMultiple};
