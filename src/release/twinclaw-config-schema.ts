type JsonRecord = Record<string, unknown>;

export interface TwinclawSchemaValidationResult {
  valid: boolean;
  errors: string[];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRequiredObject(
  parent: JsonRecord,
  key: string,
  path: string,
  errors: string[],
): JsonRecord | null {
  const value = parent[key];
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return null;
  }
  return value;
}

function readRequiredString(
  parent: JsonRecord,
  key: string,
  path: string,
  errors: string[],
  allowEmpty = false,
): string | null {
  const value = parent[key];
  if (typeof value !== 'string') {
    errors.push(`${path} must be a string.`);
    return null;
  }
  if (!allowEmpty && value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string.`);
  }
  return value;
}

function readRequiredBoolean(parent: JsonRecord, key: string, path: string, errors: string[]): boolean | null {
  const value = parent[key];
  if (typeof value !== 'boolean') {
    errors.push(`${path} must be a boolean.`);
    return null;
  }
  return value;
}

function readRequiredIntegerInRange(
  parent: JsonRecord,
  key: string,
  path: string,
  min: number,
  max: number,
  errors: string[],
): number | null {
  const value = parent[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    errors.push(`${path} must be an integer.`);
    return null;
  }
  if (value < min || value > max) {
    errors.push(`${path} must be between ${min} and ${max}.`);
  }
  return value;
}

function readStringArray(parent: JsonRecord, key: string, path: string, errors: string[]): string[] | null {
  const value = parent[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    errors.push(`${path} must be an array of strings.`);
    return null;
  }
  return value as string[];
}

function validateRuntime(root: JsonRecord, errors: string[]): void {
  const runtime = readRequiredObject(root, 'runtime', 'runtime', errors);
  if (!runtime) {
    return;
  }

  readRequiredString(runtime, 'apiSecret', 'runtime.apiSecret', errors, false);
  readRequiredIntegerInRange(runtime, 'apiPort', 'runtime.apiPort', 1, 65535, errors);
  readStringArray(runtime, 'secretVaultRequired', 'runtime.secretVaultRequired', errors);
}

function validateModels(root: JsonRecord, errors: string[]): void {
  const models = readRequiredObject(root, 'models', 'models', errors);
  if (!models) {
    return;
  }

  const modalApiKey = readRequiredString(models, 'modalApiKey', 'models.modalApiKey', errors, true);
  const openRouterApiKey = readRequiredString(
    models,
    'openRouterApiKey',
    'models.openRouterApiKey',
    errors,
    true,
  );
  const geminiApiKey = readRequiredString(models, 'geminiApiKey', 'models.geminiApiKey', errors, true);

  const hasModelKey = [modalApiKey, openRouterApiKey, geminiApiKey].some(
    (value) => typeof value === 'string' && value.trim().length > 0,
  );
  if (!hasModelKey) {
    errors.push('At least one model API key must be configured in models.*ApiKey.');
  }
}

function validateMessaging(root: JsonRecord, errors: string[]): void {
  const messaging = readRequiredObject(root, 'messaging', 'messaging', errors);
  if (!messaging) {
    return;
  }

  const telegram = readRequiredObject(messaging, 'telegram', 'messaging.telegram', errors);
  if (telegram) {
    readRequiredBoolean(telegram, 'enabled', 'messaging.telegram.enabled', errors);
    readRequiredString(telegram, 'botToken', 'messaging.telegram.botToken', errors, true);
    const userId = telegram['userId'];
    if (!(typeof userId === 'number' || userId === null)) {
      errors.push('messaging.telegram.userId must be a number or null.');
    }
  }

  const whatsapp = readRequiredObject(messaging, 'whatsapp', 'messaging.whatsapp', errors);
  if (whatsapp) {
    readRequiredBoolean(whatsapp, 'enabled', 'messaging.whatsapp.enabled', errors);
    readRequiredString(whatsapp, 'phoneNumber', 'messaging.whatsapp.phoneNumber', errors, true);
  }

  const voice = readRequiredObject(messaging, 'voice', 'messaging.voice', errors);
  if (voice) {
    readRequiredString(voice, 'groqApiKey', 'messaging.voice.groqApiKey', errors, true);
  }

  const inbound = readRequiredObject(messaging, 'inbound', 'messaging.inbound', errors);
  if (inbound) {
    readRequiredBoolean(inbound, 'enabled', 'messaging.inbound.enabled', errors);
    readRequiredIntegerInRange(inbound, 'debounceMs', 'messaging.inbound.debounceMs', 0, 60_000, errors);
  }

  const streaming = readRequiredObject(messaging, 'streaming', 'messaging.streaming', errors);
  if (streaming) {
    readRequiredBoolean(streaming, 'blockStreamingDefault', 'messaging.streaming.blockStreamingDefault', errors);
    const breakMode = readRequiredString(
      streaming,
      'blockStreamingBreak',
      'messaging.streaming.blockStreamingBreak',
      errors,
      false,
    );
    if (breakMode && breakMode !== 'paragraph' && breakMode !== 'sentence') {
      errors.push("messaging.streaming.blockStreamingBreak must be 'paragraph' or 'sentence'.");
    }
    readRequiredIntegerInRange(
      streaming,
      'blockStreamingMinChars',
      'messaging.streaming.blockStreamingMinChars',
      1,
      50_000,
      errors,
    );
    readRequiredIntegerInRange(
      streaming,
      'blockStreamingMaxChars',
      'messaging.streaming.blockStreamingMaxChars',
      1,
      200_000,
      errors,
    );
    readRequiredBoolean(
      streaming,
      'blockStreamingCoalesce',
      'messaging.streaming.blockStreamingCoalesce',
      errors,
    );
    readRequiredIntegerInRange(streaming, 'humanDelayMs', 'messaging.streaming.humanDelayMs', 0, 120_000, errors);
  }
}

function validateStorage(root: JsonRecord, errors: string[]): void {
  const storage = readRequiredObject(root, 'storage', 'storage', errors);
  if (!storage) {
    return;
  }
  readRequiredIntegerInRange(storage, 'embeddingDim', 'storage.embeddingDim', 1, 1_000_000, errors);
}

function validateIntegration(root: JsonRecord, errors: string[]): void {
  const integration = readRequiredObject(root, 'integration', 'integration', errors);
  if (!integration) {
    return;
  }

  const provider = readRequiredString(
    integration,
    'embeddingProvider',
    'integration.embeddingProvider',
    errors,
    false,
  );
  if (provider && provider !== 'openai' && provider !== 'ollama') {
    errors.push("integration.embeddingProvider must be 'openai' or 'ollama'.");
  }

  readRequiredString(integration, 'embeddingApiKey', 'integration.embeddingApiKey', errors, true);
  readRequiredString(integration, 'openaiApiKey', 'integration.openaiApiKey', errors, true);
  readRequiredString(integration, 'embeddingApiUrl', 'integration.embeddingApiUrl', errors, false);
  readRequiredString(integration, 'embeddingModel', 'integration.embeddingModel', errors, false);
  readRequiredString(integration, 'ollamaBaseUrl', 'integration.ollamaBaseUrl', errors, false);
  readRequiredString(integration, 'ollamaEmbeddingModel', 'integration.ollamaEmbeddingModel', errors, false);
}

function validateTools(root: JsonRecord, errors: string[]): void {
  const tools = readRequiredObject(root, 'tools', 'tools', errors);
  if (!tools) {
    return;
  }
  readStringArray(tools, 'allow', 'tools.allow', errors);
  readStringArray(tools, 'deny', 'tools.deny', errors);
}

export function validateTwinclawConfigSchema(value: unknown): TwinclawSchemaValidationResult {
  if (!isRecord(value)) {
    return {
      valid: false,
      errors: ['Root config must be a JSON object.'],
    };
  }

  const errors: string[] = [];
  validateRuntime(value, errors);
  validateModels(value, errors);
  validateMessaging(value, errors);
  validateStorage(value, errors);
  validateIntegration(value, errors);
  validateTools(value, errors);

  return {
    valid: errors.length === 0,
    errors,
  };
}
