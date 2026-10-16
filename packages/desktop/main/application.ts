import { app as ElectronApp, clipboard, dialog, Menu, nativeImage, shell, Tray } from 'electron'
import serve from 'electron-serve'
import Store from 'electron-store'
import Debug from 'debug'
import { createWindow, xboxWorker } from './helpers'
import Authentication from './authentication'
import Ipc from './ipc'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import xboxWebApi from 'xbox-webapi'
import xCloudApi from './helpers/xcloudapi'

import pkg from '../package.json'
import branding from '../branding.json'

import i18n from 'i18next';

const isolatedTestProfile = process.env.CI === 'true' ? process.env.XAB_TEST_PROFILE : undefined
if(isolatedTestProfile){
    const resolvedProfile = path.resolve(isolatedTestProfile)
    const temporaryRoot = `${path.resolve(os.tmpdir())}${path.sep}`
    if(!resolvedProfile.startsWith(temporaryRoot))
        throw new Error('The isolated test profile must be inside the Windows temporary directory.')
    ElectronApp.setPath('userData', resolvedProfile)
    ElectronApp.setPath('sessionData', resolvedProfile)
}

interface startupFlags {
    fullscreen:boolean;
    autoStream:string;
    hidden:boolean;
    noAutoconnect:boolean;
}

export default class Application {

    private _log
    private _bridgeLogPath:string
    public _store:Store
    private _startupFlags: startupFlags = {
        fullscreen: false,
        autoStream: '',
        hidden: false,
        noAutoconnect: false,
    }

    public _isProduction:boolean = (process.env.NODE_ENV === 'production')
    private _isCi:boolean = (process.env.CI !== undefined)
    private _isMac:boolean = (process.platform === 'darwin')
    private _isWindows:boolean = (process.platform === 'win32')
    private _isQuitting:boolean = false

    public _mainWindow
    public _ipc:Ipc
    public _authentication:Authentication
    private _tray:Tray

    private t = i18n.t.bind(i18n);

    constructor(){
        // Preserve the existing profile before changing the display name.
        const existingProfilePath = ElectronApp.getPath('userData')
        ElectronApp.setName(branding.name)
        ElectronApp.setPath('userData', existingProfilePath)
        if(process.platform === 'win32')
            ElectronApp.setAppUserModelId('com.xboxaudiobridge.desktop')
        console.log(__filename+'[constructor()] Starting '+branding.name+' v'+pkg.version)
        this._log = Debug('greenlight')

        if(this._isCi === true && !isolatedTestProfile) {
            const random = Math.random()*100
            ElectronApp.setPath('userData', `${ElectronApp.getPath('userData')} (${random})`)
            ElectronApp.setPath('sessionData', `${ElectronApp.getPath('userData')} (${random})`)
        } else if(this._isProduction === false) {
            ElectronApp.setPath('userData', `${ElectronApp.getPath('userData')} (development)`)
        }
        this._bridgeLogPath = path.join(ElectronApp.getPath('userData'), 'logs', 'bridge.log')
        this.writeBridgeLog('app.started', {version: pkg.version, platform: process.platform, arch: process.arch})
        this._store = new Store()

        // ElectronApp.commandLine.appendSwitch('use-vulkan')
        // ElectronApp.commandLine.appendSwitch('use-angle', 'vulkan')
        // ElectronApp.commandLine.appendSwitch('enable-features', 'Vulkan,VulkanFromANGLE,DefaultANGLEVulkan,VaapiVideoDecoder,PlatformHEVCDecoderSupport,CanvasOopRasterization')
        // ElectronApp.commandLine.appendSwitch('disable-features', 'UseChromeOSDirectVideoDecoder')
        // ElectronApp.commandLine.appendSwitch('enable-gpu-rasterization')
        // ElectronApp.commandLine.appendSwitch('enable-oop-rasterization')
        ElectronApp.commandLine.appendSwitch('enable-accelerated-video-decode')
        // ElectronApp.commandLine.appendSwitch('ozone-platform-hint', 'x11')
        // ElectronApp.commandLine.appendSwitch('ignore-gpu-blocklist')
        // ElectronApp.commandLine.appendSwitch('no-sandbox')
        ElectronApp.commandLine.appendSwitch('enable-zero-copy')
        ElectronApp.commandLine.appendSwitch('disable-background-timer-throttling')

        this.readStartupFlags()
        this.loadApplicationDefaults()

        // ElectronApp.removeAsDefaultProtocolClient('ms-xal-public-beta-000000004c20a908')

        this._ipc = new Ipc(this)
        this._authentication = new Authentication(this)

        this._ipc.startUp()
    }

