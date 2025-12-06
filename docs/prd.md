\# Arc Raiders Tracker v2 – Product Requirements Document (PRD)



\*\*Working Title:\*\* Arc Raiders: Data-Driven Crafting Companion  

\*\*Owner:\*\* Chris  

\*\*Status:\*\* Draft  

\*\*Last Updated:\*\* 2025-12-06  



---



\## 1. Executive Summary



The Arc Raiders Tracker is intended to be a second-screen companion for Arc Raiders players that simplifies the process of upgrading and crafting by clearly identifying the materials needed to finish specific quests, recipes, and crafting-bench upgrades.



\*\*Target Users:\*\* Arc Raiders players that want to focus individual rounds on accomplishing specific crafting targets.



\*\*Key Benefit:\*\* Removes the need to manage crafting checklists in the cumbersome in-game menu, freeing up the user to be “in-match” more frequently and not at risk of peril from other raiders or ARC enemies while digging through menus.



\*\*Success Criteria:\*\*



\- Users can populate a list of resources needed via:

&nbsp; - Free-text entry, or

&nbsp; - Selecting a parent task (quest, recipe, or upgrade).

\- Users can identify likely material drop locations by:

&nbsp; - Vendor  

&nbsp; - Enemy  

&nbsp; - Map  

&nbsp; - Biome  



---



\## 2. Problem Statements



1\. Easily generate a list of desired crafting items individually.  

2\. Use known quests, recipes, and upgrades to automatically generate lists of required materials.  

3\. Easily identify where materials can be located.  

4\. Provide a second-screen solution that allows the user to manage resources outside of the in-game menu system.



\### Why Now?



1\. While the game is fun, many missions become aimless over time. This solution serves as a tool for players who want to pursue specific goals as efficiently as possible, while still remaining fully immersed in the game.



---



\## 3. Target Personas



\### Persona 1 – Casual Player



\*\*Background:\*\* Wants to get on and have fun while still feeling that they are making meaningful progress toward their goals.



\*\*Goals:\*\*



\- Can easily generate an aggregate list of required materials based on current goals.  

\- Can easily determine where individual items can be found.



---



\### Persona 2 – Power Player



\*\*Background:\*\* Similar to the Casual Player, but with a primary motivation of efficiency in the loot-gathering process. This user wants each mission to be as efficient as possible.



\*\*Goals:\*\*



\- Can receive recommendations on maps and biomes that will provide the most relevant materials.



---



\## 4. Core Product Vision



The Arc Raiders Tracker is a \*\*data-first, player-focused crafting planner\*\* that:



\- Uses real game data instead of freeform text.  

\- Lets users build and track crafting requirement lists.  

\- Supports quest / recipe / upgrade-driven list generation.  

\- Provides contextual sourcing info (map, vendor, enemy, biome).  

\- Persists progress across devices using Google login.  

\- Avoids runtime dependency on third-party APIs through local caching.



---



\## 5. Primary Use Cases



\### 5.1 Manual Item Tracking



\- User searches for a crafting item using real game data.  

\- Adds it to a list with a required quantity.  

\- Tracks owned vs required.  

\- Adds notes and priority.



---



\### 5.2 Quest-Based List Generation



\- User selects a quest.  

\- App automatically:

&nbsp; - Pulls all required items for that quest.  

&nbsp; - Adds them to the active crafting list.  

&nbsp; - Tags each entry with the originating quest.



---



\### 5.3 Item Sourcing \& Context



For any item in a list, the user can see:



\- Maps where it drops.  

\- Enemies that drop it.  

\- Traders/vendors that sell it.  

\- Arcs or quests where it appears.  

\- Biomes where it is commonly found.



---



\### 5.4 Power Player Enhancements (Strategic Planning)



These features transform the tracker from a checklist into a tactical planning tool for efficiency-driven players.



\*\*Primary Goals:\*\*



\- Minimize wasted drops.  

\- Maximize relevant material yield.  

\- Reduce map hopping and vendor randomness.  

\- Reduce decision overhead during play sessions.



\*\*System Behavior:\*\*



The system continuously evaluates the remaining quantities across the active list and derives relevance rankings for:



\- Maps  

\- Biomes  

\- Vendors  

\- Enemies  



---



\## 6. Authentication \& User Identity



\- Users authenticate via Firebase Authentication – Google Provider.  

\- Each user has a unique `uid`.  

\- All lists and progress data are scoped to the authenticated user.  

