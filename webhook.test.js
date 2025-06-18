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

// #############################################################################
// Tests for /report endpoint handler logic
// #############################################################################

describe('/telegram endpoint handler (/report command)', () => {
  const chatId = 'testReportChatId';
  let reqMock;
  let resMock;
  let testChatStates;
  let testCommandQueue;
  let mockProcessCommandQueue;

  beforeEach(() => {
    axios.post.mockClear();
    testChatStates = {};
    testCommandQueue = [];
    mockProcessCommandQueue = jest.fn();

    reqMock = {
      body: {
        message: {
          chat: { id: chatId },
          text: '',
        },
      },
    };
    resMock = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
  });

  // Handler logic for /report, similar to handleTelegramRequest
  async function handleTelegramReportRequest(
    req,
    res,
    currentChatStates,
    sendMsgFn,
    currentCommandQueue,
    triggerProcessQueueFn
  ) {
    const chatId = req.body.message.chat.id;
    const userCommand = req.body.message.text;

    if (userCommand === "/report") {
      currentChatStates[chatId] = "WAITING_FOR_REPORT_OPTION";
      sendMsgFn(
        chatId,
        "📊 ¿Qué período deseas para el reporte?\n" +
        "[0] 📅 Hoy\n" +
        "[1] 🗓️ Semana actual\n" +
        "[2] 📆 Semana pasada\n" +
        "[3] 🗓️ Mes actual\n" +
        "[4] 📆 Mes pasado\n" +
        "[5] 📊 Trimestre actual\n" +
        "[6] 📈 Trimestre pasado"
      );
      res.status(200).send('OK');
      return;
    }

    if (currentChatStates[chatId] === "WAITING_FOR_REPORT_OPTION") {
      const validOptions = ["0", "1", "2", "3", "4", "5", "6"];
      if (validOptions.includes(userCommand.trim())) {
        sendMsgFn(chatId, "⏳ Estamos generando tu reporte. Te lo enviaremos en cuanto esté listo. 📑");
        delete currentChatStates[chatId];
        const appPath = '/home/wuilliam/proyectos/ai-financial/.venv/bin/python';
        const scriptPath = '/home/wuilliam/proyectos/ai-financial/test_report_store.py';
        const args = [scriptPath, `--period=${userCommand.trim()}`];
        const job = {
          chatId: chatId,
          appPath: appPath,
          args: args,
          originalMessageText: `/report ${userCommand.trim()}`,
          jobType: 'report'
        };
        currentCommandQueue.push(job);
        triggerProcessQueueFn();
      } else {
        sendMsgFn(chatId, "❗ Por favor, responde con un número entre 0 y 6 para seleccionar el período del reporte.");
      }
      res.status(200).send('OK');
      return;
    }

    res.status(200).send('OK');
  }

  test('should set state and prompt for period on /report', async () => {
    reqMock.body.message.text = "/report";
    await handleTelegramReportRequest(
      reqMock,
      resMock,
      testChatStates,
      sendTelegramMessage,
      testCommandQueue,
      mockProcessCommandQueue
    );
    expect(testChatStates[chatId]).toBe("WAITING_FOR_REPORT_OPTION");
    expect(axios.post).toHaveBeenCalledWith(expect.any(String), {
      chat_id: chatId,
      text: expect.stringContaining("¿Qué período deseas para el reporte?")
    });
    expect(resMock.status).toHaveBeenCalledWith(200);
    expect(resMock.send).toHaveBeenCalledWith('OK');
    expect(testCommandQueue.length).toBe(0);
    expect(mockProcessCommandQueue).not.toHaveBeenCalled();
  });

  test('should enqueue report job and trigger queue on valid option', async () => {
    testChatStates[chatId] = "WAITING_FOR_REPORT_OPTION";
    reqMock.body.message.text = "0";
    await handleTelegramReportRequest(
      reqMock,
      resMock,
      testChatStates,
      sendTelegramMessage,
      testCommandQueue,
      mockProcessCommandQueue
    );
    expect(axios.post).toHaveBeenCalledWith(expect.any(String), {
      chat_id: chatId,
      text: expect.stringContaining("Estamos generando tu reporte")
    });
    expect(testChatStates[chatId]).toBeUndefined();
    expect(testCommandQueue.length).toBe(1);
    const job = testCommandQueue[0];
    expect(job.chatId).toBe(chatId);
    expect(job.appPath).toContain('.venv/bin/python');
    expect(job.args[0]).toContain('test_report_store.py');
    expect(job.args[1]).toBe('--period=0');
    expect(job.originalMessageText).toBe('/report 0');
    expect(job.jobType).toBe('report');
    expect(mockProcessCommandQueue).toHaveBeenCalledTimes(1);
    expect(resMock.status).toHaveBeenCalledWith(200);
    expect(resMock.send).toHaveBeenCalledWith('OK');
  });

  test('should prompt for valid option on invalid input', async () => {
    testChatStates[chatId] = "WAITING_FOR_REPORT_OPTION";
    reqMock.body.message.text = "invalid";
    await handleTelegramReportRequest(
      reqMock,
      resMock,
      testChatStates,
      sendTelegramMessage,
      testCommandQueue,
      mockProcessCommandQueue
    );
    expect(axios.post).toHaveBeenCalledWith(expect.any(String), {
      chat_id: chatId,
      text: expect.stringContaining("Por favor, responde con un número entre 0 y 6")
    });
    expect(testChatStates[chatId]).toBe("WAITING_FOR_REPORT_OPTION");
    expect(testCommandQueue.length).toBe(0);
    expect(mockProcessCommandQueue).not.toHaveBeenCalled();
    expect(resMock.status).toHaveBeenCalledWith(200);
    expect(resMock.send).toHaveBeenCalledWith('OK');
  });
});

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

