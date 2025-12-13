/**
 * PF2E Hit Dice Healing
 * D&D-style Hit Dice healing system for Pathfinder 2E
 */

import { HitDiceManager } from './hit-dice-manager.js';
import { HitDiceModal } from './hit-dice-modal.js';

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
        ui.notifications.warn('Bitte wähle einen Spielercharakter aus.');
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
        ui.notifications.warn('Nur der GM kann Hit Dice manuell auffüllen.');
        return;
      }
      const result = await HitDiceManager.replenishHitDice(actor);
      ui.notifications.info(`${actor.name}: ${result.replenished} Hit Dice aufgefüllt (${result.total}/${result.total})`);
    },

    // Expose manager for advanced use
    manager: HitDiceManager
  };

  // Notify on load (GM only)
  if (game.user.isGM) {
    console.log('Hit Dice Healing | Use HitDiceHealing.open() or click the dice button on character sheets');
  }
});

// ============================================================================
// Long Rest Integration
// ============================================================================

/**
 * Hook into PF2E's rest for the night system
 * This fires when a character takes a long rest
 */
Hooks.on('pf2e.restForTheNight', async (actor) => {
  if (actor.type !== 'character') return;

  const result = await HitDiceManager.replenishHitDice(actor);

  if (result.replenished > 0) {
    ui.notifications.info(`${actor.name}: ${result.replenished} Hit Dice regeneriert!`);
  }
});

// ============================================================================
// Character Sheet Injection
// ============================================================================

/**
 * Inject Hit Dice display into the character sheet
 * Hooks into the PF2E character sheet render
 */
Hooks.on('renderCharacterSheetPF2e', async (sheet, html, data) => {
  const actor = sheet.actor;

  // Only for player characters
  if (!actor || actor.type !== 'character') return;

  // Get Hit Dice data
  const current = HitDiceManager.getCurrentHitDice(actor);
  const max = HitDiceManager.getMaxHitDice(actor);

  // Render the injection template
  const hitDiceHtml = await renderTemplate(
    'modules/hit-dice-healing/templates/sheet-inject.hbs',
    {
      actorId: actor.id,
      current,
      max
    }
  );

  // Find the HP section to inject after
  // PF2E sheet structure: Look for the health/HP area
  const $html = $(html);

  // Try multiple selectors for different sheet layouts
  const selectors = [
    '.health-stamina',           // Standard PF2E sheet
    '.hp-section',               // Alternative
    '[data-tab="character"] .sidebar .hit-points', // Sidebar HP
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

  // If no HP section found, try to find wounded/dying tracker
  if (!$hpSection || !$hpSection.length) {
    const $dying = $html.find('.dying, .wounded, [data-dying], [data-wounded]').first();
    if ($dying.length) {
      $hpSection = $dying.parent();
    }
  }

  // Insert Hit Dice display
  if ($hpSection && $hpSection.length) {
    $hpSection.after(hitDiceHtml);
  } else {
    // Fallback: Insert at the beginning of the sidebar
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
});

// ============================================================================
// Actor Update Hook (for sheet refresh)
// ============================================================================

/**
 * When Hit Dice flags are updated, the sheet might need to refresh
 */
Hooks.on('updateActor', (actor, changes, options, userId) => {
  // Check if our flags were changed
  if (changes.flags?.['hit-dice-healing']) {
    // Re-render the actor's sheet if it's open
    const sheet = actor.sheet;
    if (sheet?.rendered) {
      sheet.render(false);
    }
  }
});
