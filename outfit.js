const OPTIONAL_OUTFIT_PIECES = ['outerwear', 'accessories', 'head'];

const OUTFIT_LABELS = {
  fullBody: 'Prenda completa',
  upperBody: 'Parte superior',
  lowerBody: 'Parte inferior',
  footwear: 'Calzado',
  outerwear: 'Capa exterior',
  accessories: 'Accesorios',
  head: 'Accesorio de cabeza'
};

const OPTIONAL_PROMPT = '¿Quieres agregar prendas opcionales (outerwear, accessories, head)? Responde "si" o "no".';
const STYLE_INSTRUCTIONS_PROMPT = '¿Necesitas instrucciones de estilo adicionales para el atuendo? Responde "si" o "no".';
const STYLE_INSTRUCTIONS_INPUT_PROMPT = 'Ingresa las instrucciones de estilo separadas por punto y coma (;) o por líneas distintas. También puedes escribir "skip" para omitirlas.';

const SKIP_INPUTS = new Set(['skip', 'omitir', 'ninguno', 'ninguna', 'none', 'omito', 'saltar', 'saltear']);
const AFFIRMATIVE_INPUTS = new Set(['si', 'sí', 's', 'yes', 'y']);
const NEGATIVE_INPUTS = new Set(['no', 'n']);

function createOutfitConversationState(botName, botToken) {
  return {
    state: 'OUTFIT_COLLECTING',
    botName,
    botToken,
    outfit: {
      pieces: {},
      useFullBody: null,
      currentPiece: 'fullBody',
      optionalQueue: [...OPTIONAL_OUTFIT_PIECES],
      currentOptionalPiece: null,
      expectingOptionalConfirmation: false,
      styleInstructions: [],
      styleInstructionsPrompted: false,
      expectingStyleInstructionsConfirmation: false,
      collectingStyleInstructions: false
    }
  };
}

function getNextRequiredPiece(outfitState) {
  if (outfitState.useFullBody === null) {
    return 'fullBody';
  }
  if (outfitState.useFullBody === true) {
    if (!outfitState.pieces.fullBody) {
      return 'fullBody';
    }
    if (!outfitState.pieces.footwear) {
      return 'footwear';
    }
    return null;
  }
  if (!outfitState.pieces.upperBody) {
    return 'upperBody';
  }
  if (!outfitState.pieces.lowerBody) {
    return 'lowerBody';
  }
  if (!outfitState.pieces.footwear) {
    return 'footwear';
  }
  return null;
}

function getRequiredPrompt(pieceKey) {
  switch (pieceKey) {
    case 'fullBody':
      return 'Ingresa el código de la prenda completa (fullBody) o escribe "skip" para combinar piezas separadas.';
    case 'upperBody':
      return 'Ingresa el código de la parte superior (upperBody).';
    case 'lowerBody':
      return 'Ingresa el código de la parte inferior (lowerBody).';
    case 'footwear':
      return 'Ingresa el código del calzado (footwear).';
    default:
      return `Ingresa el código para ${pieceKey}.`;
  }
}

function getOptionalPrompt(pieceKey) {
  switch (pieceKey) {
    case 'outerwear':
      return 'Ingresa el código de la prenda exterior (outerwear) o escribe "skip" para omitirla.';
    case 'accessories':
      return 'Ingresa el código de los accesorios (accessories) o escribe "skip" para omitirlos.';
    case 'head':
      return 'Ingresa el código del accesorio de cabeza (head) o escribe "skip" para omitirlo.';
    default:
      return `Ingresa el código opcional para ${pieceKey} o escribe "skip".`;
  }
}

function isSkip(input) {
  if (!input) {
    return false;
  }
  return SKIP_INPUTS.has(input.trim().toLowerCase());
}

function isAffirmative(input) {
  if (!input) {
    return false;
  }
  return AFFIRMATIVE_INPUTS.has(input.trim().toLowerCase());
}

function isNegative(input) {
  if (!input) {
    return false;
  }
  return NEGATIVE_INPUTS.has(input.trim().toLowerCase());
}

function buildOutfitSummary(pieces) {
  return Object.entries(pieces)
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `${OUTFIT_LABELS[key] || key}: ${value}`)
    .join(', ');
}

