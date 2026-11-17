jest.mock('axios', () => ({ default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../../src/api/sheetsExpenses', () => ({ accessToken: jest.fn().mockResolvedValue('test-token') }));
jest.mock('../../src/api/firebase', () => ({ initializeFirebase: jest.fn() }));

const axios = require('axios').default;
const { initializeFirebase } = require('../../src/api/firebase');
const { lookupCoupon, redeemCoupon } = require('../../src/api/coupons');
const { localDateTime } = require('../../src/coupons');
const headers = ['FECHA_CREACION', 'CUPON', 'TIPO', 'VALOR', 'CLIENTE', 'USADO', 'FECHA_USO', 'FECHA_VENCIMIENTO', 'AUTORIZADO_POR'];
let rows;
let claims;
let writeMode;

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-17T15:00:00Z'));
  rows = [headers, ['', 'SDB-OCT26', 'PORCENTAJE', 8, '04165028307', 'NO', '', '28/12/2026', '']];
  claims = new Map(); writeMode = 'success';
  initializeFirebase.mockReturnValue({ ref: key => ({ transaction: async update => {
    const next = update(claims.get(key) || null);
    if (next === undefined) return { committed: false };
    if (next === null) claims.delete(key); else claims.set(key, next);
    return { committed: true };
  } }) });
  axios.get.mockImplementation(async url => ({ data: url.includes('/values/') ? { values: structuredClone(rows) }
    : { sheets: [{ properties: { title: 'Cupones', sheetId: 1793037417 } }] } }));
  axios.post.mockImplementation(async (url, body) => {
    if (writeMode === 'fail') throw new Error('timeout');
    const changes = body.requests.map(request => request.updateCells).filter(Boolean);
    for (const change of changes) {
      change.rows[0].values.forEach((cell, index) => {
        const value = cell.userEnteredValue;
        rows[change.start.rowIndex][change.start.columnIndex + index] = value.stringValue ?? value.numberValue;
      });
    }
    if (writeMode === 'timeoutAfterSave') throw new Error('timeout');
    return { data: {} };
  });
});

afterEach(() => jest.useRealTimers());
const lookup = () => lookupCoupon('SDB-OCT26', '04165028307');

test('escribe solo F:G e I y registra fecha venezolana e ID', async () => {
  const expected = await lookup();
  const result = await redeemCoupon(expected, 123);
  expect(result.usedAt).toBe('17/11/2026 11:00:00');
  expect(rows[1][5]).toBe('SI');
  expect(rows[1][6]).toBe(localDateTime(new Date(), 'America/Caracas').serial);
  expect(rows[1][8]).toBe('123');
  expect(rows[1][7]).toBe('28/12/2026');
  expect(rows[1].slice(0, 5)).toEqual(['', 'SDB-OCT26', 'PORCENTAJE', 8, '04165028307']);
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect([...claims.values()][0].status).toBe('saved');
  expect([...claims.values()][0]).toMatchObject({ code: 'SDB-OCT26', phone: '04165028307', userId: '123' });
});

test('dos canjes simultáneos, una sola escritura compartida', async () => {
  const expected = await lookup();
  const results = await Promise.allSettled([redeemCoupon(expected, 123), redeemCoupon(expected, 456)]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(axios.post).toHaveBeenCalledTimes(1);
});

test('mismo código para teléfonos distintos permite ambos canjes', async () => {
  const other = [...rows[1]]; other[4] = '04125028307'; rows.push(other);
  const first = await lookup();
  const second = await lookupCoupon('SDB-OCT26', '04125028307');
  await Promise.all([redeemCoupon(first, 123), redeemCoupon(second, 456)]);
  expect(axios.post).toHaveBeenCalledTimes(2);
  expect(rows.slice(1).map(row => row[5])).toEqual(['SI', 'SI']);
});

test('duplicado introducido antes de confirmar bloquea sin escribir', async () => {
  const expected = await lookup(); rows.push([...rows[1]]);
  await expect(redeemCoupon(expected, 123)).rejects.toThrow('duplicada');
  expect(axios.post).not.toHaveBeenCalled();
  expect(claims.size).toBe(0);
});

test('fallo de lectura antes de escribir libera reserva', async () => {
  const expected = await lookup(); axios.get.mockRejectedValueOnce(new Error('timeout'));
  await expect(redeemCoupon(expected, 123)).rejects.toThrow('timeout');
  expect(axios.post).not.toHaveBeenCalled();
  expect(claims.size).toBe(0);
});

test('cambio de descuento exige nueva confirmación y libera reserva', async () => {
  const expected = await lookup(); rows[1][3] = 12;
  expect(await redeemCoupon(expected, 123)).toMatchObject({ changed: true, coupon: { value: 12 } });
  expect(axios.post).not.toHaveBeenCalled();
  expect(claims.size).toBe(0);
});

test.each([[5, 'SI'], [7, '16/11/2026'], [4, '04125028307']])('revalida cambio en columna %s', async (column, value) => {
  const expected = await lookup(); rows[1][column] = value;
  await expect(redeemCoupon(expected, 123)).rejects.toThrow();
  expect(axios.post).not.toHaveBeenCalled();
  expect(claims.size).toBe(0);
});

test('actualiza ubicación actual si la fila fue movida antes de confirmar', async () => {
  const expected = await lookup(); rows.splice(1, 0, ['', 'SDB-OTHER', 'FIJO', 5, '04125028307', 'NO', '', '28/12/2026']);
  await redeemCoupon(expected, 123);
  expect(rows[1][5]).toBe('NO'); expect(rows[2][5]).toBe('SI');
});

test('timeout tras guardar se verifica sin repetir escritura', async () => {
  const expected = await lookup(); writeMode = 'timeoutAfterSave';
  expect(await redeemCoupon(expected, 123)).toMatchObject({ userId: '123' });
  expect(axios.post).toHaveBeenCalledTimes(1);
  await expect(redeemCoupon(expected, 123)).rejects.toThrow('pendiente');
  expect(axios.post).toHaveBeenCalledTimes(1);
});

test('verificación tras timeout normaliza también código almacenado', async () => {
  rows[1][1] = ' oct26 ';
  const expected = await lookup(); writeMode = 'timeoutAfterSave';
  expect(await redeemCoupon(expected, 123)).toMatchObject({ userId: '123' });
  expect(axios.post).toHaveBeenCalledTimes(1);
});

test('resultado incierto queda bloqueado sin reenvío automático', async () => {
  const expected = await lookup(); writeMode = 'fail';
  await expect(redeemCoupon(expected, 123)).rejects.toThrow('bloqueado');
  await expect(redeemCoupon(expected, 456)).rejects.toThrow('pendiente');
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect([...claims.values()][0].status).toBe('pending');
  expect([...claims.values()][0]).toMatchObject({ code: 'SDB-OCT26', phone: '04165028307', userId: '123' });
});

test('no escribe sin protección distribuida', async () => {
  const expected = await lookup(); initializeFirebase.mockReturnValue(null);
  await expect(redeemCoupon(expected, 123)).rejects.toThrow('doble canje');
  expect(axios.post).not.toHaveBeenCalled();
});