    log(namespace = 'application', ...args){
        this._log.extend(namespace)(...args)
    }

    writeBridgeLog(event:string, details:any = {}){
        try {
            fs.mkdirSync(path.dirname(this._bridgeLogPath), {recursive: true})
            if(fs.existsSync(this._bridgeLogPath) && fs.statSync(this._bridgeLogPath).size > 5 * 1024 * 1024){
                const previousPath = `${this._bridgeLogPath}.previous`
                if(fs.existsSync(previousPath))
                    fs.unlinkSync(previousPath)
                fs.renameSync(this._bridgeLogPath, previousPath)
            }
            fs.appendFileSync(this._bridgeLogPath, `${JSON.stringify({time: new Date().toISOString(), event, ...details})}\n`, 'utf8')
        } catch(error) {
            console.error('Unable to write Desk Audio Bridge diagnostic log:', error)
        }
    }

    openBridgeLog(){
        this.writeBridgeLog('diagnostics.opened')
        return shell.openPath(this._bridgeLogPath).then(error => {
            if(error)
                throw new Error(error)
            return this._bridgeLogPath
        })
    }

    copyBridgeDiagnostics(showConfirmation = false){
        this.writeBridgeLog('diagnostics.copied')
        const rawLines = fs.existsSync(this._bridgeLogPath)
            ? fs.readFileSync(this._bridgeLogPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-400)
            : []
        const safeLines = rawLines.map(line => this.sanitizeDiagnosticLine(line))
        const report = [
            `${branding.name} diagnostic report`,
            `Generated: ${new Date().toISOString()}`,
            `Version: ${pkg.version}`,
            `Platform: ${process.platform} ${process.arch} (${process.getSystemVersion()})`,
            `Log entries: ${safeLines.length}`,
            '',
            ...safeLines,
        ].join('\n')
        clipboard.writeText(report)
        if(showConfirmation && this._tray)
            this._tray.displayBalloon({
                title: branding.name,
                content: 'Diagnostics copied to the clipboard.',
                iconType: 'info',
            })
        return {copied: true, lines: safeLines.length}
    }

