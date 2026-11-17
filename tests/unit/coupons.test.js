const { normalizeCode, normalizePhone, expirationDate, localDateTime, findCoupon, couponSummary } = require('../../src/coupons');

const headers = ['FECHA_CREACION', 'CUPON', 'TIPO', 'VALOR', 'CLIENTE', 'USADO', 'FECHA_USO', 'FECHA_VENCIMIENTO', 'AUTORIZADO_POR'];
const row = ['', 'SDB-OCT26', 'PORCENTAJE', 8, '04165028307', 'NO', '', '28/12/2026', ''];
const now = new Date('2026-11-17T15:00:00Z');
const find = (rows = [headers, row], date = now) => findCoupon(rows, 'SDB-OCT26', '04165028307', 'America/Caracas', date);

test.each(['OCT26', 'oct26', 'SDB-OCT26', ' sdb-oct26 '])('normaliza código %s', input => {
  expect(normalizeCode(input)).toBe('SDB-OCT26');
});

test.each(['', 'SDB-', 'SDB-SDB-OCT26', 'OCT 26', '=SUM(1)', 'OCT26@bot', 'A'.repeat(33), '🎁'])('rechaza código %s', input => {
  expect(normalizeCode(input)).toBeNull();
});

test.each(['04165028307', '0416-502-8307', '(0416) 502 8307', '+58 416 502 8307', '584165028307'])('normaliza teléfono %s', input => {
  expect(normalizePhone(input)).toBe('04165028307');
});

test.each(['0412', '0414', '0416', '0422', '0424', '0426'])('acepta prefijo %s', prefix => {
  expect(normalizePhone(`${prefix}5028307`)).toBe(`${prefix}5028307`);
});

test.each(['', '4165028307', '0416502830', '041650283077', '+5984165028307', '+5804165028307', '+04165028307', '02125028307', '04995028307', '04165028307 ext 1', 'tel: 04165028307', '04165028307/04165028307', '04165028307.'])('rechaza teléfono %s', input => {
  expect(normalizePhone(input)).toBeNull();
});

test.each(['31/02/2026', '2026-02-30', '', 'ayer', '2026-13-01', '12/28/2026'])('rechaza vencimiento %s', date => {
  expect(expirationDate(date)).toBeNull();
});

test('acepta fechas reales y seriales de Sheets', () => {
  expect(expirationDate('28/12/2026')).toBe('2026-12-28');
  expect(expirationDate('2026-12-28')).toBe('2026-12-28');
  const serial = (Date.UTC(2026, 11, 28) - Date.UTC(1899, 11, 30)) / 86400000;
  expect(expirationDate(serial)).toBe('2026-12-28');
});

test('vencimiento inclusivo hasta medianoche venezolana', () => {
  const rows = [headers, [...row.slice(0, 7), '16/11/2026', '']];
  expect(find(rows, new Date('2026-11-17T03:59:59Z')).value).toBe(8);
  expect(() => find(rows, new Date('2026-11-17T04:00:00Z'))).toThrow('vencido');
  expect(localDateTime(new Date('2026-11-17T03:59:59Z'), 'America/Caracas').display).toBe('16/11/2026 23:59:59');
});

test('permite código repetido para clientes distintos', () => {
  const other = [...row]; other[4] = '04125028307';
  expect(find([headers, other, row]).row).toBe(3);
});

test('bloquea combinación duplicada, inexistente y teléfono sin cero', () => {
  expect(() => find([headers, row, row])).toThrow('duplicada');
  expect(() => find([headers])).toThrow('No encontramos');
  const numericPhone = [...row]; numericPhone[4] = 4165028307;
  expect(() => find([headers, numericPhone])).toThrow('No encontramos');
});

test.each([
  [2, 'OTRO'], [3, ''], [3, 0], [3, -1], [3, 101], [3, 'ocho'], [3, '0x10'], [3, '1e1'],
  [5, 'SI'], [5, 'SÍ'], [5, ''], [5, 'QUIZAS'], [6, '17/11/2026'],
  [7, ''], [7, '31/02/2026'], [8, '1234'], [6, 0], [8, 0]
])('bloquea registro inválido columna %s, valor %s', (column, value) => {
  const invalid = [...row]; invalid[column] = value;
  expect(() => find([headers, invalid])).toThrow();
});

test('bloquea columnas desplazadas', () => {
  const moved = [...headers]; [moved[2], moved[4]] = [moved[4], moved[2]];
  expect(() => find([moved, row])).toThrow('encabezados');
});

test('muestra porcentaje o monto fijo en USD', () => {
  expect(couponSummary(find())).toContain('8%');
  const fixed = [...row]; fixed[2] = 'FIJO'; fixed[3] = 150;
  expect(couponSummary(find([headers, fixed]))).toContain('USD 150');
});
