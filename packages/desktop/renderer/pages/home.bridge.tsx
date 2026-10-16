import React from 'react'
import Head from 'next/head'
import { useQuery } from 'react-query'
import Ipc from '../lib/ipc'
import BridgeReceiver from '../components/bridgeReceiver'
import branding from '../../branding.json'

type BridgeStatus = 'signed-out' | 'setup' | 'waiting' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'
interface BridgeState {
    status: BridgeStatus;
    selectedConsoleId: string;
    selectedConsoleName: string;
    volume: number;
    muted: boolean;
    outputDeviceId: string;
    launchAtLogin: boolean;
    autoConnect: boolean;
    setupComplete: boolean;
    error?: string;
}
const initialState:BridgeState = {
    status: 'setup', selectedConsoleId: '', selectedConsoleName: '', volume: 0.5,
    muted: false, outputDeviceId: '', launchAtLogin: true, autoConnect: true, setupComplete: false,
}
const statusText = {
    'signed-out': 'Signed out', setup: 'Choose an Xbox', waiting: 'Waiting for Xbox to turn on',
    connecting: 'Connecting audio…', connected: 'Xbox audio is playing', reconnecting: 'Reconnecting…',
    disconnected: 'Disconnected', error: 'Connection problem',
}

export default function Home(){
    const [state, setState] = React.useState<BridgeState>(initialState)
    const [audioOutputs, setAudioOutputs] = React.useState<MediaDeviceInfo[]>([])
    const [diagnosticsCopied, setDiagnosticsCopied] = React.useState(false)
    const outputDeviceRef = React.useRef('')
    const consoles = useQuery('bridge-consoles', () => Ipc.send('consoles', 'get') as Promise<any[]>, {
        refetchInterval: 30000,
        staleTime: 15000,
    })
    React.useEffect(() => {
        const listener = Ipc.onAction('bridge', 'stateChanged', (event, nextState) => setState(nextState))
        Ipc.send('bridge', 'getState').then((nextState:BridgeState) => setState(nextState))
        return () => Ipc.removeListener('bridge', listener)
    }, [])
    React.useEffect(() => {
        outputDeviceRef.current = state.outputDeviceId
    }, [state.outputDeviceId])
    React.useEffect(() => {
        if(!navigator.mediaDevices?.enumerateDevices)
            return
        const loadAudioOutputs = async () => {
            try {
                const devices = await navigator.mediaDevices.enumerateDevices()
                const outputs = devices.filter(device => device.kind === 'audiooutput' && device.deviceId !== 'default')
                setAudioOutputs(outputs)
                if(outputDeviceRef.current && !outputs.some(device => device.deviceId === outputDeviceRef.current))
                    Ipc.send('bridge', 'setOutputDevice', {outputDeviceId: ''})
            } catch(error) {
                console.error('Unable to enumerate audio outputs', error)
            }
        }
        loadAudioOutputs()
        navigator.mediaDevices.addEventListener('devicechange', loadAudioOutputs)
        return () => navigator.mediaDevices.removeEventListener('devicechange', loadAudioOutputs)
    }, [])
    const selectedConsole = consoles.data?.find(item => item.id === state.selectedConsoleId)
    const active = ['connecting', 'connected', 'reconnecting'].includes(state.status)

    function selectConsole(event){
        const item = consoles.data?.find(consoleItem => consoleItem.id === event.target.value)
        if(item)
            Ipc.send('bridge', 'selectConsole', {id: item.id, name: item.name}).then((nextState:BridgeState) => setState(nextState))
    }
    function updateVolume(event){
        const volume = Number(event.target.value) / 100
        setState(current => ({...current, volume}))
        Ipc.send('bridge', 'setVolume', {volume})
    }
    function signOut(){
        if(window.confirm(`Sign out and remove the saved Microsoft account from ${branding.name}?`))
            Ipc.send('app', 'clearData')
    }
    function quitApp(){
        if(window.confirm(`Quit ${branding.name} and stop console audio?`))
            Ipc.send('app', 'quit')
    }

    return <main className="bridge-shell">
        <Head><title>{branding.name}</title></Head>
        <header className="bridge-header">
            <img className="bridge-mark" src="/brand.svg" alt="" />
            <div><h1>{branding.name}</h1><p>{branding.tagline}</p></div>
        </header>
        <section className={`bridge-status bridge-status-${state.status}`}>
            <span className="bridge-status-dot" />
            <div>
                <strong>{statusText[state.status]}</strong>
                <small>{state.error || (selectedConsole ? `${selectedConsole.name} · ${selectedConsole.powerState}` : 'Select your home console below')}</small>
            </div>
        </section>
        <label className="bridge-label" htmlFor="bridge-console">Console</label>
        <select id="bridge-console" value={state.selectedConsoleId} onChange={selectConsole} disabled={consoles.isLoading || active}>
            <option value="">{consoles.isLoading ? 'Finding consoles…' : 'Select an Xbox'}</option>
            {consoles.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <div className="bridge-output">
            <label htmlFor="bridge-output">Audio output</label>
            <select id="bridge-output" value={state.outputDeviceId} onChange={event => Ipc.send('bridge', 'setOutputDevice', {outputDeviceId: event.target.value})}>
                <option value="">System default</option>
                {audioOutputs.map((device, index) => <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Audio output ${index + 1}`}
                </option>)}
            </select>
        </div>
        <div className="bridge-actions">
            <button className="bridge-primary" disabled={!state.setupComplete} onClick={() => Ipc.send('bridge', active ? 'disconnect' : 'connect')}>
                {active ? 'Disconnect' : 'Connect'}
            </button>
            <button className="bridge-secondary" onClick={() => Ipc.send('bridge', 'setMuted', {muted: !state.muted})}>
                {state.muted ? 'Unmute' : 'Mute'}
            </button>
        </div>
        <div className="bridge-volume">
            <label htmlFor="bridge-volume">Volume</label>
            <input id="bridge-volume" type="range" min="0" max="100" value={Math.round(state.volume * 100)} onChange={updateVolume} />
            <output>{Math.round(state.volume * 100)}%</output>
        </div>
        <footer className="bridge-footer">
            <label><input type="checkbox" checked={state.launchAtLogin} onChange={event => Ipc.send('bridge', 'setLaunchAtLogin', {launchAtLogin: event.target.checked})} /> Start with Windows</label>
            <div className="bridge-footer-actions">
                <button onClick={() => Ipc.send('bridge', 'copyDiagnostics').then(() => {
                    setDiagnosticsCopied(true)
                    setTimeout(() => setDiagnosticsCopied(false), 1800)
                })}>{diagnosticsCopied ? 'Copied!' : 'Copy diagnostics'}</button>
                <button onClick={() => Ipc.send('bridge', 'openLogs')}>Open logs</button>
                <button onClick={() => Ipc.send('app', 'showAbout')}>About</button>
                <button onClick={signOut}>Sign out</button>
                <button className="bridge-quit" onClick={quitApp}>Quit app</button>
            </div>
        </footer>
        <BridgeReceiver />
    </main>
}
