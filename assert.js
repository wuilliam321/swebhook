#!/usr/bin/env node

const input = process.argv[2];
const expected = process.argv[3];

if (!input) {
  console.log('Usage: ./assert.js "<transaction_string>" [expected_value]');
  process.exit(1);
}

const PatternExtractor = {
  // 1. Phone Numbers: 10-11 digits starting with 04 or 4
  PHONE: (val) => {
    const match = val.match(/(0?4\d{9})/);
    return match ? match[1] : null;
  },

  // 2. DNI: Starts with V, J, E, G, or P followed by 7-10 digits
  // We remove word boundaries (\b) so it catches "V123PAGO"
  DNI: (val) => {
    const match = val.match(/([VJEGP]\d{7,10})/i);
    return match ? match[1].toUpperCase() : null;
  },

  // 3. Reference: Last 4 digits of TRAV strings
  REFERENCE: (val) => {
    const match = val.match(/TRAV\d+(\d{4})/);
    return match ? match[1] : null;
  }
};

/**
 * Normalizes values for flexible comparison
 */
function normalize(val, type) {
  if (!val) return null;
  let normalized = val.toString().trim();
  if (type === 'PHONE') {
    // Remove leading '0' if present
    normalized = normalized.replace(/^0/, '');
  } else if (type === 'DNI') {
    // Remove prefix (V, J, E, G, P) if present
    normalized = normalized.replace(/^[VJEGP]/i, '');
  }
  return normalized;
}

/**
 * Main logic to find the best match based on priority
 */
function detectAndExecute(value) {
  if (!value || typeof value !== 'string') return { type: 'EMPTY', value: null };

  // Priority 1: DNI (Most common in your new examples)
  const dni = PatternExtractor.DNI(value);
  if (dni) return { type: 'DNI', value: dni };

  // Priority 2: Phone
  const phone = PatternExtractor.PHONE(value);
  if (phone) return { type: 'PHONE', value: phone };

  // Priority 3: Reference
  const ref = PatternExtractor.REFERENCE(value);
  if (ref) return { type: 'REFERENCE', value: ref };

  return { type: 'UNKNOWN', value: null };
}

// --- Execution ---

const data = detectAndExecute(input);
const pattern = data.type;
const extracted = data.value;

console.log(`Pattern detected: ${pattern}`);
if (extracted) {
  console.log(`Value: ${extracted}`);
}

if (expected !== undefined) {
  const normExtracted = normalize(extracted, pattern);
  const normExpected = normalize(expected, pattern);
  const isMatch = normExtracted === normExpected;
  console.log(`match: ${isMatch}`);
}
