import fs from 'mz/fs'

export function onChange (obj, callback, prefix, baseObj = obj) {
  return new Proxy(obj, {
    set (base, key, value) {
      if (typeof value === 'object') value = onChange(value, callback, baseObj)
      base[key] = value
      callback(baseObj, value, base, key)
      return true
    },
    get (base, key) {
      let value = obj[key]
      if (typeof value === 'object') value = onChange(value, callback, baseObj)
      return value
    }
  })
}

export async function loadSettings (filename, defaultSettings = {}, ...jsonArgs) {
  if (!jsonArgs.length) jsonArgs.push(null, 2)
  const save = obj => {
    fs.writeFileSync(filename, JSON.stringify(obj, ...jsonArgs))
  }
  const data = await fs.exists(filename) ? JSON.parse(await fs.readFile(filename, 'utf8')) : defaultSettings
  if (data === defaultSettings) await save(data)
  return onChange(data, save)
}
