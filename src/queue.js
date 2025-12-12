const { TELEGRAM_TOKEN } = require('./config');
const { callPagoMovilAPI } = require('./api/pagoMovil');
const { callSpendingAPI } = require('./api/spending');
const { callSalesReportAPI, callOutfitGeneratorAPI, callProductLookupAPI, callDepositoLookupAPI } = require('./api/inventory');
const { sendTelegramMessage, sendOutfitPhoto, sendProductDetails, sendDepositoDetails } = require('./api/telegram');
const { buildOutfitSummary, normalizeBase64Image } = require('./outfit'); // Assuming moved to src/outfit.js

const commandQueue = [];
let isProcessingCommand = false;
let isProcessingPagoMovil = false;

// Check if there's already a pagomovil job in queue
function hasPendingPagoMovilJob() {
    return commandQueue.some(job => job.jobType === 'pagomovil');
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

    const { chatId, originalMessageText, jobType, botToken } = job;
    const token = botToken || TELEGRAM_TOKEN; // Use provided token or default

    console.log(`Processing job for chatId ${chatId}: ${originalMessageText} (type: ${jobType || 'gasto'})`);
    console.log('Job details:', JSON.stringify(job, null, 2));

    try {
        if (jobType === 'pagomovil') {
            // Set the pagomovil processing flag
            isProcessingPagoMovil = true;

            console.log('Processing pagomovil search via API...');
            const { account, isGroupChat } = job;
            const result = await callPagoMovilAPI(account, isGroupChat);

            if (result.success) {
                console.log(`Job for ${originalMessageText} completed. message:`, result.message);
                let output = result.message;

                if (job.isGroupChat) {
                    output = output.split('\n')
                        .filter(line => !line.trim().startsWith('Saldo:'))
                        .join('\n');
                }

                await sendTelegramMessage(chatId, `💳 *Transacciones PagoMóvil - BBVA Provincial*\n\n${output}`, token);
                console.log(`Pagomovil search completed successfully for ${originalMessageText}`);
            } else {
                // Error is already logged inside callPagoMovilAPI
                await sendTelegramMessage(chatId, `❌ Error buscando pagomovil: ${result.message}`, token);
            }

            // Clear the pagomovil processing flag
            isProcessingPagoMovil = false;
        }

        if (jobType === 'gasto') {
            const { spending, sheetId } = job;
            const result = await callSpendingAPI(spending, sheetId);

            if (result.success) {
                console.log(`Job for ${originalMessageText} completed. message:`, result.message);
                await sendTelegramMessage(chatId, `✅ Gasto "${originalMessageText}" registrado con éxito! 💰`, token);
            } else {
                await sendTelegramMessage(chatId, `❌ Error registrando gasto: ${result.message}`, token);
            }
        }

        if (jobType === 'report') {
            // Handle report generation job
            const { period } = job;
            const result = await callSalesReportAPI(period);

            if (result.success) {
                console.log(`Report job for ${originalMessageText} completed. data:`, result.data);
                const reportText = (typeof result.data === 'string') ? result.data : (result.data.message || JSON.stringify(result.data, null, 2));
                await sendTelegramMessage(chatId, `📊 Reporte generado:\n\n${reportText}`, token);
            } else {
                await sendTelegramMessage(chatId, `❌ Error al generar el reporte: ${result.message}`, token);
            }
        }

        if (jobType === 'outfit') {
            console.log('Processing outfit generation job with pieces:', JSON.stringify(job.pieces || {}, null, 2));
            const pieces = job.pieces || {};
            const summary = job.summary || buildOutfitSummary(pieces);
            const result = await callOutfitGeneratorAPI(pieces, job.userPreferences);

            if (result.success) {
                const normalizedImage = result.image ? normalizeBase64Image(result.image) : null;
                const captionText = summary ? `✨ Atuendo listo\nPiezas: ${summary}` : '✨ Atuendo listo';

                if (normalizedImage) {
                    const photoOutcome = await sendOutfitPhoto(chatId, normalizedImage, captionText, token);
                    if (!photoOutcome.success) {
                        await sendTelegramMessage(chatId, captionText, token);
                    }
                } else {
                    await sendTelegramMessage(chatId, captionText, token);
                }
                console.log(`Outfit job for ${originalMessageText} completed.`);
            } else {
                await sendTelegramMessage(chatId, `❌ Error al generar el atuendo: ${result.message}`, token);
            }
        }

        if (jobType === 'product_lookup') {
            // Handle product lookup job
            console.log('Processing product lookup...');
            const { code, isGroupChat } = job;
            const result = await callProductLookupAPI(code);

            if (result.success) {
                console.log(`Product lookup job for ${originalMessageText} completed. data:`, result.data);
                await sendProductDetails(chatId, JSON.stringify(result.data), token, isGroupChat);
                console.log(`Product lookup completed successfully for ${originalMessageText}`);
            } else {
                await sendTelegramMessage(chatId, `❌ Error al consultar el producto: ${result.message}`, token);
            }
        }

        if (jobType === 'deposito_lookup') {
            // Handle deposito lookup job
            console.log('Processing deposito lookup...');
            const { code, group, isGroupChat } = job;
            const result = await callDepositoLookupAPI({ code, group });

            if (result.success) {
                console.log(`Deposito lookup job for ${originalMessageText} completed. data:`, result.data);
                await sendDepositoDetails(chatId, JSON.stringify(result.data), token, isGroupChat);
                console.log(`Deposito lookup completed successfully for ${originalMessageText}`);
            } else {
                await sendTelegramMessage(chatId, `❌ Error al consultar depósito: ${result.message}`, token);
            }
        }
    } catch (errorOutcome) {
        console.error(`Job for ${originalMessageText} failed:`, errorOutcome);

        // Make sure to clear the pagomovil flag on error too
        if (jobType === 'pagomovil') {
            isProcessingPagoMovil = false;
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
    } finally {
        isProcessingCommand = false;
        // Trigger processing for the next item in the queue, if any.
        // Use process.nextTick or setTimeout to avoid potential deep recursion issues if many jobs are processed synchronously.
        process.nextTick(processCommandQueue);
    }
}

module.exports = {
    commandQueue,
    processCommandQueue,
    hasPendingPagoMovilJob,
    isProcessingPagoMovil
};
