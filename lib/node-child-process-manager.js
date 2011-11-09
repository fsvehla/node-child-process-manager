var net          = require('net'),
    fs           = require('fs'),
    childProcess = require('child_process'),
    _            = require('underscore')._,

POLL_INTERVAL = 10; /* in ms, for connect */

var managedProcesses   = [];
var daemonizedPidFiles = [];
var managedProcessInstances = {};

var ManagedProcess = function (options) {
  this.options = options;

  if (! (options.tag in managedProcessInstances)) {
    managedProcessInstances[options.tag] = this;
  }

  this.start = function () {
    var cmdArgs = this.options.cmd.split(' '),
        cmdName = cmdArgs.shift(),
        child   = childProcess.spawn(cmdName, cmdArgs);

    child.on('exit', function () {
      // TODO: Short-circuit verifications
    });

    this.childProcess = child;
  }.bind(this);

  this.verify = function (timeout, callback) {
    var connection = net.createConnection(this.options.port, '127.0.0.1'),
        timedOut   = false;

    var timeoutTimer = setTimeout(function () {
      timedOut = true;

      connection.end();
      connection.destroy();

      callback('timeout');
    }, timeout);

    connection.on('connect', function () {
      connection.end();
      connection.destroy();

      callback.call();
      clearTimeout(timeoutTimer);
    }.bind(this));

    connection.on('error', function (error) {
      if (timedOut)
        return;

      if (error.syscall && error.syscall == 'connect') {
        setTimeout(function () {
          connection.connect(this.options.port, '127.0.0.1');
        }.bind(this), 100);
      }
    }.bind(this));
  }.bind(this);

  this.kill = function (signal, callback) {
    if (this.childProcess && this.running) {
      this.childProcess.on('exit', callback);
      this.childProcess.kill(signal);
    }
  }.bind(this);

  this.stop = function (callback) {
    this.kill('SIGTERM', callback);
  }.bind(this);

  return this;
};


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
    var managedProcess = new ManagedProcess(processDict);

    var connection = net.createConnection(processDict.port, '127.0.0.1'),
        child,
        connected = false;

    connection.on("connect", function () {
      managedProcess.running = true;

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

      managedProcess.childProcess = child;

      if (processDict.onStdout) {
        child.stdout.on('data', processDict.onStdout);
      }

      child.errorOutput = "";

      child.stderr.on('data', function (data) {
        child.errorOutput += data.toString('ascii');

        if (processDict.onStderr)
          processDict.onStderr(data);
      });

      child.on('exit', function (exitStatus) {
        managedProcess.running = false;

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
          setTimeout(function () {
            connection.connect(processDict.port, '127.0.0.1');
          }, POLL_INTERVAL);
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

var tagged = function (tag) {
  return managedProcessInstances[tag];
}

var cleanup = function () {
  console.log('CPM - Beginning with cleanup of processes that we spawned ourself...');

  _.each(processes(), function (p) {
    console.log('Would need to kill ' + p.tag);
  });

  _.each(managedProcessInstances, function (process, tag) {
    process.stop(function () { });
  });
}

module.exports = {'spawnMultiple': spawnMultiple, 'processes': processes, 'cleanup': cleanup, tagged: tagged};
