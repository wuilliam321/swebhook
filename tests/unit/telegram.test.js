const { parseProductLookup } = require('../../src/api/telegram');

describe('Telegram API - parseProductLookup', () => {
    const productData = {
        Categoria: 'Vestido',
        Codigo: 'V123',
        Descripcion: 'Vestido elegante',
        Color: 'Azul',
        Talla: 'M',
        Tienda: 'Centro',
        Ubicacion: 'Pasillo 4, Estante B',
        "Precio de Compra": 10,
        VES: 25,
        USD: 4,
        Operacion: 'DISPONIBLE',
        Image: 'http://example.com/image.jpg'
    };

    test('should format product details correctly including Ubicacion', () => {
        const jsonOutput = JSON.stringify(productData);
        const result = parseProductLookup(jsonOutput, false);

        expect(result.message).toContain('👗 Vestido - V123');
        expect(result.message).toContain('🏪 Tienda: Centro');
        expect(result.message).toContain('📍 Ubicación: Pasillo 4, Estante B');
        expect(result.message).toContain('💰 Precio de Compra: $10');
        expect(result.message).toContain('💵 Precio $ BCV: $25');
        expect(result.message).toContain('💵 Precio $ Efectivo: $4');
        expect(result.message).toContain('✅ Estado: DISPONIBLE');
        expect(result.imageUrl).toBe('http://example.com/image.jpg');
    });

    test('should not include purchase price in group chats', () => {
        const jsonOutput = JSON.stringify(productData);
        const result = parseProductLookup(jsonOutput, true);

        expect(result.message).not.toContain('💰 Precio de Compra');
        expect(result.message).toContain('📍 Ubicación: Pasillo 4, Estante B');
    });

    test('should handle group products by Tienda and only show DISPONIBLE', () => {
        const groupData = {
            ...productData,
            group: true,
            groupProducts: [
                { Codigo: 'V123', Talla: 'S', Color: 'Rojo', Tienda: 'Centro', Operacion: 'DISPONIBLE' },
                { Codigo: 'V123', Talla: 'L', Color: 'Azul', Tienda: 'Norte', Operacion: 'APARTADO' },
                { Codigo: 'V123', Talla: 'XL', Color: 'Verde', Tienda: 'Centro', Operacion: 'DISPONIBLE' }
            ]
        };

        const jsonOutput = JSON.stringify(groupData);
        const result = parseProductLookup(jsonOutput, false);

        expect(result.message).toContain('📦 Disponibles por Tienda:');
        expect(result.message).toContain('🏪 Centro:');
        expect(result.message).toContain('• V123--S');
        expect(result.message).toContain('• V123--XL');
        expect(result.message).not.toContain('Norte:');
        expect(result.message).not.toContain('V123-L-Azul');
    });

    test('should return error message on invalid JSON', () => {
        const result = parseProductLookup('invalid json', false);
        expect(result.message).toContain('Error al procesar la información del producto');
        expect(result.imageUrl).toBeNull();
    });
});
