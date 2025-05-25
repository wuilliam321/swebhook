const express = require("express");
const axios = require('axios');
const { exec } = require('child_process');

const app = express();
app.use(express.json());

const { WEBHOOK_VERIFY_TOKEN, GRAPH_API_TOKEN, PHONE_ID, PORT, GENERATOR_URL, TELEGRAM_TOKEN, PM_CEDULA, PM_PASS } = process.env;

const commandQueue = [];
let isProcessingCommand = false;

const sendFBMessage = async (to, text) => {
  const req = {
    messaging_product: "whatsapp",
    to,
    text: { body: text },
  }
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v20.0/${PHONE_ID}/messages`,
      req,
      {
        headers: {
          Authorization: `Bearer ${GRAPH_API_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    if (response.status != 200) {
      return {
        success: false,
        message: response.statusText,
      }
    }
    return {
      success: true,
      message: text,
    }
  } catch (error) {
    console.error(
      "Error sending message:",
      error.response ? error.response.data : error.message
    );
    return {
      success: false,
      message: error.response ? error.response.data : error.message,
    }
  }
};

async function generateRequest(body) {
  try {
    const response = await axios.post(GENERATOR_URL + '/generate',
      body,
      {
        headers: {
          'Content-Type': 'application/json',
          'accept': 'application/json',
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error('Error:', error);
  }
}

function runCommand(res, appPath, args) {
  // Simple quoting for arguments. This might need to be more robust
  // depending on the shell and potential argument content.
  const escapedArgs = args.map(arg => `'${arg.replace(/'/g, "'\\''")}'`).join(' ');
  const cmd = `${appPath} ${escapedArgs}`;
  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error: ${error.message}`);
      // Consider how to send error back via res if needed
      return;
    }
    if (stderr) {
      console.error(`stderr: ${stderr}`);
      // Consider how to send error back via res if needed
      return;
    }
    console.log(`stdout: ${stdout}`);
    // Consider how to send stdout back via res if needed
  });
}

function sendTelegramMessage(chatId, message) {
  axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    chat_id: chatId,
    text: message
  })
    .then(response => {
      console.log(`Mensaje "${message}" enviado con éxito`);
    })
    .catch(error => {
      console.error(`Error al enviar mensaje "${message}":`, error);
    });
}

async function runCommandAsync(appPath, args) {
  return new Promise((resolve, reject) => {
    // Simple quoting for arguments. This might need to be more robust
    // depending on the shell and potential argument content.
    const escapedArgs = args.map(arg => `'${arg.replace(/'/g, "'\\''")}'`).join(' ');
    const cmd = `${appPath} ${escapedArgs || "''"}`; // Ensure at least empty quotes if no args

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        // Execution error (e.g., command not found, non-zero exit code)
        console.error(`Error executing command: ${error.message}`);
        console.error(`stderr: ${stderr}`); // Log stderr here as it often contains useful info on error
        reject({ type: 'error', error: error, stderr: stderr });
      } else if (stderr) {
        // Command executed successfully but produced output on stderr
        // This might be treated as an error or warning depending on the use case.
        // For this refactoring, we'll treat it as a reason to reject,
        // allowing the caller to decide if stderr output is acceptable.
        console.warn(`Command produced stderr: ${stderr}`);
        reject({ type: 'error', error: null, stderr: stderr });
      } else {
        // Success
        console.log(`stdout: ${stdout}`);
        resolve({ type: 'success', stdout: stdout });
      }
    });
  });
}

async function processCommandQueue() {
  if (isProcessingCommand || commandQueue.length === 0) {
    return;
  }

  isProcessingCommand = true;
  const job = commandQueue.shift();

  if (!job) { // Should not happen if length check is done, but as a safeguard
    isProcessingCommand = false;
    return;
  }

  const { chatId, appPath, args, originalMessageText, jobType } = job;

  console.log(`Processing job for chatId ${chatId}: ${originalMessageText} (type: ${jobType || 'gasto'})`);

  try {
    if (jobType === 'pagomovil') {
      console.log('Processing pagomovil search...');
      // Default to pagomovil processing
      const result = await runCommandAsync(appPath, args);
      console.log(`Job for ${originalMessageText} completed. stdout:`, result.stdout);
      sendTelegramMessage(chatId, `💳 *Transacciones PagoMóvil - BBVA Provincial*\n\n${result.stdout}`);

      console.log(`Pagomovil search completed successfully for ${originalMessageText}`);
    }

    if (jobType === 'gasto') {
      // Default to gasto processing
      const result = await runCommandAsync(appPath, args);
      console.log(`Job for ${originalMessageText} completed. stdout:`, result.stdout);
      sendTelegramMessage(chatId, `✅ Gasto "${originalMessageText}" registrado con éxito! 💰`);
    }
  } catch (errorOutcome) {
    console.error(`Job for ${originalMessageText} failed:`, errorOutcome);

    if (jobType === 'pagomovil') {
      sendTelegramMessage(chatId, `❌ Error inesperado buscando pagomovil: ${errorOutcome.message || 'Error desconocido'}`);
    }

    if (jobType === 'gasto') {
      // Handle gasto errors as before
      if (errorOutcome.error && errorOutcome.error.message) {
        sendTelegramMessage(chatId, `❌ Error al registrar "${originalMessageText}": ${errorOutcome.error.message}`);
      } else if (errorOutcome.stderr) {
        sendTelegramMessage(chatId, `⚠️ Error (stderr) al registrar "${originalMessageText}": ${errorOutcome.stderr}`);
      } else {
        sendTelegramMessage(chatId, `❌ Error desconocido al registrar "${originalMessageText}"`);
      }
    }
  } finally {
    isProcessingCommand = false;
    // Trigger processing for the next item in the queue, if any.
    // Use process.nextTick or setTimeout to avoid potential deep recursion issues if many jobs are processed synchronously.
    process.nextTick(processCommandQueue);
  }
}


