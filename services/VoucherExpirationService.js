// services/VoucherExpirationService.js
const Voucher = require('../models/voucher');
const { expiresWithin24Hours } = require('../utils/voucherUtils');
const { CHANNEL_IDS } = require('../config/constants');
const logger = require('../utils/logger');

const EXPIRATION_CHANNEL_ID = CHANNEL_IDS.VOUCHER_EXPIRATION;
const CHECK_INTERVAL = 60 * 60 * 1000; // Check every hour

class VoucherExpirationService {
  constructor(client) {
    this.client = client;
    this.isRunning = false;
    this.intervalId = null;
  }

  /**
   * Start the expiration check service
   */
  start() {
    if (this.isRunning) {
      logger.info('[VOUCHER_SERVICE] Already running');
      return;
    }

    logger.info('[VOUCHER_SERVICE] Starting expiration checks...');
    this.isRunning = true;

    // Run immediately on start
    this.checkExpirations().catch(err => {
      logger.error('[VOUCHER_SERVICE] Initial check failed:', err);
    });

    // Then run every hour with error handling
    this.intervalId = setInterval(() => {
      this.checkExpirations().catch(err => {
        logger.error('[VOUCHER_SERVICE] Scheduled check failed:', err);
      });
    }, CHECK_INTERVAL);
  }

  /**
   * Stop the expiration check service
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('[VOUCHER_SERVICE] Stopped');
  }

  /**
   * Check for vouchers expiring within 24 hours and expired vouchers
   */
  async checkExpirations() {
    try {
      logger.info('[VOUCHER_SERVICE] Running expiration check...');

      // Find vouchers expiring within 24 hours that haven't been warned yet
      const expiringVouchers = await Voucher.find({
        isActive: true,
        expirationWarned: false,
        expiresAt: { $gt: new Date() }
      }).lean();

      const vouchersToWarn = expiringVouchers.filter(v => 
        expiresWithin24Hours(v.expiresAt)
      );

      // Send warnings (must be done individually for Discord messages)
      for (const voucher of vouchersToWarn) {
        await this.sendExpirationWarning(voucher);
      }

      // OPTIMIZED: Bulk update all warned vouchers at once
      if (vouchersToWarn.length > 0) {
        const warnedIds = vouchersToWarn.map(v => v._id);
        await Voucher.updateMany(
          { _id: { $in: warnedIds } },
          { $set: { expirationWarned: true } }
        );
      }

      // Find and delete expired vouchers
      const expiredVouchers = await Voucher.find({
        expiresAt: { $lte: new Date() }
      }).lean();

      // Send expiration notifications (must be done individually)
      for (const voucher of expiredVouchers) {
        await this.handleExpiredVoucher(voucher);
      }

      // OPTIMIZED: Bulk delete all expired vouchers at once
      if (expiredVouchers.length > 0) {
        const expiredIds = expiredVouchers.map(v => v._id);
        await Voucher.deleteMany({ _id: { $in: expiredIds } });
      }

      const total = vouchersToWarn.length + expiredVouchers.length;
      if (total > 0) {
        logger.info(`[VOUCHER_SERVICE] Processed ${vouchersToWarn.length} warnings, ${expiredVouchers.length} deletions`);
      }

    } catch (error) {
      logger.error('[VOUCHER_SERVICE_ERR]', error);
    }
  }

  /**
   * Send expiration warning to admin channel
   */
  async sendExpirationWarning(voucher) {
    try {
      const channel = this.client.getChannel(EXPIRATION_CHANNEL_ID);
      if (!channel) {
        logger.error(`[VOUCHER_WARNING] Channel ${EXPIRATION_CHANNEL_ID} not found`);
        return;
      }

      const expiresTimestamp = Math.floor(voucher.expiresAt.getTime() / 1000);
      const claims = voucher.maxClaims === null 
        ? `${voucher.claimedBy.length} claims` 
        : `${voucher.claimedBy.length}/${voucher.maxClaims} claims`;

      await channel.createMessage({
        embeds: [{
          title: '⚠️ Voucher Expiring Soon',
          description: `**Code:** \`${voucher.code}\`\n` +
                       `**Claims:** ${claims}\n` +
                       `**Expires:** <t:${expiresTimestamp}:R> (<t:${expiresTimestamp}:F>)\n\n` +
                       `This voucher will be automatically deleted when it expires.`,
          color: 0xFFAA00,
          footer: { text: `Voucher ID: ${voucher._id}` },
          timestamp: new Date().toISOString()
        }]
      });

      logger.info(`[VOUCHER_WARNING] Warning sent for voucher: ${voucher.code}`);
    } catch (error) {
      logger.error(`[VOUCHER_WARNING_ERR] ${voucher.code}:`, error);
    }
  }

  /**
   * Handle expired voucher (notify and delete)
   */
  async handleExpiredVoucher(voucher) {
    try {
      const channel = this.client.getChannel(EXPIRATION_CHANNEL_ID);
      if (!channel) {
        logger.error(`[VOUCHER_EXPIRED] Channel ${EXPIRATION_CHANNEL_ID} not found`);
        return;
      }

      const claims = voucher.maxClaims === null 
        ? `${voucher.claimedBy.length} claims` 
        : `${voucher.claimedBy.length}/${voucher.maxClaims} claims`;

      await channel.createMessage({
        embeds: [{
          title: '🗑️ Voucher Expired & Deleted',
          description: `**Code:** \`${voucher.code}\`\n` +
                       `**Final Claims:** ${claims}\n` +
                       `**Expired:** <t:${Math.floor(voucher.expiresAt.getTime() / 1000)}:R>\n\n` +
                       `This voucher has been automatically deleted.`,
          color: 0xFF0000,
          footer: { text: `Voucher ID: ${voucher._id}` },
          timestamp: new Date().toISOString()
        }]
      });

      logger.info(`[VOUCHER_EXPIRED] Deleted voucher: ${voucher.code}`);
    } catch (error) {
      logger.error(`[VOUCHER_EXPIRED_ERR] ${voucher.code}:`, error);
    }
  }

  /**
   * Manual check (can be called by admin command)
   */
  async forceCheck() {
    logger.info('[VOUCHER_SERVICE] Manual check triggered');
    await this.checkExpirations();
  }
}

module.exports = VoucherExpirationService;