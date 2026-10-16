import { clipboard, dialog, shell } from 'electron'
import { createWindow } from './helpers'
import Application from './application'
import { Msal } from 'xal-node'
import AuthTokenStore from './helpers/tokenstore'
import i18n from 'i18next';


export default class Authentication {
    _application:Application

    _tokenStore:AuthTokenStore
    _msal:Msal

    _authWindow
    _authCallback

    _isAuthenticating:boolean = false
    _isAuthenticated:boolean = false
    _appLevel:number = 0
    _authPrompt?:{
        userCode:string;
        verificationUri:string;
        verificationUrl:string;
        expiresAt:number;
    }
    _authError:string = ''
    private _deviceCodeFlowActive:boolean = false
    private _streamingRefreshPromise?:Promise<void>

    private t = i18n.t.bind(i18n);

    constructor(application:Application){
        this._application = application
        this._tokenStore = new AuthTokenStore()
        this._msal = new Msal(this._tokenStore)
    }

    loadTokenStore(){
        this._tokenStore.load()
        const result = this._tokenStore.getLastLoadResult()
        this._application.writeBridgeLog('auth.token-store-loaded', {status: result.status})
        if(result.status === 'error')
            this._authError = 'Your saved Microsoft sign-in could not be unlocked. Please sign in again.'
        return result
    }

    checkAuthentication(){
        this._application.log('authenticationV2', '[checkAuthentication()] Starting token check...')
        if(this._tokenStore.hasValidAuthTokens()){

            // Deprecate xal token.
            if(this._tokenStore.getUserToken() !== undefined && this._tokenStore.getUserToken().data.scope != 'XboxLive.signin'){
                this._application.log('authenticationV2', '[checkAuthentication()] Deprecating old XAL token scope. Starting auth flow to get new tokens.')
                return false
            }

            this._application.log('authenticationV2', '[checkAuthentication()] Tokens are valid:', this._tokenStore.getUserToken())
            this.startSilentFlow()

            return true

        } else {
            if(this._tokenStore.getUserToken() !== undefined){
                // We have a user token, lets try to refresh it.
                this._application.log('authenticationV2', '[checkAuthentication()] Tokens are expired but we have a user token. Lets try to refresh the tokens.')
                this.startSilentFlow()

                return true

            } else {
                this._application.log('authenticationV2', '[checkAuthentication()] No tokens are present.')
                return false
            }
        }
    }

    startSilentFlow(){
        this._application.log('authenticationV2', '[startSilentFlow()] Starting silent flow...')
        this._isAuthenticating = true

        const forceRegionIp = this._application._store.get('force_region_ip', '')
        if (forceRegionIp && typeof forceRegionIp === 'string' && forceRegionIp.trim() !== '') {
            this._msal.setDefaultHeaders({ 'X-Forwarded-For': forceRegionIp.trim() })
            this._application.log('authenticationV2', '[startSilentFlow()] Using X-Forwarded-For:', forceRegionIp)
        } else {
            this._msal.setDefaultHeaders({})
        }

        this.getTokens()
    }

    getTokens(){
        this.getStreamingToken().then((streamingTokens) => {
            this._application.log('authenticationV2', '[getTokens()] Retrieved streaming tokens:', streamingTokens)

            if(streamingTokens.xCloudToken !== undefined){
                this._application.log('authenticationV2', '[getTokens()] Retrieved both xHome and xCloud tokens')
                this._appLevel = 2
            } else {
                this._application.log('authenticationV2', '[getTokens()] Retrieved xHome token only')
                this._appLevel = 1
            }

            this._msal.getWebToken().then((webToken) => {
                this._application.log('authenticationV2', __filename+'[getTokens()] Web token received')
                this._application.authenticationCompleted(streamingTokens, webToken)

            }).catch((error) => {
                this._application.log('authenticationV2', __filename+'[getTokens()] Failed to retrieve web tokens:', error)
                dialog.showMessageBox({
                    message: this.t('errors.failedToRetrieveWebTokens') + ' ' + JSON.stringify(error),
                    type: 'error',
                })
            })

        }).catch((err) => {
            this._application.log('authenticationV2', '[startSilentFlow()] Failed to retrieve streaming tokens:', err)
            dialog.showMessageBox({
                message: "Failed to retrieve streaming tokens. Please sign in again.",
                type: 'error',
            })
            // @TODO: If we fail to get streaming tokens, we should probably start the auth flow to let the user re-authenticate and get new tokens.
            this.startAuthflow()
        })
    }

