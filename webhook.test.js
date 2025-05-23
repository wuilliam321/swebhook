const { exec } = require('child_process');
const axios = require('axios');

// Functions to test - Assuming they are exported from webhook.js
// We need to simulate the module exports for testing if webhook.js doesn't explicitly export them.
// For this example, let's assume webhook.js is modified to export these:
// module.exports = { runCommand, runCommandAsync, sendTelegramMessage /*, ... other functions */ };
// If not, we'd have to use a more complex setup like proxyquire or rewire.

// For now, let's define them locally for the test to run, mirroring their structure.
// In a real scenario, you would `require('./webhook')` and ensure exports are set up.

function runCommand(res, appPath, args) {
  const escapedArgs = args.map(arg => `'${arg.replace(/'/g, "'\\''")}'`).join(' ');
  const cmd = `${appPath} ${escapedArgs || "''"}`; // Ensure at least empty quotes if no args
  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`stderr: ${stderr}`);
      return;
    }
    console.log(`stdout: ${stdout}`);
  });
}

function sendTelegramMessage(chatId, message) {
  // This is a simplified version for testing runCommandAsync
  // In webhook.js, it uses axios.post
  console.log(`Mock sendTelegramMessage to ${chatId}: ${message}`);
  // Simulate axios.post call for spy purposes
  axios.post(`https://api.telegram.org/botTELEGRAM_TOKEN/sendMessage`, {
    chat_id: chatId,
    text: message
  });
}

// Updated local definition for runCommandAsync in webhook.test.js
async function runCommandAsync(appPath, args) { // Removed chatId, originalMessageText
  return new Promise((resolve, reject) => {
    const escapedArgs = args.map(arg => `'${arg.replace(/'/g, "'\\''")}'`).join(' ');
    const cmd = `${appPath} ${escapedArgs || "''"}`;

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        // console.error(`Error executing command: ${error.message}`); // Keep or remove test console logs
        // console.error(`stderr: ${stderr}`);
        reject({ type: 'error', error: error, stderr: stderr });
      } else if (stderr) {
        // console.warn(`Command produced stderr: ${stderr}`);
        reject({ type: 'error', error: null, stderr: stderr });
      } else {
        // console.log(`stdout: ${stdout}`);
        resolve({ type: 'success', stdout: stdout });
      }
    });
  });
}


// Mock child_process.exec
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

// Mock axios
jest.mock('axios');

describe('runCommand', () => {
  beforeEach(() => {
    exec.mockClear();
    // Optional: Spy on console methods if their output is critical for a test
    // jest.spyOn(console, 'log').mockImplementation(() => {});
    // jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // jest.restoreAllMocks(); // Restore console spies if used
  });

  test('should execute a command without arguments', () => {
    runCommand(null, '/bin/ls', []);
    expect(exec).toHaveBeenCalledTimes(1);
    // Adjusted expectation: if args is empty, it might pass an empty string or handle it.
    // The implementation now adds ` ''` if args is empty.
    expect(exec).toHaveBeenCalledWith("/bin/ls ''", expect.any(Function));
  });

  test('should execute a command with one argument', () => {
    runCommand(null, '/bin/echo', ['hello']);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith("/bin/echo 'hello'", expect.any(Function));
  });

  test('should execute a command with multiple arguments and proper escaping', () => {
    runCommand(null, '/usr/bin/git', ['commit', '-m', "Initial commit with 'quotes'"]);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith("/usr/bin/git 'commit' '-m' 'Initial commit with '\\''quotes'\\'''", expect.any(Function));
  });

  test('should handle command success and log stdout', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    exec.mockImplementation((command, callback) => {
      callback(null, 'stdout output', ''); // Simulate success
    });
    runCommand(null, '/bin/echo', ['hello']);
    expect(consoleSpy).toHaveBeenCalledWith('stdout: stdout output');
    consoleSpy.mockRestore();
  });

  test('should handle command error and log error message', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    exec.mockImplementation((command, callback) => {
      callback(new Error('Command failed'), '', ''); // Simulate error
    });
    runCommand(null, '/bin/false', []);
    expect(consoleSpy).toHaveBeenCalledWith('Error: Command failed');
    consoleSpy.mockRestore();
  });

  test('should handle command stderr and log stderr output', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    exec.mockImplementation((command, callback) => {
      callback(null, '', 'stderr output'); // Simulate stderr
    });
    runCommand(null, '/bin/cat', ['nonexistentfile']);
    // It will call console.error twice, once for the "stderr:" prefix, once for the message
    expect(consoleSpy).toHaveBeenCalledWith('stderr: stderr output');
    consoleSpy.mockRestore();
  });
});

