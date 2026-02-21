import { Writable } from 'node:stream';
import * as readline from 'readline';
import { assembleContext } from './context-assembly.js';
import { Gateway } from './gateway.js';
import type { Message } from './types.js';
import {
  getConfigPath,
  readConfig,
  reloadConfig,
  writeConfig,
  type TwinClawConfig,
} from '../config/config-loader.js';
import { initializeWorkspace, getWorkspaceDir } from '../config/workspace.js';
import { ensureIdentityFiles } from '../config/identity-bootstrap.js';
import { createSession, saveMessage } from '../services/db.js';
import { indexConversationTurn, retrieveMemoryContext } from '../services/semantic-memory.js';
import { ModelRouter } from '../services/model-router.js';
import { logThought } from '../utils/logger.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

export async function runOnboarding() {
  console.log(
    'Welcome to TwinClaw Setup. I will ask you a few questions to build my persona and your preferences.',
  );
  await logThought('Onboarding flow started.');

  const router = new ModelRouter();
  const sessionId = `onboarding_${Date.now()}`;
  createSession(sessionId);

  const onboardingInstructions =
    'This is the onboarding session. Ask the user 3 questions, one at a time, to establish their goals, routines, and how they want you to behave.';
  const context = await assembleContext(onboardingInstructions);

  const messages: Message[] = [{ role: 'system', content: context }];

  const askModel = async () => {
    const responseMessage = await router.createChatCompletion(messages, undefined, { sessionId });
    const responseContent = responseMessage.content ?? '';
    messages.push({ role: 'assistant', content: responseContent });
    saveMessage(Date.now().toString(), sessionId, 'assistant', responseContent);
    await indexConversationTurn(sessionId, 'assistant', responseContent);

    console.log(`\nTwinClaw: ${responseContent}`);

    rl.question('\nYou: ', async (answer) => {
      const memoryContext = await retrieveMemoryContext(sessionId, answer);
      messages[0] = {
        role: 'system',
        content: await assembleContext(
          `${onboardingInstructions}${memoryContext ? `\n\n${memoryContext}` : ''}`,
        ),
      };
      messages.push({ role: 'user', content: answer });
      saveMessage(Date.now().toString(), sessionId, 'user', answer);
      await indexConversationTurn(sessionId, 'user', answer);
      await logThought(`Onboarding user response captured (${answer.length} chars).`);
      await askModel();
    });
  };

  await askModel();
}

