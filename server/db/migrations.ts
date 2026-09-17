import { getDatabase } from './database.js';

export function runMigrations(): void {
  const db = getDatabase();

  // Create migrations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT UNIQUE NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedMigrations = db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[];
  const appliedSet = new Set(appliedMigrations.map(m => m.version));

  if (!appliedSet.has('001_initial_schema')) {
    console.log('[Migration] Applying 001_initial_schema...');
    db.transaction(() => {
      // 1. Scenarios
      db.exec(`
        CREATE TABLE IF NOT EXISTS scenarios (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          genre TEXT NOT NULL DEFAULT 'Fantasy',
          tags TEXT NOT NULL DEFAULT '[]',
          cover_url TEXT NOT NULL DEFAULT '',
          system_instructions TEXT NOT NULL DEFAULT '',
          opening_message TEXT NOT NULL DEFAULT '',
          world_info TEXT NOT NULL DEFAULT '',
          is_favorite INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_scenarios_updated ON scenarios(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_scenarios_fav ON scenarios(is_favorite);
      `);

      // 2. Characters
      db.exec(`
        CREATE TABLE IF NOT EXISTS characters (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'ai',
          title TEXT NOT NULL DEFAULT '',
          avatar_url TEXT NOT NULL DEFAULT '',
          avatar_color TEXT NOT NULL DEFAULT '#d97706',
          personality TEXT NOT NULL DEFAULT '',
          scenario_role TEXT NOT NULL DEFAULT '',
          greeting TEXT NOT NULL DEFAULT '',
          custom_instructions TEXT NOT NULL DEFAULT '',
          is_user INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_characters_user ON characters(is_user);
      `);

      // 3. Scenario Characters
      db.exec(`
        CREATE TABLE IF NOT EXISTS scenario_characters (
          id TEXT PRIMARY KEY,
          scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
          character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          is_primary INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          UNIQUE(scenario_id, character_id)
        );
      `);

      // 4. Chats
      db.exec(`
        CREATE TABLE IF NOT EXISTS chats (
          id TEXT PRIMARY KEY,
          scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          user_character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
          active_provider_id TEXT NOT NULL DEFAULT 'gemini',
          active_model_id TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
          is_favorite INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chats_scenario ON chats(scenario_id);
      `);

      // 5. Messages
      db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
          sender_type TEXT NOT NULL,
          sender_character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
          content TEXT NOT NULL,
          is_ooc INTEGER NOT NULL DEFAULT 0,
          parent_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
          branch_id TEXT NOT NULL DEFAULT 'main',
          active_generation_id TEXT,
          sequence_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_messages_chat_seq ON messages(chat_id, sequence_order ASC);
      `);

      // 6. Message Generations (support for regeneration versions & branches)
      db.exec(`
        CREATE TABLE IF NOT EXISTS message_generations (
          id TEXT PRIMARY KEY,
          message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
          provider_id TEXT NOT NULL,
          model_id TEXT NOT NULL,
          prompt_snapshot TEXT,
          content TEXT NOT NULL,
          tokens_used INTEGER NOT NULL DEFAULT 0,
          generation_time_ms INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_generations_message ON message_generations(message_id);
      `);

      // 7. Story Cards (World & Lore)
      db.exec(`
        CREATE TABLE IF NOT EXISTS story_cards (
          id TEXT PRIMARY KEY,
          scenario_id TEXT REFERENCES scenarios(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'lore',
          is_pinned INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // 8. Story Card Triggers
      db.exec(`
        CREATE TABLE IF NOT EXISTS story_card_triggers (
          id TEXT PRIMARY KEY,
          story_card_id TEXT NOT NULL REFERENCES story_cards(id) ON DELETE CASCADE,
          keyword TEXT NOT NULL,
          match_type TEXT NOT NULL DEFAULT 'contains',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_triggers_keyword ON story_card_triggers(keyword);
      `);

      // 9. Memories
      db.exec(`
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
          is_pinned INTEGER NOT NULL DEFAULT 0,
          importance_score REAL NOT NULL DEFAULT 1.0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_memories_chat ON memories(chat_id);
      `);

      // 10. LLM Providers
      db.exec(`
        CREATE TABLE IF NOT EXISTS llm_providers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          base_url TEXT NOT NULL DEFAULT '',
          api_key_configured INTEGER NOT NULL DEFAULT 0,
          is_enabled INTEGER NOT NULL DEFAULT 1,
          is_default INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // 11. LLM Models
      db.exec(`
        CREATE TABLE IF NOT EXISTS llm_models (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL REFERENCES llm_providers(id) ON DELETE CASCADE,
          model_name TEXT NOT NULL,
          display_name TEXT NOT NULL,
          context_window INTEGER NOT NULL DEFAULT 32768,
          is_default INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
      `);

      // 12. Settings
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // 13. Attachments
      db.exec(`
        CREATE TABLE IF NOT EXISTS attachments (
          id TEXT PRIMARY KEY,
          target_type TEXT NOT NULL,
          target_id TEXT NOT NULL,
          file_name TEXT NOT NULL,
          file_path TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
      `);

      // Seed default LLM providers and models
      const now = new Date().toISOString();
      const insertProvider = db.prepare(`
        INSERT OR IGNORE INTO llm_providers (id, name, type, base_url, api_key_configured, is_enabled, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertModel = db.prepare(`
        INSERT OR IGNORE INTO llm_models (id, provider_id, model_name, display_name, context_window, is_default, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      // Gemini
      const hasGeminiKey = !!process.env.GEMINI_API_KEY;
      insertProvider.run('gemini', 'Google Gemini', 'gemini', '', hasGeminiKey ? 1 : 0, 1, 1, now, now);
      insertModel.run('gemini-2.5-flash', 'gemini', 'gemini-2.5-flash', 'Gemini 2.5 Flash (Fast & Vivid)', 1048576, 1, now);
      insertModel.run('gemini-2.5-pro', 'gemini', 'gemini-2.5-pro', 'Gemini 2.5 Pro (Rich Long-form)', 2097152, 0, now);

      // Local llama.cpp / Ollama
      insertProvider.run('local_llm', 'Local LLM (llama.cpp / Ollama)', 'openai_compatible', 'http://127.0.0.1:11434/v1', 0, 0, 0, now, now);
      insertModel.run('local-default', 'local_llm', 'default', 'Local LLaMA 3.3 / Mistral', 32768, 1, now);

      // OpenRouter
      insertProvider.run('openrouter', 'OpenRouter', 'openai_compatible', 'https://openrouter.ai/api/v1', 0, 0, 0, now, now);
      insertModel.run('openrouter-auto', 'openrouter', 'openrouter/auto', 'OpenRouter Auto Router', 65536, 1, now);

      // Seed default application settings
      const insertSetting = db.prepare(`
        INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      `);
      insertSetting.run('appearance_theme', 'cinematic_dark', now);
      insertSetting.run('reading_font', 'Newsreader', now);
      insertSetting.run('font_size', '17px', now);
      insertSetting.run('active_provider_id', 'gemini', now);
      insertSetting.run('active_model_id', 'gemini-2.5-flash', now);
      insertSetting.run('generation_temperature', '0.85', now);
      insertSetting.run('generation_max_tokens', '1024', now);
      insertSetting.run('story_length_preference', 'balanced', now);

      // Record migration
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run('001_initial_schema', now);
    })();
    console.log('[Migration] 001_initial_schema applied successfully.');
  }

  // Migration 002: Seed Initial Scenarios & Characters
  const m2 = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get('002_starter_chronicles');
  if (!m2) {
    db.transaction(() => {
      const now = new Date().toISOString();

      // Characters
      const insertChar = db.prepare(`
        INSERT INTO characters (id, name, role, title, avatar_url, avatar_color, personality, scenario_role, greeting, custom_instructions, is_user, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const charEleanor = 'char_eleanor_vance';
      insertChar.run(
        charEleanor,
        'Eleanor Vance',
        'ai',
        'Master Artificer',
        '',
        '#d97706',
        'Inquisitive, sharp-witted, fiercely loyal, fascinated by forgotten clockwork and arcane seals.',
        'Chief companion and scholarly guide through the forgotten spires of Aethelgard.',
        'The ward seals are dissolving faster than the archives warned. We must move cautiously.',
        'Eleanor speaks with precision and alchemical vocabulary. She is cautious but brave.',
        0,
        now,
        now
      );

      const charKaelen = 'char_kaelen_voss';
      insertChar.run(
        charKaelen,
        'Kaelen Voss',
        'ai',
        'Shadow Operative',
        '',
        '#7c3aed',
        'Laconic, street-smart, vigilant, driven by a dry sense of humor in perilous situations.',
        'Infiltration specialist and street navigator in the lower sectors.',
        'Keep your head down and your optic sensors quiet. Patrols are closing in.',
        'Speak in concise, atmospheric noir sentences. Emphasize cybernetic details.',
        0,
        now,
        now
      );

      const charPlayer = 'char_player_persona';
      insertChar.run(
        charPlayer,
        'Valen Thorne',
        'user',
        'Wandering Scholar & Scout',
        '',
        '#2563eb',
        'Resourceful explorer with an eye for ancient glyphs and covert paths.',
        'Primary protagonist and expedition lead.',
        '',
        '',
        1,
        now,
        now
      );

      // Scenarios
      const insertScenario = db.prepare(`
        INSERT INTO scenarios (id, title, description, genre, tags, cover_url, system_instructions, opening_message, world_info, is_favorite, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const sc1 = 'sc_spire_of_whispers';
      insertScenario.run(
        sc1,
        'The Spire of Whispers',
        'Investigate an ancient mountain citadel whose forgotten seals have begun to fracture after three centuries of slumber.',
        'Fantasy',
        JSON.stringify(['High Fantasy', 'Ancient Ruins', 'Magic', 'Expedition']),
        '',
        'You are an evocative, immersive fantasy author. Write sensory descriptions of architecture, mist, magic, and dialogue. Maintain tension and continuity.',
        "The storm over the jagged peaks of Aethelgard has finally broken, leaving the ancient Obsidian Spire shrouded in violet mist. At your side, Eleanor examines the humming brass astrolabe in her hands, her silver-threaded cloak damp with mountain rain.\n\n\"The ward seals are dissolving faster than the archives warned,\" she murmurs, glancing toward the arched gates carved with draconic glyphs. \"Whatever was locked in the inner sanctum three hundred years ago... it knows we're standing on the threshold.\"\n\nA deep metallic vibration shudders through the flagstones beneath your boots.",
        'The continent of Aethelgard is strewn with colossal obsidian towers left behind by the Precursor Mages. Magic functions through resonant frequencies and geometric seals.',
        1,
        now,
        now
      );

      const sc2 = 'sc_neon_and_rust';
      insertScenario.run(
        sc2,
        'Neon & Rust: Sector 9',
        'A high-stakes cyber-heist through the rain-drenched alleys and black-market relays of the Megacity underbelly.',
        'Cyberpunk',
        JSON.stringify(['Cyberpunk', 'Noir', 'Underworld', 'Heist']),
        '',
        'Emphasize cyberpunk grit, neon lighting reflections in slick pavement, chrome augmentation, corporate espionage, and atmospheric pacing.',
        "Acid rain sizzles against the cracked neon billboard above Alley 14. Steam vents billow across the wet asphalt as sirens echo four levels down in the undercity. Kaelen leans against the rusted fire escape, flicking a thumbdrive glowing with encrypted military telemetry.\n\n\"Corporation sweeps start in six minutes,\" he says, his cybernetic optic whirring as it recalibrates. \"We either upload the payload to the broadcast relay now, or we vanish into the sewer grid.\"",
        'New Kurogane City: Divided into towering corporate aeries and sunken lower sectors where augments are scavenged and electricity is siphoned from the megagrid.',
        0,
        now,
        now
      );

      // Link characters
      const linkChar = db.prepare('INSERT INTO scenario_characters (scenario_id, character_id, is_primary, created_at) VALUES (?, ?, ?, ?)');
      linkChar.run(sc1, charEleanor, 1, now);
      linkChar.run(sc1, charPlayer, 0, now);
      linkChar.run(sc2, charKaelen, 1, now);
      linkChar.run(sc2, charPlayer, 0, now);

      // Create starter chat and initial opening message for Scenario 1
      const chatId = 'chat_starter_spire';
      db.prepare(`
        INSERT INTO chats (id, scenario_id, title, user_character_id, active_provider_id, active_model_id, is_favorite, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(chatId, sc1, 'The Spire of Whispers - First Expedition', charPlayer, 'gemini', 'gemini-2.5-flash', 1, now, now);

      db.prepare(`
        INSERT INTO messages (id, chat_id, sender_type, sender_character_id, content, is_ooc, sequence_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'msg_starter_opening',
        chatId,
        'ai',
        charEleanor,
        "The storm over the jagged peaks of Aethelgard has finally broken, leaving the ancient Obsidian Spire shrouded in violet mist. At your side, Eleanor examines the humming brass astrolabe in her hands, her silver-threaded cloak damp with mountain rain.\n\n\"The ward seals are dissolving faster than the archives warned,\" she murmurs, glancing toward the arched gates carved with draconic glyphs. \"Whatever was locked in the inner sanctum three hundred years ago... it knows we're standing on the threshold.\"\n\nA deep metallic vibration shudders through the flagstones beneath your boots.",
        0,
        0,
        now,
        now
      );

      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run('002_starter_chronicles', now);
    })();
    console.log('[Migration] 002_starter_chronicles applied successfully.');
  }

  // Migration 003: Core Domain Correction (Personas, Chronicles, Story Characters, Story Sessions)
  const m3 = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get('003_core_domain_correction');
  if (!m3) {
    console.log('[Migration] Applying 003_core_domain_correction...');
    db.exec('PRAGMA foreign_keys = OFF;'); // Disable FKs for complex migration

    db.transaction(() => {
      const now = new Date().toISOString();

      // 1. Personas
      db.exec(`
        CREATE TABLE IF NOT EXISTS personas (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          pronouns TEXT NOT NULL DEFAULT '',
          appearance TEXT NOT NULL DEFAULT '',
          personality TEXT NOT NULL DEFAULT '',
          background TEXT NOT NULL DEFAULT '',
          traits TEXT NOT NULL DEFAULT '',
          role TEXT NOT NULL DEFAULT '',
          instructions TEXT NOT NULL DEFAULT '',
          avatar_path TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // 2. Chronicles
      db.exec(`
        CREATE TABLE IF NOT EXISTS chronicles (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          genre TEXT NOT NULL DEFAULT 'Fantasy',
          tags TEXT NOT NULL DEFAULT '[]',
          cover_url TEXT NOT NULL DEFAULT '',
          system_instructions TEXT NOT NULL DEFAULT '',
          opening_message TEXT NOT NULL DEFAULT '',
          world_info TEXT NOT NULL DEFAULT '',
          is_favorite INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // 3. Story Characters
      db.exec(`
        CREATE TABLE IF NOT EXISTS story_characters (
          id TEXT PRIMARY KEY,
          chronicle_id TEXT NOT NULL REFERENCES chronicles(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'ai',
          appearance TEXT NOT NULL DEFAULT '',
          personality TEXT NOT NULL DEFAULT '',
          background TEXT NOT NULL DEFAULT '',
          goals TEXT NOT NULL DEFAULT '',
          fears TEXT NOT NULL DEFAULT '',
          relationships TEXT NOT NULL DEFAULT '',
          speech_style TEXT NOT NULL DEFAULT '',
          behavior_instructions TEXT NOT NULL DEFAULT '',
          avatar_path TEXT NOT NULL DEFAULT '',
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // 4. Story Sessions
      db.exec(`
        CREATE TABLE IF NOT EXISTS story_sessions (
          id TEXT PRIMARY KEY,
          chronicle_id TEXT NOT NULL REFERENCES chronicles(id) ON DELETE CASCADE,
          active_persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          active_provider_id TEXT NOT NULL DEFAULT 'gemini',
          active_model_id TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
          is_favorite INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // 5. Messages (recreate with session_id)
      db.exec(`
        CREATE TABLE IF NOT EXISTS new_messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES story_sessions(id) ON DELETE CASCADE,
          sender_type TEXT NOT NULL,
          sender_character_id TEXT,
          content TEXT NOT NULL,
          is_ooc INTEGER NOT NULL DEFAULT 0,
          parent_message_id TEXT REFERENCES new_messages(id) ON DELETE SET NULL,
          branch_id TEXT NOT NULL DEFAULT 'main',
          active_generation_id TEXT,
          sequence_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // Data Migration
      db.exec(`
        INSERT INTO chronicles (id, title, description, genre, tags, cover_url, system_instructions, opening_message, world_info, is_favorite, created_at, updated_at)
        SELECT id, title, description, genre, tags, cover_url, system_instructions, opening_message, world_info, is_favorite, created_at, updated_at FROM scenarios;
      `);

      db.exec(`
        INSERT INTO personas (id, name, personality, role, instructions, avatar_path, created_at, updated_at)
        SELECT id, name, personality, title, custom_instructions, avatar_url, created_at, updated_at FROM characters WHERE is_user = 1;
      `);

      db.exec(`
        INSERT INTO story_characters (id, chronicle_id, name, role, personality, behavior_instructions, avatar_path, created_at, updated_at)
        SELECT c.id, sc.scenario_id, c.name, 'ai', c.personality, c.custom_instructions, c.avatar_url, c.created_at, c.updated_at 
        FROM characters c 
        JOIN scenario_characters sc ON c.id = sc.character_id 
        WHERE c.is_user = 0;
      `);

      db.exec(`
        INSERT INTO story_sessions (id, chronicle_id, active_persona_id, title, active_provider_id, active_model_id, is_favorite, created_at, updated_at)
        SELECT id, scenario_id, user_character_id, title, active_provider_id, active_model_id, is_favorite, created_at, updated_at FROM chats;
      `);

      db.exec(`
        INSERT INTO new_messages (id, session_id, sender_type, sender_character_id, content, is_ooc, parent_message_id, branch_id, active_generation_id, sequence_order, created_at, updated_at)
        SELECT id, chat_id, sender_type, sender_character_id, content, is_ooc, parent_message_id, branch_id, active_generation_id, sequence_order, created_at, updated_at FROM messages;
      `);

      // Drop dependent tables before messages
      db.exec('DROP TABLE message_generations'); 
      
      db.exec('DROP TABLE messages');
      db.exec('ALTER TABLE new_messages RENAME TO messages');

      // Recreate message_generations
      db.exec(`
        CREATE TABLE IF NOT EXISTS message_generations (
          id TEXT PRIMARY KEY,
          message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
          provider_id TEXT NOT NULL,
          model_id TEXT NOT NULL,
          prompt_snapshot TEXT,
          content TEXT NOT NULL,
          tokens_used INTEGER NOT NULL DEFAULT 0,
          generation_time_ms INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        );
      `);

      // Update memories
      db.exec(`
        CREATE TABLE IF NOT EXISTS new_memories (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES story_sessions(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
          is_pinned INTEGER NOT NULL DEFAULT 0,
          importance_score REAL NOT NULL DEFAULT 1.0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      db.exec(`
        INSERT INTO new_memories (id, session_id, content, is_pinned, importance_score, created_at, updated_at)
        SELECT id, chat_id, content, is_pinned, importance_score, created_at, updated_at FROM memories;
      `);
      db.exec('DROP TABLE memories');
      db.exec('ALTER TABLE new_memories RENAME TO memories');

      // Update story_cards & triggers
      db.exec('ALTER TABLE story_cards RENAME COLUMN scenario_id TO chronicle_id');

      // Drop old tables
      db.exec('DROP TABLE scenario_characters');
      db.exec('DROP TABLE characters');
      db.exec('DROP TABLE chats');
      db.exec('DROP TABLE scenarios');

      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run('003_core_domain_correction', now);
    })();
    db.exec('PRAGMA foreign_keys = ON;');
    console.log('[Migration] 003_core_domain_correction applied successfully.');
  }

  // Migration 004: Correct Story Cards Chronicle Foreign Key
  const m4 = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get('004_fix_story_cards_chronicle_fk');
  if (!m4) {
    console.log('[Migration] Applying 004_fix_story_cards_chronicle_fk...');
    db.exec('PRAGMA foreign_keys = OFF;');

    db.transaction(() => {
      const now = new Date().toISOString();

      // 1. Create corrected story_cards table referencing chronicles(id) with ON DELETE CASCADE
      db.exec(`
        CREATE TABLE IF NOT EXISTS new_story_cards (
          id TEXT PRIMARY KEY,
          chronicle_id TEXT REFERENCES chronicles(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'lore',
          is_pinned INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // 2. Copy existing data preserving all fields, IDs, categories, flags, and timestamps
      db.exec(`
        INSERT INTO new_story_cards (id, chronicle_id, title, content, category, is_pinned, is_active, created_at, updated_at)
        SELECT id, chronicle_id, title, content, category, is_pinned, is_active, created_at, updated_at FROM story_cards;
      `);

      // 3. Drop the obsolete table that referenced scenarios
      db.exec('DROP TABLE story_cards;');

      // 4. Rename corrected table to canonical story_cards
      db.exec('ALTER TABLE new_story_cards RENAME TO story_cards;');

      // 5. Recreate index on chronicle_id for performant lookups and joins
      db.exec('CREATE INDEX IF NOT EXISTS idx_story_cards_chronicle ON story_cards(chronicle_id);');

      // 6. Record migration
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run('004_fix_story_cards_chronicle_fk', now);
    })();

    db.exec('PRAGMA foreign_keys = ON;');

    // 7. Verify foreign keys
    const fkErrors = db.pragma('foreign_key_check') as unknown[];
    if (fkErrors && fkErrors.length > 0) {
      throw new Error(`Foreign key check failed after 004_fix_story_cards_chronicle_fk: ${JSON.stringify(fkErrors)}`);
    }

    console.log('[Migration] 004_fix_story_cards_chronicle_fk applied successfully.');
  }

  // Migration 005: Memory Engine V2 & Trigger Indexes
  const m5 = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get('005_memory_engine_v2');
  if (!m5) {
    console.log('[Migration] Applying 005_memory_engine_v2...');
    db.exec('PRAGMA foreign_keys = OFF;');

    db.transaction(() => {
      const now = new Date().toISOString();

      // 1. Create canonical memories table
      db.exec(`
        CREATE TABLE IF NOT EXISTS new_memories (
          id TEXT PRIMARY KEY,
          chronicle_id TEXT NOT NULL REFERENCES chronicles(id) ON DELETE CASCADE,
          session_id TEXT NOT NULL REFERENCES story_sessions(id) ON DELETE CASCADE,
          type TEXT NOT NULL DEFAULT 'event',
          content TEXT NOT NULL,
          importance INTEGER NOT NULL DEFAULT 3,
          status TEXT NOT NULL DEFAULT 'active',
          source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
          is_pinned INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // 2. Check if old memories table exists and copy data
      const oldMemoriesExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories'").get();
      if (oldMemoriesExists) {
        // Copy existing memories if any exist, joining story_sessions for chronicle_id
        db.exec(`
          INSERT INTO new_memories (id, chronicle_id, session_id, type, content, importance, status, is_pinned, created_at, updated_at)
          SELECT 
            m.id,
            COALESCE(s.chronicle_id, (SELECT id FROM chronicles LIMIT 1), 'default_chronicle'),
            m.session_id,
            'event',
            m.content,
            CAST(ROUND(COALESCE(m.importance_score, 3.0)) AS INTEGER),
            'active',
            COALESCE(m.is_pinned, 0),
            m.created_at,
            m.updated_at
          FROM memories m
          LEFT JOIN story_sessions s ON m.session_id = s.id;
        `);
        db.exec('DROP TABLE memories;');
      }

      // 3. Rename new_memories to memories
      db.exec('ALTER TABLE new_memories RENAME TO memories;');

      // 4. Create performance indexes for memories
      db.exec('CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);');
      db.exec('CREATE INDEX IF NOT EXISTS idx_memories_chronicle ON memories(chronicle_id);');
      db.exec('CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);');
      db.exec('CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);');

      // 5. Create performance indexes for story card triggers
      db.exec('CREATE INDEX IF NOT EXISTS idx_triggers_story_card ON story_card_triggers(story_card_id);');
      db.exec('CREATE INDEX IF NOT EXISTS idx_triggers_keyword ON story_card_triggers(keyword);');

      // 6. Record migration
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run('005_memory_engine_v2', now);
    })();

    db.exec('PRAGMA foreign_keys = ON;');

    // 7. Verify foreign keys
    const fkErrors = db.pragma('foreign_key_check') as unknown[];
    if (fkErrors && fkErrors.length > 0) {
      throw new Error(`Foreign key check failed after 005_memory_engine_v2: ${JSON.stringify(fkErrors)}`);
    }

    console.log('[Migration] 005_memory_engine_v2 applied successfully.');
  }

  // Migration 006: Message Parent Session Integrity Triggers
  const m6 = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get('006_message_parent_session_integrity');
  if (!m6) {
    console.log('[Migration] Applying 006_message_parent_session_integrity...');
    db.exec('PRAGMA foreign_keys = OFF;');

    db.transaction(() => {
      const now = new Date().toISOString();

      // Enforce that child.session_id === parent.session_id on insert
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_messages_parent_session_check_insert
        BEFORE INSERT ON messages
        FOR EACH ROW
        WHEN NEW.parent_message_id IS NOT NULL
        BEGIN
          SELECT RAISE(ABORT, 'Cross-session parent message relationship is forbidden: parent and child messages must share the same session_id')
          WHERE (SELECT session_id FROM messages WHERE id = NEW.parent_message_id) != NEW.session_id;
        END;
      `);

      // Enforce that child.session_id === parent.session_id on update of parent_message_id or session_id
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_messages_parent_session_check_update
        BEFORE UPDATE OF parent_message_id, session_id ON messages
        FOR EACH ROW
        WHEN NEW.parent_message_id IS NOT NULL
        BEGIN
          SELECT RAISE(ABORT, 'Cross-session parent message relationship is forbidden: parent and child messages must share the same session_id')
          WHERE (SELECT session_id FROM messages WHERE id = NEW.parent_message_id) != NEW.session_id;
        END;
      `);

      // Record migration
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run('006_message_parent_session_integrity', now);
    })();

    db.exec('PRAGMA foreign_keys = ON;');

    // Verify foreign keys
    const fkErrors = db.pragma('foreign_key_check') as unknown[];
    if (fkErrors && fkErrors.length > 0) {
      throw new Error(`Foreign key check failed after 006_message_parent_session_integrity: ${JSON.stringify(fkErrors)}`);
    }

    console.log('[Migration] 006_message_parent_session_integrity applied successfully.');
  }

  // Migration 007: Phase 4.1 Branch/Message Tree Foundation
  const m7 = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get('007_branch_architecture');
  if (!m7) {
    console.log('[Migration] Applying 007_branch_architecture...');
    db.exec('PRAGMA foreign_keys = OFF;');
    db.transaction(() => {
      const now = new Date().toISOString();
      const crypto = require('crypto'); // Ensure crypto is available

      // 1. Create story_branches table
      db.exec(`
        CREATE TABLE IF NOT EXISTS story_branches (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES story_sessions(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            head_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
            is_active INTEGER NOT NULL DEFAULT 0,
            is_archived INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK (is_active IN (0, 1)),
            CHECK (is_archived IN (0, 1)),
            CHECK (NOT (is_active = 1 AND is_archived = 1))
        );
        CREATE INDEX IF NOT EXISTS idx_story_branches_session ON story_branches(session_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_story_branches_active ON story_branches(session_id) WHERE is_active = 1;
      `);

      // Branch integrity triggers
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_branches_head_session_check_insert
        BEFORE INSERT ON story_branches
        FOR EACH ROW
        WHEN NEW.head_message_id IS NOT NULL
        BEGIN
          SELECT RAISE(ABORT, 'Cross-session branch head relationship is forbidden')
          WHERE (SELECT session_id FROM messages WHERE id = NEW.head_message_id) != NEW.session_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_branches_head_session_check_update
        BEFORE UPDATE OF head_message_id, session_id ON story_branches
        FOR EACH ROW
        WHEN NEW.head_message_id IS NOT NULL
        BEGIN
          SELECT RAISE(ABORT, 'Cross-session branch head relationship is forbidden')
          WHERE (SELECT session_id FROM messages WHERE id = NEW.head_message_id) != NEW.session_id;
        END;
      `);

      // 2. Drop messages.branch_id
      try {
        db.exec('ALTER TABLE messages DROP COLUMN branch_id;');
      } catch (e) {
        console.warn('Could not drop branch_id (might not exist):', e.message);
      }
      
      // Index for parent_message_id
      db.exec('CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_message_id);');

      // 3. Backfill message tree and create branches
      const sessions = db.prepare('SELECT id FROM story_sessions').all() as any[];
      for (const session of sessions) {
        const messages = db.prepare('SELECT id FROM messages WHERE session_id = ? ORDER BY sequence_order ASC').all(session.id) as any[];
        
        let parentId = null;
        for (const msg of messages) {
          db.prepare('UPDATE messages SET parent_message_id = ? WHERE id = ?').run(parentId, msg.id);
          parentId = msg.id;
        }

        // Create Main Timeline branch
        const latestMessage = db.prepare('SELECT id FROM messages WHERE session_id = ? ORDER BY sequence_order DESC LIMIT 1').get(session.id) as any;
        db.prepare(`
          INSERT INTO story_branches (id, session_id, name, head_message_id, is_active, is_archived, created_at, updated_at)
          VALUES (?, ?, 'Main Timeline', ?, 1, 0, ?, ?)
        `).run(crypto.randomUUID(), session.id, latestMessage ? latestMessage.id : null, now, now);
      }

      // 4. Memory source-message migration (recreate memories to enforce ON DELETE CASCADE)
      db.exec(`
        CREATE TABLE IF NOT EXISTS new_memories_007 (
          id TEXT PRIMARY KEY,
          chronicle_id TEXT NOT NULL REFERENCES chronicles(id) ON DELETE CASCADE,
          session_id TEXT NOT NULL REFERENCES story_sessions(id) ON DELETE CASCADE,
          type TEXT NOT NULL DEFAULT 'event',
          content TEXT NOT NULL,
          importance INTEGER NOT NULL DEFAULT 3,
          status TEXT NOT NULL DEFAULT 'active',
          source_message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
          is_pinned INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO new_memories_007 SELECT id, chronicle_id, session_id, type, content, importance, status, source_message_id, is_pinned, created_at, updated_at FROM memories;
        DROP TABLE memories;
        ALTER TABLE new_memories_007 RENAME TO memories;
        
        CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);
        CREATE INDEX IF NOT EXISTS idx_memories_chronicle ON memories(chronicle_id);
        CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
        CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
        CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source_message_id);
      `);

      // Backfill source_message_id deterministically
      const memories = db.prepare('SELECT id, session_id, created_at, source_message_id FROM memories').all() as any[];
      for (const mem of memories) {
        if (mem.source_message_id) continue;

        // Nearest preceding message
        const closestMessage = db.prepare(`
          SELECT id FROM messages 
          WHERE session_id = ? AND created_at <= ? 
          ORDER BY created_at DESC, sequence_order DESC, id DESC 
          LIMIT 1
        `).get(mem.session_id, mem.created_at) as any;

        if (closestMessage) {
          db.prepare('UPDATE memories SET source_message_id = ? WHERE id = ?').run(closestMessage.id, mem.id);
        } else {
          throw new Error(`Migration failed: Cannot deterministically backfill source_message_id for memory ${mem.id}`);
        }
      }

      // 5. Memory source integrity triggers
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_memories_source_session_check_insert
        BEFORE INSERT ON memories
        FOR EACH ROW
        WHEN NEW.source_message_id IS NOT NULL
        BEGIN
          SELECT RAISE(ABORT, 'Cross-session memory source relationship is forbidden')
          WHERE (SELECT session_id FROM messages WHERE id = NEW.source_message_id) != NEW.session_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_memories_source_session_check_update
        BEFORE UPDATE OF source_message_id, session_id ON memories
        FOR EACH ROW
        WHEN NEW.source_message_id IS NOT NULL
        BEGIN
          SELECT RAISE(ABORT, 'Cross-session memory source relationship is forbidden')
          WHERE (SELECT session_id FROM messages WHERE id = NEW.source_message_id) != NEW.session_id;
        END;
      `);

      // 6. Memory supersessions
      db.exec(`
        CREATE TABLE IF NOT EXISTS memory_supersessions (
            id TEXT PRIMARY KEY,
            superseding_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
            superseded_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            CHECK (superseding_id <> superseded_id),
            UNIQUE (superseding_id, superseded_id)
        );
        CREATE INDEX IF NOT EXISTS idx_memory_supersessions_superseding ON memory_supersessions(superseding_id);
        CREATE INDEX IF NOT EXISTS idx_memory_supersessions_superseded ON memory_supersessions(superseded_id);

        CREATE TRIGGER IF NOT EXISTS trg_memory_supersessions_session_check_insert
        BEFORE INSERT ON memory_supersessions
        FOR EACH ROW
        BEGIN
          SELECT RAISE(ABORT, 'Cross-session supersession is forbidden')
          WHERE (SELECT session_id FROM memories WHERE id = NEW.superseding_id) != (SELECT session_id FROM memories WHERE id = NEW.superseded_id);
        END;
      `);

      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run('007_branch_architecture', now);
    })();
    db.exec('PRAGMA foreign_keys = ON;');
    const fkErrors = db.pragma('foreign_key_check') as unknown[];
    if (fkErrors && fkErrors.length > 0) {
      throw new Error(`Foreign key check failed after 007_branch_architecture: ${JSON.stringify(fkErrors)}`);
    }
    console.log('[Migration] 007_branch_architecture applied successfully.');
  }

}

