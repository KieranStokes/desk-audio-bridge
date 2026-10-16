import { app as ElectronApp } from 'electron'
import IpcBase from './base'
import { defaultSettings } from '../../renderer/context/userContext.defaults'

export type BridgeStatus = 'signed-out' | 'setup' | 'waiting' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'

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

interface SelectConsoleArgs {
    id: string;
    name: string;
}

interface RendererStateArgs {
    status: BridgeStatus;
    error?: string;
}

const RETRY_DELAYS = [2, 5, 15, 30, 60]

export default class IpcBridge extends IpcBase {
    private _state:BridgeState
    private _pollTimer:ReturnType<typeof setInterval>
    private _retryTimer:ReturnType<typeof setTimeout>
    private _retryAttempt = 0
    private _manualDisconnect = false
    private _authenticated = false
    private _rendererReady = false
    private _rendererActive = false

    constructor(application){
        super(application)
        const settings = this.readSettings()
        this._state = {
            status: 'signed-out',
            selectedConsoleId: settings.selectedConsoleId,
            selectedConsoleName: settings.selectedConsoleName,
            volume: settings.volume,
            muted: settings.muted,
            outputDeviceId: settings.outputDeviceId,
            launchAtLogin: settings.launchAtLogin,
            autoConnect: settings.autoConnect,
            setupComplete: settings.setupComplete,
        }

        const override = this._application.getStartupFlags().autoStream
        if(override){
            this._state.selectedConsoleId = override
            this._state.selectedConsoleName = 'Development console'
            this._state.setupComplete = true
        }
        if(this._application.getStartupFlags().noAutoconnect)
            this._state.autoConnect = false
    }

    private readSettings(){
        const stored = this._application._store.get('settings', defaultSettings) as object
        return {...defaultSettings, ...stored}
    }

    private saveSettings(changes){
        const settings = {...this.readSettings(), ...changes}
        this._application._store.set('settings', settings)
    }

    private sendEvent(action:string, data:any){
        if(!this._rendererReady || !this._application._mainWindow || this._application._mainWindow.isDestroyed())
            return
        this.send('bridge', { action, id: -1, data })
    }

    private updateState(changes:Partial<BridgeState>){
        const previousStatus = this._state.status
        const previousError = this._state.error
        this._state = {...this._state, ...changes}
        if(previousStatus !== this._state.status || previousError !== this._state.error){
            this._application.writeBridgeLog('bridge.state', {
                from: previousStatus,
                to: this._state.status,
                error: this._state.error,
            })
        }
        this.sendEvent('stateChanged', this._state)
        this._application.refreshTray()
    }

    private clearRetry(){
        if(this._retryTimer)
            clearTimeout(this._retryTimer)
        this._retryTimer = undefined
    }

    onUserLoaded(){
        this._authenticated = true
        this.updateState({
            status: this._state.setupComplete ? 'waiting' : 'setup',
            error: undefined,
        })
        if(this._state.setupComplete && this._state.autoConnect && !this._manualDisconnect)
            this.startPolling(true)
    }

    rendererReady(){
        return new Promise<BridgeState>((resolve) => {
            this._rendererReady = true
            this.sendEvent('applyAudioSettings', {
                volume: this._state.volume,
                muted: this._state.muted,
                outputDeviceId: this._state.outputDeviceId,
            })
            if(this._authenticated && this._state.setupComplete && this._state.autoConnect && !this._manualDisconnect)
                this.checkConsoleState(true)
            resolve(this._state)
        })
    }

    getState(){
        return Promise.resolve(this._state)
    }

