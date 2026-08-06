import {
    extractRoutingMetadata,
    isClinePassModel,
    summarizeRouting,
} from './core.js';

const MODULE_ID = 'sillytavern-clinepass-provider-monitor';
const MODULE_LABEL = 'ClinePass Provider Monitor';
const GENERATE_PATH = '/api/backends/chat-completions/generate';
const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    expectedProvider: 'moonshotai',
});

let context;
let settings;
let originalFetch;
let wrappedFetch;
let lifecycleEnabled = true;

const status = {
    phase: 'Idle',
    model: '',
    expectedProvider: '',
    actualProvider: '',
    attemptCount: null,
    attemptProviders: [],
    result: 'unknown',
    note: 'Generate with a cline-pass/* model to inspect its response metadata.',
    updatedAt: '',
};

function ensureSettings() {
    const stored = context.extensionSettings[MODULE_ID] ?? {};
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (stored[key] === undefined) {
            stored[key] = value;
        }
    }
    context.extensionSettings[MODULE_ID] = stored;
    return stored;
}

function saveSettings() {
    context.saveSettingsDebounced();
}

function setStatus(patch) {
    Object.assign(status, patch, { updatedAt: new Date().toLocaleTimeString() });
    renderStatus();
}

function renderStatus() {
    const element = document.getElementById('clinepass-monitor-status');
    if (!element) {
        return;
    }

    const resultLabel = {
        matched: 'MATCHED — final provider equals the expected provider',
        mismatched: 'MISMATCH — final provider differs from the expected provider',
        unknown: 'UNKNOWN — routing metadata was not available or was incomplete',
    }[status.result] ?? status.result;

    element.textContent = [
        `State: ${status.phase}`,
        `Model: ${status.model || '-'}`,
        `Expected: ${status.expectedProvider || '-'}`,
        `Actual: ${status.actualProvider || '-'}`,
        `Attempts: ${status.attemptCount ?? '-'}`,
        `Attempt providers: ${status.attemptProviders.length ? status.attemptProviders.join(', ') : '-'}`,
        `Result: ${resultLabel}`,
        `Note: ${status.note || '-'}`,
        `Updated: ${status.updatedAt || '-'}`,
    ].join('\n');
}

function getUrl(input) {
    try {
        const raw = typeof input === 'string' || input instanceof URL ? input : input?.url;
        return new URL(raw, globalThis.location.href);
    } catch {
        return null;
    }
}

function describeGenerationRequest(input, init) {
    const url = getUrl(input);
    if (!url || url.pathname !== GENERATE_PATH || typeof init?.body !== 'string') {
        return null;
    }

    try {
        const request = JSON.parse(init.body);
        if (!isClinePassModel(request.model)) {
            return null;
        }

        return {
            model: String(request.model),
            expectedProvider: String(settings.expectedProvider ?? '').trim(),
        };
    } catch (error) {
        console.debug(`[${MODULE_LABEL}] Could not read the generation request`, error);
        return null;
    }
}

async function inspectResponse(response, request) {
    try {
        const responseText = await response.text();
        const routing = extractRoutingMetadata(responseText);
        if (!routing) {
            setStatus({
                phase: response.ok ? 'Response completed' : `HTTP ${response.status}`,
                model: request.model,
                expectedProvider: request.expectedProvider,
                actualProvider: '',
                attemptCount: null,
                attemptProviders: [],
                result: 'unknown',
                note: response.ok
                    ? 'No finalProvider/resolvedProvider field reached SillyTavern. The upstream relay may have stripped it.'
                    : 'The request failed and no routing metadata was exposed.',
            });
            console.info(`[${MODULE_LABEL}] No routing metadata found for ${request.model}.`);
            return;
        }

        const summary = summarizeRouting(routing, request.expectedProvider);
        setStatus({
            phase: response.ok ? 'Response inspected' : `HTTP ${response.status}`,
            model: request.model,
            expectedProvider: request.expectedProvider,
            actualProvider: summary.actualProvider,
            attemptCount: summary.attemptCount,
            attemptProviders: summary.attemptProviders,
            result: summary.result,
            note: summary.result === 'matched'
                ? 'The response metadata confirms the expected final provider.'
                : summary.result === 'mismatched'
                    ? 'The response metadata reports another final provider.'
                    : 'Routing metadata was found, but it could not be compared conclusively.',
        });
        console.info(`[${MODULE_LABEL}] Routing metadata`, routing);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus({
            phase: 'Inspection failed',
            model: request.model,
            expectedProvider: request.expectedProvider,
            actualProvider: '',
            attemptCount: null,
            attemptProviders: [],
            result: 'unknown',
            note: message,
        });
        console.debug(`[${MODULE_LABEL}] Response inspection failed`, error);
    }
}

