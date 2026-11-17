const HEADERS = ['FECHA_CREACION', 'CUPON', 'TIPO', 'VALOR', 'CLIENTE', 'USADO', 'FECHA_USO', 'FECHA_VENCIMIENTO', 'AUTORIZADO_POR'];
class CouponError extends Error {}

function normalizeCode(input) {
  const code = String(input || '').trim().toUpperCase();
  if (!/^(?:SDB-)?[A-Z0-9]{1,32}$/.test(code)) return null;
  return code.startsWith('SDB-') ? code : `SDB-${code}`;
}

function normalizePhone(input) {
  const text = String(input || '').trim();
  if (!/^\+?[\d\s()-]+$/.test(text)) return null;
  let phone = text.replace(/[\s()-]/g, '');
  if (phone.startsWith('+58')) phone = `0${phone.slice(3)}`;
  else if (phone.startsWith('58')) phone = `0${phone.slice(2)}`;
  return /^04(?:12|14|16|22|24|26)\d{7}$/.test(phone) ? phone : null;
}

function localDateTime(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).map(part => [part.type, part.value]));
  const localTime = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`;
  return { date: `${parts.year}-${parts.month}-${parts.day}`,
    serial: (Date.parse(localTime) - Date.UTC(1899, 11, 30)) / 86400000,
    display: `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}` };
}

function expirationDate(value) {
  let iso;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 2958465) {
    iso = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10);
  } else {
    const text = String(value || '').trim();
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
    iso = match ? `${match[3]}-${match[2]}-${match[1]}` : text;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

function findCoupon(rows, code, phone, timeZone, now = new Date()) {
  if (!HEADERS.every((header, index) => rows[0]?.[index] === header)) {
    throw new CouponError('Los encabezados de Cupones deben coincidir con A:I.');
  }
  const matches = rows.slice(1).map((values, index) => ({ values, row: index + 2 }))
    .filter(({ values }) => normalizeCode(values[1]) === code && String(values[4]).trim() === phone);
  if (!matches.length) throw new CouponError('No encontramos un cupón para ese código y teléfono.');
  if (matches.length !== 1) throw new CouponError('La combinación cupón y teléfono está duplicada. Corrige la planilla antes de continuar.');
  const { values, row } = matches[0];
  const used = String(values[5] || '').trim().toUpperCase();
  if (used === 'SI' || used === 'SÍ') throw new CouponError('Este cupón ya fue usado.');
  const hasAudit = [values[6], values[8]].some(value => value !== '' && value !== undefined && value !== null);
  if (used !== 'NO' || hasAudit) throw new CouponError('El estado de uso del cupón es inconsistente. Revisa la planilla.');
  const type = String(values[2] || '').trim().toUpperCase();
  const rawValue = String(values[3] ?? '').trim();
  const value = typeof values[3] === 'number' ? values[3]
    : /^\d+(?:[.,]\d+)?$/.test(rawValue) ? Number(rawValue.replace(',', '.')) : NaN;
  if (!['PORCENTAJE', 'FIJO'].includes(type) || !Number.isFinite(value) || value <= 0 || (type === 'PORCENTAJE' && value > 100)) {
    throw new CouponError('El tipo o valor del cupón es inválido. Revisa la planilla.');
  }
  const expiration = expirationDate(values[7]);
  if (!expiration) throw new CouponError('El cupón no tiene una fecha de vencimiento válida.');
  if (expiration < localDateTime(now, timeZone).date) throw new CouponError('Este cupón está vencido.');
  return { code, phone, type, value, expiration, row };
}

function sameCoupon(first, second) {
  return ['code', 'phone', 'type', 'value', 'expiration'].every(key => first[key] === second[key]);
}

function couponSummary(coupon) {
  return `Cupón: ${coupon.code}\nTeléfono: ${coupon.phone}\nDescuento: ${coupon.type === 'PORCENTAJE' ? `${coupon.value}%` : `USD ${coupon.value}`}\nVence: ${coupon.expiration.split('-').reverse().join('/')}`;
}

module.exports = { CouponError, normalizeCode, normalizePhone, localDateTime, expirationDate, findCoupon, sameCoupon, couponSummary };
