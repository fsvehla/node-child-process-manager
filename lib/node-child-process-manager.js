"use strict";

var net          = require('net'),
    childProcess = require('child_process'),
    verbose      = process.env.CPM_VERBOSE;

/* Every process goes here */
var managedProcesses = [];
var managedProcessInstances = {};

var getManagedProcessesWithChilds = function () {
  return managedProcesses.filter(function (process) {
    return (process.childProcess && process.running);
  });
};

var logVerbose = function logVerbose (message) {
  if (verbose) {
    console.log("[CPM] " + message);
  }
}

var ManagedProcess = function (options) {
  var shuttingDown=false;

  this.tag     = options.tag;
  this.options = options;
  this.killSignal = 'SIGTERM';

  this.stdOut = "";
  this.stdErr = "";

  managedProcesses.push(this);

  if (! (options.tag in managedProcessInstances)) {
    managedProcessInstances[options.tag] = this;
  } else {
    managedProcessInstances[options.tag] = this;
  }

  /* Spawns the subprocess */
  this.start = function () {
    var cmdArgs = this.options.cmd.split(' '),
        cmdName = cmdArgs.shift(),
        child   = childProcess.spawn(cmdName, cmdArgs);

    this.childProcess = child;
    this.running      = true;

    if (options.killSignal) {
      this.killSignal = options.killSignal;
    }

    child.on('exit', function () {
      if (!shuttingDown) {
        var message = "[CPM]: Process " + this.tag + " exited.\n";

        message += "Output:\n" + this.stdOut + "\n";
        message += "Error:\n"  + this.stdErr + "\n";

        throw(new Error(message));
      }

      logVerbose(this.tag + " exited during shutdown.")
    }.bind(this));

    child.stdout.on('data', function (data ) {
      this.stdOut += data.toString('ascii');
    }.bind(this));

    child.stderr.on('data', function (data ) {
      this.stdErr += data.toString('ascii');
    }.bind(this));

    if (this.options.onStdout) {
      child.stdout.on('data', function (data) {
        this.options.onStdout(data);
      }.bind(this));
    }

    if (this.options.onStderr) {
      child.stderr.on('data', function (data) {
        this.options.onStderr(data);
      }.bind(this));
    }
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

      clearTimeout(timeoutTimer);
      if (!timedOut)
        callback();
    }.bind(this));

    connection.on('error', function (error) {
      if (timedOut) {
        return;
      }

      if (error.syscall && error.syscall === 'connect') {
        setTimeout(function () {
          connection.connect(this.options.port, '127.0.0.1');
        }.bind(this), 100);
      }
    }.bind(this));
  }.bind(this);

  this.kill = function (signal, callback) {
    if (this.childProcess && this.running) {
      if (signal === 'SIGKILL') {
        logVerbose(this.tag + ": Sending " + signal)
        this.childProcess.kill(signal);

        callback();
        return;
      }

      this.childProcess.on('exit', function () {
        callback();
      });

      logVerbose(this.tag + ": Sending " + signal)
      this.childProcess.kill(signal);
    }
  }.bind(this);

  this.stop = function (callback) {
    shuttingDown=true;

    var termTimeout = setTimeout(function () {
      console.log("[CPM] !! unable to stop process with " + this.killSignal + ". Sending KILL. " + this.tag);
      this.kill('SIGKILL', function(){});
      callback();
    }.bind(this), 5000);

    this.kill(this.killSignal, function () {
      clearTimeout(termTimeout);
      callback();
    }.bind(this));
  }.bind(this);

  return this;
};

// If an onConnect callback is passed in as an option,
// it is expected to call its callback function.
//
// In such a case, execution of the done callback is delayed
var spawnMultiple = function (processDicts, callback) {
  var ready = [];
  logVerbose("starting "+ processDicts.length+ " processes");
  var checkCompletion = function () {

    if(ready.length === processDicts.length) {
      logVerbose("all ready");
      process.nextTick(callback);
    }
  };

  processDicts.forEach(function (processDict) {
    var managedProcess = new ManagedProcess(processDict);

    /* This function is called whenever we have verified that the process is up.
    *  We need it in two places, because the child-process can be up right away,
    *  or after we spawned it */
    var onUp = function () {
      var startTime=new Date().getTime();
      logVerbose(managedProcess.tag + ": UP (TCP connect)");
      if (processDict.onConnect) {
        processDict.onConnect(function () {
          logVerbose(managedProcess.tag + " onConnect CB called after "+(new Date().getTime()-startTime)+"ms");
          ready.push(managedProcess);
          checkCompletion();
        });
      } else {
        // it seems this part is never executed
        ready.push(processDict);
        checkCompletion();
      }
    }.bind(this);

    /* Initial test */
    managedProcess.verify(100, function(error) {
      if (error) {
        /* We need to spawn the process, and try a tad bit longer. */
        logVerbose("Spawning " + managedProcess.tag+ " on port "+ managedProcess.options.port);

        managedProcess.start();
        managedProcess.verify(5000, function (error) {

          if (error) {
            throw(new Error("Process " + managedProcess.tag + " failed to come up at port " + managedProcess.options.port));
          } else {
            onUp();
          }
        }.bind(this));
      } else {
        onUp();
      }
    }.bind(this));
  });

  return null;
};

var tagged = function (tag) {
  return managedProcessInstances[tag];
};

var cleanedUp = false;

var cleanup = function (callback) {
  var processesToKill     = getManagedProcessesWithChilds(),
      runningProcessCount = processesToKill.length;

  if (processesToKill.length === 0)
    return callback();
  processesToKill.forEach(function (process) {
    process.stop(function () {
      if (--runningProcessCount === 0)  {
        cleanedUp = true;
        callback();
      }
    });
  });
};

var cleanupOfLastResort = function () {
  /* Sync, because node doesn't allow us to schedule timers at this point */
  if (cleanedUp == true) {
    return;
  }

  console.log("[CPM] Warning cleaning up processes that weren't cleaned up yet.");
  this.cleanup(function () {});
};

module.exports = {spawnMultiple: spawnMultiple, cleanup: cleanup, tagged: tagged, cleanupOfLastResort: cleanupOfLastResort};