function normalizeBase64Image(imageString) {
  if (!imageString || typeof imageString !== 'string') {
    return null;
  }
  const trimmed = imageString.trim();
  if (trimmed.startsWith('data:')) {
    const commaIndex = trimmed.indexOf(',');
    if (commaIndex !== -1) {
      return trimmed.substring(commaIndex + 1).trim();
    }
  }
  return trimmed;
}

function createTelegramPhotoPayload(chatId, buffer, caption) {
  const boundary = '---------------------------' + Math.random().toString(16).slice(2);
  const newLine = '\r\n';
  const parts = [];

  parts.push(Buffer.from(`--${boundary}${newLine}Content-Disposition: form-data; name="chat_id"${newLine}${newLine}${chatId}${newLine}`));

  if (caption) {
    parts.push(Buffer.from(`--${boundary}${newLine}Content-Disposition: form-data; name="caption"${newLine}${newLine}${caption}${newLine}`));
  }

  parts.push(Buffer.from(`--${boundary}${newLine}Content-Disposition: form-data; name="photo"; filename="outfit.png"${newLine}Content-Type: image/png${newLine}${newLine}`));
  parts.push(buffer);
  parts.push(Buffer.from(`${newLine}--${boundary}--${newLine}`));

  return {
    body: Buffer.concat(parts),
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    }
  };
}

