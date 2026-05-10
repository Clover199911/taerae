// utils/cardCodeGenerator.js
const mongoose = require('mongoose');
const User = require('../models/user');
const Counter = require('../models/counter');

function encodeNumber(num, characters, length) {
    let code = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = (num + Math.floor(Math.random() * characters.length)) % characters.length;
        code += characters[randomIndex];
        num = Math.floor(num / characters.length);
    }
    return code;
}

async function generateUniqueCode() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const maxAttempts = 50;
    const minLength = 3;
    const maxLength = 6;

    let isUnique = false;
    let code;
    let currentLength = minLength;

    while (!isUnique && currentLength <= maxLength) {
        let attempts = 0;

        while (!isUnique && attempts < maxAttempts) {
            const counter = await Counter.findOneAndUpdate(
                { _id: 'cardCode' },
                { $inc: { seq: 1 } },
                { new: true, upsert: true }
            );

            code = encodeNumber(counter.seq, characters, currentLength);

            const existingUser = await User.findOne({ cardCode: code });
            if (!existingUser) {
                isUnique = true;
            } else {
                attempts++;
            }
        }

        if (!isUnique) {
            currentLength++;
        }
    }

    if (!isUnique) {
        throw new Error("Unable to generate a unique code after exhausting all options.");
    }

    return code;
}

module.exports = { generateUniqueCode };