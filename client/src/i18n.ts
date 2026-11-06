import type { AgreementIssue, Lang, Party, Role, SystemEvent } from '../../shared/types.js';

const en = {
  'app.name': 'Sauda',
  'app.tagline': 'Negotiate a custom order in your own language. PayPal runs the money.',
  'lang.hi': 'हिंदी (Hindi)',
  'lang.en': 'English',
  'lang.es': 'Español (Spanish)',
  'role.maker': 'Maker',
  'role.buyer': 'Buyer',

  'home.title': 'Open a deal room',
  'home.intro': 'A maker and a buyer each get a private link. Each side reads and writes in their own language.',
  'home.name': 'Name',
  'home.language': 'Language',
  'home.create': 'Create deal room',
  'home.creating': 'Creating…',
  'home.sameLanguage': 'Pick two different languages.',
  'home.makerLink': 'Maker link (keep it private)',
  'home.buyerLink': 'Buyer invite link',
  'home.openMaker': 'Open maker',
  'home.openBuyer': 'Open buyer',
  'home.copy': 'Copy',
  'home.copied': 'Copied',

  'room.you': 'You are the {role}',
  'room.with': 'with {name}',
  'room.connecting': 'Connecting…',
  'room.reconnecting': 'Reconnecting…',
  'room.forbidden': 'This link is not valid. Ask for a new one.',
  'room.invite': 'Buyer invite link',
  'room.copy': 'Copy',
  'room.copied': 'Copied',
  'phase.negotiating': 'Negotiating',
  'phase.confirmed': 'Agreement confirmed',
  'phase.invoiced': 'Invoice sent',
  'phase.deposit_paid': 'Deposit paid',
  'phase.paid': 'Paid in full',
  'phase.shipped': 'Shipped',
  'phase.cancelled': 'Cancelled',

  'chat.title': 'Conversation',
  'chat.empty': 'Say hello. Every message is translated for the other side.',
  'chat.pending': 'Sending…',
  'chat.interpreting': 'Interpreting…',
  'chat.failed': 'Could not interpret this message.',
  'chat.retry': 'Retry',
  'chat.fallback': 'fallback',
  'chat.translatedFor': 'Translated for {name}',
  'chat.original': 'Original',

  'composer.placeholder': 'Write to {name} in {lang}…',
  'composer.send': 'Send',
  'composer.hint': 'Enter sends, Shift+Enter adds a line',

  'agreement.title': 'Agreement',
  'agreement.empty': 'Terms appear here as you agree on them, each linked to the message it came from.',
  'agreement.missing': 'Still needed: {fields}',
  'agreement.locked': 'Locked: the invoice was created from this agreement.',
  'agreement.cite': 'Show the message this came from',
  'field.item': 'Item',
  'field.quantity': 'Quantity',
  'field.size': 'Size',
  'field.measurement': 'Measurement',
  'field.measurements': 'Measurements',
  'field.color': 'Colour',
  'field.price': 'Total price',
  'field.deposit': 'Deposit',
  'field.balance': 'Balance',
  'field.delivery': 'Delivery by',
  'field.shipping': 'Shipping',
  'field.other': 'Other',

  'issue.currency_not_usd': 'The price must be in USD (it is {currency}).',
  'issue.price_not_positive': 'The price must be more than zero.',
  'issue.deposit_not_positive': 'The deposit must be more than zero.',
  'issue.deposit_exceeds_total': 'The deposit cannot be more than the total.',
  'issue.quantity_below_one': 'The quantity must be at least 1.',
  'issue.delivery_in_past': 'The delivery date is in the past.',
  'issue.agreement_too_long': 'The agreement is too long for the PayPal invoice ({field}: {bytes} of {limit} bytes).',

  'questions.title': 'Open questions',
  'questions.none': 'No open questions.',
  'questions.forYou': 'For you to answer',
  'questions.forOther': 'For {name} to answer',
  'questions.dismiss': 'Dismiss',
  'questions.answered': 'Answered in',
  'questions.dismissed': 'Dismissed',

  'confirm.title': 'Confirm',
  'confirm.button': 'Confirm this agreement',
  'confirm.youConfirmed': 'You confirmed this agreement.',
  'confirm.otherWaiting': '{name} has not confirmed yet.',
  'confirm.otherConfirmed': '{name} confirmed.',
  'confirm.changed': 'The terms changed after a confirmation. Please review and confirm again.',
  'confirm.both': 'Both sides confirmed the same agreement.',
  'confirm.hash': 'Agreement fingerprint',
  'confirm.notReady': 'Agree on the missing terms first.',
  'confirm.locked': 'The invoice was created from this agreement.',

  'event.deal_created': '{maker} opened a deal room with {buyer}.',
  'event.confirmed': '{name} confirmed the agreement.',
  'event.agreement_confirmed': 'Both sides confirmed the same agreement ({hash}…).',
  'event.terms_changed': 'The terms changed after a confirmation, so both sides need to confirm again.',

  'warning.agreement_locked': 'The agreement is locked; this message did not change it.',
  'warning.invalid_quantity': 'A quantity was ignored because it is not a whole number.',
  'warning.invalid_price': 'A price was ignored because it is not valid.',
  'warning.invalid_currency': 'A currency was ignored because it is not a 3-letter code.',
  'warning.invalid_deposit_percent': 'A deposit percent was ignored because it is not between 0 and 100.',
  'warning.invalid_deposit_amount': 'A deposit amount was ignored because it is not valid.',
  'warning.invalid_delivery_date': 'A delivery date was ignored because it is not a real date.',
  'warning.past_delivery_date': 'A delivery date was ignored because it is in the past.',
  'warning.invalid_measurement': 'A measurement was ignored because it is not valid.',

  'error.generic': 'Something went wrong. Please try again.',
  'error.stale_hash': 'The terms just changed. Review them and confirm again.',
  'error.not_ready': 'The agreement is not complete yet.',
  'error.ai_not_configured': 'The interpreter is not configured on this server.',
  'error.ai_unavailable': 'The interpreter did not answer. Try again.',
  'error.interpret_failed': 'The interpreter failed on this message. Try again.',
  'error.invalid_text': 'Messages can be up to 1000 characters.',
};

