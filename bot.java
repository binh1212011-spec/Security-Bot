import net.dv8tion.jda.api.JDABuilder;
import net.dv8tion.jda.api.entities.Activity;
import net.dv8tion.jda.api.hooks.ListenerAdapter;
import javax.security.auth.login.LoginException;

public class Bot {
    public static void main(String[] args) throws LoginException {
        String token = System.getenv("DISCORD_TOKEN");
        JDABuilder.createDefault(token)
                .addEventListeners(new BotListener())
                .setActivity(Activity.playing("Sol's RNG Security"))
                .build();
    }
}
