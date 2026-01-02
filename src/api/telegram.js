const axios = require('axios').default;
const { TELEGRAM_TOKEN, MOCK_TELEGRAM, PHONE_ID, GRAPH_API_TOKEN } = require('../config');
const { escapeMarkdownV2 } = require('../utils');
const { createTelegramPhotoPayload } = require('../outfit'); // Assuming outfit.js stays in root for now

async function sendTelegramMessage(chatId, message, token = TELEGRAM_TOKEN) {
    if (MOCK_TELEGRAM) {
        console.log(`[MOCK TELEGRAM] Sending message to ${chatId} using token ${token}: ${message}`);
        return { success: true };
    }

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

async function sendOutfitPhoto(chatId, base64Image, caption, token = TELEGRAM_TOKEN) {
    if (MOCK_TELEGRAM) {
        console.log(`[MOCK TELEGRAM] Sending photo to ${chatId} using token ${token}. Caption: ${caption}`);
        return { success: true };
    }

    try {
        if (!base64Image) {
            throw new Error('Missing image payload for outfit photo');
        }
        const imageBuffer = Buffer.from(base64Image, 'base64');
        const payload = createTelegramPhotoPayload(chatId, imageBuffer, caption);
        await axios.post(`https://api.telegram.org/bot${token}/sendPhoto`, payload.body, {
            headers: payload.headers,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        });
        console.log(`Outfit image sent to chat ${chatId}`);
        return { success: true };
    } catch (error) {
        console.error('Error sending outfit photo:', error.response ? error.response.data : error.message);
        return { success: false, error };
    }
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
            `📍 Ubicación: ${productData.Ubicacion}`,
            ``
        ];

        // Only show purchase price in private chats
        if (!isGroupChat) {
            formattedMessage.push(`💰 Precio de Compra: $${productData["Precio de Compra"]}`);
        }

        formattedMessage.push(`💵 Precio $ BCV: $${productData.VES}`);
        formattedMessage.push(`💵 Precio $ Efectivo: $${productData.USD}`);
        formattedMessage.push(`${productData.Operacion === 'APARTADO' ? '🔒' : productData.Operacion === 'VENDIDO' ? '❌' : productData.Operacion === 'DISPONIBLE' ? '✅' : '🔄'} Estado: ${productData.Operacion}`);


        // Add other products in the same group if any
        if (groupProducts.length > 0) {
            const availableProducts = groupProducts.filter(p => p.Operacion === 'DISPONIBLE');

            if (availableProducts.length > 0) {
                formattedMessage.push('');
                formattedMessage.push('📦 Disponibles por Tienda:');

                // Group available products by tienda
                const productsByTienda = {};
                availableProducts.forEach(product => {
                    if (!productsByTienda[product.Tienda]) {
                        productsByTienda[product.Tienda] = [];
                    }
                    productsByTienda[product.Tienda].push(product);
                });

                // Display products grouped by tienda
                for (const tienda in productsByTienda) {
                    formattedMessage.push(`🏪 ${tienda}:`);
                    productsByTienda[tienda].forEach(product => {
                        formattedMessage.push(`• ${product.Codigo}-${product.Talla}-${product.Color}`);
                    });
                }
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

function parseDepositoLookup(jsonOutput, isGroupChat = false) {
    try {
        const data = JSON.parse(jsonOutput);
        
        // Helper to get property case-insensitively
        const getProp = (obj, key) => obj[key] || obj[key.toLowerCase()] || obj[key.charAt(0).toUpperCase() + key.slice(1)] || 'N/A';
        
        const code = data.codigo || data.Codigo || data.grupo || data.Grupo || 'N/A';

        // Fields: Ubicacion, tienda, grupo, tipo, descripcion, marca, talla, color
        const formattedMessage = [
            `📦 Información de Depósito: ${code}`,
            `📍 Ubicación: ${getProp(data, 'Ubicacion')}`,
            `🏪 Tienda: ${getProp(data, 'Tienda')}`,
            `🏷️ Grupo: ${getProp(data, 'Grupo')}`,
            `👚 Tipo: ${getProp(data, 'Tipo')}`,
            `📝 Descripción: ${getProp(data, 'Descripcion')}`,
        ];

        if (!isGroupChat) {
            formattedMessage.push(`🏷️ Marca: ${getProp(data, 'Marca')}`);
        }

        formattedMessage.push(`📏 Talla: ${getProp(data, 'Talla')}`);
        formattedMessage.push(`🎨 Color: ${getProp(data, 'Color')}`);

        return {
            message: formattedMessage.join('\n'),
            imageUrl: data.Image || data.image || null
        };
    } catch (error) {
        console.error('Error parsing deposito lookup JSON:', error);
        return {
            message: `Error al procesar la información de depósito: ${error.message}`,
            imageUrl: null
        };
    }
}

async function sendProductDetails(chatId, jsonOutput, token = TELEGRAM_TOKEN, isGroupChat = false) {
    if (MOCK_TELEGRAM) {
        console.log(`[MOCK TELEGRAM] Sending product details to ${chatId} using token ${token}. Data: ${jsonOutput}`);
        return { success: true };
    }

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

async function sendDepositoDetails(chatId, jsonOutput, token = TELEGRAM_TOKEN, isGroupChat = false) {
    if (MOCK_TELEGRAM) {
        console.log(`[MOCK TELEGRAM] Sending deposito details to ${chatId} using token ${token}. Data: ${jsonOutput}`);
        return { success: true };
    }

    try {
        const { message, imageUrl } = parseDepositoLookup(jsonOutput, isGroupChat);

        if (imageUrl) {
            return axios.post(`https://api.telegram.org/bot${token}/sendPhoto`, {
                chat_id: chatId,
                photo: imageUrl,
                caption: escapeMarkdownV2(message),
                parse_mode: 'MarkdownV2'
            })
            .then(() => {
                 console.log(`Mensaje de depósito con imagen enviado con éxito`);
                 return { success: true };
            })
            .catch(error => {
                console.error(`Error al enviar mensaje de depósito con imagen:`, error);
                return sendTelegramMessage(chatId, message, token);
            });
        } else {
            return sendTelegramMessage(chatId, message, token);
        }
    } catch (error) {
        console.error('Error sending deposito details:', error);
        return sendTelegramMessage(chatId, `❌ Error al enviar detalles de depósito: ${error.message}`, token);
    }
}

const sendFBMessage = async (to, text) => {
    if (MOCK_TELEGRAM) { // Reusing MOCK_TELEGRAM for FB for now, or we could add MOCK_FB
        console.log(`[MOCK FB] Sending message to ${to}: ${text}`);
        return { success: true, message: text };
    }
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

module.exports = {
    sendTelegramMessage,
    sendOutfitPhoto,
    sendProductDetails,
    sendDepositoDetails,
    sendFBMessage,
    parseProductLookup,
    parseDepositoLookup
};
