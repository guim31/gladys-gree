// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `overview`.
//
// The Gladys device box already drives one air conditioner. What the widget
// adds: every Gree unit of the house on one card, what each one is doing
// (mode, setpoint, room temperature, or off, or not answering), and one button
// to turn them all off — leaving home, going to bed.
//
// Budget (8 components, 2 texts, 1 status of 10 rows, 4 buttons): a caption,
// the status list, the button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { AC_MODE, gladysMode, namesFor } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { PROPS, indoorTemperature } from './gree/protocol.js';

const ALL_OFF_ACTION = 'all_off';
const MAX_ROWS = 10;

export const TEXT = {
  none: {
    en: 'No Gree air conditioner in Gladys yet: add them from the Discovery tab of the integration.',
    fr: 'Aucun climatiseur Gree dans Gladys : ajoutez-les depuis l’onglet Découverte de l’intégration.',
    de: 'Noch kein Gree-Klimagerät in Gladys: Füge sie im Tab „Entdecken“ der Integration hinzu.',
    es: 'Aún no hay ningún aire acondicionado Gree en Gladys: añádalos desde la pestaña Descubrimiento de la integración.',
  },
  running: {
    en: 'running',
    fr: 'en marche',
    de: 'in Betrieb',
    es: 'en marcha',
  },
  off: { en: 'Off', fr: 'Arrêt', de: 'Aus', es: 'Apagado' },
  unreachable: {
    en: 'Not answering',
    fr: 'Ne répond pas',
    de: 'Antwortet nicht',
    es: 'No responde',
  },
  allOff: {
    en: 'Turn all off',
    fr: 'Tout éteindre',
    de: 'Alle ausschalten',
    es: 'Apagar todos',
  },
  turnedOff: {
    en: 'Air conditioners turned off: ',
    fr: 'Climatiseurs éteints : ',
    de: 'Ausgeschaltete Klimageräte: ',
    es: 'Aires acondicionados apagados: ',
  },
};

const t = (text, language) => text[language] ?? text.en;

const MODE_NAME_KEYS = {
  [AC_MODE.AUTO]: 'modeAuto',
  [AC_MODE.COOLING]: 'modeCool',
  [AC_MODE.HEATING]: 'modeHeat',
  [AC_MODE.DRYING]: 'modeDry',
  [AC_MODE.FAN]: 'modeFan',
};

const MODE_COLORS = {
  [AC_MODE.COOLING]: WIDGET_COLORS.INFO,
  [AC_MODE.HEATING]: WIDGET_COLORS.WARNING,
};

const degrees = (value, language) =>
  `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value)} °C`;

/** One status row: what a unit is doing, in a few words. */
export function unitRow(hub, record, language) {
  const props = record.props ?? {};
  const label = hub.label(record).slice(0, 40);
  if (record.reachable !== true) {
    return {
      label,
      icon: 'wifi-off',
      value: t(TEXT.unreachable, language),
      color: WIDGET_COLORS.DANGER,
    };
  }
  const indoor = record.caps.indoor ? indoorTemperature(props) : null;
  if (!(props[PROPS.POWER] > 0)) {
    return {
      label,
      icon: 'power',
      value: [t(TEXT.off, language), indoor === null ? null : degrees(indoor, language)]
        .filter(Boolean)
        .join(' · '),
      color: WIDGET_COLORS.NEUTRAL,
    };
  }
  const mode = gladysMode(props[PROPS.MODE]);
  const parts = [
    mode === null ? t(TEXT.running, language) : namesFor(language)[MODE_NAME_KEYS[mode]],
  ];
  // The setpoint means nothing to the fan-only mode.
  if (mode !== AC_MODE.FAN && props[PROPS.TARGET] > 0) {
    parts.push(degrees(props[PROPS.TARGET], language));
  }
  if (indoor !== null) {
    parts.push(degrees(indoor, language));
  }
  return {
    label,
    icon: 'wind',
    value: parts.join(' · ').slice(0, 40),
    color: MODE_COLORS[mode] ?? WIDGET_COLORS.SUCCESS,
  };
}

async function get(hub, { language = 'en' } = {}) {
  const records = hub
    .createdRecords()
    .sort((a, b) => hub.label(a).localeCompare(hub.label(b), language, { sensitivity: 'base' }));
  if (records.length === 0) {
    return {
      ttl_seconds: 300,
      components: [{ type: 'text', variant: 'body', text: t(TEXT.none, language) }],
    };
  }
  const on = records.filter(
    (record) => record.reachable === true && record.props?.[PROPS.POWER] > 0,
  );
  const components = [
    {
      type: 'text',
      variant: 'caption',
      text: `${on.length} / ${records.length} ${t(TEXT.running, language)}`,
    },
    {
      type: 'status',
      items: records.slice(0, MAX_ROWS).map((record) => unitRow(hub, record, language)),
    },
  ];
  if (on.length > 0) {
    components.push({
      type: 'button',
      label: t(TEXT.allOff, language),
      icon: 'power',
      style: 'secondary',
      action: { key: ALL_OFF_ACTION },
    });
  }
  return { ttl_seconds: 60, components };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ALL_OFF_ACTION) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  const count = await hub.turnOffAll();
  return {
    message: Object.fromEntries(
      Object.keys(TEXT.turnedOff).map((language) => [
        language,
        `${TEXT.turnedOff[language]}${count}`,
      ]),
    ),
  };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
