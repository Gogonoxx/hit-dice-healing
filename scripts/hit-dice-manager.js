/**
 * Hit Dice Healing - Core Manager
 * Handles all Hit Dice logic, storage, and calculations
 */

export class HitDiceManager {

  /**
   * Die type mapping by class name (lowercase)
   * d6: Psychic, Sorcerer, Witch, Wizard
   * d8: Alchemist, Animist, Bard, Cleric, Commander, Druid, Gunslinger, Investigator, Inventor, Kineticist, Oracle, Rogue, Thaumaturge
   * d10: Champion, Exemplar, Fighter, Guardian, Magus, Monk, Ranger, Summoner, Swashbuckler
   * d12: Barbarian
   */
  static CLASS_DIE_TYPES = {
    // d6 classes
    psychic: 6,
    sorcerer: 6,
    witch: 6,
    wizard: 6,

    // d8 classes
    alchemist: 8,
    animist: 8,
    bard: 8,
    cleric: 8,
    commander: 8,
    druid: 8,
    gunslinger: 8,
    investigator: 8,
    inventor: 8,
    kineticist: 8,
    oracle: 8,
    rogue: 8,
    thaumaturge: 8,

    // d10 classes
    champion: 10,
    exemplar: 10,
    fighter: 10,
    guardian: 10,
    magus: 10,
    monk: 10,
    ranger: 10,
    summoner: 10,
    swashbuckler: 10,

    // d12 classes
    barbarian: 12
  };

  /**
   * Get maximum Hit Dice for an actor (Level + 1)
   * @param {Actor} actor - The PF2E actor
   * @returns {number} Maximum Hit Dice
   */
  static getMaxHitDice(actor) {
    const level = actor.system?.details?.level?.value ?? 1;
    return level + 1;
  }

  /**
   * Get current available Hit Dice from actor flags
   * @param {Actor} actor - The PF2E actor
   * @returns {number} Current Hit Dice
   */
  static getCurrentHitDice(actor) {
    const stored = actor.getFlag('hit-dice-healing', 'current');
    // If no flag set, return max (first use)
    if (stored === undefined || stored === null) {
      return this.getMaxHitDice(actor);
    }
    return stored;
  }

  /**
   * Set current Hit Dice in actor flags
   * @param {Actor} actor - The PF2E actor
   * @param {number} value - New Hit Dice value
   */
  static async setCurrentHitDice(actor, value) {
    const max = this.getMaxHitDice(actor);
    const clamped = Math.max(0, Math.min(value, max));
    await actor.setFlag('hit-dice-healing', 'current', clamped);
  }

  /**
   * Get the die type for an actor based on their class
   * @param {Actor} actor - The PF2E actor
   * @returns {number} Die type (6, 8, 10, or 12)
   */
  static getDieType(actor) {
    // Try multiple paths to get class name
    const className = actor.class?.name?.toLowerCase()
      ?? actor.system?.details?.class?.name?.toLowerCase()
      ?? actor.items?.find(i => i.type === 'class')?.name?.toLowerCase();

    if (className && this.CLASS_DIE_TYPES[className]) {
      return this.CLASS_DIE_TYPES[className];
    }

    // Default to d8 if class not found
    console.warn(`Hit Dice Healing | Unknown class "${className}", defaulting to d8`);
    return 8;
  }

  /**
   * Get Constitution modifier for an actor
   * @param {Actor} actor - The PF2E actor
   * @returns {number} CON modifier
   */
  static getConModifier(actor) {
    return actor.system?.abilities?.con?.mod ?? 0;
  }

  /**
   * Calculate healing range for display
   * @param {number} diceCount - Number of dice to roll
   * @param {number} dieType - Die type (6, 8, 10, 12)
   * @param {number} conMod - Constitution modifier
   * @returns {{min: number, max: number}} Range object
   */
  static calculateRange(diceCount, dieType, conMod) {
    const totalConMod = conMod * diceCount;
    // Minimum is 1 HP per die spent (even with negative CON)
    const rawMin = diceCount + totalConMod;
    const min = Math.max(diceCount, rawMin);
    const max = Math.max(diceCount, (dieType * diceCount) + totalConMod);
    return { min, max };
  }

