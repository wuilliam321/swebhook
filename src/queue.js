const { TELEGRAM_TOKEN } = require('./config');
const { callPagoMovilAPI, callCierreAPI, callCasheaAbonosAPI } = require('./api/pagoMovil');
const { callSpendingAPI } = require('./api/spending');
const { callSalesReportAPI, callOutfitGeneratorAPI, callProductLookupAPI, callDepositoLookupAPI } = require('./api/inventory');
const { callAsistenciaAPI } = require('./api/asistencia');
const { sendTelegramMessage, sendOutfitPhoto, sendProductDetails, sendDepositoDetails } = require('./api/telegram');
const { buildOutfitSummary, normalizeBase64Image } = require('./outfit'); // Assuming moved to src/outfit.js

const commandQueue = [];
let currentJob = null;

/**
 * Checks if a job with the same type and identifying property is already in queue or processing.
 * @param {Object} job - The job to check
 * @returns {boolean}
 */
function isJobDuplicate(job) {
    const checkDuplicate = (j) => {
        if (!j || j.jobType !== job.jobType) return false;

        switch (job.jobType) {
            case 'pagomovil':
            case 'cierre':
            case 'cashea_abonos':
                return j.account === job.account;
            case 'gasto':
                return j.spending === job.spending && j.fileId === job.fileId;
            case 'report':
                return j.period === job.period;
            case 'product_lookup':
            case 'deposito_lookup':
                return j.code === job.code;
            case 'outfit':
                return JSON.stringify(j.pieces) === JSON.stringify(job.pieces);
            default:
                return j.originalMessageText === job.originalMessageText;
        }
    };

    if (checkDuplicate(currentJob)) return true;
    return commandQueue.some(checkDuplicate);
}

// Check if there's already a pagomovil job in queue or processing
function hasPendingPagoMovilJob(account) {
    if (account) {
        return isJobDuplicate({ jobType: 'pagomovil', account });
    }
    return (currentJob && currentJob.jobType === 'pagomovil') || 
           commandQueue.some(job => job.jobType === 'pagomovil');
}

// Check if there's already a cierre job in queue or processing
function hasPendingCierreJob(account) {
    if (account) {
        return isJobDuplicate({ jobType: 'cierre', account });
    }
    return (currentJob && currentJob.jobType === 'cierre') ||
           commandQueue.some(job => job.jobType === 'cierre');
}

// Check if there's already a cashea_abonos job in queue or processing
function hasPendingCasheaAbonosJob(account) {
    if (account) {
        return isJobDuplicate({ jobType: 'cashea_abonos', account });
    }
    return (currentJob && currentJob.jobType === 'cashea_abonos') ||
           commandQueue.some(job => job.jobType === 'cashea_abonos');
}

function parseCasheaTotal(message) {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    const todayStr = `${dd}/${mm}/${yyyy}`;

    const lines = message.split('\n').filter(line => line.trim());
    const casheaLines = lines.filter(line =>
        line.startsWith(todayStr) && line.includes('Credito Inmediato Recibido')
    );

    let total = 0;
    for (const line of casheaLines) {
        const parts = line.split('|');
        if (parts.length >= 4) {
            const amountStr = parts[3].trim();
            const amount = parseFloat(amountStr.replace(/\./g, '').replace(',', '.'));
            if (!isNaN(amount)) {
                total += amount;
            }
        }
    }

    return { total, count: casheaLines.length, lines: casheaLines };
}

