const axios = require('axios').default;
const { PAGOMOVIL_API_URL, MOCK_SPENDING } = require('../config');

async function callSpendingAPI(spending, sheetId = null) {
    if (MOCK_SPENDING) {
        console.log(`[MOCK SPENDING] Recording spending: ${spending} (sheetId: ${sheetId})`);
        return { success: true, message: "Gasto registrado (MOCK)" };
    }

    if (!PAGOMOVIL_API_URL) {
        const errorMessage = "PAGOMOVIL_API_URL environment variable is not set.";
        console.error(errorMessage);
        return { success: false, message: "Spending API URL not configured." };
    }

    const requestBody = {
        spending: spending,
        sheet_id: sheetId,
    };
    console.log('Calling Spending API with body:', JSON.stringify(requestBody, null, 2));

    try {
        const response = await axios.post(`${PAGOMOVIL_API_URL}/spending`, requestBody, { timeout: 120000 }); // 2 minute timeout
        console.log('Spending API response:', response.data);
        return { success: true, message: response.data.message };
    } catch (error) {
        console.error("Error calling Spending API:", error.response ? error.response.data : error.message);
        if (error.code === 'ECONNABORTED') {
            return { success: false, message: "Request timed out" };
        }
        if (error.response) {
            const errorMessage = error.response.data.error || "Unknown error from API";
            return { success: false, message: `Failed to record spending: ${errorMessage}` };
        }
        return { success: false, message: `Failed to record spending: ${error.message}` };
    }
}

module.exports = {
    callSpendingAPI
};