\- On first login, a user profile document is created in Firestore.



---



\## 7. External Data Integration (MetaForge)



\### 7.1 Data Source



Primary external data source:



\- MetaForge Arc Raiders API:

&nbsp; - Items  

&nbsp; - Quests  

&nbsp; - Arcs  

&nbsp; - Traders  

&nbsp; - Maps  

&nbsp; - Biomes  



---



\### 7.2 Caching Strategy (Critical Requirement)



The app \*\*must not call MetaForge directly during runtime\*\*.



All MetaForge data must be:



\- Pulled into Firestore via a scheduled or manual sync process.  

\- Normalized into controlled collections:

&nbsp; - `mfItems`  

&nbsp; - `mfQuests`  

&nbsp; - `mfArcs`  

&nbsp; - `mfTraders`  

&nbsp; - `mfMaps`  

&nbsp; - `mfBiomes`  

\- Tracked via a `metaStatus/sync` document.



\*\*Goals of caching:\*\*



\- Performance stability.  

\- Data version control.  

\- Protection from API changes.  

\- Offline-friendly future roadmap.



---



\### 7.3 Power Player Recommendation Logic (Data-Driven Scoring)



All Power Player enhancements are derived exclusively from:



\- Remaining required item quantities.  

\- Canonical source mappings (maps, biomes, enemies, vendors).



\*\*Remaining quantity definition:\*\*



\- `remaining = quantityRequired − quantityOwned`  



Only items with `remaining > 0` contribute to scoring logic.



\#### Map Relevance Scoring



For each remaining item:



\- For each map listed in `mfItems.sources.maps`:



&nbsp; - `mapScore\[map] += remaining`



Maps are ranked by descending `mapScore`.



\#### Biome Dominance Scoring



For each remaining item:



\- For each biome listed in `mfItems.sources.biomes`:



&nbsp; - `biomeScore\[biome] += remaining`



Biomes are ranked by descending `biomeScore`.



\#### Vendor Relevance Scoring



For each remaining item:



\- For each trader listed in `mfItems.sources.traders`:



&nbsp; - `vendorScore\[trader] += remaining`



Vendors are ranked by descending `vendorScore`.



\#### Enemy Target Scoring



For each remaining item:



\- For each enemy listed in `mfItems.sources.enemies`:



&nbsp; - `enemyScore\[enemy] += remaining`



Enemies are ranked by descending `enemyScore`.



\#### Recommendation Confidence (Optional v1 Enhancement)



\- `confidence = topMapScore ÷ totalRemaining`



Displayed as:



\- \*\*High confidence\*\* (> 60%)  

\- \*\*Mixed strategy\*\* (30–60%)  

\- \*\*Scattered\*\* (< 30%)  



---



\## 8. Core Data Objects (Conceptual)



\- \*\*User\*\* – Firebase Auth `uid`, profile, and preferences.  

\- \*\*Crafting List\*\* – Owned by a user, contains multiple list items, may be associated with quests/recipes/upgrades.  

\- \*\*List Item\*\* – References a canonical `mfItem` (when available), tracks required and owned quantity, priority, notes, and source.  

\- \*\*Canonical Game Data\*\* – Items, quests, arcs, traders, maps, biomes; read-only from the client.



---



\## 9. Functional Requirements



\### 9.1 Lists



Users must be able to:



\- Create a new list.  

\- Rename a list.  

\- Archive a list.  

\- Delete a list.



---



\### 9.2 Items



Users must be able to:



\- Add an item manually via search.  

\- Add multiple items from a parent task (quest/recipe/upgrade).  

\- Edit required and owned quantity.  

\- View sourcing info.  

\- Add notes.  

\- Assign priority.  

\- Remove items.



---



\### 9.3 Quests, Recipes \& Upgrades



Users must be able to:



\- Search parent tasks.  

\- View all required materials.  

\- Add all required items into a list in one action.



---



\### 9.4 Sync \& Data Freshness



The app must:



\- Display last MetaForge sync time.  

\- Handle stale data safely.  

\- Never block user interaction due to sync failure.



---



\## 10. Non-Functional Requirements



\- Fully static frontend (no server-rendered UI).  

\- Firebase-hosted backend services only.  

\- Firestore is the single source of truth.  

\- Responsive, mobile-first design.  

\- Near-instant interaction latency.  

\- Safe offline degradation (read-only future capability).  

