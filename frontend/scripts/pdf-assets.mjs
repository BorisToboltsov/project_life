import { cp, mkdir, readFile } from 'node:fs/promises'

const source = new URL('../node_modules/pdfjs-dist/', import.meta.url)
const { version } = JSON.parse(await readFile(new URL('package.json', source), 'utf8'))
const target = new URL(`../public/pdfjs/${version}/`, import.meta.url)
await mkdir(target, { recursive: true })
for (const directory of ['standard_fonts', 'cmaps', 'wasm', 'iccs']) {
  await cp(new URL(directory, source), new URL(directory, target), { recursive: true })
}
await cp(new URL('LICENSE', source), new URL('LICENSE', target))