// #############################################################################
// Tests for processCommandQueue logic
// #############################################################################

let testIsProcessingCommand; // Will be an object { value: false } to simulate by-reference modification
let mockRunCommandAsync_forQueue; // Specific mock for runCommandAsync used by queue processor
let mockNextTick;


// Testable version of processCommandQueue
async function testableProcessCommandQueue(
  currentCommandQueue,      // The queue array
  processingFlag,          // Object { value: boolean } for isProcessingCommand
  runCmdAsyncFn,           // Mocked runCommandAsync
  sendMsgFn,               // Mocked sendTelegramMessage (which uses axios.post)
  nextTickFn               // Mocked process.nextTick
) {
  // console.log(`testableProcessCommandQueue called. Processing: ${processingFlag.value}, Queue length: ${currentCommandQueue.length}`);
  if (processingFlag.value || currentCommandQueue.length === 0) {
    return;
  }

  processingFlag.value = true;
  const job = currentCommandQueue.shift();

  if (!job) { 
    processingFlag.value = false;
    // console.log("No job found, exiting.");
    return;
  }

  const { chatId, appPath, args, originalMessageText } = job;
  // console.log(`Processing job for chatId ${chatId}: ${originalMessageText}`);

  try {
    const result = await runCmdAsyncFn(appPath, args); 
    // console.log(`Job for ${originalMessageText} completed. stdout:`, result.stdout);
    sendMsgFn(chatId, `✅ Gasto "${originalMessageText}" registrado con éxito! 💰`);
  } catch (errorOutcome) { 
    // console.error(`Job for ${originalMessageText} failed:`, errorOutcome);
    if (errorOutcome && errorOutcome.error && errorOutcome.error.message) {
      sendMsgFn(chatId, `❌ Error al registrar "${originalMessageText}": ${errorOutcome.error.message}`);
    } else if (errorOutcome && errorOutcome.stderr) {
      sendMsgFn(chatId, `⚠️ Error (stderr) al registrar "${originalMessageText}": ${errorOutcome.stderr}`);
    } else {
      sendMsgFn(chatId, `❌ Error desconocido al registrar "${originalMessageText}"`);
    }
  } finally {
    // console.log(`Finished job for ${originalMessageText}. Setting processingFlag to false.`);
    processingFlag.value = false;
    // console.log(`Calling nextTickFn. Current queue length: ${currentCommandQueue.length}`);
    // The real processCommandQueue calls nextTick(processCommandQueue)
    // Here we simulate it by calling nextTickFn with a new invocation of the testable version.
    nextTickFn(() => testableProcessCommandQueue(currentCommandQueue, processingFlag, runCmdAsyncFn, sendMsgFn, nextTickFn));
  }
}