export function startBasicREPL(gateway: Gateway) {
  console.log('TwinClaw basic REPL started.');
  void logThought('Basic REPL started.');
  const sessionId = 'default_repl';
  createSession(sessionId);

  rl.on('line', async (line) => {
    await logThought(`REPL input received (${line.length} chars).`);

    try {
      const responseText = await gateway.processText(sessionId, line);
      console.log(`\nTwinClaw: ${responseText}\n`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Error generating response:', message);
    }
  });
}

type OnboardConfigKey =
  | 'API_SECRET'
  | 'OPENROUTER_API_KEY'
  | 'MODAL_API_KEY'
  | 'GEMINI_API_KEY'
  | 'GROQ_API_KEY'
  | 'TELEGRAM_BOT_TOKEN'
  | 'TELEGRAM_USER_ID'
  | 'WHATSAPP_PHONE_NUMBER'
  | 'EMBEDDING_PROVIDER'
  | 'API_PORT';

type OnboardUpdateMap = Partial<Record<OnboardConfigKey, string>>;

interface OnboardFieldSpec {
  key: OnboardConfigKey;
  label: string;
  hint: string;
  required?: boolean;
  secret?: boolean;
  validator?: (value: string) => string | null;
}

interface WizardLogger {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

type OnboardSectionId = 'runtime' | 'models' | 'messaging' | 'memory' | 'summary';

interface WizardSection {
  id: OnboardSectionId;
  label: string;
  fields: OnboardConfigKey[];
}

const WIZARD_SECTIONS: readonly WizardSection[] = [
  {
    id: 'runtime',
    label: 'Runtime & Security',
    fields: ['API_SECRET', 'API_PORT'],
  },
  {
    id: 'models',
    label: 'Intelligence & Models',
    fields: ['OPENROUTER_API_KEY', 'MODAL_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY'],
  },
  {
    id: 'messaging',
    label: 'Messaging & Channels',
    fields: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_USER_ID', 'WHATSAPP_PHONE_NUMBER'],
  },
  {
    id: 'memory',
    label: 'Memory & Workspace Defaults',
    fields: ['EMBEDDING_PROVIDER'],
  },
];

const EMBEDDING_PROVIDERS = new Set(['openai', 'ollama']);
const MODEL_KEYS: readonly OnboardConfigKey[] = [
  'OPENROUTER_API_KEY',
  'MODAL_API_KEY',
  'GEMINI_API_KEY',
];
const SECRET_KEYS = new Set<OnboardConfigKey>([
  'API_SECRET',
  'OPENROUTER_API_KEY',
  'MODAL_API_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'TELEGRAM_BOT_TOKEN',
]);

const ONBOARD_FIELDS: readonly OnboardFieldSpec[] = [
  {
    key: 'API_SECRET',
    label: 'API Secret',
    hint: 'Required. Master runtime secret used for gateway security and secret-vault fallback.',
    required: true,
    secret: true,
  },
  {
    key: 'OPENROUTER_API_KEY',
    label: 'OpenRouter API Key',
    hint: 'Optional, but at least one model key is required across OpenRouter/Modal/Gemini.',
    secret: true,
  },
  {
    key: 'MODAL_API_KEY',
    label: 'Modal API Key',
    hint: 'Optional, but at least one model key is required across OpenRouter/Modal/Gemini.',
    secret: true,
  },
  {
    key: 'GEMINI_API_KEY',
    label: 'Gemini API Key',
    hint: 'Optional, but at least one model key is required across OpenRouter/Modal/Gemini.',
    secret: true,
  },
  {
    key: 'GROQ_API_KEY',
    label: 'Groq API Key',
    hint: 'Optional unless messaging is configured. Needed for voice/STT features.',
    secret: true,
  },
  {
    key: 'TELEGRAM_BOT_TOKEN',
    label: 'Telegram Bot Token',
    hint: 'Optional. If set, TELEGRAM_USER_ID is required for deterministic pairing bootstrap.',
    secret: true,
  },
  {
    key: 'TELEGRAM_USER_ID',
    label: 'Telegram User ID',
    hint: 'Optional unless TELEGRAM_BOT_TOKEN is set. Must be a positive integer.',
    validator: (value) =>
      Number.isInteger(Number(value)) && Number(value) > 0
        ? null
        : 'TELEGRAM_USER_ID must be a positive integer.',
  },
  {
    key: 'WHATSAPP_PHONE_NUMBER',
    label: 'WhatsApp Phone Number',
    hint: 'Optional. Use E.164-like format, e.g. +15551234567.',
    validator: (value) =>
      /^\+?[1-9]\d{6,14}$/.test(value)
        ? null
        : 'WHATSAPP_PHONE_NUMBER must be a valid phone number (E.164-like format).',
  },
  {
    key: 'EMBEDDING_PROVIDER',
    label: 'Embedding Provider',
    hint: "Workspace default. Use 'openai' or 'ollama'.",
    validator: (value) =>
      EMBEDDING_PROVIDERS.has(value.toLowerCase())
        ? null
        : "EMBEDDING_PROVIDER must be 'openai' or 'ollama'.",
  },
  {
    key: 'API_PORT',
    label: 'API Port',
    hint: 'Workspace default. Integer from 1 to 65535.',
    validator: (value) => {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        return 'API_PORT must be an integer in range 1-65535.';
      }
      return null;
    },
  },
];

const ONBOARD_FLAG_TO_KEY: Record<string, OnboardConfigKey> = {
  '--api-secret': 'API_SECRET',
  '--openrouter-api-key': 'OPENROUTER_API_KEY',
  '--modal-api-key': 'MODAL_API_KEY',
  '--gemini-api-key': 'GEMINI_API_KEY',
  '--groq-api-key': 'GROQ_API_KEY',
  '--telegram-bot-token': 'TELEGRAM_BOT_TOKEN',
  '--telegram-user-id': 'TELEGRAM_USER_ID',
  '--whatsapp-phone-number': 'WHATSAPP_PHONE_NUMBER',
  '--embedding-provider': 'EMBEDDING_PROVIDER',
  '--api-port': 'API_PORT',
};

export interface SetupWizardOptions {
  nonInteractive?: boolean;
  providedValues?: OnboardUpdateMap;
  configPathOverride?: string;
  logger?: WizardLogger;
  prompter?: SetupPrompter;
}

export interface SetupWizardResult {
  status: 'success' | 'validation_error' | 'cancelled';
  configPath: string;
  warnings: string[];
  errors: string[];
}

export interface PromptOptions {
  secret?: boolean;
}

export interface SetupPrompter {
  prompt(question: string, options?: PromptOptions): Promise<string>;
  close(): void;
}

export interface ParsedOnboardArgs {
  help: boolean;
  nonInteractive: boolean;
  configPathOverride?: string;
  values: OnboardUpdateMap;
  error?: string;
}

export interface OnboardValidationResult {
  errors: string[];
  warnings: string[];
}

export class OnboardingCancelledError extends Error {
  constructor(message = 'Onboarding cancelled by user.') {
    super(message);
    this.name = 'OnboardingCancelledError';
  }
}

class MutedWriter extends Writable {
  muted = false;
  #target: NodeJS.WriteStream;

  constructor(target: NodeJS.WriteStream) {
    super();
    this.#target = target;
  }

  _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (!this.muted) {
      if (typeof chunk === 'string') {
        this.#target.write(chunk, encoding);
      } else {
        this.#target.write(chunk);
      }
    }
    callback();
  }
}

