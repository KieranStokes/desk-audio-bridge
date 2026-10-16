const path = require('node:path')
const {spawnSync} = require('node:child_process')
function prepare(){
const root = path.resolve(__dirname, '../../..')
// Workspace-level dependency commands can restore pristine package contents
// without running the repository's postinstall. Always reapply tracked patches.
for(const [script, args, cwd] of [
    [require.resolve('patch-package'), ['--error-on-fail'], root],
    [path.join(__dirname, 'generate-brand.cjs'), [], path.resolve(__dirname, '..')],
    [path.join(__dirname, 'license-inventory.cjs'), [], path.resolve(__dirname, '..')],
]){
    const result = spawnSync(process.execPath, [script, ...args], {cwd, stdio: 'inherit', windowsHide: true})
    if(result.error)
        throw result.error
    if(result.status !== 0)
        process.exit(result.status || 1)
}
}
module.exports = prepare
if(require.main === module)
    prepare()
