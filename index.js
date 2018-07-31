import path from 'path'
import Discord from 'discord.js'

import {loadSettings} from './util'
import {getModule} from './script'

(async () => {
  const CONFIG = await loadSettings('./config.json', {
    token: '---',
    defaultGuildSettings: {
      prefix: '!'
    },
    whitelist: []
  })

  const client = new Discord.Client()

  let botMention

  client.on('ready', () => {
    console.log('Ready')
    botMention = '<@' + client.user.id + '>'
  })

  client.on('message', async message => {
    try {
      const {channel} = message
      const {guild} = channel
      const settings = await getGuildSettings(guild, CONFIG.defaultGuildSettings)
      if (!message.content.startsWith(settings.prefix)) {
        if (!message.content.startsWith(botMention)) return
        await handleCommand({message, settings, unprefixed: message.content.replace(/^<@\d+>\s*/, '')})
        return
      }
      await handleCommand({message, settings, unprefixed: message.content.slice(settings.prefix.length)})
    } catch (e) {
      const stack = e.fullStack ? e.stack || String(e) : e.message || String(e)
      message.reply(`an error occurred: \`\`\`${stack.replace(new RegExp(__dirname, 'g'), '<root>')}\`\`\``)
    }
  })

  client.login(CONFIG.token)

  async function handleCommand (context) {
    const {message, settings, unprefixed} = context
    context.channel = message.channel
    context.guild = context.channel.guild
    if (!settings.commands) settings.commands = {}
    const match = unprefixed.match(/^(.*?)(?:\s|$)(.*)$/)
    const command = match[1]
    if (!command) return
    const args = (match[2] || '').split(/\s+/).filter(Boolean)
    context.command = command
    context.args = args
    context.level = getPermissionLevel(context)
    const minLevel = requireLevel.bind(null, context)
    console.log(command, args)
    try {
      switch (command) {
        case 'help': {
          if (args.length === 1) return sendUsage(args[0], context)
          let helpStr = `Built-in commands: \n`
          helpStr += Object.keys(usage).map(name => settings.prefix + name).join('\n')
          const custStr = Object.keys(settings.commands).map(name => settings.prefix + name).join('\n')
          if (custStr) helpStr += '\n\nCustom commands:\n' + custStr
          return message.channel.send(helpStr)
        }
        case 'prefix': {
          if (args.length === 0) return message.reply('the prefix for this guild is `' + settings.prefix + '`')
          if (args.length !== 1) return message.reply('expected 1 argument')
          if (!minLevel(2)) return
          settings.prefix = args[0]
          return message.reply('the prefix is now `' + args[0] + '`')
        }
        case 'error': {
          throw Error('test')
        }
        case 'level': {
          if (args.length === 0) return message.reply('your permission level is ' + context.level)
          const targetLevel = +args[0]
          if (!Number.isInteger(targetLevel)) return message.reply('invalid permission level (must be integer)')
          if (targetLevel > context.level) return message.reply('you\'re not allowed to access permissions above your level')
          if (args.length === 1) return message.reply('you did not specify a command to simulate or user to modify')
          if (/^<@\d+>$/.test(args[1])) {
            const user = args[1].match(/^<@(\d+)>$/)[1]
            if (user === message.author.id) return message.reply('you can\'t modify your own permission level')
            if (!settings.permissions) settings.permissions = {command: {}}
            if (args[2]) {
              if (!settings.permissions.command[args[2]]) settings.permissions.command[args[2]] = {}
              settings.permissions.command[args[2]][user] = targetLevel
              message.reply(`set ${args[1]}'s permission level for ${settings.prefix + args[2]} to ${targetLevel}`)
            } else {
              settings.permissions[user] = targetLevel
              message.reply(`set ${args[1]}'s permission level to ${targetLevel}`)
            }
            return
          }
          return await handleCommand({...context, level: targetLevel, unprefixed: args.slice(1).join(' ')})
        }
        case 'whitelist': {
          if (args.length === 0) return message.reply(`you are ${isWhitelisted(message.author.id) ? '' : 'not '}on the whitelist`)
          if (!minLevel(Infinity)) return
          if (args.length !== 2) return sendUsage('whitelist', context)
          if (!/^<@\d+>$/.test(args[1])) return message.reply('expected a user got `' + args[1] + '`')
          const id = args[1].slice(2, -1)
          switch (args[0]) {
            case 'add':
              CONFIG.whitelist = [...new Set([...CONFIG.whitelist, id])]
              return message.reply(`<@${id}> has been added to the whitelist`)
            case 'remove':
              CONFIG.whitelist = CONFIG.whitelist.filter(x => x !== id)
              return message.reply(`<@${id}> has been removed from the whitelist`)
            case 'get':
              return message.reply(`<@${id}> is ${isWhitelisted(id) ? '' : 'not '}on the whitelist`)
            default: return sendUsage('whitelist', context)
          }
        }
        case 'command': {
          if (args.length < 2) return message.reply(usage)
          const name = args[1]
          if (!minLevel(args[0] === 'info' ? 1 : 2)) return
          switch (args[0]) {
            case 'add':
              if (name in settings.commands) return message.reply('Command `' + name + '` already exists')
              return addCustomCommand(name, args.slice(2), context)
            case 'remove':
              delete settings.commands[name]
              return message.reply('Command `' + name + '` has been removed')
            case 'info': {
              if (usage[name]) return message.reply(`Command \`${name}\`: built-in`)
              const info = settings.commands[name]
              if (!info) return message.reply('Command `' + name + '` does not exist')
              return message.reply(`Command \`${name}\`: \`\`\`json\n${JSON.stringify(info, null, 2)}\`\`\``)
            }
          }
          return sendUsage('command', context)
        }
        default: {
          const custom = settings.commands[command]
          if (!custom) return
          switch (custom.type) {
            case 'text': return message.channel.send(custom.text.replace(/%user/g, `<@${message.author.id}>`))
            case 'script': {
              const mod = await getModule(custom.url, context)
              const {result} = await mod.evaluate()
              return await result(context)
            }
          }
        }
      }
    } catch (e) {
      console.error(e)
      const e1 = e instanceof Error ? e : Error(String(e))
      if (context.level > 1) e1.fullStack = true
      throw e1
    }
  }

  function isWhitelisted (id) {
    return CONFIG.whitelist.includes(id)
  }

  function getPermissionLevel (context) {
    if ('level' in context) return context.level
    const {settings, command} = context
    const {author, guild} = context.message
    if (author.id === CONFIG.owner) return Infinity
    if (author.id === guild.ownerID) return 9001
    let level = CONFIG.whitelist.includes(author.id) ? 1 : 0
    if (settings.permissions) {
      level = settings.permissions[author.id] || level
      if (settings.permissions.command[command]) {
        level = settings.permissions.command[command][author.id] || level
      }
    }
    context.level = level
    return level
  }
})()