    startAuthflow(){
        if(this._deviceCodeFlowActive)
            return

        this._application.log('authenticationV2', '[startAuthflow()] Starting authentication flow')
        this._deviceCodeFlowActive = true
        this._isAuthenticating = true
        this._authError = ''
        this._authPrompt = undefined

        const forceRegionIp = this._application._store.get('force_region_ip', '')
        if (forceRegionIp && typeof forceRegionIp === 'string' && forceRegionIp.trim() !== '') {
            this._msal.setDefaultHeaders({ 'X-Forwarded-For': forceRegionIp.trim() })
            this._application.log('authenticationV2', '[startSilentFlow()] Using X-Forwarded-For:', forceRegionIp)
        } else {
            this._msal.setDefaultHeaders({})
        }

        this._msal.doDeviceCodeAuth().then((data) => {
            this._application.log('authenticationV2', '[startAuthflow()] Starting devicecode auth:', data)
            const verificationUrl = this.createVerificationUrl(data.verification_uri, data.user_code)
            this._authPrompt = {
                userCode: data.user_code,
                verificationUri: data.verification_uri,
                verificationUrl,
                expiresAt: Date.now() + (data.expires_in * 1000),
            }
            this._application.showMainWindow()
            this._application.writeBridgeLog('auth.device-code-created', {
                verificationUri: data.verification_uri,
                expiresInSeconds: data.expires_in,
            })
            this.openAuthPage().catch((error) => {
                this._application.log('authenticationV2', '[startAuthflow()] Failed to open the system browser:', error)
                this._application.writeBridgeLog('auth.browser-open-failed', {error: String(error)})
            })

            this._msal.doPollForDeviceCodeAuth(data.device_code, data.expires_in * 1000).then((token) => {
                this._application.log('authenticationV2', '[startAuthflow()] Devicecode authentication successful:', token)
                this._deviceCodeFlowActive = false
                this._authPrompt = undefined
                this.getTokens()

            }).catch((error) => {
                this._application.log('authenticationV2', '[startAuthflow()] Error during devicecode polling auth:', error)
                this._deviceCodeFlowActive = false
                this._isAuthenticating = false
                this._authPrompt = undefined
                this._authError = 'Microsoft sign-in expired or was cancelled. Please try again.'
                this._application.writeBridgeLog('auth.device-code-failed', {error: String(error)})
            })

        }).catch((error) => {
            this._application.log('authenticationV2', '[startAuthflow()] Error during devicecode auth:', error)
            this._deviceCodeFlowActive = false
            this._isAuthenticating = false
            this._authPrompt = undefined
            this._authError = 'Could not start Microsoft sign-in. Check your connection and try again.'
            this._application.writeBridgeLog('auth.device-code-request-failed', {error: String(error)})
        })
    }

    private createVerificationUrl(verificationUri:string, userCode:string){
        const url = new URL(verificationUri)
        url.searchParams.set('otc', userCode)
        return url.toString()
    }

    openAuthPage(){
        if(!this._authPrompt)
            return Promise.reject(new Error('No Microsoft sign-in is currently in progress.'))
        return shell.openExternal(this._authPrompt.verificationUrl)
    }

    copyAuthCode(){
        if(!this._authPrompt)
            return false
        clipboard.writeText(this._authPrompt.userCode)
        return true
    }

    openAuthWindow(url){
        const authWindow = createWindow('auth', {
            width: 500,
            height: 600,
            title: this.t('auth.windowTitle'),
        })

        authWindow.loadURL(url)
        this._authWindow = authWindow

        this._authWindow.on('close', () => {
            this._application.log('authenticationV2', '[openAuthWindow()] Closed auth window')
            // @TODO: What to do?
        })
    }

    async getStreamingToken(){
        const userToken = this._tokenStore.getUserToken()
        if(userToken === undefined)
            throw new Error( this.t('errors.sisuTokenIsMissing') )

        this._application.log('authenticationV2', '[getStreamingToken()] Found local token:', userToken)

        const streamingTokens = await this._msal.getStreamingTokens()
        this._application.log('authenticationV2', '[getStreamingToken()] Retrieved streaming tokens:', streamingTokens)

        return { xHomeToken: streamingTokens.xHomeToken, xCloudToken: streamingTokens.xCloudToken }
        // return { xHomeToken: streamingTokens.xHomeToken, xCloudToken: undefined }
    }

    ensureHomeStreamingTokenFresh(minimumSeconds = 120){
        const secondsRemaining = this._application.getHomeStreamingTokenSecondsLeft()
        if(secondsRemaining > minimumSeconds)
            return Promise.resolve()
        return this.refreshStreamingTokens('expired-or-near-expiry')
    }

    refreshStreamingTokens(reason = 'requested'){
        if(this._streamingRefreshPromise)
            return this._streamingRefreshPromise

        this._application.writeBridgeLog('auth.streaming-token-refresh-started', {
            reason,
            secondsRemaining: this._application.getHomeStreamingTokenSecondsLeft(),
        })
        this._streamingRefreshPromise = this.getStreamingToken()
            .then(streamingTokens => {
                this._application.updateStreamingTokens(streamingTokens)
                this._application.writeBridgeLog('auth.streaming-token-refresh-completed', {
                    reason,
                    secondsRemaining: this._application.getHomeStreamingTokenSecondsLeft(),
                })
            })
            .catch(error => {
                this._application.writeBridgeLog('auth.streaming-token-refresh-failed', {
                    reason,
                    status: error?.status,
                    error: error?.message || error?.body || String(error),
                })
                throw error
            })
            .finally(() => this._streamingRefreshPromise = undefined)

        return this._streamingRefreshPromise
    }


}
