const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function isClinePassModel(model) {
    return typeof model === 'string' && model.toLowerCase().startsWith('cline-pass/');
}

function parseJsonCandidate(candidate) {
    try {
        return JSON.parse(candidate);
    } catch {
        return null;
    }
}

function collectRoutingObjects(value, output, seen, depth = 0) {
    if (depth > 16 || value === null || typeof value !== 'object' || seen.has(value)) {
        return;
    }

    seen.add(value);
    if (isRecord(value) && (typeof value.finalProvider === 'string' || typeof value.resolvedProvider === 'string')) {
        output.push(value);
    }

    for (const child of Array.isArray(value) ? value : Object.values(value)) {
        collectRoutingObjects(child, output, seen, depth + 1);
    }
}

export function extractRoutingMetadata(responseText) {
    if (typeof responseText !== 'string' || !responseText.trim()) {
        return null;
    }

    const payloads = [];
    const wholePayload = parseJsonCandidate(responseText.trim());
    if (wholePayload !== null) {
        payloads.push(wholePayload);
    }

    for (const line of responseText.split(/\r?\n/u)) {
        const match = line.match(/^\s*data:\s*(\{.*\})\s*$/u);
        if (!match) {
            continue;
        }

        const payload = parseJsonCandidate(match[1]);
        if (payload !== null) {
            payloads.push(payload);
        }
    }

    const routes = [];
    for (const payload of payloads) {
        collectRoutingObjects(payload, routes, new Set());
    }

    return routes.at(-1) ?? null;
}

function collectAttemptProviders(route) {
    const providers = [];
    const add = (attempt) => {
        if (isRecord(attempt) && typeof attempt.provider === 'string') {
            providers.push(attempt.provider);
        }
    };

    if (Array.isArray(route?.attempts)) {
        route.attempts.forEach(add);
    }
    if (Array.isArray(route?.providerAttempts)) {
        route.providerAttempts.forEach(add);
    }
    if (Array.isArray(route?.modelAttempts)) {
        for (const modelAttempt of route.modelAttempts) {
            if (Array.isArray(modelAttempt?.providerAttempts)) {
                modelAttempt.providerAttempts.forEach(add);
            }
        }
    }

    return [...new Set(providers)];
}

export function summarizeRouting(route, expectedProvider = '') {
    if (!isRecord(route)) {
        return {
            actualProvider: '',
            attemptCount: null,
            attemptProviders: [],
            result: 'unknown',
        };
    }

    const actualProvider = String(route.finalProvider ?? route.resolvedProvider ?? '');
    const expected = String(expectedProvider).trim().toLowerCase();
    const actual = actualProvider.trim().toLowerCase();
    const attemptProviders = collectAttemptProviders(route);
    const countCandidate = route.totalProviderAttemptCount ?? route.providerAttemptCount;
    const attemptCount = Number.isFinite(Number(countCandidate))
        ? Number(countCandidate)
        : attemptProviders.length || null;

    return {
        actualProvider,
        attemptCount,
        attemptProviders,
        result: !expected || !actual ? 'unknown' : expected === actual ? 'matched' : 'mismatched',
    };
}
