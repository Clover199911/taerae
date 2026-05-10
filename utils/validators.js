module.exports = {
    validateUserId(userId) {
      return /^\d+$/.test(userId);
    },
  
    validateCommandArguments(args, expectedCount) {
      if (args.length < expectedCount) {
        throw new Error(`Insufficient arguments. Expected ${expectedCount}, got ${args.length}`);
      }
    },
  
    sanitizeInput(input) {
      return input.replace(/[<>@!]/g, '');
    }
  };