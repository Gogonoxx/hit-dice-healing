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
      width: 320,
      height: 'auto'
    },
    actions: {
      increment: HitDiceModal.#onIncrement,
      decrement: HitDiceModal.#onDecrement,
      roll: HitDiceModal.#onRoll
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
      hasNoDice: current === 0
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
}