class ReadlinePrompter implements SetupPrompter {
  #writer: MutedWriter;
  #rl: readline.Interface;
  #pendingReject: ((reason?: unknown) => void) | null = null;

  constructor() {
    this.#writer = new MutedWriter(process.stdout);
    this.#rl = readline.createInterface({
      input: process.stdin,
      output: this.#writer,
      terminal: true,
    });
    this.#rl.on('SIGINT', () => {
      const reject = this.#pendingReject;
      this.#pendingReject = null;
      if (reject) {
        reject(new OnboardingCancelledError());
      }
    });
  }

  async prompt(question: string, options: PromptOptions = {}): Promise<string> {
    const isSecret = options.secret === true;
    if (isSecret) {
      process.stdout.write(question);
      this.#writer.muted = true;
    }

    return new Promise<string>((resolve, reject) => {
      this.#pendingReject = reject;
      this.#rl.question(isSecret ? '' : question, (answer) => {
        this.#pendingReject = null;
        this.#writer.muted = false;
        if (isSecret) {
          process.stdout.write('\n');
        }
        resolve(answer.trim());
      });
    });
  }

  close(): void {
    this.#writer.muted = false;
    this.#rl.close();
  }
}

function hasValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function cloneConfig(config: TwinClawConfig): TwinClawConfig {
  return JSON.parse(JSON.stringify(config)) as TwinClawConfig;
}

function readConfigValue(config: TwinClawConfig, key: OnboardConfigKey): string {
  switch (key) {
    case 'API_SECRET':
      return config.runtime.apiSecret ?? '';
    case 'OPENROUTER_API_KEY':
      return config.models.openRouterApiKey ?? '';
    case 'MODAL_API_KEY':
      return config.models.modalApiKey ?? '';
    case 'GEMINI_API_KEY':
      return config.models.geminiApiKey ?? '';
    case 'GROQ_API_KEY':
      return config.messaging.voice.groqApiKey ?? '';
    case 'TELEGRAM_BOT_TOKEN':
      return config.messaging.telegram.botToken ?? '';
    case 'TELEGRAM_USER_ID':
      return config.messaging.telegram.userId === null ? '' : String(config.messaging.telegram.userId);
    case 'WHATSAPP_PHONE_NUMBER':
      return config.messaging.whatsapp.phoneNumber ?? '';
    case 'EMBEDDING_PROVIDER':
      return config.integration.embeddingProvider ?? '';
    case 'API_PORT':
      return String(config.runtime.apiPort ?? 3100);
  }
}

