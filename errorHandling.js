const Eris = require("eris");

function setupErrorHandling(bot) {
bot.on("error", (err) => {
console.error("Bot error:", err);
if (err.code === "ECONNRESET" || err.code === "ETIMEDOUT") {
    console.log("Connection error, attempting to reconnect...");
    reconnect(bot);
}
});

bot.on("disconnect", () => {
console.warn("Bot disconnected, attempting to reconnect...");
reconnect(bot);
});
}

function reconnect(bot) {
let attempts = 0;
const maxAttempts = 5;
const baseDelay = 5000; // 5 seconds

const attemptReconnect = () => {
if (attempts >= maxAttempts) {
    console.error("Max reconnection attempts reached. Please check your connection and restart the bot manually.");
    return;
}

attempts++;
const delay = baseDelay * Math.pow(2, attempts - 1); // Exponential backoff

console.log(`Reconnection attempt ${attempts}/${maxAttempts} in ${delay/1000} seconds...`);

setTimeout(() => {
    bot.connect().catch((err) => {
    console.error("Reconnection failed:", err);
    attemptReconnect();
    });
}, delay);
};

attemptReconnect();
}

module.exports = { setupErrorHandling };