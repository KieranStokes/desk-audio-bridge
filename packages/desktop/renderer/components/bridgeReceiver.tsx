import React from 'react'
import xCloudPlayer from 'xbox-xcloud-player'
import Ipc from '../lib/ipc'

interface AudioSettings {
    volume: number;
    muted: boolean;
    outputDeviceId: string;
}

const wait = (milliseconds:number) => new Promise(resolve => setTimeout(resolve, milliseconds))

function describeConnectionError(error:any){
    let body:any = error?.body
    if(typeof body === 'string'){
        try { body = JSON.parse(body) } catch(parseError) { body = undefined }
    }
    const status = Number(error?.status) || undefined
    const code = body?.errorDetails?.code || body?.error?.code || body?.code
    const message = error?.message || body?.errorDetails?.message || body?.error?.message || body?.message
    const display = message || (status ? `Xbox streaming service returned HTTP ${status}.` : String(error))
    return {status, code, message: display}
}

export default function BridgeReceiver(){
    const playerRef = React.useRef<any>(undefined)
    const sessionRef = React.useRef('')
    const generationRef = React.useRef(0)
    const keepaliveRef = React.useRef<ReturnType<typeof setInterval>>(undefined)
    const statsRef = React.useRef<ReturnType<typeof setInterval>>(undefined)
    const observerRef = React.useRef<MutationObserver>(undefined)
    const disconnectGraceRef = React.useRef<ReturnType<typeof setTimeout>>(undefined)
    const startingRef = React.useRef(false)
    const observedAudioRef = React.useRef<WeakSet<HTMLAudioElement>>(new WeakSet())
    const audioSettingsRef = React.useRef<AudioSettings>({volume: 0.5, muted: false, outputDeviceId: ''})

    const report = React.useCallback((status:string, error?:string) => {
        return Ipc.send('bridge', 'reportRendererState', {status, error}).catch(() => undefined)
    }, [])

    const diagnostic = React.useCallback((event:string, details:any = {}) => {
        return Ipc.send('bridge', 'reportDiagnostic', {event, details}).catch(() => undefined)
    }, [])

    const applyAudioSettings = React.useCallback((settings?:AudioSettings) => {
        if(settings)
            audioSettingsRef.current = settings
        const audio = document.querySelector<HTMLAudioElement>('#audio-bridge-receiver audio')
        if(audio){
            audio.volume = audioSettingsRef.current.volume
            audio.muted = audioSettingsRef.current.muted
            if(!observedAudioRef.current.has(audio)){
                observedAudioRef.current.add(audio)
                for(const eventName of ['playing', 'waiting', 'stalled', 'emptied']){
                    audio.addEventListener(eventName, () => diagnostic(`audio-element.${eventName}`, {
                        readyState: audio.readyState,
                        networkState: audio.networkState,
                        paused: audio.paused,
                    }))
                }
                audio.addEventListener('error', () => diagnostic('audio-element.error', {
                    code: audio.error?.code,
                    message: audio.error?.message,
                }))
            }
            const sinkAudio = audio as HTMLAudioElement & {sinkId?:string; setSinkId?:(deviceId:string) => Promise<void>}
            if(sinkAudio.setSinkId && sinkAudio.sinkId !== audioSettingsRef.current.outputDeviceId){
                sinkAudio.setSinkId(audioSettingsRef.current.outputDeviceId).catch(error => {
                    console.error('Unable to use the selected audio output; returning to the system default.', error)
                    Ipc.send('bridge', 'setOutputDevice', {outputDeviceId: ''})
                })
            }
        }
        const video = document.querySelector<HTMLVideoElement>('#audio-bridge-receiver video')
        if(video){
            video.muted = true
            video.style.opacity = '0'
        }
    }, [diagnostic])

    const stop = React.useCallback(async (notify = true, reason = 'requested') => {
        diagnostic('stream.stop', {reason, notify})
        generationRef.current += 1
        startingRef.current = false
        if(keepaliveRef.current)
            clearInterval(keepaliveRef.current)
        keepaliveRef.current = undefined
        if(statsRef.current)
            clearInterval(statsRef.current)
        statsRef.current = undefined
        observerRef.current?.disconnect()
        observerRef.current = undefined
        if(disconnectGraceRef.current)
            clearTimeout(disconnectGraceRef.current)
        disconnectGraceRef.current = undefined
        const player = playerRef.current
        playerRef.current = undefined
        if(player){
            try { player.close() } catch(error) { console.debug('Player close failed', error) }
        }
        const sessionId = sessionRef.current
        sessionRef.current = ''
        if(sessionId){
            try { await Ipc.send('streaming', 'stopStream', {sessionId}) } catch(error) { console.debug('Stream was already stopped', error) }
        }
        const holder = document.getElementById('audio-bridge-receiver')
        if(holder)
            holder.innerHTML = ''
        if(notify)
            await report('disconnected')
    }, [diagnostic, report])

    const connect = React.useCallback(async (consoleId:string) => {
        if(startingRef.current || playerRef.current || !consoleId)
            return
        startingRef.current = true
        const generation = generationRef.current + 1
        generationRef.current = generation
        diagnostic('connect.begin', {inputMode: 'disabled', controllerHandshakeSlot: 3, controllerHandshake: 'attach-detach'})
        await report('connecting')
        try {
            const sessionId = await Ipc.send('streaming', 'startStream', {type: 'home', target: consoleId}) as string
            if(generation !== generationRef.current)
                return
            sessionRef.current = sessionId
            let session:any
            let previousPlayerState = ''
            while(generation === generationRef.current){
                session = await Ipc.send('streaming', 'getPlayerState', {sessionId})
                if(session?.playerState !== previousPlayerState){
                    previousPlayerState = session?.playerState
                    diagnostic('session.state', {playerState: session?.playerState, serviceState: session?.state})
                }
                if(session?.playerState === 'started')
                    break
                if(session?.playerState === 'failed')
                    throw new Error(session.errorDetails?.message || 'Xbox could not start the audio stream.')
                await wait(1000)
            }
            if(generation !== generationRef.current)
                return
            const holder = document.getElementById('audio-bridge-receiver')
            if(!holder)
                throw new Error('Audio receiver is unavailable.')
            holder.innerHTML = '<div id="audioBridgePlayer"></div>'
            const player:any = new xCloudPlayer('audioBridgePlayer', {
                ui_systemui: [],
                input_enabled: false,
                input_touch: false,
                input_mousekeyboard: false,
                input_legacykeyboard: false,
            })
            playerRef.current = player
            player.bind()
            const peerConnection:RTCPeerConnection = player._webrtcClient
            diagnostic('peer.created', {
                connectionState: peerConnection.connectionState,
                iceConnectionState: peerConnection.iceConnectionState,
                iceGatheringState: peerConnection.iceGatheringState,
            })
            const observer = new MutationObserver(() => applyAudioSettings())
            observer.observe(holder, {childList: true, subtree: true})
            observerRef.current = observer
            let connectedReported = false
            const collectTransportStats = async () => {
                if(generation !== generationRef.current)
                    return
                try {
                    const stats = await peerConnection.getStats()
                    let inboundAudio:any
                    stats.forEach((item:any) => {
                        if(item.type === 'inbound-rtp' && !item.isRemote && (item.kind === 'audio' || item.mediaType === 'audio'))
                            inboundAudio = item
                    })
                    const transport:any = inboundAudio?.transportId ? stats.get(inboundAudio.transportId) : undefined
                    const candidatePair:any = transport?.selectedCandidatePairId ? stats.get(transport.selectedCandidatePairId) : undefined
                    const localCandidate:any = candidatePair?.localCandidateId ? stats.get(candidatePair.localCandidateId) : undefined
                    const remoteCandidate:any = candidatePair?.remoteCandidateId ? stats.get(candidatePair.remoteCandidateId) : undefined
                    diagnostic('transport.stats', {
                        connectionState: peerConnection.connectionState,
                        iceConnectionState: peerConnection.iceConnectionState,
                        packetsReceived: inboundAudio?.packetsReceived,
                        packetsLost: inboundAudio?.packetsLost,
                        bytesReceived: inboundAudio?.bytesReceived,
                        jitter: inboundAudio?.jitter,
                        jitterBufferDelay: inboundAudio?.jitterBufferDelay,
                        jitterBufferEmittedCount: inboundAudio?.jitterBufferEmittedCount,
                        concealedSamples: inboundAudio?.concealedSamples,
                        silentConcealedSamples: inboundAudio?.silentConcealedSamples,
                        roundTripTime: candidatePair?.currentRoundTripTime,
                        candidatePairState: candidatePair?.state,
                        localCandidateType: localCandidate?.candidateType,
                        localProtocol: localCandidate?.protocol,
                        remoteCandidateType: remoteCandidate?.candidateType,
                        remoteProtocol: remoteCandidate?.protocol,
                    })
                } catch(error) {
                    diagnostic('transport.stats-error', {error: error?.message || String(error)})
                }
            }
            const markConnected = async () => {
                if(generation !== generationRef.current)
                    return
                if(disconnectGraceRef.current)
                    clearTimeout(disconnectGraceRef.current)
                disconnectGraceRef.current = undefined
                startingRef.current = false
                applyAudioSettings()
                if(!keepaliveRef.current){
                    keepaliveRef.current = setInterval(() => {
                        Ipc.send('streaming', 'sendKeepalive', {sessionId})
                            .then(() => diagnostic('keepalive.ok'))
                            .catch(error => {
                                diagnostic('keepalive.error', describeConnectionError(error))
                                console.error('Audio bridge keepalive failed', error)
                            })
                    }, 30000)
                }
                if(!statsRef.current){
                    collectTransportStats()
                    statsRef.current = setInterval(collectTransportStats, 15000)
                }
                if(!connectedReported){
                    connectedReported = true
                    await report('connected')
                }
            }
            const terminateConnection = async (reason:string) => {
                if(generation !== generationRef.current)
                    return
                console.error('Xbox Audio Bridge transport ended:', reason)
                diagnostic('transport.terminated', {
                    reason,
                    connectionState: peerConnection.connectionState,
                    iceConnectionState: peerConnection.iceConnectionState,
                })
                observer.disconnect()
                await stop(false, reason)
                await report('error', reason)
            }
            const waitForPeerRecovery = () => {
                if(disconnectGraceRef.current)
                    return
                disconnectGraceRef.current = setTimeout(async () => {
                    disconnectGraceRef.current = undefined
                    if(generation !== generationRef.current || peerConnection.connectionState === 'connected')
                        return
                    await terminateConnection(`WebRTC peer remained ${peerConnection.connectionState} for 15 seconds.`)
                }, 15000)
                diagnostic('peer.recovery-window-started', {
                    connectionState: peerConnection.connectionState,
                    iceConnectionState: peerConnection.iceConnectionState,
                    graceSeconds: 15,
                })
            }
            player.getEventBus().on('connectionstate', async event => {
                if(generation !== generationRef.current)
                    return
                if(event.state === 'connected'){
                    await markConnected()
                } else if(['closing', 'closed', 'failed', 'disconnected'].includes(event.state)) {
                    // The library's connectionstate event is actually the input data
                    // channel state. Audio can remain healthy after that channel closes,
                    // so it must not drive reconnection for an audio-only client.
                    diagnostic('input-channel.state', {state: event.state, peerState: peerConnection.connectionState})
                    console.warn(`Ignoring input data channel state: ${event.state}; peer is ${peerConnection.connectionState}.`)
                }
            })
            peerConnection?.addEventListener('connectionstatechange', () => {
                const state = peerConnection.connectionState
                diagnostic('peer.connection-state', {state, iceConnectionState: peerConnection.iceConnectionState})
                console.log('Xbox Audio Bridge peer connection state:', state)
                if(state === 'connected')
                    markConnected()
                else if(state === 'disconnected')
                    waitForPeerRecovery()
                else if(state === 'failed')
                    terminateConnection('WebRTC peer connection failed.')
            })
            peerConnection?.addEventListener('iceconnectionstatechange', () => {
                diagnostic('peer.ice-state', {state: peerConnection.iceConnectionState, connectionState: peerConnection.connectionState})
            })
            peerConnection?.addEventListener('icegatheringstatechange', () => {
                diagnostic('peer.ice-gathering-state', {state: peerConnection.iceGatheringState})
            })
            peerConnection?.addEventListener('signalingstatechange', () => {
                diagnostic('peer.signaling-state', {state: peerConnection.signalingState})
            })
            peerConnection?.addEventListener('track', event => {
                diagnostic('track.received', {kind: event.track.kind, id: event.track.id, readyState: event.track.readyState})
                if(event.track.kind === 'audio'){
                    event.track.addEventListener('mute', () => diagnostic('audio-track.muted', {readyState: event.track.readyState}))
                    event.track.addEventListener('unmute', () => diagnostic('audio-track.unmuted', {readyState: event.track.readyState}))
                    event.track.addEventListener('ended', () => {
                        diagnostic('audio-track.ended')
                        terminateConnection('The Xbox ended the remote audio track.')
                    }, {once: true})
                }
            })
            player.setSdpHandler((client, offer) => {
                Ipc.send('streaming', 'sendChatSdp', {sessionId, sdp: offer.sdp})
                    .then((response:any) => player.setRemoteOffer(response.sdp))
                    .catch(error => console.debug('Unused chat SDP failed', error))
            })
            const offer:any = await player.createOffer()
            diagnostic('signaling.local-offer-created', {iceCandidates: player.getIceCandidates().length})
            const sdpResult:any = await Ipc.send('streaming', 'sendSdp', {sessionId, sdp: offer.sdp})
            player.setRemoteOffer(sdpResult.sdp)
            const candidates = player.getIceCandidates().map(candidate => ({
                candidate: candidate.candidate,
                sdpMLineIndex: candidate.sdpMLineIndex,
                sdpMid: candidate.sdpMid,
            }))
            const iceResult:any = await Ipc.send('streaming', 'sendIce', {sessionId, ice: candidates})
            diagnostic('signaling.ice-exchanged', {localCandidates: candidates.length, remoteCandidates: Array.isArray(iceResult) ? iceResult.length : undefined})
            player.setIceCandidates(iceResult)
            applyAudioSettings()
        } catch(error) {
            console.error('Xbox Audio Bridge connection failed', error)
            const details = describeConnectionError(error)
            diagnostic('connect.error', details)
            await stop(false, 'connect-error')
            await report('error', details.message)
        }
    }, [applyAudioSettings, diagnostic, report, stop])

    React.useEffect(() => {
        const connectListener = Ipc.onAction('bridge', 'connectRequested', (event, data) => connect(data.consoleId))
        const disconnectListener = Ipc.onAction('bridge', 'disconnectRequested', (event, data) => stop(true, data?.reason || 'requested'))
        const audioListener = Ipc.onAction('bridge', 'applyAudioSettings', (event, data) => applyAudioSettings(data))
        Ipc.send('bridge', 'rendererReady').then((state:any) => applyAudioSettings({
            volume: state.volume,
            muted: state.muted,
            outputDeviceId: state.outputDeviceId,
        }))
        return () => {
            Ipc.removeListener('bridge', connectListener)
            Ipc.removeListener('bridge', disconnectListener)
            Ipc.removeListener('bridge', audioListener)
            stop(false, 'renderer-unmounted')
        }
    }, [applyAudioSettings, connect, stop])

    return <div id="audio-bridge-receiver" aria-hidden="true" />
}