function applyConfigValue(config: TwinClawConfig, key: OnboardConfigKey, value: string): void {
  switch (key) {
    case 'API_SECRET':
      config.runtime.apiSecret = value;
      break;
    case 'OPENROUTER_API_KEY':
      config.models.openRouterApiKey = value;
      break;
    case 'MODAL_API_KEY':
      config.models.modalApiKey = value;
      break;
    case 'GEMINI_API_KEY':
      config.models.geminiApiKey = value;
      break;
    case 'GROQ_API_KEY':
      config.messaging.voice.groqApiKey = value;
      break;
    case 'TELEGRAM_BOT_TOKEN':
      config.messaging.telegram.botToken = value;
      break;
    case 'TELEGRAM_USER_ID':
      config.messaging.telegram.userId =
        value.trim().length === 0 ? null : Number.parseInt(value.trim(), 10);
      break;
    case 'WHATSAPP_PHONE_NUMBER':
      config.messaging.whatsapp.phoneNumber = value;
      break;
    case 'EMBEDDING_PROVIDER':
      config.integration.embeddingProvider =
        value.toLowerCase() as TwinClawConfig['integration']['embeddingProvider'];
      break;
    case 'API_PORT':
      config.runtime.apiPort = Number.parseInt(value, 10);
      break;
  }
}

function applyUpdates(config: TwinClawConfig, updates: OnboardUpdateMap): TwinClawConfig {
  const next = cloneConfig(config);
  for (const [key, rawValue] of Object.entries(updates) as Array<[OnboardConfigKey, string]>) {
    const normalized = rawValue.trim();
    applyConfigValue(next, key, normalized);
  }
  syncDerivedConfig(next);
  return next;
}

function syncDerivedConfig(config: TwinClawConfig): void {
  const hasTelegramToken = hasValue(config.messaging.telegram.botToken);
  const hasTelegramUserId = Number.isInteger(config.messaging.telegram.userId ?? NaN);
  config.messaging.telegram.enabled = hasTelegramToken && hasTelegramUserId;
  config.messaging.whatsapp.enabled = hasValue(config.messaging.whatsapp.phoneNumber);
}

function hasAnyModelKey(config: TwinClawConfig): boolean {
  return MODEL_KEYS.some((key) => hasValue(readConfigValue(config, key)));
}

function buildQuestion(field: OnboardFieldSpec, currentValue: string): string {
  const hasCurrentValue = hasValue(currentValue);
  const suffix = hasCurrentValue
    ? "Press Enter to keep current value, '-' to clear."
    : field.required
      ? 'Value required.'
      : 'Optional. Press Enter to skip.';

  return `\n${field.label}\n${field.hint}\n${suffix}\n${field.key}: `;
}

async function promptFieldValue(
  field: OnboardFieldSpec,
  currentValue: string,
  prompter: SetupPrompter,
  logger: WizardLogger,
): Promise<string | undefined> {
  while (true) {
    const answer = await prompter.prompt(buildQuestion(field, currentValue), {
      secret: field.secret === true || SECRET_KEYS.has(field.key),
    });

    if (answer.length === 0) {
      if (hasValue(currentValue)) {
        return undefined;
      }
      if (field.required) {
        logger.warn(`  ${field.key} is required.`);
        continue;
      }
      return undefined;
    }

    if (answer === '-') {
      if (field.required) {
        logger.warn(`  ${field.key} cannot be cleared because it is required.`);
        continue;
      }
      return '';
    }

    const normalized = answer.trim();
    const validationError = field.validator?.(normalized) ?? null;
    if (validationError) {
      logger.warn(`  ${validationError}`);
      continue;
    }
    return normalized;
  }
}