function installFetchObserver() {
    if (!settings || wrappedFetch || typeof globalThis.fetch !== 'function') {
        return;
    }

    originalFetch = globalThis.fetch;
    wrappedFetch = async function clinePassProviderMonitorFetch(input, init) {
        const request = describeGenerationRequest(input, init);
        const response = await originalFetch.call(this, input, init);
        const shouldInspect = request && lifecycleEnabled && settings.enabled;

        if (shouldInspect) {
            setStatus({
                phase: 'Monitoring response',
                model: request.model,
                expectedProvider: request.expectedProvider,
                actualProvider: '',
                attemptCount: null,
                attemptProviders: [],
                result: 'unknown',
                note: 'Waiting for the response stream to finish.',
            });

            try {
                const copy = response.clone();
                void inspectResponse(copy, request);
            } catch (error) {
                console.debug(`[${MODULE_LABEL}] Could not clone the generation response`, error);
            }
        }

        return response;
    };
    globalThis.fetch = wrappedFetch;
}

function uninstallFetchObserver() {
    if (wrappedFetch && globalThis.fetch === wrappedFetch && originalFetch) {
        globalThis.fetch = originalFetch;
    }
    wrappedFetch = undefined;
    originalFetch = undefined;
}

function bindUi() {
    const enabledInput = document.getElementById('clinepass-monitor-enabled');
    enabledInput.checked = Boolean(settings.enabled);
    enabledInput.addEventListener('change', () => {
        settings.enabled = enabledInput.checked;
        saveSettings();
    });

    const providerInput = document.getElementById('clinepass-monitor-provider');
    providerInput.value = settings.expectedProvider;
    providerInput.addEventListener('change', () => {
        settings.expectedProvider = providerInput.value.trim();
        providerInput.value = settings.expectedProvider;
        saveSettings();
    });

    document.getElementById('clinepass-monitor-clear-status').addEventListener('click', () => {
        Object.assign(status, {
            phase: 'Idle',
            model: '',
            expectedProvider: '',
            actualProvider: '',
            attemptCount: null,
            attemptProviders: [],
            result: 'unknown',
            note: 'Status cleared. Generate with a cline-pass/* model to inspect its response metadata.',
            updatedAt: new Date().toLocaleTimeString(),
        });
        renderStatus();
    });

    renderStatus();
}

async function initialize() {
    context = globalThis.SillyTavern?.getContext?.();
    if (!context) {
        console.error(`[${MODULE_LABEL}] SillyTavern context is unavailable.`);
        return;
    }

    settings = ensureSettings();
    const html = await context.renderExtensionTemplateAsync(`third-party/${MODULE_ID}`, 'settings');
    const target = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    if (!target) {
        console.error(`[${MODULE_LABEL}] Extensions settings container was not found.`);
        return;
    }

    target.insertAdjacentHTML('beforeend', html);
    bindUi();
    installFetchObserver();
    console.info(`[${MODULE_LABEL}] Loaded in observation-only mode.`);
}

export async function onEnable() {
    lifecycleEnabled = true;
    if (settings) {
        installFetchObserver();
    }
}

export async function onDisable() {
    lifecycleEnabled = false;
    uninstallFetchObserver();
}

jQuery(initialize);
