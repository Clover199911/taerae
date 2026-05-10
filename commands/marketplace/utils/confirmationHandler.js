// marketplace/utils/confirmationHandler.js – Reusable confirmation dialog
// Handles user confirmations with buttons for marketplace actions
// ============================================================================

const CONFIRMATION_TIMEOUT = 30000; // 30 seconds
const activeCollectors = new Map();

// Periodic cleanup for stale collectors (safety net)
setInterval(() => {
  // activeCollectors should auto-cleanup via timeout, but this is a safety net
  if (activeCollectors.size > 100) {
    console.warn('[CONFIRMATION_HANDLER] activeCollectors has grown large, clearing stale entries');
    activeCollectors.clear();
  }
}, 300000); // 5 minutes

/**
 * Confirmation handler class for marketplace actions
 * Shows a confirmation dialog with ✅ Confirm and ❌ Cancel buttons
 */
class ConfirmationHandler {
  constructor(client, msg, embed, onConfirm, onCancel = null) {
    this.client = client;
    this.msg = msg;
    this.embed = embed;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
    this.messageId = null;
    this.isActive = true;
  }

  /**
   * Shows the confirmation dialog and waits for user response
   * @returns {Promise<boolean>} True if confirmed, false if cancelled/timeout
   */
  async show() {
    try {
      // Send confirmation message with buttons
      const confirmationMessage = await this.msg.channel.createMessage({
        embeds: [this.embed],
        messageReference: { messageID: this.msg.id },
        components: [{
          type: 1,
          components: [
            {
              type: 2,
              style: 3, // Green
              custom_id: "confirm",
              emoji: { id: '1461015775266603110', name: 'check' }

            },
            {
              type: 2,
              style: 4, // Red
              custom_id: "cancel",
              emoji: { id: '1461015696954753034', name: 'cross' }
            }
          ]
        }]
      });

      this.messageId = confirmationMessage.id;

      return new Promise((resolve) => {
        const collector = async (interaction) => {
          // Ignore if wrong message or wrong user
          if (!this.isActive) return;
          if (interaction.message.id !== this.messageId) return;
          if (interaction.member.id !== this.msg.author.id) return;

          this.isActive = false;

          try {
            // Acknowledge interaction immediately
            await interaction.acknowledge();

            // Show loading state
            await this.client.editMessage(
              this.msg.channel.id,
              this.messageId,
              {
                embeds: [{
                  title: "⏳ Processing",
                  description: "Please wait...",
                  color: 0xCAF0F8
                }],
                components: []
              }
            );

            if (interaction.data.custom_id === "confirm") {
              // Execute confirmation callback
              const result = await this.onConfirm();
              
              await this.client.editMessage(
                this.msg.channel.id,
                this.messageId,
                { ...result, components: [] }
              );
              
              resolve(true);
            } else {
              // Handle cancellation
              const cancelResult = this.onCancel 
                ? await this.onCancel() 
                : { 
                    embeds: [{
                      title: "❌ Cancelled",
                      description: "Action cancelled.",
                      color: 0xFF6B6B
                    }]
                  };
              
              await this.client.editMessage(
                this.msg.channel.id,
                this.messageId,
                { ...cancelResult, components: [] }
              );
              
              resolve(false);
            }
          } catch (error) {
            console.error("Confirmation handler error:", error);
            
            // Show error message
            await this.client.editMessage(
              this.msg.channel.id,
              this.messageId,
              {
                embeds: [{
                  title: "❌ Error",
                  description: error.message || "An error occurred. Please try again.",
                  color: 0xFF6B6B
                }],
                components: []
              }
            ).catch(() => {});
            
            resolve(false);
          } finally {
            this.cleanup();
          }
        };

        // Register event listener
        this.client.on("interactionCreate", collector);
        activeCollectors.set(this.messageId, collector);

        // Setup timeout
        setTimeout(() => {
          if (this.isActive) {
            this.cleanup();
            
            // Remove buttons on timeout
            this.client.editMessage(
              this.msg.channel.id,
              this.messageId,
              { components: [] }
            ).catch(() => {});
            
            resolve(false);
          }
        }, CONFIRMATION_TIMEOUT);
      });
      
    } catch (error) {
      console.error("Error showing confirmation:", error);
      return false;
    }
  }

  /**
   * Cleans up event listeners and active collectors
   */
  cleanup() {
    this.isActive = false;
    
    const collector = activeCollectors.get(this.messageId);
    if (collector) {
      this.client.removeListener("interactionCreate", collector);
      activeCollectors.delete(this.messageId);
    }
  }
}

module.exports = ConfirmationHandler;

// Cleanup on process termination
process.on("SIGINT", () => {
  activeCollectors.clear();
});