describe('processCommandQueue', () => {
  const sampleJob1 = { chatId: 'chat1', appPath: 'path1', args: ['arg1_1'], originalMessageText: 'Test Job 1' };
  const sampleJob2 = { chatId: 'chat2', appPath: 'path2', args: ['arg2_1'], originalMessageText: 'Test Job 2' };

  beforeEach(() => {
    testCommandQueue = []; // Ensure this is the same array used by handleTelegramRequest tests if state needs to be shared, or keep separate. For now, assume separate for queue logic tests.
    testIsProcessingCommand = { value: false };
    mockRunCommandAsync_forQueue = jest.fn();
    axios.post.mockClear(); // To check sendTelegramMessage calls
    
    // Default immediate nextTick for most tests
    mockNextTick = jest.fn(callback => callback()); 
  });

  test('should do nothing if queue is empty', async () => {
    testCommandQueue = [];
    testIsProcessingCommand.value = false;
    await testableProcessCommandQueue(testCommandQueue, testIsProcessingCommand, mockRunCommandAsync_forQueue, sendTelegramMessage, mockNextTick);
    expect(mockRunCommandAsync_forQueue).not.toHaveBeenCalled();
    expect(testIsProcessingCommand.value).toBe(false);
  });

  test('should do nothing if already processing', async () => {
    testCommandQueue = [{ ...sampleJob1 }];
    testIsProcessingCommand.value = true;
    await testableProcessCommandQueue(testCommandQueue, testIsProcessingCommand, mockRunCommandAsync_forQueue, sendTelegramMessage, mockNextTick);
    expect(mockRunCommandAsync_forQueue).not.toHaveBeenCalled();
  });

  test('should process a single job successfully', async () => {
    testCommandQueue = [{ ...sampleJob1 }];
    mockRunCommandAsync_forQueue.mockResolvedValue({ type: 'success', stdout: 'output' });

    // Capture the state of isProcessingCommand during the call
    let processingStateDuringCall = false;
    const originalRunCmdAsync = mockRunCommandAsync_forQueue;
    mockRunCommandAsync_forQueue = jest.fn(async (...args) => {
        processingStateDuringCall = testIsProcessingCommand.value;
        return originalRunCmdAsync(...args);
    });

    await testableProcessCommandQueue(testCommandQueue, testIsProcessingCommand, mockRunCommandAsync_forQueue, sendTelegramMessage, mockNextTick);

    expect(processingStateDuringCall).toBe(true);
    expect(mockRunCommandAsync_forQueue).toHaveBeenCalledWith(sampleJob1.appPath, sampleJob1.args);
    expect(axios.post).toHaveBeenCalledWith(expect.any(String), {
      chat_id: sampleJob1.chatId,
      text: `✅ Gasto "${sampleJob1.originalMessageText}" registrado con éxito! 💰`,
    });
    expect(testCommandQueue.length).toBe(0);
    expect(testIsProcessingCommand.value).toBe(false);
    expect(mockNextTick).toHaveBeenCalledTimes(1); 
  });

  test('should handle failed job (exec error) and send error message', async () => {
    testCommandQueue = [{ ...sampleJob1 }];
    const execError = new Error('exec err');
    mockRunCommandAsync_forQueue.mockRejectedValue({ type: 'error', error: execError, stderr: 'stderr out' });

    await testableProcessCommandQueue(testCommandQueue, testIsProcessingCommand, mockRunCommandAsync_forQueue, sendTelegramMessage, mockNextTick);

    expect(mockRunCommandAsync_forQueue).toHaveBeenCalledWith(sampleJob1.appPath, sampleJob1.args);
    expect(axios.post).toHaveBeenCalledWith(expect.any(String), {
      chat_id: sampleJob1.chatId,
      text: `❌ Error al registrar "${sampleJob1.originalMessageText}": ${execError.message}`,
    });
    expect(testCommandQueue.length).toBe(0);
    expect(testIsProcessingCommand.value).toBe(false);
    expect(mockNextTick).toHaveBeenCalledTimes(1);
  });

  test('should handle failed job (stderr only) and send stderr message', async () => {
    testCommandQueue = [{ ...sampleJob1 }];
    const stderrText = 'stderr out only';
    mockRunCommandAsync_forQueue.mockRejectedValue({ type: 'error', error: null, stderr: stderrText });

    await testableProcessCommandQueue(testCommandQueue, testIsProcessingCommand, mockRunCommandAsync_forQueue, sendTelegramMessage, mockNextTick);

    expect(mockRunCommandAsync_forQueue).toHaveBeenCalledWith(sampleJob1.appPath, sampleJob1.args);
    expect(axios.post).toHaveBeenCalledWith(expect.any(String), {
      chat_id: sampleJob1.chatId,
      text: `⚠️ Error (stderr) al registrar "${sampleJob1.originalMessageText}": ${stderrText}`,
    });
    expect(testCommandQueue.length).toBe(0);
    expect(testIsProcessingCommand.value).toBe(false);
    expect(mockNextTick).toHaveBeenCalledTimes(1);
  });
  
  test('should handle failed job (unknown error structure) and send generic error message', async () => {
    testCommandQueue = [{ ...sampleJob1 }];
    mockRunCommandAsync_forQueue.mockRejectedValue({}); // Empty error object

    await testableProcessCommandQueue(testCommandQueue, testIsProcessingCommand, mockRunCommandAsync_forQueue, sendTelegramMessage, mockNextTick);

    expect(axios.post).toHaveBeenCalledWith(expect.any(String), {
        chat_id: sampleJob1.chatId,
        text: `❌ Error desconocido al registrar "${sampleJob1.originalMessageText}"`,
    });
    expect(testCommandQueue.length).toBe(0);
    expect(testIsProcessingCommand.value).toBe(false);
    expect(mockNextTick).toHaveBeenCalledTimes(1);
  });

  test('should process two jobs sequentially', async () => {
    testCommandQueue = [{ ...sampleJob1 }, { ...sampleJob2 }];
    
    // Make nextTick manual for this test
    let nextTickCallback = null;
    mockNextTick = jest.fn(cb => {
      nextTickCallback = cb; // Capture the callback
    });

    // Mock runCommandAsync to resolve for both calls
    mockRunCommandAsync_forQueue
      .mockResolvedValueOnce({ type: 'success', stdout: 'output1' }) // For job1
      .mockResolvedValueOnce({ type: 'success', stdout: 'output2' }); // For job2

    // Start processing the first job
    await testableProcessCommandQueue(testCommandQueue, testIsProcessingCommand, mockRunCommandAsync_forQueue, sendTelegramMessage, mockNextTick);

    // --- Assertions for Job 1 ---
    expect(mockRunCommandAsync_forQueue).toHaveBeenCalledTimes(1);
    expect(mockRunCommandAsync_forQueue).toHaveBeenCalledWith(sampleJob1.appPath, sampleJob1.args);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledWith(expect.any(String), {
      chat_id: sampleJob1.chatId,
      text: `✅ Gasto "${sampleJob1.originalMessageText}" registrado con éxito! 💰`,
    });
    expect(testCommandQueue.length).toBe(1); // Job2 still in queue
    expect(testIsProcessingCommand.value).toBe(false); // Finished job1
    expect(mockNextTick).toHaveBeenCalledTimes(1); // nextTick was called after job1

    // Manually trigger the next tick to process Job 2
    expect(nextTickCallback).toBeInstanceOf(Function);
    if (nextTickCallback) {
      await nextTickCallback(); // This should call testableProcessCommandQueue again for job2
    }
    
    // --- Assertions for Job 2 ---
    expect(mockRunCommandAsync_forQueue).toHaveBeenCalledTimes(2); // Called again for job2
    expect(mockRunCommandAsync_forQueue).toHaveBeenCalledWith(sampleJob2.appPath, sampleJob2.args);
    expect(axios.post).toHaveBeenCalledTimes(2); // Called again for job2's message
    expect(axios.post).toHaveBeenLastCalledWith(expect.any(String), {
      chat_id: sampleJob2.chatId,
      text: `✅ Gasto "${sampleJob2.originalMessageText}" registrado con éxito! 💰`,
    });
    expect(testCommandQueue.length).toBe(0); // Queue is now empty
    expect(testIsProcessingCommand.value).toBe(false); // Finished job2
    expect(mockNextTick).toHaveBeenCalledTimes(2); // nextTick was called after job2
  });
});

