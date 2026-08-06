import assert from 'node:assert/strict';
import test from 'node:test';

import {
    extractRoutingMetadata,
    isClinePassModel,
    summarizeRouting,
} from '../core.js';

test('recognizes only ClinePass model slugs', () => {
    assert.equal(isClinePassModel('cline-pass/kimi-k3'), true);
    assert.equal(isClinePassModel('CLINE-PASS/KIMI-K3'), true);
    assert.equal(isClinePassModel('moonshot/kimi-k3'), false);
    assert.equal(isClinePassModel(''), false);
});

test('extracts routing metadata from the final SSE chunk', () => {
    const response = [
        'data: {"choices":[{"delta":{"content":"OK"}}]}',
        '',
        'data: {"choices":[{"delta":{"provider_metadata":{"gateway":{"routing":{"resolvedProvider":"moonshotai","finalProvider":"moonshotai","totalProviderAttemptCount":1,"attempts":[{"provider":"moonshotai","success":true}]}}}}}]}',
        '',
        'data: [DONE]',
    ].join('\n');

    const route = extractRoutingMetadata(response);
    assert.equal(route.finalProvider, 'moonshotai');
    const summary = summarizeRouting(route, 'moonshotai');
    assert.equal(summary.result, 'matched');
    assert.equal(summary.attemptCount, 1);
    assert.deepEqual(summary.attemptProviders, ['moonshotai']);
});

test('extracts routing metadata from a non-stream JSON response', () => {
    const response = JSON.stringify({
        choices: [{
            message: {
                provider_metadata: {
                    gateway: {
                        routing: {
                            resolvedProvider: 'moonshotai',
                            finalProvider: 'moonshotai',
                            totalProviderAttemptCount: 1,
                            modelAttempts: [{
                                providerAttempts: [{ provider: 'moonshotai', success: true }],
                            }],
                        },
                    },
                },
            },
        }],
    });

    const summary = summarizeRouting(extractRoutingMetadata(response), 'moonshotai');
    assert.equal(summary.result, 'matched');
    assert.deepEqual(summary.attemptProviders, ['moonshotai']);
});

test('reports a different final provider as a mismatch', () => {
    const response = JSON.stringify({
        provider_metadata: {
            gateway: {
                routing: {
                    resolvedProvider: 'moonshotai',
                    finalProvider: 'fireworks',
                    providerAttempts: [{ provider: 'fireworks' }],
                },
            },
        },
    });

    const summary = summarizeRouting(extractRoutingMetadata(response), 'moonshotai');
    assert.equal(summary.actualProvider, 'fireworks');
    assert.equal(summary.result, 'mismatched');
    assert.deepEqual(summary.attemptProviders, ['fireworks']);
});

test('uses resolvedProvider when finalProvider is absent', () => {
    const route = extractRoutingMetadata(JSON.stringify({
        routing: {
            resolvedProvider: 'moonshotai',
            providerAttemptCount: 2,
        },
    }));

    const summary = summarizeRouting(route, 'moonshotai');
    assert.equal(summary.actualProvider, 'moonshotai');
    assert.equal(summary.attemptCount, 2);
    assert.equal(summary.result, 'matched');
});

test('returns unknown when the response exposes no routing metadata', () => {
    const response = 'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]';
    assert.equal(extractRoutingMetadata(response), null);
    assert.equal(summarizeRouting(null, 'moonshotai').result, 'unknown');
});

test('returns unknown when no expected provider is configured', () => {
    const route = { finalProvider: 'moonshotai' };
    assert.equal(summarizeRouting(route, '').result, 'unknown');
});
