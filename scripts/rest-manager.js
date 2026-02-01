/**
 * Rest Manager - Handles Short, Long, and Full rest types
 * Replaces PF2E's default "Rest for the Night" with Gritfinder's three-tier rest system.
 *
 * Short Rest (10 min): Spend Hit Dice to heal HP.
 * Long Rest (8 hours): Restore Hit Dice, Focus Points, conditions, daily resources.
 *                       Does NOT restore HP or spell slots.
 * Full Rest (24 hours): Complete recovery (everything). Requires safe location.
 */

import { HitDiceManager } from './hit-dice-manager.js';
import { HitDiceModal } from './hit-dice-modal.js';

export class RestManager {

  /**
   * Show the rest type selection dialog.
   * Replaces PF2E's default "Rest for the Night" confirmation.
   * @param {Actor} actor - The PF2E character actor
   */
  static async showRestDialog(actor) {
    const i18n = (key, data) => data
      ? game.i18n.format(`HIT_DICE_HEALING.${key}`, data)
      : game.i18n.localize(`HIT_DICE_HEALING.${key}`);

    const content = `
      <div class="hit-dice-rest-dialog">
        <div class="rest-option" data-rest="short">
          <div class="rest-icon"><i class="fas fa-mug-hot"></i></div>
          <div class="rest-details">
            <h4>${i18n('ShortRestLabel')}</h4>
            <span class="rest-time">${i18n('ShortRestTime')}</span>
            <p>${i18n('ShortRestDesc')}</p>
          </div>
        </div>
        <div class="rest-option" data-rest="long">
          <div class="rest-icon"><i class="fas fa-moon"></i></div>
          <div class="rest-details">
            <h4>${i18n('LongRestLabel')}</h4>
            <span class="rest-time">${i18n('LongRestTime')}</span>
            <p>${i18n('LongRestDesc')}</p>
          </div>
        </div>
        <div class="rest-option" data-rest="full">
          <div class="rest-icon"><i class="fas fa-house-chimney"></i></div>
          <div class="rest-details">
            <h4>${i18n('FullRestLabel')}</h4>
            <span class="rest-time">${i18n('FullRestTime')}</span>
            <p>${i18n('FullRestDesc')}</p>
          </div>
        </div>
      </div>
    `;

    const result = await foundry.applications.api.DialogV2.wait({
      window: {
        title: i18n('RestTitle'),
        icon: 'fas fa-bed'
      },
      content,
      buttons: [
        {
          action: 'short',
          label: i18n('ShortRestLabel'),
          icon: 'fas fa-mug-hot',
          callback: () => 'short'
        },
        {
          action: 'long',
          label: i18n('LongRestLabel'),
          icon: 'fas fa-moon',
          callback: () => 'long'
        },
        {
          action: 'full',
          label: i18n('FullRestLabel'),
          icon: 'fas fa-house-chimney',
          callback: () => 'full'
        }
      ],
      rejectClose: false,
      close: () => null
    });

    // Handle the chosen rest type
    if (!result) return;

    switch (result) {
      case 'short':
        return this.performShortRest(actor);
      case 'long':
        return this.performLongRest(actor);
      case 'full':
        return this.performFullRest(actor);
    }
  }

  // ============================================================================
  // Short Rest
  // ============================================================================

  /**
   * Perform a Short Rest - opens the Hit Dice modal for spending dice.
   * @param {Actor} actor - The PF2E character actor
   */
  static performShortRest(actor) {
    new HitDiceModal(actor).render(true);
  }

  // ============================================================================
  // Long Rest
  // ============================================================================