async function handleOutfitProgress({
  chatId,
  text,
  chatStatesRef,
  sendMessage,
  enqueueJob
}) {
  const conversationState = chatStatesRef[chatId];
  if (!conversationState || conversationState.state !== 'OUTFIT_COLLECTING') {
    return false;
  }
  if (typeof sendMessage !== 'function') {
    throw new Error('sendMessage function is required');
  }
  if (typeof enqueueJob !== 'function') {
    throw new Error('enqueueJob function is required');
  }

  const outfitState = conversationState.outfit;
  const rawInput = (text || '').trim();
  const lowerInput = rawInput.toLowerCase();

  async function promptNextStep() {
    outfitState.expectingOptionalConfirmation = false;
    outfitState.currentOptionalPiece = null;
    const nextPiece = getNextRequiredPiece(outfitState);
    outfitState.currentPiece = nextPiece;
    if (nextPiece) {
      await sendMessage(getRequiredPrompt(nextPiece));
    } else {
      outfitState.expectingOptionalConfirmation = true;
      await sendMessage(OPTIONAL_PROMPT);
    }
  }

  async function moveToNextOptional() {
    outfitState.currentOptionalPiece = outfitState.optionalQueue.shift() || null;
    if (outfitState.currentOptionalPiece) {
      await sendMessage(getOptionalPrompt(outfitState.currentOptionalPiece));
    } else {
      await finalizeOutfit();
    }
  }

  async function finalizeOutfit({ skipStylePrompt = false } = {}) {
    const filteredPieces = Object.fromEntries(
      Object.entries(outfitState.pieces).filter(([, value]) => Boolean(value))
    );

    const requiredOk = outfitState.useFullBody
      ? Boolean(filteredPieces.fullBody && filteredPieces.footwear)
      : Boolean(filteredPieces.upperBody && filteredPieces.lowerBody && filteredPieces.footwear);

    if (!requiredOk) {
      outfitState.expectingOptionalConfirmation = false;
      outfitState.currentOptionalPiece = null;
      outfitState.optionalQueue = [...OPTIONAL_OUTFIT_PIECES];
      outfitState.currentPiece = getNextRequiredPiece(outfitState);
      await sendMessage('❗ Faltan piezas obligatorias para generar el atuendo. Continuemos con los datos requeridos.');
      if (outfitState.currentPiece) {
        await sendMessage(getRequiredPrompt(outfitState.currentPiece));
      }
      return;
    }

    if (!skipStylePrompt && !outfitState.styleInstructionsPrompted) {
      outfitState.styleInstructionsPrompted = true;
      outfitState.expectingStyleInstructionsConfirmation = true;
      await sendMessage(STYLE_INSTRUCTIONS_PROMPT);
      return;
    }

    const summary = buildOutfitSummary(filteredPieces);
    await sendMessage(`⏳ Generando atuendo con: ${summary || 'las piezas seleccionadas'}. Te avisaré cuando esté listo. 🧵`);
    delete chatStatesRef[chatId];
    const jobPayload = {
      pieces: filteredPieces,
      summary,
      useFullBody: outfitState.useFullBody
    };
    if (outfitState.styleInstructions.length > 0) {
      jobPayload.userPreferences = {
        styleInstructions: [...outfitState.styleInstructions]
      };
    }
    await enqueueJob(jobPayload);
  }

  if (outfitState.expectingStyleInstructionsConfirmation) {
    if (isAffirmative(lowerInput)) {
      outfitState.expectingStyleInstructionsConfirmation = false;
      outfitState.collectingStyleInstructions = true;
      await sendMessage(STYLE_INSTRUCTIONS_INPUT_PROMPT);
    } else if (isNegative(lowerInput) || isSkip(lowerInput)) {
      outfitState.expectingStyleInstructionsConfirmation = false;
      outfitState.styleInstructions = [];
      await finalizeOutfit({ skipStylePrompt: true });
    } else {
      await sendMessage('❗ Responde "si" o "no" para continuar.');
    }
    return true;
  }

  if (outfitState.collectingStyleInstructions) {
    if (!rawInput || isSkip(lowerInput)) {
      outfitState.collectingStyleInstructions = false;
      outfitState.styleInstructions = [];
      await finalizeOutfit({ skipStylePrompt: true });
      return true;
    }
    const instructions = rawInput
      .split(/\r?\n|;/)
      .map(instruction => instruction.trim())
      .filter(Boolean);
    if (instructions.length === 0) {
      await sendMessage('❗ Ingresa al menos una instrucción de estilo o escribe "skip" para omitirlas.');
      return true;
    }
    outfitState.styleInstructions = instructions;
    outfitState.collectingStyleInstructions = false;
    await sendMessage('✅ Instrucciones de estilo guardadas.');
    await finalizeOutfit({ skipStylePrompt: true });
    return true;
  }

  if (outfitState.expectingOptionalConfirmation) {
    if (isAffirmative(lowerInput)) {
      outfitState.expectingOptionalConfirmation = false;
      await moveToNextOptional();
    } else if (isNegative(lowerInput) || isSkip(lowerInput)) {
      await finalizeOutfit();
    } else {
      await sendMessage('❗ Responde "si" o "no" para continuar.');
    }
    return true;
  }

  if (outfitState.currentOptionalPiece) {
    const optionalKey = outfitState.currentOptionalPiece;
    if (!rawInput || isSkip(lowerInput)) {
      await sendMessage(`➡️ ${OUTFIT_LABELS[optionalKey]} omitido.`);
    } else {
      outfitState.pieces[optionalKey] = rawInput;
      await sendMessage(`✅ ${OUTFIT_LABELS[optionalKey]} guardado: ${rawInput}`);
    }
    await moveToNextOptional();
    return true;
  }

  const targetPiece = outfitState.currentPiece || getNextRequiredPiece(outfitState);

  if (!targetPiece) {
    outfitState.expectingOptionalConfirmation = true;
    await sendMessage(OPTIONAL_PROMPT);
    return true;
  }

  if (targetPiece === 'fullBody') {
    if (!rawInput) {
      await sendMessage('❗ Ingresa un código válido para la prenda completa o escribe "skip".');
      return true;
    }
    if (isSkip(lowerInput)) {
      outfitState.useFullBody = false;
      delete outfitState.pieces.fullBody;
      await sendMessage('➡️ Usaremos prendas separadas para la parte superior e inferior.');
      await promptNextStep();
      return true;
    }
    outfitState.useFullBody = true;
    outfitState.pieces.fullBody = rawInput;
    await sendMessage(`✅ ${OUTFIT_LABELS.fullBody} guardada: ${rawInput}`);
    await promptNextStep();
    return true;
  }

  if (!rawInput || isSkip(lowerInput)) {
    await sendMessage(`❗ ${OUTFIT_LABELS[targetPiece]} es obligatoria. Ingresa un código válido.`);
    return true;
  }

  outfitState.pieces[targetPiece] = rawInput;
  await sendMessage(`✅ ${OUTFIT_LABELS[targetPiece]} guardada: ${rawInput}`);
  await promptNextStep();
  return true;
}

module.exports = {
  createOutfitConversationState,
  handleOutfitProgress,
  buildOutfitSummary,
  normalizeBase64Image,
  createTelegramPhotoPayload,
  OUTFIT_LABELS
};