const usage = {
  help: [
    'General help: %help',
    'Command usage: %help <command>'
  ],
  prefix: [
    'Get: %prefix', 'Set: %prefix <new prefix>'
  ],
  error: [
    'Cause an error: %error'
  ],
  level: [
    'Get: %level',
    'Execute command: %level <level> <command...>',
    'Set user\'s level: %level <level> <@USER> [command]'
  ],
  whitelist: [
    'Add user: %whitelist add <@USER>',
    'Remove user: %whitelist remove <@USER>',
    'Get status: %whitelist get <@USER>'
  ],
  command: [
    'Add: %command add <name> script <url>',
    'Remove: %command remove <name>',
    'Update cache: %command update <name>',
    'Get info: %command info <name>'
  ]
}

function sendUsage (name, context) {
  const {message, settings} = context
  const arr = usage[name] || (settings.commands[name] || {}).usage
  if (!arr) return message.reply('unknown command `' + name + '`')
  const usageStr = '```\n' + arr.join('\n').replace(/%/g, settings.prefix) + '```'
  message.reply('usage for `' + name + '`: ' + usageStr)
}

function requireLevel (context, lvl) {
  if (context.level >= lvl) return true
  context.message.reply('you don\'t have permission to use this command')
  return false
}

function addCustomCommand (name, args, context) {
  const {settings, message} = context
  if (!requireLevel(context, 2)) return
  if (args.length === 0) return message.reply('command add: expected more arguments')
  switch (args[0]) {
    case 'script': {
      if (args.length !== 2) return message.reply('usage: ' + settings.prefix + 'command add script <url>')
      if (!isValidCommandUrl(args[1])) return message.reply('invalid url')
      settings.commands[name] = {
        type: 'script',
        url: args[1],
        creator: message.author.id
      }
      return message.reply('command `' + name + '` added successfully')
    }
    case 'text': {
      settings.commands[name] = {
        type: 'text',
        text: args.slice(1).join(' '),
        creator: message.author.id
      }
      return message.reply('command `' + name + '` added successfully')
    }
  }
  return sendUsage('command', context)
}

function isValidCommandUrl (url) {
  try {
    const parsed = new URL(url)
    console.log(parsed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch (e) {
    console.error(e)
    if (e instanceof TypeError) return false
    throw e
  }
}

const guildSettings = {}

async function getGuildSettings (guild, defaultGuildSettings) {
  if (typeof guild === 'object') guild = guild.id
  if (guild in guildSettings) return guildSettings[guild]
  const settings = loadGuildSettings(guild)
  guildSettings[guild] = settings
  return settings
}

async function loadGuildSettings (guild, defaultGuildSettings) {
  if (typeof guild === 'object') guild = guild.id
  return loadSettings(path.resolve('guild-settings', guild + '.json'), defaultGuildSettings)
}
