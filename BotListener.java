import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import net.dv8tion.jda.api.entities.Message;
import net.dv8tion.jda.api.entities.TextChannel;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.events.message.MessageReceivedEvent;
import net.dv8tion.jda.api.hooks.ListenerAdapter;
import net.dv8tion.jda.api.interactions.commands.build.Commands;
import net.dv8tion.jda.api.EmbedBuilder;

import java.io.*;
import java.lang.reflect.Type;
import java.time.Instant;
import java.time.Duration;
import java.util.*;

public class BotListener extends ListenerAdapter {

    private final String WARNINGS_FILE = "warnings.json";
    private Map<String, Integer> warnings = new HashMap<>();
    private List<Rule> rules = new ArrayList<>();
    private Gson gson = new Gson();

    public BotListener() {
        loadWarnings();
        loadRules();
    }

    // Load warning points
    private void loadWarnings() {
        try {
            File file = new File(WARNINGS_FILE);
            if(!file.exists()) return;
            Reader reader = new FileReader(file);
            Type type = new TypeToken<Map<String, Integer>>(){}.getType();
            warnings = gson.fromJson(reader,type);
            reader.close();
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    private void saveWarnings() {
        try {
            Writer writer = new FileWriter(WARNINGS_FILE);
            gson.toJson(warnings, writer);
            writer.close();
        } catch(IOException e) {
            e.printStackTrace();
        }
    }

    // Sample rules (can load from JSON)
    private void loadRules() {
        rules.add(new Rule("Bad Word", Arrays.asList("badword1","badword2"), 1, null));
        rules.add(new Rule("Suspicious Regex", Collections.emptyList(), 2, "https?://.*"));
    }

    @Override
    public void onMessageReceived(MessageReceivedEvent event) {
        if(event.getAuthor().isBot()) return;
        Message message = event.getMessage();
        String content = message.getContentRaw().toLowerCase();
        boolean violationDetected = false;
        int severity = 0;
        String matchedRule = "";

        // Check rules
        for(Rule rule : rules) {
            for(String kw : rule.keywords) {
                if(content.contains(kw.toLowerCase())) {
                    violationDetected = true;
                    severity = rule.severity;
                    matchedRule = rule.title;
                    break;
                }
            }
            if(rule.regex != null && content.matches("(?i)"+rule.regex)) {
                violationDetected = true;
                severity = rule.severity;
                matchedRule = rule.title;
            }
            if(violationDetected) break;
        }

        // Check links
        if(content.matches(".*https?://.*")) {
            violationDetected = true;
            severity = 1;
            matchedRule = "Suspicious Link";
        }

        // Check attachments
        message.getAttachments().forEach(att -> {
            String url = att.getUrl().toLowerCase();
            if(url.endsWith(".jpg")||url.endsWith(".png")||url.endsWith(".gif")) {
                violationDetected = true;
                severity = 1;
                matchedRule = "Image Uploaded";
            }
        });

        if(violationDetected) {
            String uid = event.getAuthor().getId();
            warnings.put(uid, warnings.getOrDefault(uid,0)+severity);
            saveWarnings();

            // Reply warning
            event.getChannel().sendMessage("⚠️ Violation detected: **"+matchedRule+"**. Warning points: "+warnings.get(uid)).queue();

            // Log embed
            EmbedBuilder embed = new EmbedBuilder();
            embed.setTitle("⚠️ Violation Detected")
                    .addField("User","<@"+uid+">",true)
                    .addField("Rule",matchedRule,true)
                    .addField("Warning Points",String.valueOf(warnings.get(uid)),true)
                    .setColor(0xFF0000)
                    .setTimestamp(Instant.now());
            TextChannel logChannel = event.getGuild().getTextChannelById(System.getenv("MOD_LOG_CHANNEL_ID"));
            if(logChannel!=null) logChannel.sendMessageEmbeds(embed.build()).queue();

            // Automatic punishments
            try {
                if(warnings.get(uid)==2) event.getGuild().timeoutFor(event.getMember(), Duration.ofHours(1), "2 WP Mute").queue();
                else if(warnings.get(uid)==3) event.getGuild().timeoutFor(event.getMember(), Duration.ofHours(12), "3 WP Mute").queue();
                else if(warnings.get(uid)==4) event.getGuild().timeoutFor(event.getMember(), Duration.ofHours(24), "4 WP Mute").queue();
                else if(warnings.get(uid)>=5) event.getGuild().ban(event.getMember(),0,"5 WP Ban").queue();
            } catch(Exception e){ e.printStackTrace(); }
        }
    }

    @Override
    public void onSlashCommandInteraction(SlashCommandInteractionEvent event) {
        String uid = event.getOption("user") != null ? event.getOption("user").getAsUser().getId() : null;

        switch(event.getName()) {
            case "warnings":
                int points = uid != null ? warnings.getOrDefault(uid,0) : 0;
                event.reply("User has "+points+" warning points.").queue();
                break;
            case "resetwarnings":
                if(uid!=null) {
                    warnings.put(uid,0);
                    saveWarnings();
                    event.reply("Reset warning points for <@"+uid+">").queue();
                }
                break;
            case "announce":
                String title = event.getOption("title").getAsString();
                String content = event.getOption("content").getAsString();
                EmbedBuilder embed = new EmbedBuilder();
                embed.setTitle(title)
                        .setDescription(content)
                        .setColor(0x303030)
                        .setTimestamp(Instant.now());
                event.getChannel().sendMessageEmbeds(embed.build()).queue();
                event.reply("Announcement sent!").setEphemeral(true).queue();
                break;
            case "topviolators":
                List<Map.Entry<String,Integer>> sorted = new ArrayList<>(warnings.entrySet());
                sorted.sort((a,b)->b.getValue()-a.getValue());
                StringBuilder desc = new StringBuilder();
                for(int i=0;i<Math.min(10,sorted.size());i++){
                    Map.Entry<String,Integer> e = sorted.get(i);
                    desc.append("<@").append(e.getKey()).append(">: ").append(e.getValue()).append("\n");
                }
                if(desc.length()==0) desc.append("No violators yet.");
                EmbedBuilder topEmbed = new EmbedBuilder();
                topEmbed.setTitle("Top Violators")
                        .setDescription(desc.toString())
                        .setColor(0xFFAA00)
                        .setTimestamp(Instant.now());
                event.replyEmbeds(topEmbed.build()).queue();
                break;
        }
    }

    // Inner class for rule
    private static class Rule {
        String title;
        List<String> keywords;
        int severity;
        String regex;
        public Rule(String title, List<String> keywords, int severity, String regex){
            this.title = title;
            this.keywords = keywords;
            this.severity = severity;
            this.regex = regex;
        }
    }
}