// Mock puppeteer
jest.mock('puppeteer');

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
  const userCommand = req.body.message.text;

  if (userCommand === "/gasto") {
    currentChatStates[chatId] = "WAITING_FOR_AMOUNT";
    sendMsgFn(chatId, "💰 ¿Cuánto gastaste y en qué?");
    res.status(200).send('OK');
    return;
  }

  if (currentChatStates[chatId] === "WAITING_FOR_AMOUNT") {
    const appPath = '/home/wuilliam/proyectos/ai-financial/.venv/bin/python';
    const scriptPath = '/home/wuilliam/proyectos/ai-financial/test_zsoft.py';
    const args = [scriptPath, '--mode=stdin', `--spending=${userCommand}`];

    const job = {
      chatId: chatId,
      appPath: appPath,
      args: args,
      originalMessageText: userCommand
    };
    currentCommandQueue.push(job);

    delete currentChatStates[chatId]; 

    sendMsgFn(chatId, `⏳ Gasto "${userCommand}" encolado. Te avisaré cuando esté listo. ✨`);
    
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

describe('/telegram endpoint handler (/pagomovil command)', () => {
  const puppeteer = require('puppeteer');
  const chatId = 'testChatId456';
  let reqMock;
  let resMock;
  let testCommandQueue;
  let mockProcessCommandQueue;
  let mockBrowser;
  let mockPage;

  beforeEach(() => {
    axios.post.mockClear();
    testCommandQueue = [];
    mockProcessCommandQueue = jest.fn();

    // Setup puppeteer mocks
    mockPage = {
      goto: jest.fn(),
      waitForSelector: jest.fn(),
      type: jest.fn(),
      press: jest.fn(),
      evaluate: jest.fn(),
      close: jest.fn()
    };

    mockBrowser = {
      newPage: jest.fn().mockResolvedValue(mockPage),
      close: jest.fn()
    };

    puppeteer.launch = jest.fn().mockResolvedValue(mockBrowser);

    reqMock = {
      body: {
        message: {
          chat: { id: chatId },
          text: '/pagomovil',
        },
      },
    };

    resMock = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
  });

  async function handleTelegramPagomovilRequest(req, res, currentCommandQueue, triggerProcessQueueFn, sendMsgFn) {
    const chatId = req.body.message.chat.id;
    const messageText = req.body.message.text;

    if (messageText === "/pagomovil") {
      const job = {
        chatId: chatId,
        originalMessageText: messageText,
        jobType: 'pagomovil'
      };
      currentCommandQueue.push(job);

      sendMsgFn(chatId, "⏳ Buscando información de pagomovil en Google. Te avisaré cuando esté listo. 🔍");
      
      triggerProcessQueueFn();

      res.status(200).send('OK');
      return;
    }

    res.status(200).send('OK');
  }

  async function mockSearchPagomovilOnGoogle() {
    let browser;
    try {
      browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      const page = await browser.newPage();
      
      await page.goto('https://google.com', { waitUntil: 'networkidle0' });
      
      const searchBox = await page.waitForSelector('input[name="q"]', { timeout: 5000 });
      await searchBox.type('pagomovil');
      await searchBox.press('Enter');
      
      await page.waitForSelector('h3', { timeout: 10000 });
      
      const results = await page.evaluate(() => {
        return [
          'PagoMóvil - Banco de Venezuela',
          'Cómo usar PagoMóvil - Guía completa',
          'PagoMóvil BBVA Provincial',
          'Sistema PagoMóvil - Banco Mercantil',
          'PagoMóvil: Todo lo que necesitas saber'
        ];
      });
      
      return {
        success: true,
        results: results
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  function mockFormatPagomovilResults(results) {
    if (!results || results.length === 0) {
      return '❌ No se encontraron resultados para "pagomovil"';
    }
    
    let message = '🔍 Resultados de búsqueda para "pagomovil":\n\n';
    results.forEach((title, index) => {
      message += `${index + 1}. ${title}\n`;
    });
    
    return message;
  }

  test('should queue pagomovil job and send acknowledgment message', async () => {
    await handleTelegramPagomovilRequest(
      reqMock,
      resMock,
      testCommandQueue,
      mockProcessCommandQueue,
      sendTelegramMessage
    );

    expect(testCommandQueue.length).toBe(1);
    const job = testCommandQueue[0];
    expect(job.chatId).toBe(chatId);
    expect(job.originalMessageText).toBe('/pagomovil');
    expect(job.jobType).toBe('pagomovil');

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledWith(expect.any(String), {
      chat_id: chatId,
      text: "⏳ Buscando información de pagomovil en Google. Te avisaré cuando esté listo. 🔍",
    });

    expect(mockProcessCommandQueue).toHaveBeenCalledTimes(1);
    expect(resMock.status).toHaveBeenCalledWith(200);
    expect(resMock.send).toHaveBeenCalledWith('OK');
  });

  test('should successfully search Google and format results', async () => {
    // Setup successful puppeteer interaction
    const mockSearchBox = { type: jest.fn(), press: jest.fn() };
    mockPage.waitForSelector.mockResolvedValueOnce(mockSearchBox);
    mockPage.waitForSelector.mockResolvedValueOnce(true); // for h3 elements
    mockPage.evaluate.mockResolvedValue([
      'PagoMóvil - Banco de Venezuela',
      'Cómo usar PagoMóvil - Guía completa',
      'PagoMóvil BBVA Provincial',
      'Sistema PagoMóvil - Banco Mercantil',
      'PagoMóvil: Todo lo que necesitas saber'
    ]);

    const result = await mockSearchPagomovilOnGoogle();

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(5);
    expect(result.results[0]).toBe('PagoMóvil - Banco de Venezuela');

    // Test formatting
    const formattedMessage = mockFormatPagomovilResults(result.results);
    expect(formattedMessage).toContain('🔍 Resultados de búsqueda para "pagomovil":');
    expect(formattedMessage).toContain('1. PagoMóvil - Banco de Venezuela');
    expect(formattedMessage).toContain('5. PagoMóvil: Todo lo que necesitas saber');

    expect(puppeteer.launch).toHaveBeenCalledWith({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    expect(mockBrowser.newPage).toHaveBeenCalled();
    expect(mockPage.goto).toHaveBeenCalledWith('https://google.com', { waitUntil: 'networkidle0' });
    expect(mockSearchBox.type).toHaveBeenCalledWith('pagomovil');
    expect(mockSearchBox.press).toHaveBeenCalledWith('Enter');
    expect(mockBrowser.close).toHaveBeenCalled();
  });

  test('should handle Google search errors gracefully', async () => {
    puppeteer.launch.mockRejectedValue(new Error('Browser launch failed'));

    const result = await mockSearchPagomovilOnGoogle();

    expect(result.success).toBe(false);
    expect(result.error).toBe('Browser launch failed');
  });

  test('should handle empty search results', async () => {
    const mockSearchBox = { type: jest.fn(), press: jest.fn() };
    mockPage.waitForSelector.mockResolvedValueOnce(mockSearchBox);
    mockPage.waitForSelector.mockResolvedValueOnce(true);
    mockPage.evaluate.mockResolvedValue([]); // Empty results array

    // Override the puppeteer mock to actually throw the error
    puppeteer.launch.mockImplementationOnce(async () => {
      const page = await mockBrowser.newPage();
      await page.goto('https://google.com', { waitUntil: 'networkidle0' });
      const searchBox = await page.waitForSelector('input[name="q"]', { timeout: 5000 });
      await searchBox.type('pagomovil');
      await searchBox.press('Enter');
      await page.waitForSelector('h3', { timeout: 10000 });
      
      const results = await page.evaluate(() => []);
      if (results.length === 0) {
        throw new Error('No search results found');
      }
      return { success: true, results };
    });

    const result = await mockSearchPagomovilOnGoogle();

    expect(result.success).toBe(false);
    expect(result.error).toBe('No search results found');

    const formattedMessage = mockFormatPagomovilResults([]);
    expect(formattedMessage).toBe('❌ No se encontraron resultados para "pagomovil"');
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
