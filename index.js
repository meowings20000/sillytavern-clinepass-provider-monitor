import {
    extractRoutingMetadata,
    isClinePassModel,
    summarizeRouting,
} from './core.js';

const MODULE_ID = 'sillytavern-clinepass-provider-monitor';
const MODULE_LABEL = 'ClinePass 路由監察';
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
    phase: '等待生成',
    model: '',
    expectedProvider: '',
    actualProvider: '',
    attemptCount: null,
    attemptProviders: [],
    result: 'unknown',
    note: '使用 cline-pass/* 模型生成後，這裡會顯示最終路由結果。',
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
    Object.assign(status, patch, {
        updatedAt: new Date().toLocaleTimeString('zh-Hant', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        }),
    });
    renderStatus();
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = value;
    }
}

function renderStatus() {
    const stateElement = document.getElementById('clinepass-monitor-state');
    if (!stateElement) {
        return;
    }

    const isMonitoring = status.phase === '正在監察回應';
    const visualResult = isMonitoring ? 'monitoring' : status.result;
    const symbol = isMonitoring ? '…' : status.result === 'matched' ? '✓' : status.result === 'mismatched' ? '!' : '?';
    const expected = status.expectedProvider || settings?.expectedProvider || '未設定';

    stateElement.dataset.result = visualResult;
    setText('clinepass-monitor-summary-badge', status.phase);
    setText('clinepass-monitor-state-symbol', symbol);
    setText('clinepass-monitor-state-title', status.phase);
    setText('clinepass-monitor-updated', status.updatedAt || '尚未更新');
    setText('clinepass-monitor-note', status.note || '—');
    setText('clinepass-monitor-expected', expected);
    setText('clinepass-monitor-actual', status.actualProvider || '尚未取得');
    setText('clinepass-monitor-model', status.model || '尚未生成');
    setText('clinepass-monitor-attempt-count', status.attemptCount ?? '—');
    setText(
        'clinepass-monitor-attempt-providers',
        status.attemptProviders.length ? status.attemptProviders.join('、') : '尚未取得',
    );
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
        console.debug(`[${MODULE_LABEL}] 無法讀取這次生成請求`, error);
        return null;
    }
}

async function inspectResponse(response, request) {
    try {
        const responseText = await response.text();
        const routing = extractRoutingMetadata(responseText);
        if (!routing) {
            setStatus({
                phase: response.ok ? '無法判斷' : `請求失敗（HTTP ${response.status}）`,
                model: request.model,
                expectedProvider: request.expectedProvider,
                actualProvider: '',
                attemptCount: null,
                attemptProviders: [],
                result: 'unknown',
                note: response.ok
                    ? '回應中沒有 finalProvider 或 resolvedProvider。上游轉發服務可能沒有保留這些資料。'
                    : '請求失敗，而且回應中沒有可用的路由資料。',
            });
            console.info(`[${MODULE_LABEL}] ${request.model} 的回應中沒有找到路由資料。`);
            return;
        }

        const summary = summarizeRouting(routing, request.expectedProvider);
        setStatus({
            phase: response.ok
                ? summary.result === 'matched' ? '服務商符合' : summary.result === 'mismatched' ? '服務商不符' : '無法判斷'
                : `請求失敗（HTTP ${response.status}）`,
            model: request.model,
            expectedProvider: request.expectedProvider,
            actualProvider: summary.actualProvider,
            attemptCount: summary.attemptCount,
            attemptProviders: summary.attemptProviders,
            result: summary.result,
            note: summary.result === 'matched'
                ? '回應 metadata 顯示，最終服務商與你設定的預期代號一致。'
                : summary.result === 'mismatched'
                    ? '回應 metadata 顯示，實際使用了另一個服務商。'
                    : '已找到部分路由資料，但內容不足以完成比對。',
        });
        console.info(`[${MODULE_LABEL}] 完整路由 metadata`, routing);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus({
            phase: '監察失敗',
            model: request.model,
            expectedProvider: request.expectedProvider,
            actualProvider: '',
            attemptCount: null,
            attemptProviders: [],
            result: 'unknown',
            note: message,
        });
        console.debug(`[${MODULE_LABEL}] 回應監察失敗`, error);
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
                phase: '正在監察回應',
                model: request.model,
                expectedProvider: request.expectedProvider,
                actualProvider: '',
                attemptCount: null,
                attemptProviders: [],
                result: 'unknown',
                note: '正在等待這次串流完成，原始回應仍會正常顯示。',
            });

            try {
                const copy = response.clone();
                void inspectResponse(copy, request);
            } catch (error) {
                console.debug(`[${MODULE_LABEL}] 無法建立回應副本`, error);
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
        if (!status.expectedProvider) {
            renderStatus();
        }
    });

    document.getElementById('clinepass-monitor-clear-status').addEventListener('click', () => {
        Object.assign(status, {
            phase: '等待生成',
            model: '',
            expectedProvider: '',
            actualProvider: '',
            attemptCount: null,
            attemptProviders: [],
            result: 'unknown',
            note: '監察結果已清除。使用 cline-pass/* 模型生成後，這裡會顯示新的路由結果。',
            updatedAt: new Date().toLocaleTimeString('zh-Hant', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            }),
        });
        renderStatus();
    });

    renderStatus();
}

async function initialize() {
    context = globalThis.SillyTavern?.getContext?.();
    if (!context) {
        console.error(`[${MODULE_LABEL}] 無法取得 SillyTavern 執行環境。`);
        return;
    }

    settings = ensureSettings();
    const html = await context.renderExtensionTemplateAsync(`third-party/${MODULE_ID}`, 'settings');
    const target = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
    if (!target) {
        console.error(`[${MODULE_LABEL}] 找不到擴充設定容器。`);
        return;
    }

    target.insertAdjacentHTML('beforeend', html);
    bindUi();
    installFetchObserver();
    console.info(`[${MODULE_LABEL}] 已載入純監察模式。`);
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
