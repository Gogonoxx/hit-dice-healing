/**
 * PF2E Hit Dice Healing
 * D&D-style Hit Dice healing system for Pathfinder 2E
 * with Gritfinder's three-tier rest system (Short / Long / Full).
 */

import { HitDiceManager } from './hit-dice-manager.js';
import { HitDiceModal } from './hit-dice-modal.js';
import { RestManager } from './rest-manager.js';

const MODULE_ID = 'hit-dice-healing';

// ============================================================================
// Initialization
// ============================================================================

Hooks.once('init', () => {
  console.log('Hit Dice Healing | Initializing module');
});

Hooks.once('ready', () => {
  console.log('Hit Dice Healing | Module ready');

  // Expose global API for macro use
  globalThis.HitDiceHealing = {
    /**
     * Open the Hit Dice modal for an actor
     * @param {Actor} actor - The actor (defaults to selected token's actor)
     */
    open: (actor) => {
      if (!actor) {
        const token = canvas.tokens.controlled[0];
        actor = token?.actor;
      }
      if (!actor || actor.type !== 'character') {
        ui.notifications.warn(game.i18n.localize('HIT_DICE_HEALING.SelectCharacter'));
        return;
      }
      new HitDiceModal(actor).render(true);
    },

    /**
     * Get Hit Dice info for an actor
     * @param {Actor} actor - The actor
     * @returns {Object} Hit Dice info
     */
    getInfo: (actor) => {
      return {
        current: HitDiceManager.getCurrentHitDice(actor),
        max: HitDiceManager.getMaxHitDice(actor),
        dieType: HitDiceManager.getDieType(actor),
        conMod: HitDiceManager.getConModifier(actor)
      };
    },

    /**
     * Replenish Hit Dice for an actor (GM only)
     * @param {Actor} actor - The actor
     */
    replenish: async (actor) => {
      if (!game.user.isGM) {
        ui.notifications.warn(game.i18n.localize('HIT_DICE_HEALING.GMOnly'));
        return;
      }
      const result = await HitDiceManager.replenishHitDice(actor);
      ui.notifications.info(game.i18n.format('HIT_DICE_HEALING.Replenished', {
        name: actor.name,
        count: result.replenished,
        current: result.total,
        max: result.total
      }));
    },

    /**
     * Open the rest dialog for an actor
     * @param {Actor} actor - The actor (defaults to selected token's actor)
     */
    rest: (actor) => {
      if (!actor) {
        const token = canvas.tokens.controlled[0];
        actor = token?.actor;
      }
      if (!actor || actor.type !== 'character') {
        ui.notifications.warn(game.i18n.localize('HIT_DICE_HEALING.SelectCharacter'));
        return;
      }
      RestManager.showRestDialog(actor);
    },

    // Expose managers for advanced use
    manager: HitDiceManager,
    restManager: RestManager
  };

  // Notify on load (GM only)
  if (game.user.isGM) {
    console.log('Hit Dice Healing | Use HitDiceHealing.open() or HitDiceHealing.rest() or click the dice/rest buttons on character sheets');
  }
});

// ============================================================================
// Long Rest Integration (via pf2e.restForTheNight hook)
// ============================================================================

/**
 * Hook into PF2E's rest for the night system.
 * This fires AFTER PF2E's rest completes (Full Rest scenario).
 * We keep this hook to handle cases where rest is triggered
 * from sources other than our dialog (e.g., macros, other modules).
 */
Hooks.on('pf2e.restForTheNight', async (actor) => {
  if (actor.type !== 'character') return;

  const result = await HitDiceManager.replenishHitDice(actor);

  if (result.replenished > 0) {
    ui.notifications.info(game.i18n.format('HIT_DICE_HEALING.Replenished', {
      name: actor.name,
      count: result.replenished,
      current: result.total,
      max: result.total
    }));
  }
});

// ============================================================================
// Character Sheet Injection
// ============================================================================

/**
 * Inject Hit Dice display and intercept rest button on the character sheet.
 */
Hooks.on('renderCharacterSheetPF2e', async (sheet, html, data) => {
  const actor = sheet.actor;

  // Only for player characters
  if (!actor || actor.type !== 'character') return;

  // --- Hit Dice Display Injection ---
  const current = HitDiceManager.getCurrentHitDice(actor);
  const max = HitDiceManager.getMaxHitDice(actor);

  const hitDiceHtml = await renderTemplate(
    'modules/hit-dice-healing/templates/sheet-inject.hbs',
    {
      actorId: actor.id,
      current,
      max
    }
  );

  // Find the HP section to inject after
  const $html = $(html);

  const selectors = [
    '.health-stamina',
    '.hp-section',
    '[data-tab="character"] .sidebar .hit-points',
    '.character-stats .hit-points',
    '.sheet-sidebar .hp',
    '.actor-header .hp'
  ];

  let $hpSection = null;
  for (const selector of selectors) {
    const $found = $html.find(selector).first();
    if ($found.length) {
      $hpSection = $found;
      break;
    }
  }

  if (!$hpSection || !$hpSection.length) {
    const $dying = $html.find('.dying, .wounded, [data-dying], [data-wounded]').first();
    if ($dying.length) {
      $hpSection = $dying.parent();
    }
  }

  if ($hpSection && $hpSection.length) {
    $hpSection.after(hitDiceHtml);
  } else {
    const $sidebar = $html.find('.sheet-sidebar, .sidebar, .character-sidebar').first();
    if ($sidebar.length) {
      $sidebar.prepend(hitDiceHtml);
    } else {
      console.warn('Hit Dice Healing | Could not find suitable injection point on character sheet');
      return;
    }
  }

  // Add click handler for the Hit Dice button
  $html.find('.hit-dice-btn').on('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    new HitDiceModal(actor).render(true);
  });

  // --- Rest Button Interception ---
  // Find PF2E's "Rest for the Night" button and replace its behavior
  // with our three-option rest dialog
  const $restBtn = $html.find('[data-action="rest"]');
  if ($restBtn.length) {
    // Remove PF2E's data-action to prevent the default handler from firing
    $restBtn.removeAttr('data-action');

    // Add our rest dialog handler
    $restBtn.on('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      RestManager.showRestDialog(actor);
    });
  }
});

// ============================================================================
// Actor Update Hook (for sheet refresh)
// ============================================================================

/**
 * When Hit Dice flags are updated, the sheet might need to refresh.
 */
Hooks.on('updateActor', (actor, changes, options, userId) => {
  if (changes.flags?.['hit-dice-healing']) {
    const sheet = actor.sheet;
    if (sheet?.rendered) {
      sheet.render(false);
    }
  }
});