    selectConsole(args:SelectConsoleArgs){
        if(args.id !== this._state.selectedConsoleId && ['connecting', 'connected', 'reconnecting'].includes(this._state.status))
            this.sendEvent('disconnectRequested', {reason: 'consoleChanged'})
        this._manualDisconnect = false
        this._retryAttempt = 0
        this._state.selectedConsoleId = args.id
        this._state.selectedConsoleName = args.name
        this._state.setupComplete = Boolean(args.id)
        this._state.autoConnect = true
        this.saveSettings({
            selectedConsoleId: args.id,
            selectedConsoleName: args.name,
            setupComplete: Boolean(args.id),
            autoConnect: true,
        })
        this.updateState({status: args.id ? 'waiting' : 'setup', error: undefined})
        if(args.id)
            this._application.setLaunchAtLogin(this._state.launchAtLogin)
        if(args.id)
            this.startPolling(true)
        return Promise.resolve(this._state)
    }

    connect(){
        this._application.writeBridgeLog('bridge.connect-requested')
        this._manualDisconnect = false
        this._retryAttempt = 0
        this.clearRetry()
        this._state.autoConnect = true
        this.saveSettings({autoConnect: true})
        this.updateState({status: this._state.setupComplete ? 'waiting' : 'setup', error: undefined})
        if(this._state.setupComplete)
            this.startPolling(true)
        return Promise.resolve(this._state)
    }

    disconnect(){
        this._application.writeBridgeLog('bridge.disconnect-requested', {reason: 'manual'})
        this._manualDisconnect = true
        this._rendererActive = false
        this._retryAttempt = 0
        this.clearRetry()
        this.sendEvent('disconnectRequested', {reason: 'manual'})
        this.updateState({status: 'disconnected', error: undefined})
        return Promise.resolve(this._state)
    }

    setVolume(args:{volume:number}){
        const volume = Math.max(0, Math.min(1, Number(args.volume)))
        this.saveSettings({volume})
        this.updateState({volume})
        this.sendEvent('applyAudioSettings', {volume, muted: this._state.muted, outputDeviceId: this._state.outputDeviceId})
        return Promise.resolve(this._state)
    }

    setMuted(args:{muted:boolean}){
        const muted = Boolean(args.muted)
        this.saveSettings({muted})
        this.updateState({muted})
        this.sendEvent('applyAudioSettings', {volume: this._state.volume, muted, outputDeviceId: this._state.outputDeviceId})
        return Promise.resolve(this._state)
    }

    setOutputDevice(args:{outputDeviceId:string}){
        const outputDeviceId = String(args.outputDeviceId || '')
        this.saveSettings({outputDeviceId})
        this.updateState({outputDeviceId})
        this.sendEvent('applyAudioSettings', {
            volume: this._state.volume,
            muted: this._state.muted,
            outputDeviceId,
        })
        return Promise.resolve(this._state)
    }

    setLaunchAtLogin(args:{launchAtLogin:boolean}){
        const launchAtLogin = Boolean(args.launchAtLogin)
        this.saveSettings({launchAtLogin})
        this.updateState({launchAtLogin})
        this._application.setLaunchAtLogin(launchAtLogin)
        return Promise.resolve(this._state)
    }

    openLogs(){
        return this._application.openBridgeLog()
    }

    copyDiagnostics(){
        return Promise.resolve(this._application.copyBridgeDiagnostics())
    }

    reportDiagnostic(args:{event:string; details?:any}){
        const event = String(args?.event || 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 80)
        this._application.writeBridgeLog(`renderer.${event}`, {details: args?.details || {}})
        return Promise.resolve(true)
    }

    reportRendererState(args:RendererStateArgs){
        this._application.writeBridgeLog('bridge.renderer-state', {status: args.status, error: args.error})
        if(args.status === 'connected'){
            this._rendererActive = true
            this._retryAttempt = 0
            this.clearRetry()
            this.updateState({status: 'connected', error: undefined})
        } else if(args.status === 'connecting') {
            this._rendererActive = true
            this.updateState({status: this._state.status === 'reconnecting' ? 'reconnecting' : 'connecting', error: undefined})
        } else if(args.status === 'error') {
            this._rendererActive = false
            this.updateState({status: 'error', error: args.error || 'The stream stopped unexpectedly.'})
            this.scheduleRetry()
        } else if(args.status === 'disconnected') {
            this._rendererActive = false
            if(!this._manualDisconnect){
                if(this._state.status === 'waiting')
                    this.checkConsoleState(true)
                else
                    this.scheduleRetry()
            }
        }
        return Promise.resolve(this._state)
    }