async function collectInteractiveUpdates(
  existing: TwinClawConfig,
  logger: WizardLogger,
  prompter: SetupPrompter,
): Promise<OnboardUpdateMap> {
  const workspaceDir = getWorkspaceDir();
  logger.log('\nTwinClaw Onboarding Wizard v2.0');
  logger.log('──────────────────────────────────────────────────');
  logger.log(`Workspace: ${workspaceDir}`);
  logger.log('Model keys, channel preferences, and workspace defaults will be configured.');
  logger.log("Secret prompts are masked. Type '-' to clear an existing optional value.\n");

  const updates: OnboardUpdateMap = {};
  let candidate = cloneConfig(existing);

  for (const section of WIZARD_SECTIONS) {
    while (true) {
      logger.log(`\nSection: ${section.label}`);
      logger.log('──────────────────────────────────────────────────');
      for (const fieldKey of section.fields) {
        const field = ONBOARD_FIELDS.find((item) => item.key === fieldKey);
        if (!field) {
          continue;
        }
        const current = readConfigValue(candidate, field.key);
        const nextValue = await promptFieldValue(field, current, prompter, logger);
        if (nextValue !== undefined) {
          updates[field.key] = nextValue;
          candidate = applyUpdates(candidate, { [field.key]: nextValue });
        }
      }

      if (section.id === 'models' && !hasAnyModelKey(candidate)) {
        logger.warn('\nAt least one model API key is required (OpenRouter, Modal, or Gemini).');
        continue;
      }

      if (section.id === 'messaging') {
        const telegramToken = (candidate.messaging.telegram.botToken ?? '').trim();
        const telegramUserId = candidate.messaging.telegram.userId;
        if (hasValue(telegramToken) && !telegramUserId) {
          logger.warn('\nTELEGRAM_USER_ID is required when TELEGRAM_BOT_TOKEN is provided.');
          continue;
        }
        if (!hasValue(telegramToken) && telegramUserId) {
          logger.warn('\nTELEGRAM_BOT_TOKEN is required when TELEGRAM_USER_ID is provided.');
          continue;
        }
      }

      break;
    }
  }

  while (true) {
    logger.log('\nSummary of Configuration:');
    logger.log('──────────────────────────────────────────────────');
    for (const field of ONBOARD_FIELDS) {
      const val = readConfigValue(candidate, field.key);
      const displayVal =
        field.secret || SECRET_KEYS.has(field.key)
          ? val
            ? '********'
            : '(not set)'
          : val || '(not set)';
      logger.log(`  ${field.label}: ${displayVal}`);
    }

    const choice = await prompter.prompt('\nConfirm configuration? [y]es, [n]o (cancel), [e]dit: ');
    const lower = choice.toLowerCase();

    if (lower === 'y' || lower === 'yes') {
      if (!hasAnyModelKey(candidate)) {
        logger.warn('\nAt least one model API key is required (OpenRouter, Modal, or Gemini).');
        continue;
      }
      return updates;
    }

    if (lower === 'n' || lower === 'no') {
      throw new OnboardingCancelledError();
    }

    if (lower === 'e' || lower === 'edit') {
      logger.log('\nSelect section to edit:');
      WIZARD_SECTIONS.forEach((s, i) => {
        logger.log(`  ${i + 1}. ${s.label}`);
      });
      const sectionIdxStr = await prompter.prompt('\nSection number: ');
      const sectionIdx = Number.parseInt(sectionIdxStr, 10) - 1;

      if (WIZARD_SECTIONS[sectionIdx]) {
        const section = WIZARD_SECTIONS[sectionIdx];
        logger.log(`\nEditing Section: ${section.label}`);
        logger.log('──────────────────────────────────────────────────');
        for (const fieldKey of section.fields) {
          const field = ONBOARD_FIELDS.find((item) => item.key === fieldKey);
          if (!field) {
            continue;
          }
          const current = readConfigValue(candidate, field.key);
          const nextValue = await promptFieldValue(field, current, prompter, logger);
          if (nextValue !== undefined) {
            updates[field.key] = nextValue;
            candidate = applyUpdates(candidate, { [field.key]: nextValue });
          }
        }
      } else {
        logger.warn('Invalid section number.');
      }
      continue;
    }

    logger.warn("Please enter 'y', 'n', or 'e'.");
  }
}