\- All Power Player recommendation logic must be deterministic and explainable.



---



\## 11. UX Guidelines



\### 11.1 Experience Principles



\- \*\*Second-Screen First:\*\* Designed to be used alongside active gameplay, not as a replacement.  

\- \*\*Zero-Friction Planning:\*\* The app must be faster than the in-game menus for planning and tracking.  

\- \*\*Cognitive Offload:\*\* The app remembers materials, sources, and goals so the player doesn’t have to.  

\- \*\*Progress Visibility:\*\* At a glance, the user can always see what’s left, what’s complete, and what’s next.  

\- \*\*Trust Through Data:\*\* All canonical game data feels authoritative, stable, and verifiable.



\### 11.2 Interaction Rules



\*\*Input \& Creation\*\*



\- Search is the primary method of discovery, followed by browsing, then free-text.  

\- Free-text entries are always allowed but clearly marked as “Unverified.”  

\- Parent tasks always show a preview before bulk-adding items.



\*\*Editing \& Progress\*\*



\- Quantity updates are inline and require a single tap or click.  

\- Owned vs Required quantities must be visually distinct.  

\- Progress is represented visually (bars or meters) rather than raw percentages where possible.



\*\*Feedback \& Sync\*\*



\- Every add, remove, or update shows immediate visual confirmation.  

\- No action should require a full page refresh.  

\- Data sync status is visible but never blocking.



\*\*Discovery\*\*



\- Item sources (enemy, vendor, map, biome) are always one interaction away.  

\- Contextual sourcing never requires navigating to a separate tool or mode.



\### 11.3 Constraints \& Guardrails



\- No multi-step wizards.  

\- No hidden actions behind long-presses.  

\- No modal overload.  

\- No required tutorials.  

\- No required manual entry for known items.  

\- No blocking screens for background data sync.



\### 11.4 Aesthetic North-Star (Retro-Future Terminal)



\- UI reflects Arc Raiders’ 80s retro-future vibe in both color palette and interaction design.  

\- Visual language feels gritty, industrial, technological, and slightly analog.  

\- Typography and layout evoke a CRT terminal:

&nbsp; - High-contrast text.  

&nbsp; - Subtle glow or phosphor-style accents.  

&nbsp; - Scanline-inspired textures (used sparingly).  

\- Motion and transitions feel mechanical and utility-driven, not decorative.  

\- Overall effect: \*“A scavenger’s command terminal for survival planning.”\*



---



\## 12. Scope Boundaries



\*(Intentionally left flexible for early experimentation; to be locked later.)\*



\### In Scope (Goals)



\- Crafting list management.  

\- Quest / recipe / upgrade-driven item injection.  

\- Real data integration via MetaForge cache.  

\- Progress tracking.  

\- Google login.  

\- Power Player relevance scoring (maps/biomes/vendors/enemies).



\### Out of Scope (Non-Goals, v1)



\- Full in-game inventory syncing.  

\- Multiplayer list sharing.  

\- Clan/group coordination.  

\- Real-time drop tracking.  

\- Trading automation.



---



\## 13. Risks \& Assumptions



\### Assumptions



\- MetaForge continues to support public access.  

\- Arc Raiders data models remain reasonably stable.  

\- Firebase pricing remains within hobby-tier limits.  

\- Source attribution requirements remain consistent.



\### Risks



\- MetaForge schema changes.  

\- Rapid game balance changes.  

\- Over-scoping v1.  

\- Recommendation logic becoming misleading if source data is incomplete.



---



\## 14. Success Metrics



\- Time to create a list \&lt; 30 seconds.  

\- Time to add a parent task \&lt; 10 seconds.  

\- Zero manual typing required for known items.  

\- 100% of items sourced from canonical data.  

\- Sync reliability \&gt; 99%.  



---



\## 15. Open Questions



\- How often should MetaForge auto-sync?  

\- Do we need light roles (admin vs normal user)?  

\- Should lists eventually support sharing?  

\- Should vendor pricing be tracked in future versions?  

\- Should biome-level routing be surfaced as a planning tool?



---



\## 16. Versioning Roadmap



\- \*\*v1:\*\* Core crafting lists + parent task injection + item sourcing + Power Player map/biome/vendor/enemy relevance scoring.  

\- \*\*v2:\*\* Route optimization, vendor planning, and rotation awareness.  

\- \*\*v3:\*\* Loadouts, progression forecasting, and deeper efficiency modeling.  