async function processCommandQueue() {
    if (currentJob || commandQueue.length === 0) {
        return;
    }

    currentJob = commandQueue.shift();

    if (!currentJob) {
        return;
    }

    const { chatId, originalMessageText, jobType, botToken } = currentJob;
    const token = botToken || TELEGRAM_TOKEN; // Use provided token or default

    console.log(`Processing job for chatId ${chatId}: ${originalMessageText} (type: ${jobType || 'gasto'})`);
    console.log('Job details:', JSON.stringify(currentJob, null, 2));

    try {
        if (jobType === 'pagomovil') {
            console.log('Processing pagomovil search via API...');
            const { account, isGroupChat } = currentJob;
            const result = await callPagoMovilAPI(account, isGroupChat);

            if (result.success) {
                console.log(`Job for ${originalMessageText} completed. message:`, result.message);
                let output = result.message;

                if (currentJob.isGroupChat) {
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
        }

        if (jobType === 'cierre') {
            console.log('Processing cierre calculation via API...');
            const { account, isGroupChat } = currentJob;
            const result = await callCierreAPI(account, isGroupChat);

            if (result.success) {
                console.log(`Job for ${originalMessageText} completed. message:`, result.message);
                await sendTelegramMessage(chatId, `🏦 *Cierre de Caja - BBVA Provincial*\n\n${result.message}`, token);
                console.log(`Cierre calculation completed successfully for ${originalMessageText}`);
            } else {
                await sendTelegramMessage(chatId, `❌ Error calculando cierre: ${result.message}`, token);
            }
        }

        if (jobType === 'gasto') {
            const { spending, sheetId, fileId, mediaType } = currentJob;
            const result = await callSpendingAPI(spending, sheetId, { fileId, mediaType });

            if (result.success) {
                console.log(`Job for ${originalMessageText} completed. message:`, result.message);
                await sendTelegramMessage(chatId, `✅ Gasto "${originalMessageText}" registrado con éxito! 💰`, token);
            } else {
                await sendTelegramMessage(chatId, `❌ Error registrando gasto: ${result.message}`, token);
            }
        }

        if (jobType === 'report') {
            // Handle report generation job
            const { period } = currentJob;
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
            console.log('Processing outfit generation job with pieces:', JSON.stringify(currentJob.pieces || {}, null, 2));
            const pieces = currentJob.pieces || {};
            const summary = currentJob.summary || buildOutfitSummary(pieces);
            const result = await callOutfitGeneratorAPI(pieces, currentJob.userPreferences);

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
            const { code, isGroupChat } = currentJob;
            const result = await callProductLookupAPI(code);

            if (result.success) {
                console.log(`Product lookup job for ${originalMessageText} completed. data:`, result.data);
                await sendProductDetails(chatId, JSON.stringify(result.data), token, isGroupChat);
                console.log(`Product lookup completed successfully for ${originalMessageText}`);
            } else {
                await sendTelegramMessage(chatId, `❌ Error al consultar el producto: ${result.message}`, token);
            }
        }

        if (jobType === 'cashea_abonos') {
            console.log('Processing cashea abonos via BNC API...');
            const { account } = currentJob;
            const result = await callCasheaAbonosAPI(account);

            if (result.success) {
                const { total, count, lines } = parseCasheaTotal(result.message);
                const formattedTotal = total.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const detail = lines.map(l => {
                    const parts = l.split('|');
                    const time = parts[0].trim().split(' ').slice(1, 4).join(' ');
                    const amount = parts[3] ? parts[3].trim() : '';
                    return `• ${time} — Bs ${amount}`;
                }).join('\n');

                const responseMsg = count > 0
                    ? `💰 *Cashea Abonos BNC - ${account.charAt(0).toUpperCase() + account.slice(1)}*\n\n${detail}\n\n*Total: Bs ${formattedTotal}* (${count} transacciones)`
                    : `💰 *Cashea Abonos BNC - ${account.charAt(0).toUpperCase() + account.slice(1)}*\n\nNo hay abonos Cashea registrados hoy.`;

                await sendTelegramMessage(chatId, responseMsg, token);
                console.log(`Cashea abonos completed for ${account}: ${count} txns, total ${total}`);
            } else {
                await sendTelegramMessage(chatId, `❌ Error consultando cashea abonos: ${result.message}`, token);
            }
        }

        if (jobType === 'deposito_lookup') {
            // Handle deposito lookup job
            console.log('Processing deposito lookup...');
            const { code, isGroupChat } = currentJob;
            const result = await callDepositoLookupAPI(code);

            if (result.success) {
                console.log(`Deposito lookup job for ${originalMessageText} completed. data:`, result.data);
                await sendDepositoDetails(chatId, JSON.stringify(result.data), token, isGroupChat);
                console.log(`Deposito lookup completed successfully for ${originalMessageText}`);
            } else {
                await sendTelegramMessage(chatId, `❌ Error al consultar depósito: ${result.message}`, token);
            }
        }

        if (jobType === 'asistencia') {
            console.log('Processing asistencia job...');
            const { nombre, tienda, accion, reminders } = currentJob;
            const result = await callAsistenciaAPI(nombre, tienda, accion, reminders);

            if (result.success) {
                console.log(`Asistencia job for ${nombre} completed.`);
                await sendTelegramMessage(chatId, `✅ ${result.message}`, token);
            } else {
                await sendTelegramMessage(chatId, `❌ Error registrando asistencia: ${result.message}`, token);
            }
        }
    } catch (errorOutcome) {
        console.error(`Job for ${originalMessageText} failed:`, errorOutcome);

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
        currentJob = null;
        // Trigger processing for the next item in the queue, if any.
        // Use process.nextTick or setTimeout to avoid potential deep recursion issues if many jobs are processed synchronously.
        process.nextTick(processCommandQueue);
    }
}

function getCurrentJob() {
    return currentJob;
}

module.exports = {
    commandQueue,
    processCommandQueue,
    hasPendingPagoMovilJob,
    hasPendingCierreJob,
    hasPendingCasheaAbonosJob,
    isJobDuplicate,
    getCurrentJob
};