export function validateOnboardConfig(config: TwinClawConfig): OnboardValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!hasValue(config.runtime.apiSecret)) {
    errors.push('API_SECRET is required.');
  }

  if (!hasAnyModelKey(config)) {
    errors.push(
      'At least one model key must be configured (OPENROUTER_API_KEY, MODAL_API_KEY, or GEMINI_API_KEY).',
    );
  }

  const telegramToken = (config.messaging.telegram.botToken ?? '').trim();
  const telegramUserId =
    config.messaging.telegram.userId === null ? '' : String(config.messaging.telegram.userId);
  if (hasValue(telegramToken) && !hasValue(telegramUserId)) {
    errors.push('TELEGRAM_USER_ID is required when TELEGRAM_BOT_TOKEN is provided.');
  }
  if (!hasValue(telegramToken) && hasValue(telegramUserId)) {
    errors.push('TELEGRAM_BOT_TOKEN is required when TELEGRAM_USER_ID is provided.');
  }
  if (hasValue(telegramUserId)) {
    const parsed = Number(telegramUserId);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      errors.push('TELEGRAM_USER_ID must be a positive integer.');
    }
  }

  const whatsapp = (config.messaging.whatsapp.phoneNumber ?? '').trim();
  if (hasValue(whatsapp) && !/^\+?[1-9]\d{6,14}$/.test(whatsapp)) {
    errors.push('WHATSAPP_PHONE_NUMBER must be in E.164-like format (example: +15551234567).');
  }

  const provider = (config.integration.embeddingProvider ?? '').trim().toLowerCase();
  if (!EMBEDDING_PROVIDERS.has(provider)) {
    errors.push("EMBEDDING_PROVIDER must be 'openai' or 'ollama'.");
  }

  if (!Number.isInteger(config.runtime.apiPort) || config.runtime.apiPort < 1 || config.runtime.apiPort > 65535) {
    errors.push('API_PORT must be an integer in range 1-65535.');
  }

  const messagingEnabled = hasValue(telegramToken) || hasValue(whatsapp);
  if (messagingEnabled && !hasValue(config.messaging.voice.groqApiKey)) {
    warnings.push(
      'Messaging is configured without GROQ_API_KEY. Voice and STT features will be unavailable.',
    );
  }
  if (!messagingEnabled) {
    warnings.push('No messaging channel configured yet. You can add one later via `channels login`.');
  }

  return { errors, warnings };
}

function printWarnings(warnings: string[], logger: WizardLogger): void {
  if (warnings.length === 0) {
    return;
  }
  logger.warn('\nOptional integration warnings:');
  for (const warning of warnings) {
    logger.warn(`  - ${warning}`);
  }
}

function printNextActions(logger: WizardLogger): void {
  logger.log('\nNext actions:');
  logger.log('  1. node src/index.ts doctor');
  logger.log('  2. node src/index.ts channels login whatsapp');
  logger.log('  3. node src/index.ts pairing approve <channel> <CODE>');
}

export function parseOnboardArgs(args: string[]): ParsedOnboardArgs {
  const parsed: ParsedOnboardArgs = {
    help: false,
    nonInteractive: false,
    values: {},
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--help' || token === '-h') {
      parsed.help = true;
      continue;
    }
    if (token === '--non-interactive') {
      parsed.nonInteractive = true;
      continue;
    }
    if (token === '--config') {
      const nextValue = args[i + 1];
      if (!nextValue) {
        parsed.error = 'Missing value for --config.';
        return parsed;
      }
      parsed.configPathOverride = nextValue;
      i += 1;
      continue;
    }

    const mappedKey = ONBOARD_FLAG_TO_KEY[token];
    if (mappedKey) {
      const nextValue = args[i + 1];
      if (nextValue === undefined) {
        parsed.error = `Missing value for ${token}.`;
        return parsed;
      }
      parsed.values[mappedKey] = nextValue;
      i += 1;
      continue;
    }

    parsed.error = `Unknown option '${token}'.`;
    return parsed;
  }

  return parsed;
}

