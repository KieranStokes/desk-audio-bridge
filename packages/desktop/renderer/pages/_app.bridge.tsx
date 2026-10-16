import '../styles.css'
import React from 'react'
import Head from 'next/head'
import Ipc from '../lib/ipc'
import { QueryClient, QueryClientProvider } from 'react-query'
import branding from '../../branding.json'

export default function MyApp({ Component, pageProps }){
    const [queryClient] = React.useState(() => new QueryClient())
    const [authState, setAuthState] = React.useState<{
        authenticated:boolean;
        authenticating:boolean;
        prompt?:{userCode:string; verificationUri:string; verificationUrl:string; expiresAt:number};
        error?:string;
    }>({authenticated: false, authenticating: false})
    const [copied, setCopied] = React.useState(false)
    const [rendererReady, setRendererReady] = React.useState(false)
    React.useEffect(() => {
        let mounted = true
        setRendererReady(true)
        const check = () => Ipc.send('app', 'getAuthState').then((result:any) => {
            if(mounted)
                setAuthState({
                    authenticated: result.isAuthenticated && result.user.signedIn,
                    authenticating: result.isAuthenticating,
                    prompt: result.prompt,
                    error: result.error,
                })
        })
        check()
        const interval = setInterval(check, 750)
        return () => { mounted = false; clearInterval(interval) }
    }, [])
    return <React.Fragment>
        <Head><title>{branding.name}</title></Head>
        <QueryClientProvider client={queryClient}>
            {authState.authenticated
                ? <Component {...pageProps} />
                : <main className={`bridge-shell bridge-auth ${authState.prompt ? 'bridge-auth-pending' : ''}`}>
                    <button className="bridge-auth-quit" disabled={!rendererReady} onClick={() => Ipc.send('app', 'quit')}>Quit app</button>
                    <img className="bridge-mark bridge-auth-mark" src="/brand.svg" alt="" />
                    <h1>{branding.name}</h1>
                    {authState.prompt
                        ? <React.Fragment>
                            <p>Finish signing in securely in your browser. This window will continue automatically.</p>
                            <button className="bridge-auth-code" title="Copy sign-in code" onClick={() => {
                                Ipc.send('app', 'copyAuthCode').then(() => {
                                    setCopied(true)
                                    setTimeout(() => setCopied(false), 1500)
                                })
                            }}>
                                <span>{authState.prompt.userCode}</span>
                                <small>{copied ? 'Copied!' : 'Click to copy'}</small>
                            </button>
                            <button className="bridge-primary" onClick={() => Ipc.send('app', 'openAuthPage')}>
                                Open Microsoft sign-in
                            </button>
                            <small>The code should already be filled in. If it is not, paste the code shown above.</small>
                        </React.Fragment>
                        : <React.Fragment>
                            <p>Sign in with the Microsoft account connected to your Xbox.</p>
                            {authState.error && <p className="bridge-auth-error">{authState.error}</p>}
                            <button className="bridge-primary" disabled={authState.authenticating} onClick={() => Ipc.send('app', 'login')}>
                                {authState.authenticating ? 'Preparing Microsoft sign-in…' : 'Sign in with Microsoft'}
                            </button>
                            <small>Your password is entered only on Microsoft&apos;s website. {branding.name} stores the resulting sign-in token locally.</small>
                        </React.Fragment>}
                    <small>{branding.disclaimer}</small>
                    <button className="bridge-auth-about" onClick={() => Ipc.send('app', 'showAbout')}>About &amp; licenses</button>
                </main>}
        </QueryClientProvider>
    </React.Fragment>
}
