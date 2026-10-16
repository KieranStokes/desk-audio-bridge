const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')

async function main(){
    const desktop = path.resolve(__dirname, '..')
    const svg = fs.readFileSync(path.join(desktop, 'resources/brand.svg'))
    const sizes = [16, 24, 32, 48, 64, 256]
    const frames = await Promise.all(sizes.map(size => sharp(svg).resize(size, size).png().toBuffer()))
    const header = Buffer.alloc(6 + sizes.length * 16)
    header.writeUInt16LE(1, 2)
    header.writeUInt16LE(sizes.length, 4)
    let offset = header.length
    frames.forEach((frame, index) => {
        const entry = 6 + index * 16
        header[entry] = sizes[index] % 256
        header[entry + 1] = sizes[index] % 256
        header.writeUInt16LE(1, entry + 4)
        header.writeUInt16LE(32, entry + 6)
        header.writeUInt32LE(frame.length, entry + 8)
        header.writeUInt32LE(offset, entry + 12)
        offset += frame.length
    })
    fs.writeFileSync(path.join(desktop, 'resources/icon.ico'), Buffer.concat([header, ...frames]))
    fs.writeFileSync(path.join(desktop, 'resources/brand.png'), await sharp(svg).png().toBuffer())
    fs.copyFileSync(path.join(desktop, 'resources/brand.svg'), path.join(desktop, 'renderer/public/brand.svg'))
    console.log('Generated original Desk Audio Bridge icon at six Windows sizes.')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
