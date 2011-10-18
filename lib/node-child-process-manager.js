var net          = require('net'),
    fs           = require('fs'),
    childProcess = require('child_process');

POLL_INTERVAL = 10; /* in ms, for connect */

var managedProcesses   = [];
var daemonizedPidFiles = [];

process.on('exit', function() {
  /* The node reactor is already shutting down, and won't
     fire timers that we now create. */

  daemonizedPidFiles.forEach(function (pair) {
    var contents = fs.readFileSync(pair.pid, "ascii"),
             pid = parseInt(contents);

    var killSignal = pair.killSignal;

    if (!killSignal || killSignal == "") {
      killSignal = "SIGTERM";
    }

    console.log(killSignal);

     try {
        process.kill(pid, pair.killSignal);
     } catch(err) {}
  })
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

    connection.on("connect", function () {
      connection.end();
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

      child.errorOutput = "";
      child.stderr.on('data', function (data) {
        console.log('got data');

        child.errorOutput += data.toString('ascii');

        if (processDict.onStderr)
          processDict.onStderr(data);
      });

      child.on('exit', function (exitStatus) {
        if (! connected) {
          if (processDict.daemon) {
            if (processDict.pidFile) {
              daemonizedPidFiles.push({ pid: processDict.pidFile, killSignal: processDict.killSignal });
            }
          } else {
            throw('Process exited before even starting to listen(): ' + require('sys').inspect({
              process:    processDict,
              stdErr:     child.errorOutput,
              exitStatus: exitStatus
            }));
          }
        }
      });

      child.tag = processDict.tag;

      managedProcesses.push(child);

      connection.connect(processDict.port, '127.0.0.1');

      connection.on('error', function (error) {
        if (error.syscall && error.syscall == 'connect') {
          setTimeout(function () { connection.connect(processDict.port, '127.0.0.1'); }, POLL_INTERVAL);
        } else {
          throw(error);
        };
      });
    });
  });

  return null;
};

var processes = function () {
  return managedProcesses;
}

module.exports = {'spawnMultiple': spawnMultiple, 'processes': processes};

