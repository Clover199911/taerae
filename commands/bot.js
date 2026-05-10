const os = require('os');
const Eris = require("eris");

module.exports = {
    name: "bot",
    description: "Display bot statistics and information",
    async execute(msg, args, client) {
        // Calculate uptime
        const uptime = process.uptime();
        const uptimeString = formatUptime(uptime);

        // Get memory usage
        const usedMemory = process.memoryUsage().heapUsed / 1024 / 1024;
        const totalMemory = os.totalmem() / 1024 / 1024;
        const memoryUsage = `${usedMemory.toFixed(2)} MB / ${totalMemory.toFixed(2)} MB`;

        // Get CPU usage
        const cpuUsage = os.loadavg()[0];

        // Create embed
        const embed = {
            title: "Bot Statistics",
            color: 0x7289DA,
            fields: [
                { name: "Uptime", value: uptimeString, inline: true },
                { name: "Memory Usage", value: memoryUsage, inline: true },
                { name: "CPU Usage", value: `${cpuUsage.toFixed(2)}%`, inline: true },
                { name: "Node.js Version", value: process.version, inline: true },
                { name: "Eris Version", value: Eris.VERSION, inline: true },
                { name: "Operating System", value: `${os.type()} ${os.release()}`, inline: true },
            ],
            footer: {
                text: `Requested by ${msg.author.username}`,
                icon_url: msg.author.avatarURL
            },
            timestamp: new Date()
        };

        // Send the embed as a reply
await msg.channel.createMessage({
    embeds: [embed],
    messageReference: { messageID: msg.id }
});
    },
};

function formatUptime(uptime) {
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor(uptime / 3600) % 24;
    const minutes = Math.floor(uptime / 60) % 60;
    const seconds = Math.floor(uptime % 60);

    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}