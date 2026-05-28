const axios = require('axios').default;
const { PAGOMOVIL_API_URL, MOCK_PAGOMOVIL } = require('../config');

/**
 * Calls the financial backend to register attendance.
 * @param {string} nombre - Employee name
 * @param {string} tienda - Store location
 * @param {string} accion - Attendance action (e.g., Apertura, Cierre)
 */
async function callAsistenciaAPI(nombre, tienda, accion) {
    if (MOCK_PAGOMOVIL) {
        console.log(`[MOCK ASISTENCIA] Registering attendance for ${nombre} at ${tienda}: ${accion}`);
        return { success: true, message: `Asistencia (mock) registrada para ${nombre}` };
    }

    if (!PAGOMOVIL_API_URL) {
        console.error("PAGOMOVIL_API_URL environment variable is not set.");
        return { success: false, message: "API URL not configured." };
    }

    const requestBody = { nombre, tienda, accion };
    console.log('Calling Asistencia API with body:', JSON.stringify(requestBody, null, 2));

    try {
        const response = await axios.post(`${PAGOMOVIL_API_URL}/asistencia`, requestBody, { timeout: 30000 });
        console.log('Asistencia API response:', response.data);
        return { success: true, message: response.data.message };
    } catch (error) {
        console.error("Error calling Asistencia API:", error.response ? error.response.data : error.message);
        if (error.response) {
            const errorMessage = error.response.data.error || "Unknown error from API";
            return { success: false, message: errorMessage };
        }
        return { success: false, message: error.message };
    }
}

module.exports = {
    callAsistenciaAPI
};
