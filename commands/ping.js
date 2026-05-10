module.exports = {
name: "ping",
description: "Ping!",
execute(msg, args) {

msg.channel.createMessage({ content: "Pong!", messageReference: { messageID: msg.id } });
},
};
