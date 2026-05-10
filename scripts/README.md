# Scripts Directory

This directory contains utility and migration scripts for the card bot.

## Migration Scripts
- `deleteUserCards.js` - Delete user cards (admin utility)
- `InteractiveFixCards.js` - Interactive card fixing tool
- `migrateCardLock.js` - Migration for card lock feature
- `migratePrintSystem.js` - Migration for print number system
- `migrateCardImagePaths.js` - Migrates Card imageURL/imagePath to local `/images/...` URLs
- `verifyMissingCards.js` - Verify and report missing cards

## Root Scripts (should be moved here)
The following scripts are in the root directory and should be considered for moving:

- `fix-embeds.js` - One-time migration to fix embed format (embed → embeds)
- `syntax_check.js` - Syntax validation for key files
- `validate_syntax.js` - Additional syntax validation
- `test-sharp-optimization.js` - Sharp image processing tests

## Usage

Run scripts from the project root:
```bash
node scripts/migrateCardLock.js
node scripts/verifyMissingCards.js
node scripts/migrateCardImagePaths.js
```

## Notes
- Always backup the database before running migration scripts
- Test on a dev environment first
- Some scripts are one-time use and should not be re-run
