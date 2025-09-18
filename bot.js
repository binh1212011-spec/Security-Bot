// ==== IMPORT MODULES ====
const fs = require('fs');
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const express = require('express');
const Sentiment = require('sentiment'); // sentiment analysis miễn phí
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
let warnings = {}; // {userId: warningCount}
let lastMessages = {}; // {userId: [timestamps]} để check flooding

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

// Kiểm tra vi phạm rules
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

  // Giữ lại 10s gần nhất
  lastMessages[userId] = lastMessages[userId].filter(ts => now - ts <= 10000);

  if (lastMessages[userId].length >= 5) { // 5 tin nhắn trong 10s → flooding
    violation = rules.find(r => r.name.toLowerCase().includes('flood'));
    return violation;
  }

  // ---- 3. Toxicity detection ----
  if (sentiment.score < -2) { // negative sentiment
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

// Áp dụng hình phạt dựa trên warningLevel
async function applyPunishment(member, violation) {
  if (!violation) return;
  const userId = member.id;
  warnings[userId] = warnings[userId] ? warnings[userId] + 1 : 1;

  console.log(`User ${member.user.tag} violated rule: ${violation.name}. Total warnings: ${warnings[userId]}`);

  try {
    if (violation.warningLevel === 'instant') {
      await member.ban({ reason: violation.name });
      console.log(`${member.user.tag} was banned instantly`);
    } else if (violation.warningLevel === 3 && warnings[userId] >= 3) {
      await member.kick();
      console.log(`${member.user.tag} was kicked after 3 warnings`);
      warnings[userId] = 0;
    } else if (violation.warningLevel === 2 && warnings[userId] >= 2) {
      // Mute user (cần role "Muted" trong server)
      const muteRole = member.guild.roles.cache.find(r => r.name.toLowerCase() === 'muted');
      if (muteRole) await member.roles.add(muteRole);
      console.log(`${member.user.tag} was muted for 2 warnings`);
    } else {
      // Just warn
      member.send(`⚠️ You violated rule: **${violation.name}**. Please follow server rules.`);
    }
  } catch (err) {
    console.error('Error applying punishment:', err);
  }
}

// ==== BOT EVENTS ====
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const violation = checkViolation(message);
  if (violation) {
    await applyPunishment(message.member, violation);
  }

  // Optional: command !warnings
  if (message.content.toLowerCase() === '!warnings') {
    const userWarnings = warnings[message.author.id] || 0;
    message.reply(`You have ${userWarnings} warning(s).`);
  }
});

// ==== LOGIN BOT ====
client.login(process.env.TOKEN);
