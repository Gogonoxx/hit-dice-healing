/**
 * Hit Dice Healing - Modal Application
 * ApplicationV2 modal for selecting and rolling Hit Dice
 */

import { HitDiceManager } from './hit-dice-manager.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class HitDiceModal extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: 'hit-dice-modal',
    classes: ['hit-dice-healing', 'hit-dice-modal'],
    tag: 'div',
    window: {
      title: 'Hit Dice',
      icon: 'fas fa-heart',
      resizable: false
    },
    position: {
      width: 340,
      height: 'auto'
    },
    actions: {
      increment: HitDiceModal.#onIncrement,
      decrement: HitDiceModal.#onDecrement,
      roll: HitDiceModal.#onRoll,
      switchTab: HitDiceModal.#onSwitchTab,
      restoreSlot: HitDiceModal.#onRestoreSlot
    }
  };

  static PARTS = {
    form: {
      template: 'modules/hit-dice-healing/templates/hit-dice-modal.hbs'
    }
  };

  /**
   * @param {Actor} actor - The actor to roll Hit Dice for
   */
  constructor(actor) {
    super();
    this.actor = actor;
    this.diceToRoll = 1;
    this._activeTab = 'healing'; // Default tab
  }

  /**
   * Prepare context data for the template
   */
  async _prepareContext() {
    const current = HitDiceManager.getCurrentHitDice(this.actor);
    const max = HitDiceManager.getMaxHitDice(this.actor);
    const dieType = HitDiceManager.getDieType(this.actor);
    const conMod = HitDiceManager.getConModifier(this.actor);

    // Clamp diceToRoll to available dice
    if (this.diceToRoll > current) {
      this.diceToRoll = Math.max(1, current);
    }

    const range = HitDiceManager.calculateRange(this.diceToRoll, dieType, conMod);
    const formula = HitDiceManager.buildFormula(this.diceToRoll, dieType, conMod);

    // Spellcaster data
    const isSpellcaster = HitDiceManager.isSpellcaster(this.actor);
    let depletedSlots = [];

    if (isSpellcaster) {
      depletedSlots = HitDiceManager.getDepletedSpellslots(this.actor).map(slot => ({
        ...slot,
        canAfford: current >= slot.level
      }));
    }

    // Tab state (default to healing for non-spellcasters)
    const activeTab = isSpellcaster ? this._activeTab : 'healing';

    return {
      actor: this.actor,
      actorName: this.actor.name,
      current,
      max,
      dieType,
      conMod,
      diceToRoll: this.diceToRoll,
      formula,
      rangeMin: range.min,
      rangeMax: range.max,
      canIncrement: this.diceToRoll < current,
      canDecrement: this.diceToRoll > 1,
      canRoll: current > 0,
      hasNoDice: current === 0,
      // Spellcaster data
      isSpellcaster,
      depletedSlots,
      // Tab state
      healingTabActive: activeTab === 'healing',
      spellsTabActive: activeTab === 'spells'
    };
  }

  /**
   * Handle increment button click
   */
  static #onIncrement(event, target) {
    const current = HitDiceManager.getCurrentHitDice(this.actor);
    if (this.diceToRoll < current) {
      this.diceToRoll++;
      this.render();
    }
  }

  /**
   * Handle decrement button click
   */
  static #onDecrement(event, target) {
    if (this.diceToRoll > 1) {
      this.diceToRoll--;
      this.render();
    }
  }

  /**
   * Handle roll button click
   */
  static async #onRoll(event, target) {
    const result = await HitDiceManager.rollAndHeal(this.actor, this.diceToRoll);

    if (result) {
      // Reset to 1 die for next roll
      this.diceToRoll = 1;
      // Re-render to show updated values
      this.render();
    }
  }

  /**
   * Handle tab switch
   */
  static #onSwitchTab(event, target) {
    const tab = target.dataset.tab;
    if (tab && ['healing', 'spells'].includes(tab)) {
      this._activeTab = tab;
      this.render();
    }
  }

  /**
   * Handle spellslot restore button click
   */
  static async #onRestoreSlot(event, target) {
    const entryId = target.dataset.entry;
    const slotLevel = parseInt(target.dataset.level, 10);

    if (!entryId || isNaN(slotLevel)) {
      console.error('Hit Dice Healing | Invalid restore slot data', { entryId, slotLevel });
      return;
    }

    const success = await HitDiceManager.restoreSpellslot(this.actor, entryId, slotLevel);

    if (success) {
      // Re-render to show updated values
      this.render();
    }
  }
}