  /**
   * Perform a Long Rest.
   * Restores Hit Dice, Focus Points, handles conditions, refreshes daily resources.
   * Does NOT restore HP or spell slots.
   * @param {Actor} actor - The PF2E character actor
   */
  static async performLongRest(actor) {
    const messages = [];
    const updates = {};

    // 1. Restore all Hit Dice
    const hdResult = await HitDiceManager.replenishHitDice(actor);
    if (hdResult.replenished > 0) {
      messages.push(game.i18n.format('HIT_DICE_HEALING.HitDiceRestored', { count: hdResult.replenished }));
    } else {
      messages.push(game.i18n.localize('HIT_DICE_HEALING.HitDiceAlreadyFull'));
    }

    // 2. Restore Focus Points
    const focus = actor.system.resources?.focus;
    if (focus && focus.max > 0) {
      if (focus.value < focus.max) {
        updates['system.resources.focus.value'] = focus.max;
        messages.push(game.i18n.localize('HIT_DICE_HEALING.FocusRestored'));
      } else {
        messages.push(game.i18n.localize('HIT_DICE_HEALING.FocusAlreadyFull'));
      }
    }

    // 3. Handle conditions
    await this._handleRestConditions(actor, messages);

    // 4. Refresh daily resources
    await this._refreshDailyResources(actor, messages, updates);

    // Apply batched updates
    if (Object.keys(updates).length > 0) {
      await actor.update(updates, { render: false });
    }

    // 5. Send chat message
    await this._sendRestChatMessage(actor, 'long', messages);

    // 6. Re-render sheet
    if (actor.sheet?.rendered) {
      actor.sheet.render(false);
    }
  }

  // ============================================================================
  // Full Rest
  // ============================================================================

  /**
   * Perform a Full Rest.
   * Calls PF2E's built-in rest (HP, spell slots, conditions, etc.)
   * then also restores Hit Dice.
   * @param {Actor} actor - The PF2E character actor
   */
  static async performFullRest(actor) {
    // Call PF2E's original rest for the night (handles HP, slots, conditions, etc.)
    if (game.pf2e?.actions?.restForTheNight) {
      await game.pf2e.actions.restForTheNight({ actors: actor, skipDialog: true });
    }

    // Restore Hit Dice (not handled by PF2E's rest)
    const hdResult = await HitDiceManager.replenishHitDice(actor);

    // Send additional notification about HD
    if (hdResult.replenished > 0) {
      const msg = game.i18n.format('HIT_DICE_HEALING.HitDiceRestored', { count: hdResult.replenished });
      ui.notifications.info(`${actor.name}: ${msg}`);
    }
  }

  // ============================================================================
  // Internal Helpers
  // ============================================================================

  /**
   * Handle condition changes during Long Rest.
   * Removes fatigued, decreases doomed/drained by 1,
   * removes wounded only if at max HP.
   * @param {Actor} actor
   * @param {string[]} messages - Array to push status messages into
   */
  static async _handleRestConditions(actor, messages) {
    // Remove fatigued
    if (actor.hasCondition('fatigued')) {
      await actor.decreaseCondition('fatigued', { forceRemove: true });
      messages.push(game.i18n.format('HIT_DICE_HEALING.ConditionRemoved', { condition: 'Fatigued' }));
    }

    // Decrease doomed by 1
    if (actor.hasCondition('doomed')) {
      const doomed = actor.getCondition('doomed');
      if (doomed?.value <= 1) {
        await actor.decreaseCondition('doomed', { forceRemove: true });
        messages.push(game.i18n.format('HIT_DICE_HEALING.ConditionRemoved', { condition: 'Doomed' }));
      } else {
        await actor.decreaseCondition('doomed');
        messages.push(game.i18n.format('HIT_DICE_HEALING.ConditionReduced', { condition: 'Doomed' }));
      }
    }

    // Decrease drained by 1
    if (actor.hasCondition('drained')) {
      const drained = actor.getCondition('drained');
      if (drained?.value <= 1) {
        await actor.decreaseCondition('drained', { forceRemove: true });
        messages.push(game.i18n.format('HIT_DICE_HEALING.ConditionRemoved', { condition: 'Drained' }));
      } else {
        await actor.decreaseCondition('drained');
        messages.push(game.i18n.format('HIT_DICE_HEALING.ConditionReduced', { condition: 'Drained' }));
      }
    }

    // Remove wounded only if at max HP
    if (actor.hasCondition('wounded')) {
      const hp = actor.system.attributes.hp;
      if (hp.value >= hp.max) {
        await actor.decreaseCondition('wounded', { forceRemove: true });
        messages.push(game.i18n.format('HIT_DICE_HEALING.ConditionRemoved', { condition: 'Wounded' }));
      } else {
        messages.push(game.i18n.localize('HIT_DICE_HEALING.WoundsNotHealed'));
      }
    }
  }