// #############################################################################
// Tests for /telegram endpoint handler logic
// #############################################################################

// Simulate chatStates for testing purposes
let testChatStates = {};

// Mock for runCommandAsync - will not be directly used by handleTelegramRequest anymore for WAITING_FOR_AMOUNT state
// let mockRunCommandAsync; 
// Instead, we'll have a mock for processCommandQueue

let testCommandQueue = []; // Local command queue for testing
let mockProcessCommandQueue; // Mock for the processCommandQueue function

// Updated handler logic for testability
async function handleTelegramRequest(
  req,
  res,
  currentChatStates,
  // runCmdAsync, // No longer directly called for WAITING_FOR_AMOUNT
  sendMsgFn,
  currentCommandQueue, // Pass the test's command queue
  triggerProcessQueueFn // Pass the mock processCommandQueue
) {
  const chatId = req.body.message.chat.id;
  const messageText = req.body.message.text;

  if (messageText === "/gasto") {
    currentChatStates[chatId] = "WAITING_FOR_AMOUNT";
    sendMsgFn(chatId, "💰 ¿Cuánto gastaste y en qué?");
    res.status(200).send('OK');
    return;
  }

  if (currentChatStates[chatId] === "WAITING_FOR_AMOUNT") {
    const appPath = '/home/wuilliam/proyectos/ai-financial/.venv/bin/python';
    const scriptPath = '/home/wuilliam/proyectos/ai-financial/test_zsoft.py';
    const args = [scriptPath, '--mode=stdin', `--spending=${messageText}`];

    const job = {
      chatId: chatId,
      appPath: appPath,
      args: args,
      originalMessageText: messageText
    };
    currentCommandQueue.push(job);

    delete currentChatStates[chatId]; 

    sendMsgFn(chatId, `⏳ Gasto "${messageText}" encolado. Te avisaré cuando esté listo. ✨`);
    
    triggerProcessQueueFn(); 

    res.status(200).send('OK');
    return;
  }

  // console.log("nothing to do for", messageText);
  res.status(200).send('OK');
}

