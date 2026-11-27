import { createAvatar } from '@dicebear/core'
import { lorelei } from '@dicebear/collection'
import { Resvg } from '@resvg/resvg-js'
import fs from 'node:fs'
const F = [10, 13, 14, 15, 16, 18, 19, 21, 23, 24, 29, 31, 32, 35, 40, 41, 45, 48]
const M = [1, 2, 3, 4, 6, 7, 8, 9, 25, 12, 20, 22, 38, 27, 36, 39, 44, 47]
const SKIN = ['f8d9c4', 'f1c7a8', 'e9b993', 'f6e0cf', 'd9a47f', 'c98e69']
const HAIR = ['2a2733', '3b2a22', '5a3a28', '7a4a2c', '2a2733', '4b3a6b']
const BG = ['dbeafe', 'fce7f3', 'dcfce7', 'fef3c7', 'ede9fe', 'cffafe', 'ffe4e6', 'e0e7ff', 'fae8ff', 'd1fae5', 'fef9c3', 'e0f2fe']
const MOUTH = ['happy01', 'happy02', 'happy03', 'happy04', 'happy05', 'happy06', 'happy08', 'happy09', 'happy10', 'happy11']
const out = process.argv[2]
fs.mkdirSync(out, { recursive: true })
const list = []
const make = (g, hair, i) => {
  const id = `${g}${String(i + 1).padStart(2, '0')}`
  const svg = createAvatar(lorelei, {
    seed: id, hair: [`variant${String(hair).padStart(2, '0')}`], mouth: [MOUTH[(i * 5 + (g === 'm' ? 3 : 0)) % MOUTH.length]],
    skinColor: [SKIN[(i * 7 + (g === 'm' ? 2 : 0)) % SKIN.length]], hairColor: [g === 'm' ? HAIR.slice(0, 4)[(i * 3 + 1) % 4] : HAIR[(i * 5) % HAIR.length]],
    backgroundColor: [BG[(i * 5 + (g === 'm' ? 6 : 0)) % BG.length]], beardProbability: g === 'm' && i % 6 === 5 ? 100 : 0,
    earringsProbability: g === 'f' && i % 4 === 1 ? 100 : 0, glassesProbability: i % 7 === 3 ? 100 : 0, frecklesProbability: 0, hairAccessoriesProbability: g === 'f' && i % 9 === 4 ? 100 : 0,
    scale: 92, translateY: 4,
  }).toString()
  fs.writeFileSync(`${out}/${id}.png`, new Resvg(svg, { fitTo: { mode: 'width', value: 256 } }).render().asPng())
  list.push({ id, g, svg })
}
F.forEach((h, i) => make('f', h, i))
M.forEach((h, i) => make('m', h, i))
// 预览
const cols = 9, cell = 120
let body = ''
list.forEach((a, i) => { body += a.svg.replace(/^<svg /, `<svg x="${(i % cols) * cell}" y="${Math.floor(i / cols) * (cell + 18)}" width="${cell - 8}" height="${cell - 8}" `) + `<text x="${(i % cols) * cell + 4}" y="${Math.floor(i / cols) * (cell + 18) + cell + 6}" font-size="13" font-family="sans-serif">${a.id}</text>` })
fs.writeFileSync('preview.png', new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cell}" height="${Math.ceil(list.length / cols) * (cell + 18)}"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`).render().asPng())
console.log(list.length)
