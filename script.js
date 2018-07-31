import fs from 'mz/fs'
import path from 'path'
import * as vm from 'vm'
import crypto from 'crypto'
import request from 'request-promise-native'

const CACHE_DIRECTORY = path.resolve('.cache', 'script')
if (!fs.existsSync(CACHE_DIRECTORY)) fs.mkdir(CACHE_DIRECTORY)

export function getCacheName (url) {
  const hash = crypto.createHash('sha512')
  hash.update(url)
  return hash.digest('hex')
}

const moduleCache = {}

export async function updateScript (url, context) {
  moduleCache[context.guild.id] = moduleCache[context.guild.id] || {}
  delete moduleCache[context.guild.id][url]
  const cacheName = getCacheName(url)
  const cacheFile = path.resolve(CACHE_DIRECTORY, cacheName + '.js')
  const metaFile = path.resolve(CACHE_DIRECTORY, cacheName + '.meta.json')
  const res = await request(url, {resolveWithFullResponse: true, encoding: null})
  const meta = {issuer: context.issuer, url, time: new Date().toISOString(), size: res.body.length}
  await fs.writeFile(metaFile, JSON.stringify(meta, null, 2))
  await fs.writeFile(cacheFile, res.body)
  return res.body.toString('utf8')
}

export async function getModule (url, context) {
  moduleCache[context.guild.id] = moduleCache[context.guild.id] || {}
  if (moduleCache[context.guild.id][url]) return moduleCache[context.guild.id][url]
  const source =
`import def from '${url}'
async function main (context) {
  console.log(def)
  if (typeof def === 'function') await def(context)
}
main
`
  const ctx = createContext({guild: context.guild, settings: context.settings})
  const mod = new vm.Module(source, {context: ctx})
  await mod.link(async (spec, ref) => {
    const url = new URL(spec, ref.url).toString()
    if (moduleCache[context.guild.id][url]) return moduleCache[context.guild.id][url]
    const code = await getScript(url, context)
    const mod = new vm.Module(code, {url, context: ctx})
    moduleCache[context.guild.id][url] = mod
    return mod
  })
  await mod.instantiate()
  moduleCache[context.guild.id][url] = mod
  return mod
}

export async function getScript (url, context) {
  const cacheName = getCacheName(url)
  const cacheFile = path.resolve(CACHE_DIRECTORY, cacheName + '.js')
  const metaFile = path.resolve(CACHE_DIRECTORY, cacheName + '.meta.json')
  if (!(await fs.exists(metaFile))) return updateScript(url, context)
  return fs.readFile(cacheFile, 'utf8')
}

export function makeGlobal (g) {
  const gnew = {global: undefined, ...g}
  gnew.global = gnew
  return gnew
}

export function createContext (context = {}) {
  return vm.createContext(makeGlobal(context))
}

export async function execute (url, context) {
  const code = await getScript(url)
  vm.runInContext(code, createContext(context), {
    timeout: 100
  })
}
