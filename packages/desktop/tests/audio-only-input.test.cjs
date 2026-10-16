const test = require('node:test')
const assert = require('node:assert/strict')
const ControlChannel = require('xbox-xcloud-player/dist/Channel/Control').default
const InputChannel = require('xbox-xcloud-player/dist/Channel/Input').default

function mockClient(inputEnabled){
    const sent = []
    const counters = {gamepadStart: 0, gamepadRun: 0, keyboardStart: 0, stateReads: 0}
    const client = {
        _config: {input_enabled: inputEnabled, input_legacykeyboard: true, input_touch: false},
        _inputDriver: {
            start: () => counters.gamepadStart++,
            run: () => counters.gamepadRun++,
            stop: () => undefined,
            requestStates: () => { counters.stateReads++; return [] },
        },
        _keyboardDriver: {
            start: () => counters.keyboardStart++,
            stop: () => undefined,
            requestState: () => ({}),
        },
        getChannel: () => ({readyState: 'open', send: data => sent.push(data)}),
        getEventBus: () => ({emit: () => undefined}),
    }
    return {client, sent, counters}
}

test('audio-only control channel briefly uses only the fourth remote slot, including on reconnect', () => {
    const {client, sent, counters} = mockClient(false)
    for(let connection = 0; connection < 3; connection++){
        const channel = new ControlChannel('control', client)
        channel.start()
        channel.sendGamepadAdded(0)
        channel.sendGamepadRemoved(0)
    }
    const messages = sent.map(data => JSON.parse(new TextDecoder().decode(data)))
    assert.equal(messages.filter(message => message.message === 'authorizationRequest').length, 3)
    const presence = messages.filter(message => message.message === 'gamepadChanged')
    assert.deepEqual(presence, Array.from({length: 3}, () => [
        {message: 'gamepadChanged', gamepadIndex: 3, wasAdded: true},
        {message: 'gamepadChanged', gamepadIndex: 3, wasAdded: false},
    ]).flat())
    assert.equal(presence.filter(message => message.gamepadIndex === 0).length, 0)
    assert.equal(counters.gamepadStart, 0)
    assert.equal(counters.keyboardStart, 0)
})

test('audio-only input channel retains metadata for 30 simulated idle minutes without gamepad reports', t => {
    t.mock.timers.enable({apis: ['setInterval']})
    const {client, sent, counters} = mockClient(false)
    const channel = new InputChannel('input', client)
    channel.start()
    channel.queueGamepadState({GamepadIndex: 0, A: 1})
    for(let second = 0; second < 30 * 60; second++){
        channel.addProcessedFrame({
            serverDataKey: second,
            firstFramePacketArrivalTimeMs: 1,
            frameSubmittedTimeMs: 2,
            frameDecodedTimeMs: 3,
            frameRenderedTimeMs: 4,
        })
        t.mock.timers.tick(1000)
    }
    channel.destroy()
    const reportTypes = sent.map(buffer => buffer instanceof DataView
        ? buffer.getUint16(0, true)
        : new DataView(buffer.buffer || buffer).getUint16(0, true))
    assert.ok(reportTypes.includes(8), 'client metadata is still sent')
    assert.equal(reportTypes.filter(type => type === 1).length, 30 * 60, 'frame metadata continues throughout idle time')
    assert.equal(reportTypes.filter(type => (type & 2) === 2).length, 0)
    assert.equal(counters.gamepadRun, 0)
    assert.equal(counters.stateReads, 0)
})

test('input remains enabled by default for upstream compatibility', () => {
    const {client, sent, counters} = mockClient(undefined)
    new ControlChannel('control', client).start()
    const messages = sent.map(data => JSON.parse(new TextDecoder().decode(data)))
    assert.equal(messages.filter(message => message.message === 'gamepadChanged').length, 1)
    assert.equal(counters.gamepadStart, 1)
    assert.equal(counters.keyboardStart, 1)
})
