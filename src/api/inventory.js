const axios = require('axios').default;
const { INVENTORY_API_URL, GENERATOR_URL, MOCK_INVENTORY } = require('../config');

async function callProductLookupAPI(code) {
    if (MOCK_INVENTORY) {
        console.log(`[MOCK INVENTORY] Looking up product: ${code}`);
        return {
            success: true,
            data: JSON.stringify({
                "Codigo": code,
                "Descripcion": "Producto de Prueba (MOCK)",
                "Categoria": "General",
                "Color": "N/A",
                "Talla": "Unica",
                "Tienda": "Principal",
                "Precio de Compra": "10.00",
                "VES": "20.00",
                "USD": "4.00",
                "Operacion": "DISPONIBLE",
                "Image": "https://via.placeholder.com/150"
            })
        };
    }

    if (!INVENTORY_API_URL) {
        const errorMessage = "INVENTORY_API_URL environment variable is not set.";
        console.error(errorMessage);
        return { success: false, message: "Inventory API URL not configured." };
    }

    const requestBody = {
        code: code,
    };
    console.log('Calling Product Lookup API with body:', JSON.stringify(requestBody, null, 2));

    try {
        const response = await axios.post(`${INVENTORY_API_URL}/consulta_producto`, requestBody, { timeout: 120000 }); // 2 minute timeout
        console.log('Product Lookup API response:', response.data);
        return { success: true, data: response.data };
    } catch (error) {
        console.error("Error calling Product Lookup API:", error.response ? error.response.data : error.message);
        if (error.code === 'ECONNABORTED') {
            return { success: false, message: "Request timed out" };
        }
        if (error.response) {
            const errorMessage = error.response.data.error || "Unknown error from API";
            return { success: false, message: `Failed to lookup product: ${errorMessage}` };
        }
        return { success: false, message: `Failed to lookup product: ${error.message}` };
    }
}

async function callDepositoLookupAPI(code) {
    if (MOCK_INVENTORY) {
        console.log(`[MOCK INVENTORY] Looking up deposito info for: ${code}`);
        return {
            success: true,
            data: JSON.stringify({
                "codigo": code,
                "descripcion": "Producto Deposito Mock",
                "ubicacion": "Pasillo A - Estante 2",
                "tienda": "Principal",
                "grupo": "Ropa Dama",
                "tipo": "Blusa",
                "marca": "Zara",
                "talla": "M",
                "color": "Rojo"
            })
        };
    }

    if (!INVENTORY_API_URL) {
        const errorMessage = "INVENTORY_API_URL environment variable is not set.";
        console.error(errorMessage);
        return { success: false, message: "Inventory API URL not configured." };
    }

    const requestBody = {
        code: code,
    };
    console.log('Calling Deposito Lookup API with body:', JSON.stringify(requestBody, null, 2));

    try {
        const response = await axios.post(`${INVENTORY_API_URL}/deposito`, requestBody, { timeout: 120000 });
        console.log('Deposito Lookup API response:', response.data);
        return { success: true, data: response.data };
    } catch (error) {
        console.error("Error calling Deposito Lookup API:", error.response ? error.response.data : error.message);
        if (error.code === 'ECONNABORTED') {
            return { success: false, message: "Request timed out" };
        }
        if (error.response) {
            const errorMessage = error.response.data.error || "Unknown error from API";
            return { success: false, message: `Failed to lookup deposito info: ${errorMessage}` };
        }
        return { success: false, message: `Failed to lookup deposito info: ${error.message}` };
    }
}

async function callSalesReportAPI(period) {
    if (MOCK_INVENTORY) {
        console.log(`[MOCK INVENTORY] Generating sales report for period: ${period}`);
        return { success: true, data: "Reporte de Ventas (MOCK)\n\nVentas Totales: $500.00\nItems Vendidos: 15" };
    }

    if (!INVENTORY_API_URL) {
        const errorMessage = "INVENTORY_API_URL environment variable is not set.";
        console.error(errorMessage);
        return { success: false, message: "Inventory API URL not configured." };
    }

    const requestBody = {
        period: period,
        ai: true
    };
    console.log('Calling Sales Report API with body:', JSON.stringify(requestBody, null, 2));

    try {
        const response = await axios.post(`${INVENTORY_API_URL}/reporte_ventas`, requestBody, { timeout: 300000 }); // 5 minute timeout for AI
        console.log('Sales Report API response:', response.data);
        return { success: true, data: response.data };
    } catch (error) {
        console.error("Error calling Sales Report API:", error.response ? error.response.data : error.message);
        if (error.code === 'ECONNABORTED') {
            return { success: false, message: "Request timed out" };
        }
        if (error.response) {
            const errorMessage = error.response.data.error || "Unknown error from API";
            return { success: false, message: `Failed to generate report: ${errorMessage}` };
        }
        return { success: false, message: `Failed to generate report: ${error.message}` };
    }
}

async function callOutfitGeneratorAPI(pieces, userPreferences) {
    if (MOCK_INVENTORY) {
        console.log(`[MOCK INVENTORY] Generating outfit with pieces:`, pieces);
        return {
            success: true,
            data: { image: "base64mockimage..." },
            image: "base64mockimage..."
        };
    }

    if (!INVENTORY_API_URL) {
        const errorMessage = "INVENTORY_API_URL environment variable is not set.";
        console.error(errorMessage);
        return { success: false, message: "Inventory API URL not configured." };
    }

    const requestBody = {
        pieces: pieces,
    };
    if (userPreferences && Object.keys(userPreferences).length > 0) {
        requestBody.userPreferences = userPreferences;
    }
    console.log('Calling Outfit Generator API with body:', JSON.stringify(requestBody, null, 2));

    try {
        const response = await axios.post(`${INVENTORY_API_URL}/outfit`, requestBody, { timeout: 300000 });
        console.log('Outfit Generator API response:', response.data);
        const data = response.data || {};
        const image = data.image || null;
        return { success: true, data, image };
    } catch (error) {
        console.error("Error calling Outfit Generator API:", error.response ? error.response.data : error.message);
        if (error.code === 'ECONNABORTED') {
            return { success: false, message: "Request timed out" };
        }
        if (error.response) {
            const errorMessage = (error.response.data && (error.response.data.error || error.response.data.message)) || null;
            return { success: false, message: `Failed to generate outfit: ${errorMessage || "Unknown error from API"}` };
        }
        return { success: false, message: `Failed to generate outfit: ${error.message}` };
    }
}

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

module.exports = {
    callProductLookupAPI,
    callDepositoLookupAPI,
    callSalesReportAPI,
    callOutfitGeneratorAPI,
    generateRequest
};
