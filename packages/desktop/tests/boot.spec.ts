import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'

// import authHelper from './lib/auth'

let appWindow
let electronApp

test.beforeAll('Setup', async () => {
    electronApp = await electron.launch({
        args: ['background.js'],
        cwd: 'app/',
    })

    appWindow = await electronApp.firstWindow()
   
})

test('Application can launch', async () => {
    await expect(appWindow).toHaveTitle(/Desk Audio Bridge/)
    const size = await appWindow.evaluate(() => ({width: window.innerWidth, height: window.innerHeight}))
    expect(size.width).toBe(420)
    expect(size.height).toBe(380)
    await expect(appWindow.getByRole('button', {name: 'Sign in with Microsoft'})).toBeVisible()
    await expect(appWindow.getByRole('button', {name: 'Quit app'})).toBeVisible()
    const overflow = await appWindow.evaluate(() => ({
        document: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        body: document.body.scrollHeight - document.body.clientHeight,
    }))
    expect(overflow).toEqual({document: 0, body: 0})
    expect(electronApp.windows()).toHaveLength(1)
    const authState = await appWindow.evaluate(() => (window as any).Greenlight.send('app', 'getAuthState'))
    expect(authState.tokenProtectionAvailable).toBe(true)
    const tokenProtection = await appWindow.evaluate(() => (window as any).Greenlight.send('app', 'testTokenProtection'))
    expect(tokenProtection).toEqual({
        migrated: true,
        migrationStatus: 'migrated',
        encryptedValuePresent: true,
        plaintextAbsent: true,
        legacyRemoved: true,
        reloaded: true,
        reloadStatus: 'encrypted',
        decryptedValueMatches: true,
    })
})

test('Copied diagnostics redact private connection data', async () => {
    await appWindow.evaluate(async () => {
        await (window as any).Greenlight.send('bridge', 'reportDiagnostic', {
            event: 'redaction-test',
            details: {
                token: 'test-secret-token',
                sessionId: 'test-session-id',
                consoleId: 'test-console-id',
                endpoint: '192.168.10.25',
            },
        })
        await (window as any).Greenlight.send('bridge', 'copyDiagnostics')
    })
    const report = await electronApp.evaluate(({clipboard}) => clipboard.readText())
    expect(report).toContain('Desk Audio Bridge diagnostic report')
    expect(report).toContain('[redacted]')
    expect(report).toContain('[ip-redacted]')
    expect(report).not.toContain('test-secret-token')
    expect(report).not.toContain('test-session-id')
    expect(report).not.toContain('test-console-id')
    expect(report).not.toContain('192.168.10.25')
})

test('Branded sign-in, code, and control screens fit without clipping', async () => {
    const assertLayout = async (name:string) => {
        const clipped = await appWindow.locator('main').evaluate((main:HTMLElement) => {
            const bounds = main.getBoundingClientRect()
            return Array.from(main.querySelectorAll('button, small, img, h1, p, label, input, select, output'))
                .filter((element:HTMLElement) => {
                    const box = element.getBoundingClientRect()
                    return box.width > 0 && box.height > 0 && (box.top < bounds.top || box.bottom > bounds.bottom || box.left < bounds.left || box.right > bounds.right)
                }).map(element => element.textContent || element.tagName)
        })
        expect(clipped).toEqual([])
        await appWindow.screenshot({path: `test-results/desk-audio-bridge-${name}.png`})
    }
    await expect(appWindow.locator('img.bridge-mark')).toBeVisible()
    expect(await appWindow.locator('img.bridge-mark').evaluate((image:HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    await assertLayout('sign-in')
    const setAuth = async (mode:string) => electronApp.evaluate(({ipcMain}, authMode) => {
        const testIpc = ipcMain as any
        if(!testIpc.__brandingOriginal){
            testIpc.__brandingOriginal = ipcMain.listeners('app')
            ipcMain.removeAllListeners('app')
            ipcMain.on('app', (event, args) => {
                if(args.action === 'getAuthState'){
                    const authenticated = testIpc.__brandingMode === 'controls'
                    event.sender.send('app', {action: args.action, id: args.id, data: {
                        isAuthenticated: authenticated,
                        isAuthenticating: !authenticated,
                        user: {signedIn: authenticated},
                        prompt: authenticated ? undefined : {userCode: 'TEST-CODE', verificationUri: 'https://microsoft.com/link'},
                    }})
                } else {
                    for(const listener of testIpc.__brandingOriginal)
                        listener.call(ipcMain, event, args)
                }
            })
        }
        testIpc.__brandingMode = authMode
    }, mode)
    try {
        await setAuth('code')
        await expect(appWindow.getByText('TEST-CODE', {exact: true})).toBeVisible()
        await assertLayout('code')
        await setAuth('controls')
        await expect(appWindow.getByRole('button', {name: 'About', exact: true})).toBeVisible()
        await assertLayout('controls')
    } finally {
        await electronApp.evaluate(({ipcMain}) => {
            const testIpc = ipcMain as any
            ipcMain.removeAllListeners('app')
            for(const listener of testIpc.__brandingOriginal || [])
                ipcMain.on('app', listener)
            delete testIpc.__brandingOriginal
            delete testIpc.__brandingMode
        })
        await expect(appWindow.getByRole('button', {name: 'Sign in with Microsoft'})).toBeVisible()
    }
})

test('Visible Quit app control fully exits the process', async () => {
    const process = electronApp.process()
    const exited = new Promise<void>((resolve) => {
        if(process.exitCode !== null)
            resolve()
        else
            process.once('exit', () => resolve())
    })
    await appWindow.getByRole('button', {name: 'Quit app'}).click()
    await exited
    electronApp = undefined
})

// test('Can perform authentication', async () => {
//     while(electronApp.windows().length < 2) {
//         await delay(100)
//     }
//     const authWindow = await electronApp.windows()[1]

//     await expect(authWindow).toHaveTitle(/Sign in to your Microsoft account/)

//     await authWindow.isVisible('div#lightbox input#i0116')
//     await delay(500)
//     await authWindow.locator('div#lightbox input#i0116').fill(process.env.XBOX_USERNAME)
//     await authWindow.isVisible('div#lightbox input#idSIButton9')
//     await delay(500)
//     await authWindow.locator('div#lightbox input#idSIButton9').click()

//     await authWindow.isVisible('input#i0118')
//     await delay(500)
//     await authWindow.locator('input#i0118').fill(process.env.XBOX_PASSWORD)
//     await authWindow.isVisible('input#idSIButton9')
//     await delay(500)
//     await authWindow.locator('input#idSIButton9').click()

//     await appWindow.isVisible('div#component_header')
//     await delay(500)
//     await expect(appWindow.locator('div#component_header a[href="/profile"]')).toHaveText('GreenlightE2E')
// })

// test('Is still authenticated', async () => {
//     await expect(appWindow.locator('div#component_header a[href="/profile"]')).toHaveText('GreenlightE2E')
// })

test.afterAll('Setup', async () => {
    // await appWindow.screenshot({path: 'screenshots/final-screen.png'})
    // await delay(30*1000)
    if(electronApp !== undefined)
        await electronApp.close()
})
