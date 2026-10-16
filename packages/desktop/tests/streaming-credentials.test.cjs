const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Exercise the real IPC credential/retry code without Electron or Xbox access.
const source = fs.readFileSync(path.join(__dirname, '../main/ipc/streaming.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText
const loaded = {exports: {}}
vm.runInNewContext(compiled, {
    exports: loaded.exports,
    require: name => {
        if(name === './base')
            return {default: class { constructor(application){ this._application = application } }}
        if(name === '../helpers/streammanager')
            return {default: class {}}
        throw new Error(`Unexpected dependency: ${name}`)
    },
})
const Streaming = loaded.exports.default

function createHarness(type = 'home'){
    const calls = []
    const app = {
        _authentication: {
            ensureHomeStreamingTokenFresh: async () => { calls.push('ensure-fresh') },
            refreshStreamingTokens: async reason => { calls.push(reason) },
        },
        _ipc: {_channels: {consoles: {}, xCloud: {}}},
        writeBridgeLog: () => undefined,
    }
    const ipc = new Streaming(app)
    const sessions = {existing: {type}}
    ipc._streamManager = {
        getSession: id => sessions[id],
        sendKeepalive: async id => { calls.push(`keepalive:${id}`); return 'ok' },
        startStream: async () => { calls.push('start'); return 'new-session' },
    }
    return {ipc, app, calls}
}

test('long-running home session checks credentials before every keepalive without starting a new stream', async () => {
    const {ipc, calls} = createHarness()
    assert.equal(await ipc.sendKeepalive({sessionId: 'existing'}), 'ok')
    assert.equal(await ipc.sendKeepalive({sessionId: 'existing'}), 'ok')
    assert.deepEqual(calls, ['ensure-fresh', 'keepalive:existing', 'ensure-fresh', 'keepalive:existing'])
})

test('keepalive auth rejection refreshes and retries the same session once', async () => {
    for(const failure of [{status: 401}, {status: '403'}, {body: JSON.stringify({error: {code: 'TokenExpired'}})}]){
        const {ipc, calls} = createHarness()
        let attempts = 0
        ipc._streamManager.sendKeepalive = async id => {
            calls.push(`keepalive:${id}`)
            if(attempts++ === 0)
                throw failure
            return 'recovered'
        }
        assert.equal(await ipc.sendKeepalive({sessionId: 'existing'}), 'recovered')
        assert.deepEqual(calls, ['ensure-fresh', 'keepalive:existing', 'keepalive-stream-auth-error', 'keepalive:existing'])
    }
})

test('a second auth rejection stops retrying and surfaces the error', async () => {
    const {ipc, calls} = createHarness()
    const failure = {status: 401}
    ipc._streamManager.sendKeepalive = async () => { calls.push('keepalive'); throw failure }
    await assert.rejects(ipc.sendKeepalive({sessionId: 'existing'}), error => error === failure)
    assert.deepEqual(calls, ['ensure-fresh', 'keepalive', 'keepalive-stream-auth-error', 'keepalive'])
})

test('network failures do not force credential refreshes or recreate sessions', async () => {
    const {ipc, calls} = createHarness()
    const failure = new Error('Network unavailable')
    ipc._streamManager.sendKeepalive = async () => { calls.push('keepalive'); throw failure }
    await assert.rejects(ipc.sendKeepalive({sessionId: 'existing'}), /Network unavailable/)
    assert.deepEqual(calls, ['ensure-fresh', 'keepalive'])
})

test('failed token refresh does not send a request with stale credentials', async () => {
    const {ipc, app, calls} = createHarness()
    app._authentication.ensureHomeStreamingTokenFresh = async () => { throw new Error('Sign-in expired') }
    await assert.rejects(ipc.sendKeepalive({sessionId: 'existing'}), /Sign-in expired/)
    assert.deepEqual(calls, [])
})

test('stopped sessions cannot send keepalives', async () => {
    const {ipc, calls} = createHarness()
    await assert.rejects(ipc.sendKeepalive({sessionId: 'missing'}), /no longer active/)
    assert.deepEqual(calls, [])
})

test('home connect still refreshes and retries authentication failures once', async () => {
    const {ipc, calls} = createHarness()
    let attempts = 0
    ipc._streamManager.startStream = async () => {
        calls.push('start')
        if(attempts++ === 0)
            throw {status: 401}
        return 'new-session'
    }
    assert.equal(await ipc.startStream({type: 'home', target: 'console'}), 'new-session')
    assert.deepEqual(calls, ['ensure-fresh', 'start', 'start-stream-auth-error', 'start'])
})

test('cloud keepalive does not refresh home credentials', async () => {
    const {ipc, calls} = createHarness('cloud')
    assert.equal(await ipc.sendKeepalive({sessionId: 'existing'}), 'ok')
    assert.deepEqual(calls, ['keepalive:existing'])
})