export type Key = keyof typeof en;
type Dict = Record<Key, string>;

const hi: Dict = {
  'app.name': 'सौदा',
  'app.tagline': 'अपनी भाषा में कस्टम ऑर्डर तय करें। पैसों का काम PayPal संभालता है।',
  'lang.hi': 'हिंदी',
  'lang.en': 'English (अंग्रेज़ी)',
  'lang.es': 'Español (स्पैनिश)',
  'role.maker': 'कारीगर',
  'role.buyer': 'खरीदार',

  'home.title': 'सौदे का कमरा खोलें',
  'home.intro': 'कारीगर और खरीदार दोनों को अलग निजी लिंक मिलता है। हर कोई अपनी भाषा में पढ़ता और लिखता है।',
  'home.name': 'नाम',
  'home.language': 'भाषा',
  'home.create': 'सौदे का कमरा बनाएँ',
  'home.creating': 'बन रहा है…',
  'home.sameLanguage': 'दो अलग भाषाएँ चुनें।',
  'home.makerLink': 'कारीगर का लिंक (इसे निजी रखें)',
  'home.buyerLink': 'खरीदार का निमंत्रण लिंक',
  'home.openMaker': 'कारीगर खोलें',
  'home.openBuyer': 'खरीदार खोलें',
  'home.copy': 'कॉपी करें',
  'home.copied': 'कॉपी हो गया',

  'room.you': 'आप {role} हैं',
  'room.with': '{name} के साथ',
  'room.connecting': 'जुड़ रहा है…',
  'room.reconnecting': 'फिर से जुड़ रहा है…',
  'room.forbidden': 'यह लिंक सही नहीं है। नया लिंक माँगें।',
  'room.invite': 'खरीदार का निमंत्रण लिंक',
  'room.copy': 'कॉपी करें',
  'room.copied': 'कॉपी हो गया',
  'phase.negotiating': 'बातचीत जारी',
  'phase.confirmed': 'समझौता पक्का',
  'phase.invoiced': 'इनवॉइस भेजा गया',
  'phase.deposit_paid': 'एडवांस मिल गया',
  'phase.paid': 'पूरा भुगतान हो गया',
  'phase.shipped': 'भेज दिया गया',
  'phase.cancelled': 'रद्द',

  'chat.title': 'बातचीत',
  'chat.empty': 'नमस्ते कहिए। हर संदेश दूसरी तरफ़ के लिए अनुवाद होता है।',
  'chat.pending': 'भेजा जा रहा है…',
  'chat.interpreting': 'अनुवाद हो रहा है…',
  'chat.failed': 'इस संदेश का अनुवाद नहीं हो सका।',
  'chat.retry': 'फिर कोशिश करें',
  'chat.fallback': 'बैकअप',
  'chat.translatedFor': '{name} के लिए अनुवाद',
  'chat.original': 'मूल',

  'composer.placeholder': '{name} को {lang} में लिखें…',
  'composer.send': 'भेजें',
  'composer.hint': 'Enter से भेजें, Shift+Enter से नई लाइन',

  'agreement.title': 'समझौता',
  'agreement.empty': 'जो शर्तें तय होंगी वे यहाँ दिखेंगी, हर एक उस संदेश से जुड़ी जिससे वह आई।',
  'agreement.missing': 'अभी बाकी: {fields}',
  'agreement.locked': 'बंद: इसी समझौते से इनवॉइस बना है।',
  'agreement.cite': 'वह संदेश दिखाएँ जिससे यह आया',
  'field.item': 'सामान',
  'field.quantity': 'मात्रा',
  'field.size': 'साइज़',
  'field.measurement': 'माप',
  'field.measurements': 'माप',
  'field.color': 'रंग',
  'field.price': 'कुल कीमत',
  'field.deposit': 'एडवांस',
  'field.balance': 'बाकी रकम',
  'field.delivery': 'डिलीवरी',
  'field.shipping': 'शिपिंग',
  'field.other': 'अन्य',

  'issue.currency_not_usd': 'कीमत USD में होनी चाहिए (अभी {currency} है)।',
  'issue.price_not_positive': 'कीमत शून्य से ज़्यादा होनी चाहिए।',
  'issue.deposit_not_positive': 'एडवांस शून्य से ज़्यादा होना चाहिए।',
  'issue.deposit_exceeds_total': 'एडवांस कुल कीमत से ज़्यादा नहीं हो सकता।',
  'issue.quantity_below_one': 'मात्रा कम से कम 1 होनी चाहिए।',
  'issue.delivery_in_past': 'डिलीवरी की तारीख बीत चुकी है।',
  'issue.agreement_too_long': 'समझौता PayPal इनवॉइस के लिए बहुत लंबा है ({field}: {limit} में से {bytes} बाइट)।',

  'questions.title': 'खुले सवाल',
  'questions.none': 'कोई खुला सवाल नहीं।',
  'questions.forYou': 'आपको जवाब देना है',
  'questions.forOther': '{name} को जवाब देना है',
  'questions.dismiss': 'हटाएँ',
  'questions.answered': 'जवाब मिला',
  'questions.dismissed': 'हटाया गया',

  'confirm.title': 'पक्का करें',
  'confirm.button': 'यह समझौता पक्का करें',
  'confirm.youConfirmed': 'आपने यह समझौता पक्का किया।',
  'confirm.otherWaiting': '{name} ने अभी पक्का नहीं किया है।',
  'confirm.otherConfirmed': '{name} ने पक्का किया।',
  'confirm.changed': 'पक्का करने के बाद शर्तें बदल गईं। कृपया देखकर फिर से पक्का करें।',
  'confirm.both': 'दोनों तरफ़ ने एक ही समझौता पक्का किया।',
  'confirm.hash': 'समझौते की पहचान',
  'confirm.notReady': 'पहले बाकी शर्तें तय करें।',
  'confirm.locked': 'इसी समझौते से इनवॉइस बना है।',

  'event.deal_created': '{maker} ने {buyer} के साथ सौदे का कमरा खोला।',
  'event.confirmed': '{name} ने समझौता पक्का किया।',
  'event.agreement_confirmed': 'दोनों तरफ़ ने एक ही समझौता पक्का किया ({hash}…)।',
  'event.terms_changed': 'पक्का करने के बाद शर्तें बदल गईं, इसलिए दोनों को फिर से पक्का करना होगा।',

  'warning.agreement_locked': 'समझौता बंद है; इस संदेश से वह नहीं बदला।',
  'warning.invalid_quantity': 'एक मात्रा छोड़ दी गई क्योंकि वह पूरी संख्या नहीं है।',
  'warning.invalid_price': 'एक कीमत छोड़ दी गई क्योंकि वह सही नहीं है।',
  'warning.invalid_currency': 'एक मुद्रा छोड़ दी गई क्योंकि वह 3 अक्षर का कोड नहीं है।',
  'warning.invalid_deposit_percent': 'एडवांस का प्रतिशत छोड़ दिया गया क्योंकि वह 0 और 100 के बीच नहीं है।',
  'warning.invalid_deposit_amount': 'एडवांस की रकम छोड़ दी गई क्योंकि वह सही नहीं है।',
  'warning.invalid_delivery_date': 'डिलीवरी की तारीख छोड़ दी गई क्योंकि वह असली तारीख नहीं है।',
  'warning.past_delivery_date': 'डिलीवरी की तारीख छोड़ दी गई क्योंकि वह बीत चुकी है।',
  'warning.invalid_measurement': 'एक माप छोड़ दिया गया क्योंकि वह सही नहीं है।',

  'error.generic': 'कुछ गड़बड़ हो गई। फिर कोशिश करें।',
  'error.stale_hash': 'शर्तें अभी बदली हैं। देखकर फिर से पक्का करें।',
  'error.not_ready': 'समझौता अभी पूरा नहीं है।',
  'error.ai_not_configured': 'इस सर्वर पर अनुवादक सेट नहीं है।',
  'error.ai_unavailable': 'अनुवादक ने जवाब नहीं दिया। फिर कोशिश करें।',
  'error.interpret_failed': 'इस संदेश पर अनुवादक विफल रहा। फिर कोशिश करें।',
  'error.invalid_text': 'संदेश 1000 अक्षरों तक हो सकता है।',
};

