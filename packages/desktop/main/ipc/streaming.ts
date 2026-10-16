import IpcBase from './base'
import Application from '../application'
import StreamManager from '../helpers/streammanager'

interface startStreamArgs {
    type: string;
    target: string;
}

interface sendSdpArgs {
    sessionId: string;
    sdp: any;
}

interface sendIceArgs {
    sessionId: string;
    ice: any;
}
interface sendKeepaliveArgs {
    sessionId: string;
}
interface stopStreamArgs {
    sessionId: string;
}
interface getPlayerStateArgs {
    sessionId: string;
}

function serviceErrorDetails(error){
    let body:any = error?.body
    if(typeof body === 'string'){
        try { body = JSON.parse(body) } catch(parseError) { body = undefined }
    }
    return {
        status: error?.status,
        code: body?.errorDetails?.code || body?.error?.code || body?.code,
        message: error?.message || body?.errorDetails?.message || body?.error?.message || body?.message,
    }
}

function isStreamingCredentialError(error){
    const details = serviceErrorDetails(error)
    if(Number(details.status) === 401 || Number(details.status) === 403)
        return true
    return /token|auth|credential|expired|unauthorized|forbidden/i.test(`${details.code || ''} ${details.message || ''}`)
}

export default class IpcStreaming extends IpcBase {

    _streamManager:StreamManager

    constructor(application:Application){
        super(application)

        this._streamManager = new StreamManager(application)
    }

    async startStream(args:startStreamArgs){

        if(args.type === 'home'){
            this._application._ipc._channels.consoles._consolesLastUpdate = 0
        } else {
            this._application._ipc._channels.xCloud._recentTitlesLastUpdate = 0
        }

        return this.withStreamingCredentials(args.type, 'start', () => this._streamManager.startStream(args.type, args.target))
    }

    private async withStreamingCredentials<T>(type:string, action:string, request:() => Promise<T>){
        if(type === 'home')
            await this._application._authentication.ensureHomeStreamingTokenFresh()

        try {
            return await request()
        } catch(error) {
            const details = serviceErrorDetails(error)
            this._application.writeBridgeLog(`stream.${action}-failed`, details)
            if(type !== 'home' || !isStreamingCredentialError(error))
                throw error

            this._application.writeBridgeLog(`stream.${action}-auth-retry`, details)
            await this._application._authentication.refreshStreamingTokens(`${action}-stream-auth-error`)
            return request()
        }
    }

    stopStream(args:stopStreamArgs){
        return this._streamManager.stopStream(args.sessionId)
    }

    sendSdp(args:sendSdpArgs){
        return this._streamManager.sendSdp(args.sessionId, args.sdp)
    }

    sendChatSdp(args:sendSdpArgs){
        return this._streamManager.sendChatSdp(args.sessionId, args.sdp)
    }

    sendIce(args:sendIceArgs){
        return this._streamManager.sendIce(args.sessionId, args.ice)
    }

    sendKeepalive(args:sendKeepaliveArgs){
        const session = this._streamManager.getSession(args.sessionId)
        if(!session)
            return Promise.reject(new Error('Stream session is no longer active.'))
        return this.withStreamingCredentials(session.type, 'keepalive', () => this._streamManager.sendKeepalive(args.sessionId))
    }

    getPlayerState(args:getPlayerStateArgs){
        return new Promise((resolve) => {
            resolve(this._streamManager.getSession(args.sessionId))
        })
    }

    activeSessions(){
        return this._streamManager.getActiveSessions()
    }

}
