const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } = require("discord.js");
const fs = require("fs");
const fetch = require("node-fetch");
const express = require("express");
require("dotenv").config();

// --- Client setup ---
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// --- Keep-alive ---
const app = express();
app.get("/", (req,res)=>res.send("Bot is alive!"));
app.listen(process.env.PORT || 3000, ()=>console.log("Keep-alive server running"));

// --- Load rules, warnings, whitelist ---
const rulesJSON = JSON.parse(fs.readFileSync("rules.json"));
const rules = rulesJSON.rules; // <--- quan trọng: lấy mảng rules
const warningsFile = "warnings.json";
let warnings = fs.existsSync(warningsFile) ? JSON.parse(fs.readFileSync(warningsFile)) : {};
function saveWarnings(){ fs.writeFileSync(warningsFile, JSON.stringify(warnings,null,2)); }

const whitelist = fs.existsSync("imageWhitelist.json") ? JSON.parse(fs.readFileSync("imageWhitelist.json")) : {};
function isWhitelisted(url){
    try{
        const domain = (new URL(url)).hostname;
        return whitelist[url] || whitelist[domain];
    }catch(e){ return false; }
}

// --- Slash commands ---
const commands = [
  new SlashCommandBuilder().setName("warnings").setDescription("View user warning points")
    .addUserOption(opt=>opt.setName("user").setDescription("Target user").setRequired(true)),
  new SlashCommandBuilder().setName("resetwarnings").setDescription("Reset a user's warning points")
    .addUserOption(opt=>opt.setName("user").setDescription("Target user").setRequired(true)),
  new SlashCommandBuilder().setName("announce").setDescription("Send an embed announcement")
    .addStringOption(opt=>opt.setName("title").setDescription("Title").setRequired(true))
    .addStringOption(opt=>opt.setName("content").setDescription("Content").setRequired(true)),
  new SlashCommandBuilder().setName("topviolators").setDescription("Show top 10 users with warning points")
];

const rest = new REST({version:"10"}).setToken(process.env.DISCORD_TOKEN);
client.once("ready", async ()=>{
    try{
        await rest.put(Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID), {body: commands});
        console.log(`${client.user.tag} ready!`);
    }catch(e){ console.log("Error registering commands:",e);}
});

// --- Hugging Face Text Moderation ---
async function checkMessageAI(content){
    try{
        const res = await fetch("https://api-inference.huggingface.co/models/KoalaAI/Text-Moderation", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.HF_API_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({inputs: content})
        });
        const data = await res.json();
        // data sẽ có flagged: true/false, categories: [...]
        return data;
    }catch(e){ console.log("HF moderation error:", e); return {flagged:false}; }
}

// --- Handle messages ---
client.on("messageCreate", async message=>{
    if(message.author.bot) return;

    let violationDetected=false;
    let severity=0;
    let matchedRule="";

    // --- Check rules.json ---
    for(const rule of rules){
        // dùng description và keywords nếu muốn
        if(rule.keywords){
            for(const kw of rule.keywords){
                if(message.content.toLowerCase().includes(kw.toLowerCase())){
                    violationDetected=true;
                    severity += rule.warningLevel || 1;
                    matchedRule=rule.name || rule.title || "Rule match";
                    break;
                }
            }
        }
        if(violationDetected) break;
    }

    // --- Check AI text ---
    try{
        const result = await checkMessageAI(message.content);
        if(result.flagged){
            violationDetected=true;
            severity += 1;
            matchedRule = (matchedRule ? matchedRule+", " : "") + (result.categories?.join(", ") || "AI flagged");
        }
    }catch(err){ console.log("AI text check error:",err); }

    // --- Check images ---
    if(message.attachments.size>0){
        for(const att of message.attachments.values()){
            if(isWhitelisted(att.url)) continue;
            // Nếu muốn check AI ảnh, thêm code API tương tự HF hoặc ModerationAPI
        }
    }

    // --- If violation detected ---
    if(violationDetected){
        const uid = message.author.id;
        warnings[uid] = (warnings[uid]||0)+severity;
        saveWarnings();

        // DM user
        try{ await message.author.send(`⚠️ You received ${severity} WP for: ${matchedRule}. Total WP: ${warnings[uid]}`);}catch(e){}

        message.reply(`⚠️ Violation detected: ${matchedRule}. Warning points: ${warnings[uid]}`);

        // Log to mod channel
        const embed = new EmbedBuilder()
            .setTitle("⚠️ User Violation / Action Taken")
            .addFields(
                {name:"User", value:`<@${uid}>`},
                {name:"Rule / AI Categories", value: matchedRule},
                {name:"Warning Points", value: warnings[uid].toString()}
            )
            .setColor("#FF0000")
            .setTimestamp();

        const logChannel = await client.channels.fetch(process.env.MOD_LOG_CHANNEL_ID);
        logChannel.send({embeds:[embed]});

        // Auto punishment
        const member = await message.guild.members.fetch(uid);
        let actionTaken="";
        try{
            if(warnings[uid] === 2){ await member.timeout(60*60*1000,"2 WP Mute"); actionTaken="Muted 1h";}
            else if(warnings[uid] === 3){ await member.timeout(12*60*60*1000,"3 WP Mute"); actionTaken="Muted 12h";}
            else if(warnings[uid] === 4){ await member.timeout(24*60*60*1000,"4 WP Mute"); actionTaken="Muted 1d";}
            else if(warnings[uid] >= 5){ await member.ban({reason:"5 WP Ban"}); actionTaken="Banned";}
        }catch(e){ console.log(e); }

        if(actionTaken){
            const actionEmbed = new EmbedBuilder()
                .setTitle("🛡️ Action Taken")
                .addFields(
                    {name:"User", value:`<@${uid}>`},
                    {name:"Action", value: actionTaken},
                    {name:"Reason", value: matchedRule},
                    {name:"Warning Points", value: warnings[uid].toString()}
                )
                .setColor("#FFAA00")
                .setTimestamp();
            logChannel.send({embeds:[actionEmbed]});
        }
    }
});

// --- Slash commands ---
client.on("interactionCreate", async interaction=>{
    if(!interaction.isChatInputCommand()) return;
    const uid = interaction.options.getUser("user")?.id;
    if(interaction.commandName==="warnings"){
        await interaction.reply(`User has ${warnings[uid]||0} warning points.`);
    }else if(interaction.commandName==="resetwarnings"){
        warnings[uid]=0;
        saveWarnings();
        await interaction.reply(`Reset warning points for <@${uid}>.`);
    }else if(interaction.commandName==="announce"){
        const title = interaction.options.getString("title");
        const content = interaction.options.getString("content");
        const embed = new EmbedBuilder().setTitle(title).setDescription(content).setColor("#303030").setTimestamp();
        await interaction.channel.send({embeds:[embed]});
        await interaction.reply({content:"Announcement sent!",ephemeral:true});
    }else if(interaction.commandName==="topviolators"){
        const sorted = Object.entries(warnings).sort((a,b)=>b[1]-a[1]).slice(0,10);
        let desc = sorted.map(([id,pts])=>`<@${id}>: ${pts}`).join("\n") || "No violators yet.";
        const embed = new EmbedBuilder().setTitle("Top Violators").setDescription(desc).setColor("#FFAA00").setTimestamp();
        await interaction.reply({embeds:[embed]});
    }
});

client.login(process.env.DISCORD_TOKEN);