const es: Dict = {
  'app.name': 'Sauda',
  'app.tagline': 'Negocia un pedido a medida en tu propio idioma. PayPal gestiona el dinero.',
  'lang.hi': 'हिंदी (hindi)',
  'lang.en': 'English (inglés)',
  'lang.es': 'Español',
  'role.maker': 'Artesano',
  'role.buyer': 'Comprador',

  'home.title': 'Abrir una sala de trato',
  'home.intro': 'El artesano y el comprador reciben cada uno un enlace privado. Cada parte lee y escribe en su idioma.',
  'home.name': 'Nombre',
  'home.language': 'Idioma',
  'home.create': 'Crear sala de trato',
  'home.creating': 'Creando…',
  'home.sameLanguage': 'Elige dos idiomas distintos.',
  'home.makerLink': 'Enlace del artesano (mantenlo privado)',
  'home.buyerLink': 'Enlace de invitación del comprador',
  'home.openMaker': 'Abrir artesano',
  'home.openBuyer': 'Abrir comprador',
  'home.copy': 'Copiar',
  'home.copied': 'Copiado',

  'room.you': 'Eres el {role}',
  'room.with': 'con {name}',
  'room.connecting': 'Conectando…',
  'room.reconnecting': 'Reconectando…',
  'room.forbidden': 'Este enlace no es válido. Pide uno nuevo.',
  'room.invite': 'Enlace de invitación del comprador',
  'room.copy': 'Copiar',
  'room.copied': 'Copiado',
  'phase.negotiating': 'Negociando',
  'phase.confirmed': 'Acuerdo confirmado',
  'phase.invoiced': 'Factura enviada',
  'phase.deposit_paid': 'Anticipo pagado',
  'phase.paid': 'Pagado por completo',
  'phase.shipped': 'Enviado',
  'phase.cancelled': 'Cancelado',

  'chat.title': 'Conversación',
  'chat.empty': 'Saluda. Cada mensaje se traduce para la otra parte.',
  'chat.pending': 'Enviando…',
  'chat.interpreting': 'Interpretando…',
  'chat.failed': 'No se pudo interpretar este mensaje.',
  'chat.retry': 'Reintentar',
  'chat.fallback': 'respaldo',
  'chat.translatedFor': 'Traducido para {name}',
  'chat.original': 'Original',

  'composer.placeholder': 'Escribe a {name} en {lang}…',
  'composer.send': 'Enviar',
  'composer.hint': 'Enter envía, Shift+Enter añade una línea',

  'agreement.title': 'Acuerdo',
  'agreement.empty': 'Las condiciones aparecen aquí a medida que las acordáis, cada una enlazada al mensaje de origen.',
  'agreement.missing': 'Falta: {fields}',
  'agreement.locked': 'Bloqueado: la factura se creó a partir de este acuerdo.',
  'agreement.cite': 'Mostrar el mensaje de origen',
  'field.item': 'Artículo',
  'field.quantity': 'Cantidad',
  'field.size': 'Talla',
  'field.measurement': 'Medida',
  'field.measurements': 'Medidas',
  'field.color': 'Color',
  'field.price': 'Precio total',
  'field.deposit': 'Anticipo',
  'field.balance': 'Saldo',
  'field.delivery': 'Entrega antes del',
  'field.shipping': 'Envío',
  'field.other': 'Otro',

  'issue.currency_not_usd': 'El precio debe estar en USD (está en {currency}).',
  'issue.price_not_positive': 'El precio debe ser mayor que cero.',
  'issue.deposit_not_positive': 'El anticipo debe ser mayor que cero.',
  'issue.deposit_exceeds_total': 'El anticipo no puede superar el total.',
  'issue.quantity_below_one': 'La cantidad debe ser al menos 1.',
  'issue.delivery_in_past': 'La fecha de entrega ya pasó.',
  'issue.agreement_too_long': 'El acuerdo es demasiado largo para la factura de PayPal ({field}: {bytes} de {limit} bytes).',

  'questions.title': 'Preguntas abiertas',
  'questions.none': 'No hay preguntas abiertas.',
  'questions.forYou': 'Te toca responder',
  'questions.forOther': 'Le toca responder a {name}',
  'questions.dismiss': 'Descartar',
  'questions.answered': 'Respondida en',
  'questions.dismissed': 'Descartada',

  'confirm.title': 'Confirmar',
  'confirm.button': 'Confirmar este acuerdo',
  'confirm.youConfirmed': 'Confirmaste este acuerdo.',
  'confirm.otherWaiting': '{name} aún no ha confirmado.',
  'confirm.otherConfirmed': '{name} confirmó.',
  'confirm.changed': 'Las condiciones cambiaron después de una confirmación. Revísalas y confirma de nuevo.',
  'confirm.both': 'Ambas partes confirmaron el mismo acuerdo.',
  'confirm.hash': 'Huella del acuerdo',
  'confirm.notReady': 'Primero acordad las condiciones que faltan.',
  'confirm.locked': 'La factura se creó a partir de este acuerdo.',

  'event.deal_created': '{maker} abrió una sala de trato con {buyer}.',
  'event.confirmed': '{name} confirmó el acuerdo.',
  'event.agreement_confirmed': 'Ambas partes confirmaron el mismo acuerdo ({hash}…).',
  'event.terms_changed': 'Las condiciones cambiaron después de una confirmación, así que ambas partes deben confirmar de nuevo.',

  'warning.agreement_locked': 'El acuerdo está bloqueado; este mensaje no lo cambió.',
  'warning.invalid_quantity': 'Se ignoró una cantidad porque no es un número entero.',
  'warning.invalid_price': 'Se ignoró un precio porque no es válido.',
  'warning.invalid_currency': 'Se ignoró una moneda porque no es un código de 3 letras.',
  'warning.invalid_deposit_percent': 'Se ignoró un porcentaje de anticipo porque no está entre 0 y 100.',
  'warning.invalid_deposit_amount': 'Se ignoró un importe de anticipo porque no es válido.',
  'warning.invalid_delivery_date': 'Se ignoró una fecha de entrega porque no es una fecha real.',
  'warning.past_delivery_date': 'Se ignoró una fecha de entrega porque ya pasó.',
  'warning.invalid_measurement': 'Se ignoró una medida porque no es válida.',

  'error.generic': 'Algo salió mal. Inténtalo de nuevo.',
  'error.stale_hash': 'Las condiciones acaban de cambiar. Revísalas y confirma de nuevo.',
  'error.not_ready': 'El acuerdo aún no está completo.',
  'error.ai_not_configured': 'El intérprete no está configurado en este servidor.',
  'error.ai_unavailable': 'El intérprete no respondió. Inténtalo de nuevo.',
  'error.interpret_failed': 'El intérprete falló con este mensaje. Inténtalo de nuevo.',
  'error.invalid_text': 'Los mensajes pueden tener hasta 1000 caracteres.',
};