async function simulateHumanTyping(page, selector, text) {
  // Click on the input field first
  await page.click(selector);

  // Clear any existing content
  await page.evaluate((sel) => {
    document.querySelector(sel).value = '';
  }, selector);

  // Type each character with human-like delays
  for (let char of text) {
    await page.type(selector, char, {
      delay: 80 + Math.random() * 120 // Random delay between 80-200ms per character
    });

  }
}

const chatStates = {};

app.post("/telegram", async (req, res) => {
  const chatId = req.body.message.chat.id;
  const messageText = req.body.message.text;

  console.log("CHAT req", messageText);

  if (messageText === "/gasto") {
    chatStates[chatId] = "WAITING_FOR_AMOUNT";
    sendTelegramMessage(chatId, "💰 ¿Cuánto gastaste y en qué?");
    res.status(200).send('OK');
    return;
  }

  if (messageText === "/pagomovil") {
    const appPath = '/home/wuilliam/proyectos/ai-financial/.venv/bin/python'; // Or from config
    const scriptPath = '/home/wuilliam/proyectos/ai-financial/test_pagomovil.py'; // Or from config
    const args = [scriptPath];
    const job = {
      chatId: chatId,
      appPath: appPath,
      args: args,
      originalMessageText: messageText,
      jobType: 'pagomovil'
    };
    commandQueue.push(job);

    delete chatStates[chatId]; // Delete state *after* queuing the job.

    sendTelegramMessage(chatId, "⏳ Consultando transacciones de PagoMóvil en BBVA Provincial. Te avisaré cuando esté listo. 🔍");

    processCommandQueue(); // Kick off processing if not already running

    res.status(200).send('OK');
    return;
  }

  if (chatStates[chatId] === "WAITING_FOR_AMOUNT") {
    // New logic:
    const appPath = '/home/wuilliam/proyectos/ai-financial/.venv/bin/python'; // Or from config
    const scriptPath = '/home/wuilliam/proyectos/ai-financial/test_zsoft.py'; // Or from config
    // Note: In runCommandAsync, the scriptPath was the first element of the args array.
    // The new processCommandQueue job structure has `args` which is directly passed to runCommandAsync.
    // So, scriptPath should be the first element in this args array.
    const args = [scriptPath, '--mode=stdin', `--spending=${messageText}`];

    const job = {
      chatId: chatId,
      appPath: appPath,
      args: args,
      originalMessageText: messageText, // Store the original message for notifications
      jobType: 'gasto'
    };
    commandQueue.push(job);

    delete chatStates[chatId]; // Delete state *after* queuing the job.

    sendTelegramMessage(chatId, `⏳ Gasto "${messageText}" encolado. Te avisaré cuando esté listo. ✨`);

    processCommandQueue(); // Kick off processing if not already running

    res.status(200).send('OK');
    return;
  }

  console.log("nothing to do for", messageText);

  res.status(200).send('OK');
})

app.post("/chat", async (req, res) => {
  console.log("CHAT req", req["body"]);
  const appPath = '/home/wuilliam/proyectos/ai-financial/.venv/bin/python';
  const scriptPath = '/home/wuilliam/proyectos/ai-financial/test_zsoft.py';
  const args = ['--mode=stdin', `--spending=${req["body"]["message"]}`];
  runCommand(res, appPath, [scriptPath, ...args]); // Pass scriptPath as an arg
  res.send({
    "response": "en breve quedara registrado",
    "context_id": req["body"].context_id
  });
})

app.post("/webhook", async (req, res) => {
  const entry = req.body.entry[0];
  const changes = entry.changes[0];
  const value = changes.value;
  const message = value.messages && value.messages[0];

  console.log('req', JSON.stringify(req.body));

  if (message && message.text && message.text.body) {
    const res = await generateRequest({
      username: req.body.entry[0].id,
      message: message.text.body
    });
    await sendFBMessage(message.from, res.signedUrl)
    console.log("sent", message.text.body, "=>", res.signedUrl)
  }
  res.sendStatus(200);
});

// accepts GET requests at the /webhook endpoint. You need this URL to setup webhook initially.
// info on verification request payload: https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // check the mode and token sent are correct
  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    // respond with 200 OK and challenge token from the request
    res.status(200).send(challenge);
    console.log("Webhook verified successfully!");
  } else {
    // respond with '403 Forbidden' if verify tokens do not match
    res.sendStatus(403);
  }
});

app.get("/", (req, res) => {
  res.send(`<pre>Nothing to see here.
Checkout README.md to start.</pre>`);
});

app.listen(PORT, () => {
  console.log(`Server is listening on port: ${PORT}`);
});
