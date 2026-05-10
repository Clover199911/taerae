# Pack Collage Feature Implementation

This implementation adds a visual collage feature to pack opening, similar to the group command.

## How it works:

### 1. Pack Opening Flow
When a user opens a pack:
1. A collage image is generated showing all pulled cards
2. A brief message is displayed with:
   - The collage image
   - Pristine count (⭐ X pristine)
   - Target group hits if applicable (🎯 X/Y from Group)
   - A "Show Details" button

### 2. Button Interaction
When the "Show Details" button is clicked:
- Shows the full text version ephemerally (only to the user who clicked)
- Contains all the detailed card information like before (card codes, rarity stars, etc.)
- Button only works for the user who opened the pack
- Button expires after 10 minutes

### 3. Files Modified:

#### `utils/packCollageGenerator.js` (NEW)
- Generates collage images using the same grid layout as group command
- All cards show in full color (no grayscale) since they were just pulled
- Uses CardGenerationService for processing images with condition overlays

#### `commands/packs/pack.js`
- Added import for generatePackCollage
- Modified openFlow() to generate collage and create button
- Stores detailed embed data for button interaction
- Creates brief embed with collage for public display

#### `index.js`
- Extended handleInteraction() to handle component interactions
- Added handleComponentInteraction() method for button clicks
- Validates user authorization and expiration for pack detail buttons

### 4. Technical Details:
- Uses global.packDetailsCache to store button interaction data
- Automatic cleanup of expired button data
- Ephemeral responses for security and clean UX
- Same image processing pipeline as group command
- WebP format for optimal file size

### 5. Button Behavior:
- Custom ID format: `pack_details_{userId}_{timestamp}`
- 10-minute expiration for button functionality
- User validation to prevent unauthorized access
- Graceful error handling for expired/invalid buttons

## Testing
To test the implementation:
1. Ensure all dependencies are installed (`sharp`, `axios`, etc.)
2. Run syntax check: `node test_pack_syntax.js`
3. Test pack opening in Discord
4. Verify collage appears and button works correctly