    private sanitizeDiagnosticLine(line:string){
        try {
            return JSON.stringify(this.sanitizeDiagnosticValue(JSON.parse(line)))
        } catch(error) {
            return line
                .replace(/("(?:access_token|refresh_token|id_token|token|authorization|accessKey|deviceCode|userCode|password|secret|sessionId|consoleId)"\s*:\s*")[^"]*(")/gi, '$1[redacted]$2')
                .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip-redacted]')
        }
    }

    private sanitizeDiagnosticValue(value:any, key = ''):any {
        if(/token|authorization|accesskey|devicecode|usercode|password|secret|sessionid|consoleid/i.test(key))
            return '[redacted]'
        if(Array.isArray(value))
            return value.map(item => this.sanitizeDiagnosticValue(item))
        if(value && typeof value === 'object')
            return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, this.sanitizeDiagnosticValue(childValue, childKey)]))
        if(typeof value === 'string')
            return value.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip-redacted]')
        return value
    }

    getStartupFlags(){
        return this._startupFlags
    }

    resetAutostream(){
        this._startupFlags.autoStream = ''
    }

    readStartupFlags(){
        this.log('application', __filename+'[readStartupFlags()] Program args detected:', process.argv)

        for(const arg in process.argv){
            if(process.argv[arg].includes('--fullscreen')){
                this.log('application', __filename+'[readStartupFlags()] --fullscreen switch found. Setting fullscreen to true')
                this._startupFlags.fullscreen = true
            }

            if(process.argv[arg].includes('--connect=')){
                const key = process.argv[arg].substring(10)

                this.log('application', __filename+'[readStartupFlags()] --connect switch found. Setting autoStream to', key)
                this._startupFlags.autoStream = key
            }

            if(process.argv[arg] === '--hidden')
                this._startupFlags.hidden = true

            if(process.argv[arg] === '--no-autoconnect')
                this._startupFlags.noAutoconnect = true
        }

        this.log('application', __filename+'[readStartupFlags()] End result of startupFlags:', this._startupFlags)
    }

    loadApplicationDefaults(){
        if(this._isProduction === true && this._isCi === false) {
            serve({ directory: 'app' })

        } else if(this._isCi === true) {
            this._store.delete('user')
            this._store.delete('auth')

            serve({ directory: 'app' })
        }

        ElectronApp.whenReady().then(() => {
            this.log('electron', __filename+'[loadApplicationDefaults()] Electron has been fully loaded. Ready to open windows')

            this._authentication.loadTokenStore()
            this.openMainWindow()
            this.createTray()
            const settings = this._store.get('settings', {}) as any
            if(ElectronApp.isPackaged && !this._isCi && settings.setupComplete)
                this.setLaunchAtLogin(settings.launchAtLogin !== false)

            // Check authentication
            if(! this._authentication.checkAuthentication()){
                this.showMainWindow()
            }

            const autoQuitDelay = Number(process.env.XAB_TEST_AUTO_QUIT_MS || 0)
            if(this._isCi && autoQuitDelay >= 1000 && autoQuitDelay <= 30000)
                setTimeout(() => this.quit(), autoQuitDelay)

        }).catch((error) => {
            this.log('electron', __filename+'[loadApplicationDefaults()] Electron has failed to load:', error)
        })

        ElectronApp.on('window-all-closed', () => {
            this.log('electron', __filename+'[loadApplicationDefaults()] All windows closed; tray process remains active.')
        })

        ElectronApp.on('activate', () => {
            (this._mainWindow !== undefined) ? this._mainWindow.show() : this.openMainWindow()
        })
        ElectronApp.on('before-quit', () => this._isQuitting = true)
        ElectronApp.on('second-instance', () => this.showMainWindow())
    }

    _webApi:xboxWebApi
    _xHomeApi:xCloudApi
    _xCloudApi:xCloudApi
    _xboxWorker:xboxWorker
    private _xHomeStreamingToken:any


    authenticationCompleted(streamingTokens, webToken){
        this.log('electron', __filename+'[authenticationCompleted()] authenticationCompleted called')
        // const tokens = this._authentication._tokens
        this.updateStreamingTokens(streamingTokens)

        this._webApi = new xboxWebApi({
            token: webToken.data.Token,
            uhs: webToken.data.DisplayClaims.xui[0].uhs,
        })

        this._authentication._isAuthenticating = false
        this._authentication._isAuthenticated = true

        this._webApi.providers.profile.get('/users/me/profile/settings?settings=GameDisplayName,GameDisplayPicRaw,Gamerscore,Gamertag').then((result) => {
            if(result.data.profileUsers.length > 0) {
                for(const setting in result.data.profileUsers[0].settings){

                    if(result.data.profileUsers[0].settings[setting].id === 'Gamertag'){
                        this._store.set('user.gamertag', result.data.profileUsers[0].settings[setting].value)

                    } else if(result.data.profileUsers[0].settings[setting].id === 'GameDisplayPicRaw'){
                        this._store.set('user.gamerpic', result.data.profileUsers[0].settings[setting].value)

                    } else if(result.data.profileUsers[0].settings[setting].id === 'Gamerscore'){
                        this._store.set('user.gamerscore', result.data.profileUsers[0].settings[setting].value)
                    }
                }
            }

            // Run workers
            this._xboxWorker = new xboxWorker(this)
            this._ipc.onUserLoaded()

        }).catch((error) => {
            this.log('electron', __filename+'[authenticationCompleted()] Failed to retrieve user profile:', error)
            dialog.showMessageBox({
                message: this.t('errors.failedToRetrieveUserProfile') + JSON.stringify(error),
                type: 'error',
            })
        })
    }

    openMainWindow(){
        this.log('electron', __filename+'[openMainWindow()] Creating new main window')

        const windowOptions:any = {
            title: branding.name,
            icon: this.trayIconPath(),
            backgroundColor: 'rgb(26, 27, 30)',
            show: false,
            resizable: false,
            minimizable: true,
            maximizable: false,
            fullscreenable: false,
            webPreferences: {
                backgroundThrottling: false,
            },
        }
        if(this._startupFlags.fullscreen === true){
            windowOptions.fullscreen = true
        }

        this._mainWindow = createWindow('main', {
            width: 420,
            height: 380,
            useContentSize: true,
            ...windowOptions,
        })

        const rendererSession = this._mainWindow.webContents.session
        rendererSession.setPermissionCheckHandler((webContents, permission) => permission === 'speaker-selection')
        rendererSession.setPermissionRequestHandler((webContents, permission, callback) => {
            callback(permission === 'speaker-selection')
        })
        this._mainWindow.webContents.on('render-process-gone', (event, details) => {
            this.writeBridgeLog('renderer.process-gone', details)
        })
        this._mainWindow.on('unresponsive', () => this.writeBridgeLog('renderer.unresponsive'))
        this._mainWindow.on('responsive', () => this.writeBridgeLog('renderer.responsive'))

        this._mainWindow.once('ready-to-show', () => {
            const settings = this._store.get('settings', {}) as any
            if(!settings.setupComplete)
                this._mainWindow.show()
        })

        this._mainWindow.on('show', () => {
            this.log('electron', __filename+'[openMainWindow()] Showing Main window.')
        })

        this._mainWindow.on('close', (event) => {
            if(this._isQuitting === false){
                event.preventDefault()
                this.log('electron', __filename+'[openMainWindow()] Main window has been hidden')
                if(!this._store.get('ui.trayHintShown', false)){
                    this._store.set('ui.trayHintShown', true)
                    dialog.showMessageBox(this._mainWindow, {
                        type: 'info',
                        title: 'Still running in the tray',
                        message: `${branding.name} will keep playing in the background.`,
                        detail: `Use the ${branding.name} icon in the notification area to show, mute, disconnect, or quit the app.`,
                        buttons: ['Got it'],
                        defaultId: 0,
                    }).finally(() => this._mainWindow?.hide())
                } else {
                    this._mainWindow.hide()
                }
            } else {
                this.log('electron', __filename+'[openMainWindow()] Main window has been closed')
                this._mainWindow = undefined
            }
        })

        if (this._isProduction === true && this._isCi === false) {
            this._mainWindow.loadURL('app://./home.html')
        } else {
            const port = process.argv[2] || 3000
            this._mainWindow.loadURL(`http://localhost:${port}/home`)
        }
    }

    showMainWindow(){
        if(!this._mainWindow || this._mainWindow.isDestroyed())
            this.openMainWindow()
        this._mainWindow.show()
        this._mainWindow.focus()
    }

    toggleMainWindow(){
        if(this._mainWindow?.isVisible())
            this._mainWindow.hide()
        else
            this.showMainWindow()
    }

    private trayIconPath(){
        return ElectronApp.isPackaged
            ? path.join(process.resourcesPath, 'icon.ico')
            : path.join(__dirname, '..', 'resources', 'icon.ico')
    }

    createTray(){
        const icon = nativeImage.createFromPath(this.trayIconPath())
        this._tray = new Tray(icon)
        this._tray.setToolTip(branding.name)
        this._tray.on('click', () => this.toggleMainWindow())
        this.refreshTray()
    }

    refreshTray(){
        if(!this._tray || !this._ipc?._channels?.bridge)
            return
        const state = this._ipc._channels.bridge.getStateSnapshot()
        const active = ['connecting', 'connected', 'reconnecting'].includes(state.status)
        const menu = Menu.buildFromTemplate([
            {label: `Status: ${state.status}`, enabled: false},
            {type: 'separator'},
            {label: 'Show', click: () => this.showMainWindow()},
            {
                label: active ? 'Disconnect' : 'Connect',
                enabled: state.setupComplete,
                click: () => active ? this._ipc._channels.bridge.disconnect() : this._ipc._channels.bridge.connect(),
            },
            {
                label: 'Mute',
                type: 'checkbox',
                checked: state.muted,
                click: item => this._ipc._channels.bridge.setMuted({muted: item.checked}),
            },
            {label: 'Copy diagnostics', click: () => this.copyBridgeDiagnostics(true)},
            {label: 'Open diagnostic log', click: () => this.openBridgeLog()},
            {label: 'About & licenses', click: () => this.showAbout()},
            {type: 'separator'},
            {label: 'Quit', click: () => this.quit()},
        ])
        this._tray.setContextMenu(menu)
    }

    setLaunchAtLogin(enabled:boolean){
        if(!this._isWindows || !ElectronApp.isPackaged)
            return
        ElectronApp.setLoginItemSettings({name: 'Xbox Audio Bridge', openAtLogin: false})
        ElectronApp.setLoginItemSettings({
            name: branding.name,
            openAtLogin: enabled,
            path: process.execPath,
            args: ['--hidden'],
        })
    }

    async showAbout(){
        const result = await dialog.showMessageBox(this._mainWindow, {
            type: 'info', title: `About ${branding.name}`,
            message: `${branding.name} ${pkg.version}`,
            detail: `${branding.description}\n\nBased on Greenlight by UnknownSKL (Jim Kroon) and contributors, under the MIT License.\n\n${branding.disclaimer}\nMicrosoft and Xbox are trademarks of the Microsoft group of companies.`,
            buttons: ['Close', 'Open licenses'], defaultId: 0, cancelId: 0,
        })
        if(result.response === 1){
            const directory = ElectronApp.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'resources')
            const error = await shell.openPath(path.join(directory, 'legal', 'THIRD-PARTY-LICENSES.txt'))
            if(error)
                throw new Error(error)
        }
        return true
    }

    updateStreamingTokens(streamingTokens){
        const homeToken = streamingTokens.xHomeToken
        const homeRegion = homeToken.data.offeringSettings.regions.find(region => region.isDefault)
        if(!homeRegion)
            throw new Error('Xbox Home did not provide a default streaming region.')
        this._xHomeStreamingToken = homeToken
        this._xHomeApi = new xCloudApi(this, homeRegion.baseUri.substring(8), homeToken.data.gsToken, 'home')

        if(streamingTokens.xCloudToken !== undefined){
            const cloudRegion = streamingTokens.xCloudToken.data.offeringSettings.regions.find(region => region.isDefault)
            if(cloudRegion)
                this._xCloudApi = new xCloudApi(this, cloudRegion.baseUri.substring(8), streamingTokens.xCloudToken.data.gsToken, 'cloud')
        }
    }

    getHomeStreamingTokenSecondsLeft(){
        const seconds = this._xHomeStreamingToken?.getSecondsValid?.()
        return Number.isFinite(seconds) ? seconds : 0
    }

    quit(){
        if(this._isQuitting)
            return
        this._isQuitting = true
        this._ipc?._channels?.bridge?.shutdown()
        const sessions = Object.keys(this._ipc?._channels?.streaming?._streamManager?._sessions || {})
        this.writeBridgeLog('app.quit-started', {activeSessions: sessions.length})
        Promise.allSettled(sessions.map(id => this._ipc._channels.streaming._streamManager.stopStream(id)))
            .finally(() => {
                this.writeBridgeLog('app.quit-complete')
                ElectronApp.quit()
            })
    }

    restart(){
        this.quit()
        ElectronApp.relaunch()
    }
}

if(ElectronApp.requestSingleInstanceLock())
    new Application()
else
    ElectronApp.quit()
