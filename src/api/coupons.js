const axios = require('axios').default;
const { createHash, randomUUID } = require('crypto');
const { COUPONS_SPREADSHEET_ID } = require('../config');
const { accessToken } = require('./sheetsExpenses');
const { initializeFirebase } = require('./firebase');
const { CouponError, normalizeCode, findCoupon, sameCoupon, localDateTime } = require('../coupons');
const { markEffect, logEvent, errorDetails } = require('../conversations');

const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${COUPONS_SPREADSHEET_ID}`;

async function readSheet() {
  const token = await accessToken();
  const options = { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 };
  const [metadata, data] = await Promise.all([
    axios.get(baseUrl, { ...options, params: { fields: 'sheets.properties(sheetId,title)' } }),
    axios.get(`${baseUrl}/values/${encodeURIComponent('Cupones!A:I')}`, {
      ...options, params: { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' }
    })
  ]);
  const sheet = metadata.data.sheets?.find(item => item.properties.title === 'Cupones');
  if (!sheet) throw new CouponError('No se pudo leer la configuración de Cupones.');
  return { rows: data.data.values || [], timeZone: 'America/Caracas', sheetId: sheet.properties.sheetId, options };
}

async function lookupCoupon(code, phone) {
  const sheet = await readSheet();
  return findCoupon(sheet.rows, code, phone, sheet.timeZone);
}

async function redeemCoupon(expected, userId) {
  const database = initializeFirebase();
  if (!database) throw new CouponError('No se pudo habilitar la protección contra doble canje.');
  const key = createHash('sha256').update(JSON.stringify([COUPONS_SPREADSHEET_ID, expected.code, expected.phone])).digest('hex');
  const ref = database.ref(`7db-adm/couponRedemptions/${key}`);
  const operationId = randomUUID();
  const claim = await ref.transaction(current => current === null
    ? { operationId, code: expected.code, phone: expected.phone,
      status: 'pending', userId: String(userId), createdAt: Date.now() }
    : undefined);
  if (!claim.committed) throw new CouponError('Este cupón ya tiene un canje registrado o pendiente de verificación. No lo repitas.');

  let writeStarted = false;
  let saved = false;
  try {
    const sheet = await readSheet();
    const current = findCoupon(sheet.rows, expected.code, expected.phone, sheet.timeZone);
    if (!sameCoupon(expected, current)) return { changed: true, coupon: current };
    const usedAt = localDateTime(new Date(), sheet.timeZone);
    const rowIndex = current.row - 1;
    writeStarted = true;
    markEffect('coupon_write_started');
    try {
      await axios.post(`${baseUrl}:batchUpdate`, { requests: [
        { updateCells: { start: { sheetId: sheet.sheetId, rowIndex, columnIndex: 5 },
          rows: [{ values: [{ userEnteredValue: { stringValue: 'SI' } }, {
            userEnteredValue: { numberValue: usedAt.serial }
          }] }], fields: 'userEnteredValue' } },
        { updateCells: { start: { sheetId: sheet.sheetId, rowIndex, columnIndex: 8 },
          rows: [{ values: [{ userEnteredValue: { stringValue: String(userId) } }] }], fields: 'userEnteredValue' } },
        { repeatCell: { range: { sheetId: sheet.sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1,
          startColumnIndex: 6, endColumnIndex: 7 },
          cell: { userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern: 'dd/MM/yyyy HH:mm:ss' } } },
          fields: 'userEnteredFormat.numberFormat' } }
      ] }, sheet.options);
      saved = true;
    } catch (error) {
      logEvent('coupon_write_failed', errorDetails(error));
      const verified = await readSheet();
      const matches = verified.rows.slice(1).filter(row => normalizeCode(row[1]) === current.code && String(row[4]).trim() === current.phone);
      saved = matches.length === 1 && matches[0][5] === 'SI' &&
        Math.abs(matches[0][6] - usedAt.serial) < 0.000001 && String(matches[0][8]) === String(userId);
      if (!saved) throw new CouponError('No se pudo confirmar el canje. Quedó bloqueado para evitar un doble uso; revisa la planilla.');
    }
    try {
      const finalized = await ref.transaction(value => value === null ? null
        : value.operationId === operationId ? { ...value, status: 'saved' } : undefined);
      if (!finalized.committed || finalized.snapshot.val()?.status !== 'saved') {
        throw new Error('No se confirmó el estado final de la reserva.');
      }
    } catch (error) {
      logEvent('coupon_claim_finalize_failed', errorDetails(error));
    }
    return { coupon: current, usedAt: usedAt.display, userId: String(userId) };
  } catch (error) {
    if (writeStarted && !saved) {
      throw new CouponError('No se pudo confirmar el canje. Quedó bloqueado para evitar un doble uso; revisa la planilla.');
    }
    throw error;
  } finally {
    if (!writeStarted) {
      try {
        const released = await ref.transaction(value => value === null || value.operationId === operationId ? null : undefined);
        if (!released.committed) logEvent('coupon_claim_release_skipped', { reason: 'reservation_changed' });
      } catch (error) {
        logEvent('coupon_claim_release_failed', errorDetails(error));
      }
    }
  }
}

module.exports = { lookupCoupon, redeemCoupon };
