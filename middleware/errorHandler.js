module.exports = {
    async wrapCommand(command, msg, args, client) {
      try {
        await command.execute(msg, args, client);
      } catch (error) {
        console.error(`Command ${command.name} error:`, error);
        
        // Send user-friendly error
        const errorMessage = {
          content: "❌ Oops! Something went wrong. Our team has been notified.",
          messageReference: { messageID: msg.id }
        };
  
        // In production, send to monitoring service
        if (process.env.SENTRY_DSN) {
          const Sentry = require('@sentry/node');
          Sentry.captureException(error, {
            user: { id: msg.author.id },
            tags: { command: command.name }
          });
        }
  
        try {
          await msg.channel.createMessage(errorMessage);
        } catch (e) {
          console.error("Failed to send error message:", e);
        }
      }
    },
  
    async withTimeout(promise, timeoutMs = 30000) {
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Operation timed out')), timeoutMs)
      );
      
      return Promise.race([promise, timeout]);
    }
  };