    startPolling(immediate = false){
        if(this._pollTimer)
            clearInterval(this._pollTimer)
        if(immediate)
            this.checkConsoleState(true)
        this._pollTimer = setInterval(() => this.checkConsoleState(true), 30000)
    }

    async checkConsoleState(connectWhenOn:boolean){
        if(!this._authenticated || !this._state.selectedConsoleId || this._manualDisconnect || this._rendererActive)
            return
        try {
            const response = await this._application._webApi.providers.smartglass.getConsolesList()
            const consoles = response.data.result || []
            this._application._ipc._channels.consoles._consoles = consoles
            this._application._ipc._channels.consoles._consolesLastUpdate = Date.now()
            const consoleInfo = consoles.find(item => item.id === this._state.selectedConsoleId)
            if(!consoleInfo){
                this.updateState({status: 'error', error: 'The selected Xbox was not found.'})
                return
            }

            this._application.writeBridgeLog('bridge.console-presence', {powerState: consoleInfo.powerState})

            if(consoleInfo.powerState !== 'On'){
                this.clearRetry()
                this._retryAttempt = 0
                if(this._state.status === 'connected' || this._state.status === 'connecting' || this._state.status === 'reconnecting')
                    this.sendEvent('disconnectRequested', {reason: 'consoleOff'})
                this.updateState({status: 'waiting', error: undefined})
                return
            }

            if(connectWhenOn && this._state.autoConnect && !['connected', 'connecting'].includes(this._state.status) && !this._retryTimer){
                this.updateState({status: this._retryAttempt > 0 ? 'reconnecting' : 'connecting', error: undefined})
                this.sendEvent('connectRequested', {consoleId: this._state.selectedConsoleId})
            }
        } catch(error) {
            this._application.writeBridgeLog('bridge.console-presence-error', {error: this.formatError(error), status: error?.status})
            if(error?.status === 401){
                this._authenticated = false
                this._application._authentication._isAuthenticated = false
                this.updateState({status: 'signed-out', error: 'Microsoft sign-in expired.'})
                this._application.showMainWindow()
                this._application._authentication.startSilentFlow()
                return
            }
            this.updateState({status: 'error', error: this.formatError(error)})
            this.scheduleRetry()
        }
    }

    private scheduleRetry(){
        if(this._manualDisconnect || !this._state.autoConnect || !this._state.setupComplete || this._retryTimer)
            return
        const delay = RETRY_DELAYS[Math.min(this._retryAttempt, RETRY_DELAYS.length - 1)]
        this._retryAttempt += 1
        this._application.writeBridgeLog('bridge.retry-scheduled', {delaySeconds: delay, attempt: this._retryAttempt, error: this._state.error})
        this.updateState({status: 'reconnecting'})
        this._retryTimer = setTimeout(() => {
            this._retryTimer = undefined
            this.checkConsoleState(true)
        }, delay * 1000)
    }

    private formatError(error){
        if(typeof error === 'string')
            return error
        let body:any = error?.body
        if(typeof body === 'string'){
            try { body = JSON.parse(body) } catch(parseError) { body = undefined }
        }
        return error?.message || body?.errorDetails?.message || body?.error?.message || body?.message ||
            (error?.status ? `Xbox service returned HTTP ${error.status}.` : 'Unable to reach Xbox services.')
    }

    shutdown(){
        if(this._pollTimer)
            clearInterval(this._pollTimer)
        this.clearRetry()
    }

    getStateSnapshot(){
        return this._state
    }
}