function printOnboardUsage(): void {
  console.log(`Onboard command usage:
  onboard                            Run interactive onboarding wizard
  onboard --non-interactive [flags]  Run scripted onboarding mode

Options:
  --config <path>                    Override twinclaw.json output path
  --api-secret <value>               Set API_SECRET
  --openrouter-api-key <value>       Set OPENROUTER_API_KEY
  --modal-api-key <value>            Set MODAL_API_KEY
  --gemini-api-key <value>           Set GEMINI_API_KEY
  --groq-api-key <value>             Set GROQ_API_KEY
  --telegram-bot-token <value>       Set TELEGRAM_BOT_TOKEN
  --telegram-user-id <value>         Set TELEGRAM_USER_ID
  --whatsapp-phone-number <value>    Set WHATSAPP_PHONE_NUMBER
  --embedding-provider <openai|ollama> Set EMBEDDING_PROVIDER
  --api-port <1-65535>               Set API_PORT`);
}

export async function runSetupWizard(options: SetupWizardOptions = {}): Promise<SetupWizardResult> {
  const logger = options.logger ?? console;
  const configPath = getConfigPath(options.configPathOverride);
  const baseConfig = await readConfig(options.configPathOverride);

  // Keep default provider deterministic even when config has empty string.
  if (!hasValue(baseConfig.integration.embeddingProvider)) {
    baseConfig.integration.embeddingProvider = 'openai';
  }

  let updates: OnboardUpdateMap = {};
  const ownPrompter = options.nonInteractive || options.prompter ? null : new ReadlinePrompter();
  const prompter = options.prompter ?? ownPrompter;

  try {
    if (options.nonInteractive) {
      updates = options.providedValues ?? {};
    } else {
      if (!prompter) {
        throw new Error('Interactive onboarding requires an available prompt session.');
      }
      updates = await collectInteractiveUpdates(baseConfig, logger, prompter);
    }
  } catch (error) {
    if (error instanceof OnboardingCancelledError) {
      logger.warn('\nOnboarding cancelled. No configuration changes were written.');
      await logThought('Setup wizard cancelled before persistence.');
      return {
        status: 'cancelled',
        configPath,
        warnings: [],
        errors: [error.message],
      };
    }
    throw error;
  } finally {
    ownPrompter?.close();
  }

  const candidate = applyUpdates(baseConfig, updates);
  const validation = validateOnboardConfig(candidate);
  if (validation.errors.length > 0) {
    logger.error('\nOnboarding validation failed. No configuration changes were written.');
    for (const error of validation.errors) {
      logger.error(`  - ${error}`);
    }
    await logThought(`Setup wizard validation failed (${validation.errors.length} issue(s)).`);
    return {
      status: 'validation_error',
      configPath,
      warnings: validation.warnings,
      errors: validation.errors,
    };
  }

  await writeConfig(candidate, options.configPathOverride);
  reloadConfig();
  initializeWorkspace();
  ensureIdentityFiles();
  logger.log(`\nConfiguration saved to ${configPath}.`);
  logger.log(`Workspace initialized at ${getWorkspaceDir()}.`);
  printWarnings(validation.warnings, logger);
  printNextActions(logger);
  await logThought('Setup wizard completed and twinclaw.json updated.');

  return {
    status: 'success',
    configPath,
    warnings: validation.warnings,
    errors: [],
  };
}

export async function handleOnboardCli(argv: string[]): Promise<boolean> {
  if (argv[0] !== 'onboard') {
    return false;
  }

  const parsed = parseOnboardArgs(argv.slice(1));
  if (parsed.help) {
    printOnboardUsage();
    process.exitCode = 0;
    return true;
  }
  if (parsed.error) {
    console.error(`[TwinClaw Onboard] ${parsed.error}`);
    printOnboardUsage();
    process.exitCode = 1;
    return true;
  }
  if (!parsed.nonInteractive && Object.keys(parsed.values).length > 0) {
    console.error(
      '[TwinClaw Onboard] Value flags require --non-interactive. Use `onboard` alone for guided prompts.',
    );
    process.exitCode = 1;
    return true;
  }

  const result = await runSetupWizard({
    nonInteractive: parsed.nonInteractive,
    providedValues: parsed.values,
    configPathOverride: parsed.configPathOverride,
  });

  if (result.status === 'success') {
    process.exitCode = 0;
  } else if (result.status === 'cancelled') {
    process.exitCode = 130;
  } else {
    process.exitCode = 1;
  }

  return true;
}
