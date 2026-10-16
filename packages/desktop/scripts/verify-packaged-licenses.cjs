const fs = require('node:fs')
const path = require('node:path')
const asar = require('@electron/asar')

function verify(appOutDir){
    const resources = path.join(appOutDir, 'resources')
    const legal = path.join(resources, 'legal')
    const inventory = JSON.parse(fs.readFileSync(path.join(legal, 'dependency-inventory.json'), 'utf8'))
    const audit = JSON.parse(fs.readFileSync(path.join(legal, 'license-audit.json'), 'utf8'))
    if(audit.missingText.length || audit.unreviewed.length)
        throw new Error('Packaged license audit contains unresolved packages.')
    const covered = new Set(inventory.packages.map(pkg => `${pkg.name}@${pkg.version}`))
    const archive = path.join(resources, 'app.asar')
    const entries = asar.listPackage(archive).map(entry => entry.replace(/\\/g, '/').replace(/^\//, ''))
    const packaged = new Set()
    for(const entry of entries){
        if(!/(^|\/)node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(entry))
            continue
        const pkg = JSON.parse(asar.extractFile(archive, path.normalize(entry)).toString('utf8'))
        if(!pkg.name || !pkg.version)
            continue
        const key = `${pkg.name}@${pkg.version}`
        packaged.add(key)
        if(!covered.has(key))
            throw new Error(`A shipped dependency has no generated license coverage: ${key}`)
    }
    if([...packaged].some(key => key.startsWith('npm@')))
        throw new Error('The unused npm CLI must not be included in this audio utility.')
    const unwanted = entries.filter(entry => /^app\/images\//.test(entry) || /\.(woff2?|ttf|icns|pfx|p12)$/i.test(entry) || /(^|\/)\.env$/.test(entry))
    if(unwanted.length)
        throw new Error(`Unexpected legacy artwork, fonts, or private files in the package: ${unwanted.join(', ')}`)
    for(const file of ['LICENSE-GREENLIGHT.txt', 'THIRD_PARTY_NOTICES.md', 'legal/THIRD-PARTY-LICENSES.txt'])
        if(!fs.statSync(path.join(resources, file)).size)
            throw new Error(`Required notice is empty: ${file}`)
    for(const file of ['LICENSE.electron.txt', 'LICENSES.chromium.html'])
        if(!fs.statSync(path.join(appOutDir, file)).size)
            throw new Error(`Runtime notice is missing: ${file}`)
    console.log(`Packaged license coverage verified: ${packaged.size} shipped Node packages; ${covered.size} inventoried runtime/renderer packages.`)
}

module.exports = async context => {
    if(context.electronPlatformName === 'win32'){
        const {rcedit} = await import('rcedit')
        const branding = require('../branding.json')
        const manifest = require('../package.json')
        await rcedit(path.join(context.appOutDir, `${branding.name}.exe`), {
            icon: path.join(__dirname, '../resources/icon.ico'),
            'file-version': manifest.version,
            'product-version': manifest.version,
            'requested-execution-level': 'asInvoker',
            'version-string': {
                CompanyName: 'Desk Audio Bridge contributors',
                FileDescription: branding.description,
                ProductName: branding.name,
                InternalName: branding.name,
                OriginalFilename: `${branding.name}.exe`,
                LegalCopyright: 'Desk Audio Bridge contributors; based on Greenlight by UnknownSKL (Jim Kroon)',
            },
        })
    }
    verify(context.appOutDir)
}
module.exports.verify = verify
if(require.main === module)
    verify(path.resolve(process.argv[2] || path.join(__dirname, '../dist/win-unpacked')))
