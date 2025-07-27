const express = require("express");
const axios = require('axios').default;
const { exec } = require('child_process');

const app = express();
app.use(express.json());

const { WEBHOOK_VERIFY_TOKEN, GRAPH_API_TOKEN, PHONE_ID, PORT, GENERATOR_URL, TELEGRAM_TOKEN } = process.env;

// Bot token management - dynamically load from environment variables
const BOT_TOKENS = {};

// Load all bot tokens from environment variables using a naming pattern
Object.keys(process.env).forEach(key => {
  if (key.startsWith('TELEGRAM_TOKEN_')) {
    const botName = key.replace('TELEGRAM_TOKEN_', '').toLowerCase();
    BOT_TOKENS[botName] = process.env[key];
  }
});

// Add default token
BOT_TOKENS.default = TELEGRAM_TOKEN;

// Validate required tokens at startup
const requiredBots = ['septimodiaboutique_bot'];
requiredBots.forEach(botName => {
  const token = BOT_TOKENS[botName.toLowerCase()];
  if (!token) {
    console.warn(`Warning: Missing token for bot '${botName}'. Environment variable TELEGRAM_TOKEN_${botName.toUpperCase()} is not set.`);
  }
});

// Extract bot name from commands with format /command@botname
function extractBotName(command) {
  if (!command) return null;
  const atIndex = command.indexOf('@');
  if (atIndex !== -1) {
    return command.substring(atIndex + 1).toLowerCase();
  }
  return null;
}

// Extract base command from /command@botname format
function extractBaseCommand(command) {
  if (!command) return command;
  const atIndex = command.indexOf('@');
  if (atIndex !== -1) {
    return command.substring(0, atIndex);
  }
  return command;
}

// Get token for a specific bot name
function getTokenForBot(botName) {
  if (!botName) return BOT_TOKENS.default;
  return BOT_TOKENS[botName.toLowerCase()] || BOT_TOKENS.default;
}

// Check if a bot name is valid
function isValidBotName(botName) {
  return botName && (BOT_TOKENS[botName.toLowerCase()] !== undefined);
}

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

