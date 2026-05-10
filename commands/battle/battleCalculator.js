// commands/battle/battleCalculator.js - Win/loss calculation logic (IMPROVED)
// ============================================================================

const { SCORE_WEIGHTS, BATTLE_CONFIG } = require('../../config/battle');

/**
 * Calculate card battle score
 * Formula: (rarity × 10) + condition + random(0-30)
 */
function calculateCardScore(rarity, condition) {
  const rarityScore = SCORE_WEIGHTS.rarity[rarity] || 1;
  const conditionScore = SCORE_WEIGHTS.condition[condition] || 1;
  
  // Base score
  const baseScore = (rarityScore * SCORE_WEIGHTS.rarityMultiplier) + conditionScore;
  
  // Add random bonus (0-30 gives weaker cards better chance)
  const randomBonus = Math.floor(Math.random() * 31); // 0-30 inclusive
  
  return {
    baseScore,
    randomBonus,
    totalScore: baseScore + randomBonus,
    breakdown: {
      rarity: rarityScore,
      condition: conditionScore
    }
  };
}

/**
 * Determine battle winner
 * Returns: { winner: 'user'|'bot'|'draw', userScore, botScore, userDetails, botDetails }
 */
function determineBattleWinner(userCard, botCard) {
  const userScoreData = calculateCardScore(userCard.rarity, userCard.condition);
  const botScoreData = calculateCardScore(botCard.rarity, botCard.condition);

  let winner;
  if (userScoreData.totalScore > botScoreData.totalScore) {
    winner = 'user';
  } else if (botScoreData.totalScore > userScoreData.totalScore) {
    winner = 'bot';
  } else {
    winner = 'draw'; // Rare, but possible
  }

  return {
    winner,
    userScore: userScoreData,
    botScore: botScoreData,
    userCard: {
      name: userCard.name,
      group: userCard.group,
      rarity: userCard.rarity,
      condition: userCard.condition
    },
    botCard: {
      name: botCard.name,
      group: botCard.group,
      rarity: botCard.rarity,
      condition: botCard.condition
    }
  };
}

/**
 * Format battle result for display - COMPACT MOBILE-FRIENDLY VERSION
 */
function formatBattleResult(result) {
  const { winner, userScore, botScore, userCard, botCard } = result;

  // Calculate score breakdown for compact display
  const userRarityScore = userScore.breakdown.rarity * SCORE_WEIGHTS.rarityMultiplier;
  const botRarityScore = botScore.breakdown.rarity * SCORE_WEIGHTS.rarityMultiplier;
  
  const pointDiff = Math.abs(userScore.totalScore - botScore.totalScore);
  
  // Compact title with point difference
  let title, resultEmoji;
  if (winner === 'user') {
    title = `🏆 Victory! (+${pointDiff} pts)`;
    resultEmoji = '🎉';
  } else if (winner === 'bot') {
    title = `💔 Defeat! (-${pointDiff} pts)`;
    resultEmoji = '😢';
  } else {
    title = '🤝 Draw!';
    resultEmoji = '⚖️';
  }

  // Compact single-line breakdown format
  const userBreakdown = `${userRarityScore}+${userScore.breakdown.condition}+${userScore.randomBonus}`;
  const botBreakdown = `${botRarityScore}+${botScore.breakdown.condition}+${botScore.randomBonus}`;

  return {
    title,
    description: `
**Your Card:** ${userCard.rarity} ${userCard.group} ${userCard.name}
⚡ **${userScore.totalScore}** pts _(${userBreakdown})_

**Bot Card:** ${botCard.rarity} ${botCard.group} ${botCard.name}
🤖 **${botScore.totalScore}** pts _(${botBreakdown})_

${resultEmoji} ${winner === 'user' ? 'You claimed the bot\'s card!' : winner === 'bot' ? 'Your card is locked this session.' : 'No cards exchanged!'}
    `.trim(),
    color: winner === 'user' ? 0x00ff00 : winner === 'bot' ? 0xff0000 : 0xffff00
  };
}

module.exports = {
  calculateCardScore,
  determineBattleWinner,
  formatBattleResult
};