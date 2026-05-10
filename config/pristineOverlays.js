// config/pristineOverlays.js
// ============================================================================
// PRISTINE OVERLAY CONFIG - Edit this file to control which cards get which overlay
// ============================================================================

const cosmicConfig = require('../utils/cosmicConfig');

module.exports = {
  // ============================================================================
  // IOTW PRISTINE (iotwpristine.png)
  // ============================================================================
  iotwpristine: {
    file: 'iotwpristine.png',
    cardIds: [
      ...cosmicConfig.getAllIOTWCards(),
      // ADD MORE CARD IDS HERE:
      // 2100, 2101, 2102,
    ]
  },

  // ============================================================================
  // WINTER PRISTINE (winterpristine.png)
  // ============================================================================
  winterpristine: {
    file: 'winterpristine.png',
    cardIds: [
      ...cosmicConfig.getEventCards('winter2024'),
      ...cosmicConfig.getEventCards('winter2025'),
      // ADD MORE CARD IDS HERE:
      // 2200, 2201, 2202,
    ]
  },

  // ============================================================================
  // DANCE/DISCO PRISTINE (dancepristine.png)
  // ============================================================================
  dancepristine: {
    file: 'dancepristine.png',
    cardIds: [
      ...cosmicConfig.getEventCards('disco'),
      // ADD MORE CARD IDS HERE:
      // 2300, 2301, 2302,
    ]
  },

  // ============================================================================
  // TAERAE WINTER PRISTINE (taeraepristine.png)
  // ============================================================================
  taeraepristine: {
    file: 'taeraepristine.png',
    cardIds: [
      // ADD CARD IDS HERE:
      // 2400, 2401, 2402,
    ]
  },

  // ============================================================================
  // ADD NEW OVERLAYS BELOW (copy this template)
  // ============================================================================
  // newoverlay: {
  //   file: 'newoverlay.png',
  //   cardIds: [
  //     1234, 1235, 1236,
  //   ]
  // },

  // ============================================================================
  // HELPER FUNCTION - Gets the overlay file for a card ID
  // ============================================================================
  getOverlayForCardId(cardId) {
    for (const [key, config] of Object.entries(this)) {
      if (typeof config === 'object' && config.cardIds && config.cardIds.includes(cardId)) {
        return config.file;
      }
    }
    return null;
  },

  // ============================================================================
  // GROUP-BASED FALLBACK (when cardId doesn't match)
  // ============================================================================
  groupFallbacks: {
    'taeraewinter': 'taeraepristine.png',
    'idol of the week': 'iotwpristine.png',
    'idol of the month': 'iotwpristine.png',
    'iotm2': 'iotwpristine.png',
    'iotm': 'iotwpristine.png',
    'winter': 'winterpristine.png',
    'disco': 'dancepristine.png',
    '17': 'iotwpristine.png',
  },

  getOverlayForGroup(group) {
    if (!group) return null;
    for (const [pattern, file] of Object.entries(this.groupFallbacks)) {
      if (group.match(new RegExp(pattern, 'i'))) {
        return file;
      }
    }
    return null;
  }
};
