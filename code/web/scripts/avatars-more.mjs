import { createAvatar } from '@dicebear/core'
import * as C from '@dicebear/collection'
import { Resvg } from '@resvg/resvg-js'
import fs from 'node:fs'
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true })
const BG = ['dbeafe', 'fce7f3', 'dcfce7', 'fef3c7', 'ede9fe', 'cffafe', 'ffe4e6', 'e0e7ff', 'fae8ff', 'd1fae5', 'fef9c3', 'e0f2fe']
const at = (a, i) => a[i % a.length]
const SETS = {
  av: { style: 'avataaars', n: { f: 14, m: 14 }, opt: (g, i) => ({
    top: [g === 'f' ? at(['bob', 'bun', 'curly', 'curvy', 'longButNotTooLong', 'miaWallace', 'straight01', 'straight02', 'straightAndStrand', 'bigHair', 'frida', 'fro', 'shavedSides', 'curvy'], i) : at(['shortCurly', 'shortFlat', 'shortRound', 'shortWaved', 'sides', 'theCaesar', 'theCaesarAndSidePart', 'shaggy', 'dreads01', 'frizzle', 'shortFlat', 'shortCurly', 'shortWaved', 'dreads02'], i)],
    skinColor: [at(['ffdbb4', 'edb98a', 'd08b5b', 'ae5d29', 'edb98a', '614335', 'ffdbb4'], i + (g === 'm' ? 2 : 0))], hairColor: [at(['2c1b18', '4a312c', '724133', 'a55728', 'b58143', '2c1b18', 'd6b370', 'c93305'], i * 3 + (g === 'm' ? 1 : 0))],
    mouth: [at(['smile', 'twinkle', 'default', 'smile'], i)], eyes: [at(['default', 'happy', 'default', 'wink', 'happy', 'default'], i)], eyebrows: [at(['default', 'defaultNatural', 'raisedExcitedNatural', 'flatNatural'], i)],
    facialHairProbability: g === 'm' && i % 4 === 2 ? 100 : 0, facialHair: ['beardLight', 'beardMedium'], accessoriesProbability: i % 5 === 3 ? 100 : 0, accessories: ['prescription01', 'prescription02', 'round'],
    clothing: [at(['blazerAndShirt', 'collarAndSweater', 'hoodie', 'shirtCrewNeck', 'shirtScoopNeck', 'shirtVNeck', 'blazerAndSweater', 'overall'], i + (g === 'm' ? 3 : 0))],
  }) },
  mi: { style: 'micah', n: { f: 10, m: 10 }, opt: (g, i) => ({
    hair: [g === 'f' ? at(['full', 'pixie', 'dannyPhantom', 'full', 'pixie'], i) : at(['fonze', 'mrT', 'dougFunny', 'mrClean', 'fonze', 'dougFunny'], i)],
    mouth: [at(['smile', 'laughing', 'smirk', 'smile'], i)], eyes: [at(['eyes', 'smiling', 'round', 'eyesShadow'], i)], eyebrows: [g === 'f' ? at(['eyelashesUp', 'up'], i) : at(['up', 'down'], i)],
    baseColor: [at(['f9c9b6', 'fdd7b8', 'e0a990', 'ac6651', 'f9c9b6', '77311d', 'fdd7b8'], i + (g === 'm' ? 3 : 0))], hairColor: [at(['000000', '77311d', 'ac6651', 'f4d150', '000000', 'fc909f', '9287ff', '6bd9e9'], i * 3 + (g === 'm' ? 1 : 0))],
    facialHairProbability: g === 'm' && i % 3 === 1 ? 100 : 0, earringsProbability: g === 'f' && i % 2 === 0 ? 100 : 0, glassesProbability: i % 4 === 3 ? 100 : 0,
  }) },
  th: { style: 'toonHead', n: { f: 8, m: 8 }, opt: (g, i) => ({
    hair: [g === 'f' ? at(['bun', 'sideComed'], i) : at(['sideComed', 'undercut', 'spiky', 'sideComed'], i)], hairProbability: 100,
    rearHair: [at(['longStraight', 'longWavy'], i)], rearHairProbability: g === 'f' ? 100 : 0,
    skinColor: [at(['f1c3a5', 'c68e7a', 'b98e6a', 'f1c3a5', 'a36b4f', '5c3829'], i + (g === 'm' ? 2 : 0))],
    beardProbability: g === 'm' && i % 3 === 2 ? 100 : 0, beard: ['fullBeard', 'chin', 'chinMoustache'],
    mouth: [at(['smile', 'laugh'], i)], eyes: [at(['happy', 'wide', 'bow', 'humble'], i)], eyebrows: [at(['happy', 'neutral', 'raised'], i)],
    clothes: [g === 'f' ? at(['dress', 'turtleNeck', 'openJacket', 'tShirt'], i) : at(['shirt', 'tShirt', 'openJacket', 'turtleNeck'], i)],
  }) },
  pe: { style: 'personas', n: { f: 8, m: 8 }, opt: (g, i) => ({
    hair: [g === 'f' ? at(['long', 'bobCut', 'pigtails', 'curlyBun', 'bobBangs', 'extraLong', 'straightBun', 'curly'], i) : at(['shortCombover', 'buzzcut', 'fade', 'shortComboverChops', 'curlyHighTop', 'balding', 'shortComboverChops', 'mohawk'], i)],
    eyes: [at(['open', 'happy', 'open', 'wink', 'happy', 'glasses'], i)], mouth: [at(['smile', 'bigSmile', 'smile'], i)], skinColor: [at(['eeb4a4', 'e7a391', 'e5a07e', 'd78774', 'b16a5b'], i + (g === 'm' ? 2 : 0))],
    facialHairProbability: g === 'm' && i % 3 === 1 ? 100 : 0, facialHair: ['beardMustache', 'goatee', 'shadow'],
  }) },
  bt: { style: 'bottts', n: { x: 12 }, opt: (g, i) => ({ textureProbability: 0, mouth: [at(['smile01', 'smile02', 'square01', 'bite', 'grill01', 'square02'], i)], eyes: [at(['eva', 'happy', 'roundFrame01', 'round', 'bulging', 'frame1', 'robocop', 'glow', 'shade01', 'hearts', 'roundFrame02', 'sensor'], i)] }) },
}
const only = process.argv[3]
const all = []
for (const [k, s] of Object.entries(SETS)) {
  if (only && only !== k) continue
  for (const [g, n] of Object.entries(s.n)) for (let i = 0; i < n; i++) {
    const id = `${k}-${g === 'x' ? '' : g}${String(i + 1).padStart(2, '0')}`
    const svg = createAvatar(C[s.style], { seed: id, backgroundColor: [at(BG, i * 5 + (g === 'm' ? 6 : 0) + k.length)], ...s.opt(g, i) }).toString()
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: 200 } }).render().asPng()
    fs.writeFileSync(`${out}/${id}.png`, png)
    all.push({ id, png })
  }
}
const cols = 10, cell = 104
let body = ''
all.forEach((a, i) => { body += `<image x="${(i % cols) * cell}" y="${Math.floor(i / cols) * (cell + 16)}" width="${cell - 8}" height="${cell - 8}" href="data:image/png;base64,${a.png.toString('base64')}"/><text x="${(i % cols) * cell + 2}" y="${Math.floor(i / cols) * (cell + 16) + cell + 6}" font-size="12" font-family="sans-serif">${a.id}</text>` })
fs.writeFileSync(`preview-${only ?? 'all'}.png`, new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cell}" height="${Math.ceil(all.length / cols) * (cell + 16)}"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`).render().asPng())
console.log(all.length)