function runCommand(_, appPath, args) {
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

// Escape special characters for MarkdownV2
function escapeMarkdownV2(text) {
  return text
    .replace(/[_*[\]()~`>#+\-=|{}.!]/g, ch => '\\' + ch);
}

// Parse product lookup JSON output and return formatted message and image URL
function parseProductLookup(jsonOutput, isGroupChat = false) {
  try {
    const data = JSON.parse(jsonOutput);
    let productData = data
    let groupProducts = [];

    // Check if we have a group structure or a single product
    if (data.group && data.groupProducts && Array.isArray(data.groupProducts)) {
      // We have a group structure
      groupProducts = data.groupProducts;
    }

    // Format the message with emoji and organized sections
    const formattedMessage = [
      `👗 ${productData.Categoria} - ${productData.Codigo}`,
      `📝 ${productData.Descripcion}`,
      `🎨 Color: ${productData.Color}`,
      `📏 Talla: ${productData.Talla}`,
      ``,
      `🏪 Tienda: ${productData.Tienda}`,
      ``
    ];
    
    // Only show purchase price in private chats
    if (!isGroupChat) {
      formattedMessage.push(`💰 Precio de Compra: $${productData["Precio de Compra"]}`);
    }
    
    formattedMessage.push(`💵 Precio de Venta: $${productData.Monto}`);
    formattedMessage.push(`${productData.Operacion === 'APARTADO' ? '🔒' : productData.Operacion === 'VENDIDO' ? '❌' : productData.Operacion === 'DISPONIBLE' ? '✅' : '🔄'} Estado: ${productData.Operacion}`);
    

    // Add other products in the same group if any
    if (groupProducts.length > 0) {
      formattedMessage.push('');
      formattedMessage.push('📦 Otros del mismo grupo:');

      // Group products by their status for better organization
      const productsByStatus = {
        'DISPONIBLE': [],
        'APARTADO': [],
        'VENDIDO': [],
        'other': []
      };
      
      // Sort products into groups by status
      groupProducts.forEach(product => {
        if (productsByStatus[product.Operacion]) {
          productsByStatus[product.Operacion].push(product);
        } else {
          productsByStatus.other.push(product);
        }
      });
      
      // Display products grouped by status, one per line
      if (productsByStatus.DISPONIBLE.length > 0) {
        formattedMessage.push(`✅ Disponibles:`);
        productsByStatus.DISPONIBLE.forEach(product => {
          formattedMessage.push(`${product.Codigo}-${product.Talla}-${product.Color}-${product.Tienda}`);
        });
      }
      
      if (productsByStatus.APARTADO.length > 0) {
        formattedMessage.push(`🔒 Apartados:`);
        productsByStatus.APARTADO.forEach(product => {
          formattedMessage.push(`${product.Codigo}-${product.Talla}-${product.Color}-${product.Tienda}`);
        });
      }
      
      if (productsByStatus.VENDIDO.length > 0) {
        formattedMessage.push(`❌ Vendidos:`);
        productsByStatus.VENDIDO.forEach(product => {
          formattedMessage.push(`${product.Codigo}-${product.Talla}-${product.Color}-${product.Tienda}`);
        });
      }
      
      if (productsByStatus.other.length > 0) {
        formattedMessage.push(`🔄 Otros:`);
        productsByStatus.other.forEach(product => {
          formattedMessage.push(`${product.Codigo}-${product.Talla}-${product.Color}-${product.Tienda} [${product.Operacion}]`);
        });
      }
    }

    return {
      message: formattedMessage.join('\n'),
      imageUrl: productData.Image || null
    };
  } catch (error) {
    console.error('Error parsing product lookup JSON:', error);
    return {
      message: `Error al procesar la información del producto: ${error.message}`,
      imageUrl: null
    };
  }
}

async function sendTelegramMessage(chatId, message, token = TELEGRAM_TOKEN) {
  const escapedOutput = escapeMarkdownV2(message);
  return axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text: escapedOutput,
    parse_mode: 'MarkdownV2'
  })
    .then(() => {
      console.log(`Mensaje "${message}" enviado con éxito`);
      return { success: true };
    })
    .catch(error => {
      console.error(`Error al enviar mensaje "${message}":`, error);
      return { success: false, error };
    });
}

// Function to send product details with image
async function sendProductDetails(chatId, jsonOutput, token = TELEGRAM_TOKEN, isGroupChat = false) {
  try {
    const { message, imageUrl } = parseProductLookup(jsonOutput, isGroupChat);

    // If we have an image URL, send photo with caption
    if (imageUrl) {
      return axios.post(`https://api.telegram.org/bot${token}/sendPhoto`, {
        chat_id: chatId,
        photo: imageUrl,
        caption: escapeMarkdownV2(message),
        parse_mode: 'MarkdownV2'
      })
        .then(() => {
          console.log(`Mensaje de producto con imagen enviado con éxito`);
          return { success: true };
        })
        .catch(error => {
          console.error(`Error al enviar mensaje de producto con imagen:`, error);
          // Fallback to text-only message if sending image fails
          return sendTelegramMessage(chatId, message, token);
        });
    } else {
      // If no image URL, send text-only message
      return sendTelegramMessage(chatId, message, token);
    }
  } catch (error) {
    console.error('Error sending product details:', error);
    return sendTelegramMessage(chatId, `❌ Error al enviar detalles del producto: ${error.message}`, token);
  }
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

  const { chatId, appPath, args, originalMessageText, jobType, botToken } = job;
  const token = botToken || TELEGRAM_TOKEN; // Use provided token or default

  console.log(`Processing job for chatId ${chatId}: ${originalMessageText} (type: ${jobType || 'gasto'})`);

  try {
    if (jobType === 'pagomovil') {
      console.log('Processing pagomovil search...');
      // Default to pagomovil processing
      const result = await runCommandAsync(appPath, args);
      console.log(`Job for ${originalMessageText} completed. stdout:`, result.stdout);
      
      // Process output to remove Saldo lines if in group chat
      let output = result.stdout;
      if (job.isGroupChat) {
        // Filter out Saldo lines from the output
        output = output.split('\n')
          .filter(line => !line.includes('💳 Saldo:'))
          .join('\n');
      }
      
      await sendTelegramMessage(chatId, `💳 *Transacciones PagoMóvil - BBVA Provincial*\n\n${output}`, token);

      console.log(`Pagomovil search completed successfully for ${originalMessageText}`);
    }

    if (jobType === 'gasto') {
      // Default to gasto processing
      const result = await runCommandAsync(appPath, args);
      console.log(`Job for ${originalMessageText} completed. stdout:`, result.stdout);
      await sendTelegramMessage(chatId, `✅ Gasto "${originalMessageText}" registrado con éxito! 💰`, token);
    }

    if (jobType === 'report') {
      // Handle report generation job
      const result = await runCommandAsync(appPath, args);
      console.log(`Report job for ${originalMessageText} completed. stdout:`, result.stdout);
      await sendTelegramMessage(chatId, `📊 Reporte generado:\n\n${result.stdout}`, token);
    }

    if (jobType === 'product_lookup') {
      // Handle product lookup job
      console.log('Processing product lookup...');
      const result = await runCommandAsync(appPath, args);
      console.log(`Product lookup job for ${originalMessageText} completed. stdout:`, result.stdout);

      // Use specialized function to send product details with image
      await sendProductDetails(chatId, result.stdout, token, job.isGroupChat);
      console.log(`Product lookup completed successfully for ${originalMessageText}`);
    }
  } catch (errorOutcome) {
    console.error(`Job for ${originalMessageText} failed:`, errorOutcome);

    if (jobType === 'pagomovil') {
      await sendTelegramMessage(chatId, `❌ Error inesperado buscando pagomovil: ${errorOutcome.message || 'Error desconocido'}`, token);
    }

    if (jobType === 'gasto') {
      // Handle gasto errors as before
      if (errorOutcome.error && errorOutcome.error.message) {
        await sendTelegramMessage(chatId, `❌ Error al registrar "${originalMessageText}": ${errorOutcome.error.message}`, token);
      } else if (errorOutcome.stderr) {
        await sendTelegramMessage(chatId, `⚠️ Error (stderr) al registrar "${originalMessageText}": ${errorOutcome.stderr}`, token);
      } else {
        await sendTelegramMessage(chatId, `❌ Error desconocido al registrar "${originalMessageText}"`, token);
      }
    }

    if (jobType === 'report') {
      // Handle report errors
      if (errorOutcome.error && errorOutcome.error.message) {
        await sendTelegramMessage(chatId, `❌ Error al generar el reporte: ${errorOutcome.error.message}`, token);
      } else if (errorOutcome.stderr) {
        await sendTelegramMessage(chatId, `⚠️ Error (stderr) al generar el reporte: ${errorOutcome.stderr}`, token);
      } else {
        await sendTelegramMessage(chatId, `❌ Error desconocido al generar el reporte`, token);
      }
    }

    if (jobType === 'product_lookup') {
      // Handle product lookup errors
      if (errorOutcome.error && errorOutcome.error.message) {
        await sendTelegramMessage(chatId, `❌ Error al consultar el producto: ${errorOutcome.error.message}`, token);
      } else if (errorOutcome.stderr) {
        await sendTelegramMessage(chatId, `⚠️ Error (stderr) al consultar el producto: ${errorOutcome.stderr}`, token);
      } else {
        await sendTelegramMessage(chatId, `❌ Error desconocido al consultar el producto`, token);
      }
    }
  } finally {
    isProcessingCommand = false;
    // Trigger processing for the next item in the queue, if any.
    // Use process.nextTick or setTimeout to avoid potential deep recursion issues if many jobs are processed synchronously.
    process.nextTick(processCommandQueue);
  }
}

