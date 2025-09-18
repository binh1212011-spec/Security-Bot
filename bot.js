// ==== IMPORT MODULES ====
const fs = require('fs');
const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder } = require('discord.js');
const express = require('express');
const Sentiment = require('sentiment');
require('dotenv').config();

// ==== KEEP-ALIVE SERVER ====
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(PORT, () => console.log(`Keep-alive running on port ${PORT}`));

// ==== LOAD RULES ====
let rules = [];
const rulesPath = './rules.json';
if (fs.existsSync(rulesPath)) {
  try {
    rules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8')).rules || [];
    console.log(`Loaded ${rules.length} rules`);
  } catch (err) {
    console.error('Error parsing rules.json:', err);
  }
} else {
  console.log('rules.json not found, starting with empty rules.');
}

// ==== WARNING SYSTEM ====
let warnings = {}; // { userId: [{ timestamp, rule }] }
let lastMessages = {}; // Flooding check

// ==== DISCORD BOT ====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// ==== UTILITY FUNCTIONS ====

// Clean old warnings (30 days)
function cleanOldWarnings() {
  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;

  for (const userId in warnings) {
    warnings[userId] = warnings[userId].filter(w => now - w.timestamp <= thirtyDays);
    if (warnings[userId].length === 0) delete warnings[userId];
  }
}
setInterval(cleanOldWarnings, 60 * 60 * 1000); // mỗi 1h

// Check violation
function checkViolation(message) {
  const userId = message.author.id;
  const content = message.content.toLowerCase();
  const sentiment = new Sentiment().analyze(content);
  let violation = null;

  // ---- 1. Spam / link detection ----
  const spamKeywords = ['buy', 'free', 'discord.gg', 'invite', 'nitro'];
  if (spamKeywords.some(k => content.includes(k))) {
    violation = rules.find(r => r.name.toLowerCase().includes('spam') || r.name.toLowerCase().includes('advertising'));
    return violation;
  }

  // ---- 2. Flooding detection ----
  const now = Date.now();
  if (!lastMessages[userId]) lastMessages[userId] = [];
  lastMessages[userId].push(now);
  lastMessages[userId] = lastMessages[userId].filter(ts => now - ts <= 10000);
  if (lastMessages[userId].length >= 5) { // 5 tin nhắn/10s
    violation = rules.find(r => r.name.toLowerCase().includes('flood'));
    return violation;
  }

  // ---- 3. Toxicity detection ----
  if (sentiment.score < -2) {
    violation = rules.find(r => r.name.toLowerCase().includes('toxicity') || r.name.toLowerCase().includes('discrimination'));
    return violation;
  }

  // ---- 4. Attachment / image NSFW detection ----
  if (message.attachments.size > 0) {
    message.attachments.forEach(att => {
      if (att.contentType && att.contentType.startsWith('image/')) {
        const nsfwRule = rules.find(r => r.name.toLowerCase().includes('nsfw'));
        if (nsfwRule) violation = nsfwRule;
      }
    });
  }

  return violation;
}

// Apply punishment & log
async function applyPunishment(member, violation) {
  if (!violation) return;
  const userId = member.id;
  const now = Date.now();

  if (!warnings[userId]) warnings[userId] = [];
  warnings[userId].push({ timestamp: now, rule: violation.name });

  const userWarns = warnings[userId].length;

  // Log to channel
  const logChannelId = process.env.LOG_CHANNEL_ID;
  const logChannel = member.guild.channels.cache.get(logChannelId);
  if (logChannel) {
    const embed = new EmbedBuilder()
      .setTitle(`⚠️ Violation: ${violation.name}`)
      .addFields(
        { name: 'User', value: `${member.user.tag}`, inline: true },
        { name: 'Warns', value: `${userWarns}`, inline: true },
        { name: 'Warning Level', value: `${violation.warningLevel}` }
      )
      .setColor('Red')
      .setTimestamp();
    logChannel.send({ embeds: [embed] });
  }

  // Apply punishment
  try {
    if (violation.warningLevel === 'instant') {
      await member.ban({ reason: violation.name });
    } else if (violation.warningLevel === 3 && userWarns >= 3) {
      await member.kick();
      warnings[userId] = [];
    } else if (violation.warningLevel === 2 && userWarns >= 2) {
      const muteRole = member.guild.roles.cache.find(r => r.name.toLowerCase() === 'muted');
      if (muteRole) await member.roles.add(muteRole);
    } else {
      member.send(`⚠️ You violated rule: **${violation.name}**. Current warnings: ${userWarns}`);
    }
  } catch (err) {
    console.error('Error applying punishment:', err);
  }
}

// ==== BOT EVENTS ====
client.once('ready', () => console.log(`Logged in as ${client.user.tag}`));

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  // Check violation
  const violation = checkViolation(message);
  if (violation) {
    await applyPunishment(message.member, violation);
  }

  // Command: !warnings
  if (message.content.toLowerCase().startsWith('!warnings')) {
    let target = message.mentions.users.first() || message.author;
    const userWarns = warnings[target.id] ? warnings[target.id].length : 0;
    message.reply(`${target.tag} has ${userWarns} warning(s).`);
  }
});

// ==== LOGIN BOT ====
client.login(process.env.TOKEN);