  /**
   * Build the roll formula string
   * @param {number} diceCount - Number of dice
   * @param {number} dieType - Die type
   * @param {number} conMod - CON modifier
   * @returns {string} Roll formula (e.g., "3d8+6")
   */
  static buildFormula(diceCount, dieType, conMod) {
    const totalMod = conMod * diceCount;
    if (totalMod === 0) {
      return `${diceCount}d${dieType}`;
    } else if (totalMod > 0) {
      return `${diceCount}d${dieType}+${totalMod}`;
    } else {
      return `${diceCount}d${dieType}${totalMod}`;
    }
  }

  /**
   * Roll Hit Dice and apply healing to the actor
   * @param {Actor} actor - The PF2E actor
   * @param {number} diceCount - Number of Hit Dice to spend
   * @returns {Promise<{roll: Roll, healing: number}>} Roll result and healing applied
   */
  static async rollAndHeal(actor, diceCount) {
    const current = this.getCurrentHitDice(actor);

    // Validate
    if (diceCount > current) {
      ui.notifications.warn(game.i18n.format('HIT_DICE_HEALING.NotEnoughDiceNamed', { name: actor.name }));
      return null;
    }

    if (diceCount < 1) {
      ui.notifications.warn(game.i18n.localize('HIT_DICE_HEALING.MinimumOneDie'));
      return null;
    }

    const dieType = this.getDieType(actor);
    const conMod = this.getConModifier(actor);
    const formula = this.buildFormula(diceCount, dieType, conMod);

    // Roll the dice
    const roll = await new Roll(formula).evaluate();

    // Apply minimum healing (1 HP per die spent)
    const healing = Math.max(roll.total, diceCount);

    // Calculate new HP (capped at max)
    const currentHP = actor.system.attributes.hp.value;
    const maxHP = actor.system.attributes.hp.max;
    const newHP = Math.min(currentHP + healing, maxHP);
    const actualHealing = newHP - currentHP;

    // Update actor HP
    await actor.update({ 'system.attributes.hp.value': newHP });

    // Reduce Hit Dice
    await this.setCurrentHitDice(actor, current - diceCount);

    // Send chat message
    await this.sendChatMessage(actor, roll, healing, actualHealing, diceCount, current - diceCount);

    return { roll, healing: actualHealing };
  }