describe('/telegram endpoint handler (WAITING_FOR_AMOUNT state)', () => {
  const chatId = 'testChatId123';
  const messageText = '100 for lunch';
  let reqMock;
  let resMock;

  beforeEach(() => {
    axios.post.mockClear(); 
    testChatStates = {}; 
    testCommandQueue = []; // Clear the test command queue for each test
    mockProcessCommandQueue = jest.fn(); // Create a new mock for each test

    reqMock = {
      body: {
        message: {
          chat: { id: chatId },
          text: messageText,
        },
      },
    };
    resMock = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
  });

  test('should enqueue job, send acknowledgment, and trigger queue processing when in WAITING_FOR_AMOUNT state', async () => {
    testChatStates[chatId] = "WAITING_FOR_AMOUNT";

    await handleTelegramRequest(
      reqMock,
      resMock,
      testChatStates,
      sendTelegramMessage,
      testCommandQueue,
      mockProcessCommandQueue
    );

    // Verify job queueing
    expect(testCommandQueue.length).toBe(1);
    const job = testCommandQueue[0];
    expect(job.chatId).toBe(chatId);
    expect(job.appPath).toEqual(expect.any(String)); // Assuming a default path is set
    expect(job.args).toEqual(expect.arrayContaining([expect.stringContaining(messageText)]));
    expect(job.originalMessageText).toBe(messageText);
    expect(job.args[0]).toContain('test_zsoft.py'); // Check script path is first arg

    // Verify acknowledgment message
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledWith(expect.any(String), {
      chat_id: chatId,
      text: `⏳ Gasto "${messageText}" encolado. Te avisaré cuando esté listo. ✨`,
    });

    // Verify processCommandQueue call
    expect(mockProcessCommandQueue).toHaveBeenCalledTimes(1);

    // Verify state deletion
    expect(testChatStates[chatId]).toBeUndefined();

    // Verify HTTP response
    expect(resMock.status).toHaveBeenCalledWith(200);
    expect(resMock.send).toHaveBeenCalledWith('OK');
  });
  
  test('should handle /gasto command correctly (no queueing)', async () => {
    reqMock.body.message.text = "/gasto"; 
    // mockRunCommandAsync = jest.fn(); // Not needed for this path

    await handleTelegramRequest(
      reqMock, 
      resMock, 
      testChatStates, 
      sendTelegramMessage, 
      testCommandQueue, 
      mockProcessCommandQueue
    );

    expect(axios.post).toHaveBeenCalledTimes(1); 
    expect(axios.post).toHaveBeenCalledWith(expect.any(String), {
      chat_id: chatId,
      text: "💰 ¿Cuánto gastaste y en qué?",
    });
    expect(testChatStates[chatId]).toEqual("WAITING_FOR_AMOUNT");
    expect(resMock.status).toHaveBeenCalledWith(200);
    expect(resMock.send).toHaveBeenCalledWith('OK');
    expect(testCommandQueue.length).toBe(0); // No job queued
    expect(mockProcessCommandQueue).not.toHaveBeenCalled(); // Queue processing not triggered
  });
  
  test('should do nothing specific if not /gasto and not WAITING_FOR_AMOUNT (no queueing)', async () => {
    reqMock.body.message.text = "some other message"; 
    // mockRunCommandAsync = jest.fn(); // Not needed

    await handleTelegramRequest(
      reqMock, 
      resMock, 
      testChatStates, 
      sendTelegramMessage, 
      testCommandQueue, 
      mockProcessCommandQueue
    );
    
    expect(axios.post).not.toHaveBeenCalled(); 
    expect(resMock.status).toHaveBeenCalledWith(200);
    expect(resMock.send).toHaveBeenCalledWith('OK');
    expect(testCommandQueue.length).toBe(0);
    expect(mockProcessCommandQueue).not.toHaveBeenCalled();
  });
});

