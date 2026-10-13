// -----------------------------------------------------------------------------
// The `overview` dashboard widget: every unit added to Gladys on one card,
// within the core budget, and its "turn all off" button.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { TEXT } from '../src/widgets.js';
import {
  CLASSIC,
  FAHRENHEIT,
  FakeGree,
  NO_SENSOR,
  RECENT,
  createAll,
  createWorld,
} from './helpers/world.js';

async function content(world, language = 'en') {
  const ack = await world.fake.widgetGet('overview', { settings: {}, language, units: 'metric' });
  assert.equal(ack.success, true, ack.error);
  const result = ack.data.content ?? ack.data;
  assert.deepEqual(validateWidgetContent(result), [], 'rendered exactly as sent');
  return result;
}

const statusOf = (result) => result.components.find((component) => component.type === 'status');
const buttons = (result) => result.components.filter((component) => component.type === 'button');

test('every unit: mode, setpoint and room temperature, off, or not answering', async (t) => {
  const units = [
    new FakeGree(CLASSIC, '192.0.2.10'),
    new FakeGree(RECENT, '192.0.2.11'),
    new FakeGree(NO_SENSOR, '192.0.2.12'),
    new FakeGree(FAHRENHEIT, '192.0.2.13'),
  ];
  const world = await createWorld({ units });
  t.after(() => world.app.stop());
  await createAll(world);
  units[3].online = false;
  await world.hub.pollAll();
  await world.hub.pollAll();

  const fr = await content(world, 'fr');
  assert.equal(fr.components[0].text, '2 / 4 en marche');
  assert.deepEqual(
    statusOf(fr).items.map((item) => [item.label, item.value, item.color]),
    [
      ['Gree 000001', 'Froid · 24 °C · 25 °C', 'info'],
      ['Gree 000003', 'Arrêt', 'neutral'],
      ['Gree Chambre', 'Ne répond pas', 'danger'],
      ['Gree Salon', 'Chaud · 21 °C · 24 °C', 'warning'],
    ],
  );
  assert.deepEqual(
    buttons(fr).map((button) => [button.label, button.action.key]),
    [[TEXT.allOff.fr, 'all_off']],
  );
  const de = await content(world, 'de');
  assert.equal(statusOf(de).items[0].value, 'Kühlen · 24 °C · 25 °C');
});

test('the button turns every running unit off, in one tap', async (t) => {
  const units = [new FakeGree(CLASSIC, '192.0.2.10'), new FakeGree(RECENT, '192.0.2.11')];
  const world = await createWorld({ units });
  t.after(() => world.app.stop());
  await createAll(world);
  const ack = await world.fake.widgetAction('overview', 'all_off', {}, { settings: {} });
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.message.fr, 'Climatiseurs éteints : 2');
  assert.deepEqual(
    units.map((unit) => unit.props.Pow),
    [0, 0],
  );
  const after = await content(world);
  assert.equal(after.components[0].text, '0 / 2 running');
  assert.deepEqual(buttons(after), [], 'nothing left to turn off');
  // The trigger is never fired by Gladys' own commands.
  await world.hub.pollAll();
  await world.hub.idle();
  assert.equal(world.fake.sceneEvents.length, 0);
});

test('no unit added yet: a sentence that says where to add them', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const result = await content(world, 'es');
  assert.deepEqual(result.components, [{ type: 'text', variant: 'body', text: TEXT.none.es }]);
});

test('the widget is nudged when a state it shows changes, not for the others', async (t) => {
  const unit = new FakeGree(CLASSIC, '192.0.2.10');
  const world = await createWorld({ units: [unit] });
  t.after(() => world.app.stop());
  await createAll(world);
  const count = () => world.fake.widgetRefreshes.length;
  const before = count();
  unit.props.Lig = 0;
  await world.hub.pollAll();
  assert.equal(count(), before, 'the display light is not on the card');
  unit.props.SetTem = 26;
  await world.hub.pollAll();
  assert.equal(count(), before + 1);
});