export const DICTS: Record<Lang, Dict> = { en, hi, es };

export type Params = Record<string, string | number | boolean | null | undefined>;

export function t(lang: Lang, key: Key, params: Params = {}): string {
  const s = DICTS[lang][key] ?? en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (params[k] === undefined || params[k] === null ? '' : String(params[k])));
}

/** Looks up a dynamic key (e.g. `event.${type}`) and falls back when it does not exist. */
export function tMaybe(lang: Lang, key: string, params: Params = {}, fallback = key): string {
  return key in en ? t(lang, key as Key, params) : fallback;
}

/** A system event in the viewer's language. Role params are shown as the party's name. */
export function renderEvent(lang: Lang, ev: SystemEvent, parties: Record<Role, Party>): string {
  const p: Params = { ...ev.params };
  for (const k of ['role', 'by']) {
    const r = ev.params[k];
    if (r === 'maker' || r === 'buyer') p.name = parties[r].name;
  }
  return tMaybe(lang, `event.${ev.type}`, p, ev.type);
}

export function renderIssue(lang: Lang, issue: AgreementIssue): string {
  return tMaybe(lang, `issue.${issue.code}`, issue.params ?? {}, issue.code);
}

export function renderError(lang: Lang, code: string | undefined): string {
  return code ? tMaybe(lang, `error.${code}`, {}, t(lang, 'error.generic')) : t(lang, 'error.generic');
}

/** "Flash 4.8 s" or "Argon (fallback) 7.1 s". */
export function modelBadge(lang: Lang, ai: { model: string; ms: number; fallback: boolean }): string {
  const name = /flash/i.test(ai.model) ? 'Flash' : /argon/i.test(ai.model) ? 'Argon' : ai.model;
  return `${name}${ai.fallback ? ` (${t(lang, 'chat.fallback')})` : ''} ${(ai.ms / 1000).toFixed(1)} s`;
}