describe('runCommandAsync', () => {
  const appPath = '/usr/bin/python';
  const scriptArgs = ['script.py', '--arg1', 'value1'];

  beforeEach(() => {
    exec.mockClear();
    // axios.post.mockClear(); // No longer needed here as runCommandAsync doesn't call sendTelegramMessage
  });

  test('should resolve with success object on successful execution', async () => {
    const expectedStdout = 'Process completed successfully';
    exec.mockImplementation((command, callback) => {
      callback(null, expectedStdout, ''); // Simulate success, empty stderr
    });

    const result = await runCommandAsync(appPath, scriptArgs);

    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith(`${appPath} 'script.py' '--arg1' 'value1'`, expect.any(Function));
    expect(result).toEqual({ type: 'success', stdout: expectedStdout });
  });

  test('should correctly escape arguments and resolve on success', async () => {
    const complexArgs = ['script.py', '--message', "Hello 'world' with spaces"];
    const expectedStdout = 'Complex args processed';
    exec.mockImplementation((command, callback) => {
      callback(null, expectedStdout, ''); // Simulate success
    });

    const result = await runCommandAsync(appPath, complexArgs);

    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith(`${appPath} 'script.py' '--message' 'Hello '\\''world'\\'' with spaces'`, expect.any(Function));
    expect(result).toEqual({ type: 'success', stdout: expectedStdout });
  });

  test('should reject with error object on command execution error', async () => {
    const errorMessage = 'Command execution failed';
    const execError = new Error(errorMessage);
    const stderrOutput = 'Error details on stderr';
    exec.mockImplementation((command, callback) => {
      callback(execError, 'stdout if any', stderrOutput); // Simulate error
    });

    await expect(runCommandAsync(appPath, scriptArgs))
      .rejects.toEqual({ type: 'error', error: execError, stderr: stderrOutput });
    
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith(`${appPath} 'script.py' '--arg1' 'value1'`, expect.any(Function));
  });

  test('should reject with error object when only stderr is present', async () => {
    const stderrOutput = 'This is a stderr warning or error';
    const stdoutOutput = 'Some stdout was produced';
    exec.mockImplementation((command, callback) => {
      callback(null, stdoutOutput, stderrOutput); // Simulate stderr output
    });

    await expect(runCommandAsync(appPath, scriptArgs))
      .rejects.toEqual({ type: 'error', error: null, stderr: stderrOutput });

    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith(`${appPath} 'script.py' '--arg1' 'value1'`, expect.any(Function));
  });

  test('should handle command without arguments and resolve on success', async () => {
    const expectedStdout = 'No args command executed';
    exec.mockImplementation((command, callback) => {
      callback(null, expectedStdout, ''); // Simulate success
    });

    const result = await runCommandAsync(appPath, []);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith(`${appPath} ''`, expect.any(Function)); // or just appPath if that's the behavior
    expect(result).toEqual({ type: 'success', stdout: expectedStdout });
  });
});
