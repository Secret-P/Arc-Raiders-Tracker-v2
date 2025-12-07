# MetaForge Sync

This repository includes a small Node.js script that keeps canonical Arc Raiders data in Firestore in sync with MetaForge. The frontend continues to read only from Firestore; MetaForge is contacted exclusively by the sync script.

## Prerequisites

- Node.js 18+ (for the built-in `fetch`) and npm installed locally.
- A Firebase service account credential JSON file.
- The environment variable `GOOGLE_APPLICATION_CREDENTIALS` set to the absolute path of that JSON file before running the script, for example:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/path/to/serviceAccount.json"
```

## Running the sync

Install dependencies (firebase-admin) and then invoke the script:

```bash
npm install
npm run sync:metaforge
# or
node scripts/syncMetaforge.js
```

You can override the MetaForge base URL if needed:

```bash
META_BASE_URL="https://metaforge.app/arc-raiders/api" npm run sync:metaforge
```

The script logs progress as it fetches data and upserts Firestore documents. It only writes to the canonical collections and never touches user-generated crafting lists or list items.

## Firestore canonical schemas

### `mfItems/{itemId}`

```json
{
  "name": "<item name>",
  "rarity": "Common | Uncommon | ...",
  "type": "Component | Resource | Currency | ...",
  "sources": {
    "maps": ["<map>"],
    "biomes": ["<biome>"],
    "enemies": ["<enemy>"],
    "traders": ["<trader>"],
    "quests": ["<questId>"]
  },
  "metaforgeId": "<id from MetaForge>",
  "categorySlug": "<slug from MetaForge>"
}
```

### `mfQuests/{questId}`

```json
{
  "name": "<quest/recipe name>",
  "category": "<quest category or line>",
  "description": "<quest summary>",
  "requiredItems": [
    {
      "itemId": "<item identifier>",
      "quantity": 1
    }
  ],
  "metaforgeId": "<id from MetaForge>",
  "rewards": []
}
```

User-specific data in `craftingLists` is not modified by the sync process.