// Enhanced chat state structure to store bot information
const chatStates = {};

app.post("/telegram", async (req, res) => {
  console.log("CHAT full request", req.body);
  
  // Handle different types of Telegram updates
  // my_chat_member updates occur when bot is added/removed from groups
  if (req.body.my_chat_member) {
    console.log("Received my_chat_member update", req.body.my_chat_member);
    res.status(200).send('OK'); // Acknowledge receipt
    return;
  }
  
  // Handle other update types like callback_query, edited_message, etc.
  if (!req.body.message) {
    console.log("Received non-message update", Object.keys(req.body));
    res.status(200).send('OK'); // Acknowledge receipt
    return;
  }
  const chatId = req.body.message.chat.id;
  
  // Determine if this is a group chat
  const isGroupChat = req.body.message.chat.type === 'group' 
    || req.body.message.chat.type === 'supergroup';
    
  // Handle non-text messages (new chat members, photos, etc.)
  if (!req.body.message.text) {
    console.log("Received non-text message", 
      req.body.message.new_chat_member ? "new_chat_member" : 
      req.body.message.new_chat_members ? "new_chat_members" : 
      "unknown message type", 
      isGroupChat ? "(group chat)" : "(private chat)");
    
    // We could add welcome messages or other handling here if needed
    
    res.status(200).send('OK'); // Acknowledge receipt
    return;
  }
  
  const userCommandRaw = req.body.message.text;
  
  // Extract bot name and base command if present
  const botName = extractBotName(userCommandRaw);
  const userCommand = extractBaseCommand(userCommandRaw);
  
  // Get token for this bot
  const botToken = botName ? getTokenForBot(botName) : TELEGRAM_TOKEN;
  
  // Log details about the incoming command
  console.log(
    "CHAT req:", 
    userCommandRaw, 
    botName ? `(bot: ${botName})` : '',
    isGroupChat ? '(group chat)' : '(private chat)',
    isValidBotName(botName) ? '(valid bot)' : botName ? '(unknown bot)' : ''
  );
  
  // Validate bot name in group chats - commands in group chats should include valid bot name
  if (isGroupChat && userCommandRaw.startsWith('/') && botName && !isValidBotName(botName)) {
    console.log(`Ignoring command with unknown bot name: ${botName}`);
    res.status(200).send('OK');
    return;
  }

  // --- /gasto command ---
  if (userCommand === "/gasto") {
    chatStates[chatId] = {
      state: "WAITING_FOR_AMOUNT",
      botName: botName,
      botToken: botToken
    };
    await sendTelegramMessage(chatId, "💰 ¿Cuánto gastaste y en qué?", botToken);
    res.status(200).send('OK');
    return;
  }

  // --- /pagomovil_wuilliam command ---
  if (userCommand === "/pagomovil_wuilliam") {
    const appPath = '/home/wuilliam/proyectos/ai-financial/.venv/bin/python'; // Or from config
    const scriptPath = '/home/wuilliam/proyectos/ai-financial/test_pagomovil.py'; // Or from config
    const args = [scriptPath, '--account=wuilliam', '--group=' + (isGroupChat ? 'true' : 'false')];
    const job = {
      chatId: chatId,
      appPath: appPath,
      args: args,
      originalMessageText: userCommandRaw,
      jobType: 'pagomovil',
      botToken: botToken,
      isGroupChat: isGroupChat
    };
    commandQueue.push(job);

    delete chatStates[chatId]; // Delete state *after* queuing the job.

    await sendTelegramMessage(chatId, "⏳ Consultando transacciones de PagoMóvil Wuilliam en BBVA Provincial. Te avisaré cuando esté listo. 🔍", botToken);

    processCommandQueue(); // Kick off processing if not already running

    res.status(200).send('OK');
    return;
  }

  // --- /pagomovil_gilza command ---
  if (userCommand === "/pagomovil_gilza") {
    const appPath = '/home/wuilliam/proyectos/ai-financial/.venv/bin/python'; // Or from config
    const scriptPath = '/home/wuilliam/proyectos/ai-financial/test_pagomovil.py'; // Or from config
    const args = [scriptPath, '--account=gilza'];
    const job = {
      chatId: chatId,
      appPath: appPath,
      args: args,
      originalMessageText: userCommandRaw,
      jobType: 'pagomovil',
      botToken: botToken,
      isGroupChat: isGroupChat
    };
    commandQueue.push(job);

    delete chatStates[chatId]; // Delete state *after* queuing the job.

    await sendTelegramMessage(chatId, "⏳ Consultando transacciones de PagoMóvil Gilza en BBVA Provincial. Te avisaré cuando esté listo. 🔍", botToken);

    processCommandQueue(); // Kick off processing if not already running

    res.status(200).send('OK');
    return;
  }

  // --- /report command: Step 1 ---
  if (userCommand === "/report") {
    chatStates[chatId] = {
      state: "WAITING_FOR_REPORT_OPTION",
      botName: botName,
      botToken: botToken
    };
    await sendTelegramMessage(
      chatId,
      "📊 ¿Qué período deseas para el reporte?\n" +
      "[0] 📅 Hoy\n" +
      "[1] 🗓️ Semana actual\n" +
      "[2] 📆 Semana pasada\n" +
      "[3] 🗓️ Mes actual\n" +
      "[4] 📆 Mes pasado\n" +
      "[5] 📊 Trimestre actual\n" +
      "[6] 📈 Trimestre pasado",
      botToken
    );
    res.status(200).send('OK');
    return;
  }

  // --- /consulta_codigo command: Step 1 ---
  if (userCommand === "/consulta_codigo") {
    chatStates[chatId] = {
      state: "WAITING_FOR_PRODUCT_CODE",
      botName: botName,
      botToken: botToken
    };
    await sendTelegramMessage(chatId, "🔍 Por favor, ingresa el código del producto que deseas consultar:", botToken);
    res.status(200).send('OK');
    return;
  }


  // --- /report option selection ---
  if (chatStates[chatId] && chatStates[chatId].state === "WAITING_FOR_REPORT_OPTION") {
    // Get the stored bot token for this conversation
    const storedBotToken = chatStates[chatId].botToken || botToken;
    // Only accept numbers 0-6
    const validOptions = ["0", "1", "2", "3", "4", "5", "6"];
    if (validOptions.includes(userCommand.trim())) {
      // Feedback to user
      await sendTelegramMessage(chatId, "⏳ Estamos generando tu reporte. Te lo enviaremos en cuanto esté listo. 📑", storedBotToken);
      delete chatStates[chatId];
      // Enqueue a report generation job
      const appPath = '/home/wuilliam/.nvm/versions/node/v20.16.0/bin/node'; // Or from config
      const scriptPath = '/home/wuilliam/proyectos/7db-inventariodb/analize_short.js'; // Or from config
      const args = [scriptPath, '--period', `${userCommand.trim()}`, '--ai', 'true'];
      const job = {
        chatId: chatId,
        appPath: appPath,
        args: args,
        originalMessageText: `/report ${userCommand.trim()}`,
        jobType: 'report',
        botToken: storedBotToken
      };
      commandQueue.push(job);
      delete chatStates[chatId];
      // Feedback to user is already sent above
      processCommandQueue();
    } else {
      await sendTelegramMessage(chatId, "❗ Por favor, responde con un número entre 0 y 6 para seleccionar el período del reporte.", storedBotToken);
    }
    res.status(200).send('OK');
    return;
  }

  // --- /consulta_codigo product code input ---
  if (chatStates[chatId] && chatStates[chatId].state === "WAITING_FOR_PRODUCT_CODE") {
    // Get the stored bot token for this conversation
    const storedBotToken = chatStates[chatId].botToken || botToken;
    if (userCommand.trim()) {
      // Feedback to user
      await sendTelegramMessage(chatId, `⏳ Consultando información del producto con código "${userCommand.trim()}". Te informaremos cuando esté listo.`, storedBotToken);
      delete chatStates[chatId];
      // Enqueue a product lookup job
      const appPath = '/home/wuilliam/.nvm/versions/node/v20.16.0/bin/node'; // Or from config
      const scriptPath = '/home/wuilliam/proyectos/7db-inventariodb/product_lookup.js'; // Or from config
      const args = [scriptPath, '--code', `${userCommand.trim()}`];
      const job = {
        chatId: chatId,
        appPath: appPath,
        args: args,
        originalMessageText: userCommand.trim(),
        jobType: 'product_lookup',
        onStdout: parseProductLookup,
        botToken: storedBotToken,
        isGroupChat: isGroupChat
      };
      commandQueue.push(job);
      // Feedback to user is already sent above
      processCommandQueue();
    } else {
      await sendTelegramMessage(chatId, "❗ Por favor, ingresa un código de producto válido.", storedBotToken);
    }
    res.status(200).send('OK');
    return;
  }

  // --- /gasto amount input ---
  if (chatStates[chatId] && chatStates[chatId].state === "WAITING_FOR_AMOUNT") {
    // Get the stored bot token for this conversation
    const storedBotToken = chatStates[chatId].botToken || botToken;
    // New logic:
    const appPath = '/home/wuilliam/proyectos/ai-financial/.venv/bin/python'; // Or from config
    const scriptPath = '/home/wuilliam/proyectos/ai-financial/test_zsoft.py'; // Or from config
    // Note: In runCommandAsync, the scriptPath was the first element of the args array.
    // The new processCommandQueue job structure has `args` which is directly passed to runCommandAsync.
    // So, scriptPath should be the first element in this args array.

    // Append source:1 and the phone number to the user command
    const phone = req.body.message.from ? req.body.message.from.phone_number || req.body.message.from.id || "unknown" : "unknown";
    const modifiedCommand = `${userCommand} source:${phone}`;

    const args = [scriptPath, '--mode=stdin', `--spending=${modifiedCommand}`, '--sheets'];

    const job = {
      chatId: chatId,
      appPath: appPath,
      args: args,
      originalMessageText: userCommand, // Store the original message for notifications
      jobType: 'gasto',
      botToken: storedBotToken
    };
    commandQueue.push(job);

    delete chatStates[chatId]; // Delete state *after* queuing the job.

    await sendTelegramMessage(chatId, `⏳ Gasto "${userCommand}" encolado. Te avisaré cuando esté listo. ✨`, storedBotToken);

    processCommandQueue(); // Kick off processing if not already running

    res.status(200).send('OK');
    return;
  }

  console.log("nothing to do for", userCommand);

  // If it's not a command, show a keyboard menu with available commands
  // if (!userCommand.startsWith('/')) {
  //   try {
  //     // For groups, show only group-appropriate commands
  //     const keyboard = isGroupChat ? 
  //       [
  //         [{"text": "/consulta_codigo@septimodiaboutique_bot"}], 
  //         [{"text": "/pagomovil_wuilliam@septimodiaboutique_bot"}],
  //         [{"text": "/pagomovil_gilza@septimodiaboutique_bot"}],
  //       ] :
  //       [
  //         [{"text": "/gasto"}, {"text": "/consulta_codigo"}],
  //         [{"text": "/pagomovil_wuilliam"}, {"text": "/pagomovil_gilza"}],
  //         [{"text": "/report"}]
  //       ];
  //       
  //     let token = isGroupChat ? getTokenForBot("septimodiaboutique_bot") : botToken;
  //     await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
  //       chat_id: chatId,
  //       text: "Selecciona un comando:",
  //       reply_markup: {
  //         keyboard: keyboard,
  //         resize_keyboard: true,
  //         one_time_keyboard: false
  //       }
  //     });
  //     
  //     console.log("Sent keyboard menu to chat", chatId);
  //   } catch (error) {
  //     console.error("Error sending keyboard menu:", error);
  //   }
  // }

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

app.get("/", (_, res) => {
  res.send(`<pre>Nothing to see here.
Checkout README.md to start.</pre>`);
});

app.listen(PORT, () => {
  console.log(`Server is listening on port: ${PORT}`);
});
