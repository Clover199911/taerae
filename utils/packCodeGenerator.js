const mongoose = require("mongoose");

const CHARACTERS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const CODE_LENGTH = 4;
const MAX_ATTEMPTS = 50;

// Generate a random code
const generateRandomCode = () => {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    const randomIndex = Math.floor(Math.random() * CHARACTERS.length);
    code += CHARACTERS[randomIndex];
  }
  return code;
};

// Main generation function
const generatePackCode = async () => {
  let attempts = 0;

  while (attempts < MAX_ATTEMPTS) {
    try {
      const code = generateRandomCode();

      // Check if code already exists in database
      const exists = await mongoose
        .model("Pack")
        .findOne({ packCode: code })
        .select("_id")
        .lean();

      if (!exists) {
        return code;
      }

      attempts++;
    } catch (error) {
      console.error("Pack code generation error:", error);
      attempts++;
    }
  }

  throw new Error("Failed to generate unique pack code after maximum attempts");
};

// Batch generation
const generatePackCodes = async (count) => {
  if (count > 100) throw new Error("Batch size too large (max 100)");

  const codes = [];
  const codeSet = new Set();

  while (codes.length < count) {
    const code = await generatePackCode();
    if (!codeSet.has(code)) {
      codeSet.add(code);
      codes.push(code);
    }
  }

  return codes;
};

// Fast variant (skips DB check - use carefully!)
const generatePackCodeFast = () => {
  return generateRandomCode();
};

module.exports = {
  generatePackCode,
  generatePackCodeFast,
  generatePackCodes,
};
