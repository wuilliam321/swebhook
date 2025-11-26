const axios = require('axios').default;
const { PAGOMOVIL_API_URL, MOCK_PAGOMOVIL } = require('../config');

async function callPagoMovilAPI(account, group = false, debug = false) {
    if (MOCK_PAGOMOVIL) {
        console.log(`[MOCK PAGOMOVIL] Checking transactions for ${account} (group: ${group})`);
        const mockMessage = `Saldo: 100.00\n\n1. 2023-10-27 -50.00 Compra en Farmatodo\n2. 2023-10-26 +200.00 Pago Móvil recibido`;
        return { success: true, message: mockMessage };
    }

    if (!PAGOMOVIL_API_URL) {
        const errorMessage = "PAGOMOVIL_API_URL environment variable is not set.";
        console.error(errorMessage);
        return { success: false, message: "PagoMóvil API URL not configured." };
    }

    const requestBody = {
        account,
        group,
        debug
    };
    console.log('Calling PagoMóvil API with body:', JSON.stringify(requestBody, null, 2));

    try {
        const response = await axios.post(`${PAGOMOVIL_API_URL}/pagomovil`, requestBody, { timeout: 120000 }); // 2 minute timeout
        console.log('PagoMóvil API response:', response.data);
        return { success: true, message: response.data.message };
    } catch (error) {
        console.error("Error calling PagoMóvil API:", error.response ? error.response.data : error.message);
        if (error.code === 'ECONNABORTED') {
            return { success: false, message: "Request timed out" };
        }
        if (error.response) {
            const errorMessage = error.response.data.error || "Unknown error from API";
            return { success: false, message: `Failed to extract transactions: ${errorMessage}` };
        }
        return { success: false, message: `Failed to extract transactions: ${error.message}` };
    }
}

module.exports = {
    callPagoMovilAPI
};
