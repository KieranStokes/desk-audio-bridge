const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const spdx = require('spdx-expression-parse')

const desktop = path.resolve(__dirname, '..')
const root = path.resolve(desktop, '../..')
const manifest = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8'))
const rendererRoots = ['next', 'react', 'react-dom', 'react-query', 'react-i18next', '@babel/runtime-corejs3', 'core-js-pure']
const sourceDirectory = path.join(desktop, 'resources/license-sources')
const declarations = JSON.parse(fs.readFileSync(path.join(sourceDirectory, 'declarations.json'), 'utf8'))
const permissive = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'BlueOak-1.0.0', 'CC0-1.0', 'Unlicense', 'Python-2.0', 'Zlib', 'CC-BY-4.0', 'OFL-1.1'])

function chooseLicense(expression){
    try {
        function choose(node){
            if(node.license)
                return permissive.has(node.license) && !node.exception ? node.license : undefined
            const left = choose(node.left)
            const right = choose(node.right)
            return node.conjunction === 'or' ? left || right : left && right ? `${left} AND ${right}` : undefined
        }
        return choose(spdx(expression))
    } catch { return undefined }
}

function resolvePackage(name, start){
    let directory = start
    while(true){
        const candidate = path.join(directory, 'node_modules', name, 'package.json')
        if(fs.existsSync(candidate))
            return fs.realpathSync(path.dirname(candidate))
        const parent = path.dirname(directory)
        if(parent === directory)
            return undefined
        directory = parent
    }
}

function legalFiles(directory, prefix = ''){
    const files = []
    for(const entry of fs.readdirSync(directory, {withFileTypes: true})){
        if(entry.name === 'node_modules' || entry.name.startsWith('.'))
            continue
        const relative = path.posix.join(prefix, entry.name)
        const absolute = path.join(directory, entry.name)
        if(entry.isDirectory())
            files.push(...legalFiles(absolute, relative))
        else if(/^(licen[cs]e|copying|copyright|notice)([._-]|$)/i.test(entry.name))
            files.push({name: relative, text: fs.readFileSync(absolute, 'utf8')})
    }
    return files
}

function inventory(){
    const records = new Map()
    const visited = new Set()
    function visit(name, parent, optional = false){
        const directory = resolvePackage(name, parent)
        if(!directory){
            if(optional)
                return
            throw new Error(`Required dependency is missing: ${name}`)
        }
        if(visited.has(directory))
            return
        visited.add(directory)
        const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
        const key = `${pkg.name}@${pkg.version}`
        if(!records.has(key)){
            const expression = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type || pkg.licenses?.map(item => item.type).join(' OR ') || 'UNKNOWN'
            const record = {
                name: pkg.name, version: pkg.version, license: expression, selectedLicense: chooseLicense(expression),
                repository: typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url,
                author: typeof pkg.author === 'string' ? pkg.author : pkg.author?.name,
                files: legalFiles(directory),
            }
            const declaration = declarations[key]
            if(record.files.length === 0 && declaration){
                let terms
                if(declaration.relatedLicense)
                    terms = fs.readFileSync(path.join(root, 'node_modules', declaration.relatedLicense), 'utf8')
                else if(declaration.licenseFile)
                    terms = fs.readFileSync(path.join(sourceDirectory, declaration.licenseFile), 'utf8')
                else if(expression === 'MIT')
                    terms = 'MIT License\n\n' + fs.readFileSync(path.join(root, 'LICENSE'), 'utf8').split('Permission is hereby granted')[1].replace(/^/, 'Permission is hereby granted')
                else if(expression === 'ISC')
                    terms = fs.readFileSync(path.join(sourceDirectory, 'ISC-terms.txt'), 'utf8')
                else
                    throw new Error(`No reviewed license text source for ${key}`)
                record.declaration = declaration
                record.files.push({name: 'SUPPLEMENTAL-LICENSE-NOTICE.txt', text: `${declaration.note}\nSource: ${declaration.source}\nAuthor attribution: ${record.author || pkg.homepage || 'React contributors'}\n\n${terms}`})
            }
            records.set(key, record)
        }
        const optionalDependencies = pkg.optionalDependencies || {}
        for(const dependency of Object.keys(pkg.dependencies || {}))
            visit(dependency, directory, dependency in optionalDependencies)
        // Next is statically exported. Its native image/compiler tooling is
        // build-only and is never redistributed in the renderer.
        for(const dependency of pkg.name === 'next' ? [] : Object.keys(optionalDependencies))
            if(!(dependency in (pkg.dependencies || {})))
                visit(dependency, directory, true)
    }
    for(const dependency of new Set([...Object.keys(manifest.dependencies), ...rendererRoots]))
        visit(dependency, desktop)
    return [...records.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`))
}

function generate(){
    const records = inventory()
    const missingText = records.filter(record => record.files.length === 0).map(record => `${record.name}@${record.version}`)
    const unreviewed = records.filter(record => !record.selectedLicense).map(record => ({package: `${record.name}@${record.version}`, license: record.license}))
    const supplementalNotices = records.filter(record => record.declaration).map(record => `${record.name}@${record.version}`)
    const summary = {packageCount: records.length, missingText, unreviewed, supplementalNotices}
    console.log(JSON.stringify(summary, null, 2))
    if(process.argv.includes('--inspect'))
        return
    if(missingText.length || unreviewed.length)
        throw new Error('License inventory is incomplete; review the packages above before building a distribution.')
    const destination = path.join(desktop, 'resources', 'legal')
    fs.mkdirSync(destination, {recursive: true})
    const sections = records.map(record => [
        '='.repeat(72), `${record.name}@${record.version}`, `Declared license: ${record.license}`, `Selected license: ${record.selectedLicense}`,
        `Source: ${record.repository || 'npm package archive'}`, '',
        ...record.files.flatMap(file => [`--- ${file.name} ---`, file.text.trim(), '']),
    ].join('\n'))
    const upstream = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8')
    const notices = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')
    fs.writeFileSync(path.join(destination, 'THIRD-PARTY-LICENSES.txt'), `${notices}\n\nGreenlight license\n\n${upstream}\n\n${sections.join('\n')}\n`)
    const packages = records.map(({files, ...record}) => ({...record, files: files.map(file => ({name: file.name, sha256: crypto.createHash('sha256').update(file.text).digest('hex')}))}))
    fs.writeFileSync(path.join(destination, 'dependency-inventory.json'), JSON.stringify({packages}, null, 2) + '\n')
    fs.writeFileSync(path.join(destination, 'license-audit.json'), JSON.stringify(summary, null, 2) + '\n')
}

module.exports = {inventory, generate, chooseLicense}
if(require.main === module)
    generate()
