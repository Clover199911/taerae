require('dotenv').config();
const mongoose = require('mongoose');
const Card = require('../models/card');
const {
  parseImagePathFromGitHubUrl,
  normalizeRelativeImagePath,
  buildPublicImageUrl,
  imagePathExists
} = require('../utils/cardImageSource');

async function migrateCardImagePaths() {
  console.log('Starting image path migration...');

  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/cardbot', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Connected to MongoDB');

    const cards = await Card.find({}, 'cardId name group rarity imageURL imagePath').lean();

    let updated = 0;
    let missingPath = 0;
    let missingPublicBase = 0;
    let skipped = 0;
    let notParseable = 0;

    for (const card of cards) {
      const parsedFromUrl = parseImagePathFromGitHubUrl(card.imageURL);
      const targetPath = normalizeRelativeImagePath(card.imagePath || parsedFromUrl);

      if (!targetPath) {
        notParseable++;
        continue;
      }

      if (!(await imagePathExists(targetPath))) {
        missingPath++;
        continue;
      }

      const localPublicUrl = buildPublicImageUrl(targetPath);
      if (!localPublicUrl) {
        missingPublicBase++;
        continue;
      }

      if (card.imagePath === targetPath && card.imageURL === localPublicUrl) {
        skipped++;
        continue;
      }

      await Card.updateOne(
        { _id: card._id },
        { $set: { imagePath: targetPath, imageURL: localPublicUrl } }
      );
      updated++;
    }

    console.log('Migration complete.');
    console.log(`Updated: ${updated}`);
    console.log(`Skipped (already migrated): ${skipped}`);
    console.log(`Missing local file: ${missingPath}`);
    console.log(`Not parseable from URL/path: ${notParseable}`);
    if (missingPublicBase > 0) {
      console.log(`Skipped due to missing PUBLIC_BASE_URL/HEROKU_APP_NAME: ${missingPublicBase}`);
    }
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

migrateCardImagePaths().catch((error) => {
  console.error('Unhandled migration error:', error);
  process.exit(1);
});
