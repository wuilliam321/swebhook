const axios = require('axios');
const { callAsistenciaAPI } = require('../../src/api/asistencia');

jest.mock('axios', () => ({
  default: {
    post: jest.fn()
  }
}));

jest.mock('../../src/config', () => ({
  PAGOMOVIL_API_URL: 'http://mock-api',
  MOCK_PAGOMOVIL: false
}));

describe('Asistencia API', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('callAsistenciaAPI should send correct request', async () => {
        axios.default.post.mockResolvedValue({ data: { message: 'Success' } });
        
        const result = await callAsistenciaAPI('Ana', 'Rodeo', '☀️ Apertura', 'Cierre caja?');
        
        expect(axios.default.post).toHaveBeenCalledWith(
            'http://mock-api/asistencia',
            { nombre: 'Ana', tienda: 'Rodeo', accion: '☀️ Apertura', reminders: 'Cierre caja?' },
            expect.any(Object)
        );
        expect(result).toEqual({ success: true, message: 'Success' });
    });

    test('callAsistenciaAPI should handle errors', async () => {
        axios.default.post.mockRejectedValue({
            response: { data: { error: 'Something went wrong' } }
        });
        
        const result = await callAsistenciaAPI('Ana', 'Rodeo', '☀️ Apertura');
        
        expect(result).toEqual({ success: false, message: 'Something went wrong' });
    });
});
