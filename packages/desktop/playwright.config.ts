import { PlaywrightTestConfig } from '@playwright/test'

const config: PlaywrightTestConfig = {
    testDir: 'tests/',
    testMatch: [
        '*.spec.ts',
    ],
    timeout: 60000,
    workers: 1,
    expect: {
        toMatchSnapshot: { threshold: 0.2 },
    },
    webServer: {
        command: 'corepack yarn test-serve',
        url: 'http://127.0.0.1:3000/home.html',
        reuseExistingServer: false,
        timeout: 60000,
    },
}

export default config