  /**
   * Send a chat message with the Hit Dice roll result
   * @param {Actor} actor - The actor
   * @param {Roll} roll - The dice roll
   * @param {number} totalHealing - Total healing from roll
   * @param {number} actualHealing - Actual HP healed (may be less if at max)
   * @param {number} diceSpent - Number of dice spent
   * @param {number} remaining - Remaining Hit Dice
   */
  static async sendChatMessage(actor, roll, totalHealing, actualHealing, diceSpent, remaining) {
    const max = this.getMaxHitDice(actor);
    const dieType = this.getDieType(actor);

    const dieWord = diceSpent === 1
      ? game.i18n.localize('HIT_DICE_HEALING.HitDie')
      : game.i18n.localize('HIT_DICE_HEALING.HitDicePlural');

    const content = await renderTemplate(
      'modules/hit-dice-healing/templates/chat-roll.hbs',
      {
        actorName: actor.name,
        actorImg: actor.img,
        diceSpent,
        dieType,
        dieWord,
        formula: roll.formula,
        rollTotal: roll.total,
        healing: actualHealing,
        remaining,
        maxDice: max,
        wasLimited: totalHealing > actualHealing
      }
    );

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      rolls: [roll],
      type: CONST.CHAT_MESSAGE_TYPES.ROLL
    });
  }

  /**
   * Replenish all Hit Dice (called on Long Rest)
   * @param {Actor} actor - The PF2E actor
   */
  static async replenishHitDice(actor) {
    const max = this.getMaxHitDice(actor);
    const current = this.getCurrentHitDice(actor);

    // Only notify if actually replenishing
    if (current < max) {
      await this.setCurrentHitDice(actor, max);
      return { replenished: max - current, total: max };
    }

    return { replenished: 0, total: max };
  }

  // ============================================================================
  // SPELLSLOT RECOVERY METHODS
  // ============================================================================

  /**
   * Check if an actor is a spellcaster (has spellcasting features)
   * @param {Actor} actor - The PF2E actor
   * @returns {boolean} True if actor has spellcasting
   */
  static isSpellcaster(actor) {
    // spellcastingFeatures returns only prepared/spontaneous entries (not focus/innate)
    return actor.spellcasting?.spellcastingFeatures?.length > 0;
  }

  /**
   * Get all depleted spellslots (where value < max) for an actor
   * @param {Actor} actor - The PF2E actor
   * @returns {Array} Array of depleted slot objects
   */
  static getDepletedSpellslots(actor) {
    const depletedSlots = [];

    if (!actor.spellcasting) return depletedSlots;

    // Only get "regular" spellcasting entries (prepared/spontaneous, not focus/innate)
    const entries = actor.spellcasting.spellcastingFeatures;

    for (const entry of entries) {
      const entryName = entry.name;
      const entryId = entry.id;
      const slots = entry.system?.slots;

      if (!slots) continue;

      // Check each slot level (slot1 through slot10)
      for (let level = 1; level <= 10; level++) {
        const slotKey = `slot${level}`;
        const slotData = slots[slotKey];

        if (!slotData || slotData.max === 0) continue;

        // Only add if depleted (value < max)
        if (slotData.value < slotData.max) {
          depletedSlots.push({
            entryId,
            entryName,
            level,
            current: slotData.value,
            max: slotData.max
          });
        }
      }
    }

    // Sort by level ascending
    return depletedSlots.sort((a, b) => a.level - b.level);
  }

  /**
   * Restore a single spellslot by spending Hit Dice
   * Cost: Slot Level = Hit Dice required (e.g., Level 5 slot = 5 Hit Dice)
   * @param {Actor} actor - The PF2E actor
   * @param {string} entryId - The spellcasting entry ID
   * @param {number} slotLevel - The slot level to restore (1-10)
   * @returns {Promise<boolean>} Success status
   */
  static async restoreSpellslot(actor, entryId, slotLevel) {
    const hitDiceCost = slotLevel; // Cost equals slot level
    const current = this.getCurrentHitDice(actor);

    // Validate Hit Dice
    if (hitDiceCost > current) {
      ui.notifications.warn(game.i18n.format('HIT_DICE_HEALING.NotEnoughDiceForSlot', {
        cost: hitDiceCost,
        current: current
      }));
      return false;
    }

    // Find the spellcasting entry
    const entry = actor.items.get(entryId);
    if (!entry) {
      ui.notifications.error('Spellcasting entry not found!');
      return false;
    }

    const slotKey = `slot${slotLevel}`;
    const slotData = entry.system.slots[slotKey];

    if (!slotData || slotData.value >= slotData.max) {
      ui.notifications.warn(game.i18n.localize('HIT_DICE_HEALING.SlotAlreadyFull'));
      return false;
    }

    // Restore one slot
    const newValue = slotData.value + 1;
    await entry.update({
      [`system.slots.${slotKey}.value`]: newValue
    });

    // Deduct Hit Dice
    await this.setCurrentHitDice(actor, current - hitDiceCost);

    // Send chat message
    await this.sendSpellslotChatMessage(actor, entry.name, slotLevel, hitDiceCost, current - hitDiceCost);

    return true;
  }

  /**
   * Send a chat message for spellslot restoration
   * @param {Actor} actor - The actor
   * @param {string} entryName - Name of the spellcasting entry
   * @param {number} slotLevel - The restored slot level
   * @param {number} hitDiceSpent - Hit Dice spent
   * @param {number} remaining - Remaining Hit Dice
   */
  static async sendSpellslotChatMessage(actor, entryName, slotLevel, hitDiceSpent, remaining) {
    const content = game.i18n.format('HIT_DICE_HEALING.SpellslotRestoredDesc', {
      name: `<strong>${actor.name}</strong>`,
      level: slotLevel,
      entry: entryName,
      cost: hitDiceSpent
    });

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER
    });
  }
}