  /**
   * Refresh daily resources during Long Rest.
   * Handles wands, reagents, action frequencies, daily crafting, temporary items.
   * @param {Actor} actor
   * @param {string[]} messages - Array to push status messages into
   * @param {Object} updates - Batched actor updates
   */
  static async _refreshDailyResources(actor, messages, updates) {
    let dailyRefreshed = false;

    // Recharge wands (reset overcharge tracking)
    const wands = actor.items.filter(i =>
      i.type === 'consumable' && i.system?.consumableType?.value === 'wand'
    );
    for (const wand of wands) {
      // Wands in PF2E track daily usage via frequency
      if (wand.system?.frequency) {
        await wand.update({
          'system.frequency.value': wand.system.frequency.max
        }, { render: false });
        dailyRefreshed = true;
      }
    }

    // Restore infused reagents (Alchemist)
    const reagents = actor.system.resources?.crafting?.infusedReagents;
    if (reagents && reagents.value < reagents.max) {
      updates['system.resources.crafting.infusedReagents.value'] = reagents.max;
      messages.push(game.i18n.localize('HIT_DICE_HEALING.InfusedReagentsRestored'));
    }

    // Reset daily crafting flag
    if (actor.flags?.pf2e?.dailyCraftingComplete) {
      await actor.setFlag('pf2e', 'dailyCraftingComplete', false);
    }

    // Refresh action frequencies (daily-use abilities)
    for (const item of actor.items) {
      if (item.system?.frequency?.per === 'day' && item.system.frequency.value < item.system.frequency.max) {
        await item.update({
          'system.frequency.value': item.system.frequency.max
        }, { render: false });
        dailyRefreshed = true;
      }
    }

    // Delete temporary items (items with duration that have expired)
    const temporaryItems = actor.items.filter(i => i.system?.temporary === true);
    if (temporaryItems.length > 0) {
      const ids = temporaryItems.map(i => i.id);
      await actor.deleteEmbeddedDocuments('Item', ids, { render: false });
      messages.push(game.i18n.localize('HIT_DICE_HEALING.TemporaryItemsExpired'));
    }

    if (dailyRefreshed) {
      messages.push(game.i18n.localize('HIT_DICE_HEALING.DailyResourcesReset'));
    }

    // Explicitly note what was NOT restored
    messages.push(game.i18n.localize('HIT_DICE_HEALING.HPUnchanged'));
    messages.push(game.i18n.localize('HIT_DICE_HEALING.SpellSlotsUnchanged'));
  }

  /**
   * Send a chat message summarizing the rest results.
   * @param {Actor} actor
   * @param {'long'|'full'} restType
   * @param {string[]} messages - Status messages to display
   */
  static async _sendRestChatMessage(actor, restType, messages) {
    const isLong = restType === 'long';
    const title = isLong
      ? game.i18n.localize('HIT_DICE_HEALING.LongRestComplete')
      : game.i18n.localize('HIT_DICE_HEALING.FullRestComplete');
    const awakens = isLong
      ? game.i18n.format('HIT_DICE_HEALING.Awakens', { name: actor.name })
      : game.i18n.format('HIT_DICE_HEALING.AwakensFullyRested', { name: actor.name });

    const content = await renderTemplate(
      'modules/hit-dice-healing/templates/chat-rest.hbs',
      {
        actorName: actor.name,
        actorImg: actor.img,
        title,
        awakens,
        messages,
        isLongRest: isLong,
        isFullRest: !isLong
      }
    );

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER
    });
  }
}
