/**
 * The emoji the picker offers, by category, drawn with the device's own emoji
 * font — no image sprites, no library. Kept to what people use at work.
 *
 * `KEYWORDS` makes the common ones findable by search in Arabic and English.
 */

const list = (text) => text.split(' ').filter(Boolean);

export const EMOJI_CATEGORIES = [
  {
    key: 'smileys',
    icon: '😀',
    emojis: list(
      '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬',
    ),
  },
  {
    key: 'gestures',
    icon: '👍',
    emojis: list(
      '👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤝 👏 🙌 👐 🤲 🙏 ✍️ 💪 🫡 🫶 👀 🧠 🫂',
    ),
  },
  {
    key: 'people',
    icon: '🧑‍💼',
    emojis: list(
      '🧑‍💼 👨‍💼 👩‍💼 🧑‍💻 👨‍💻 👩‍💻 🧑‍🔧 🕵️ 👮 🧑‍⚖️ 👷 💁 🙋 🙆 🙅 🤷 🤦 🧑‍🤝‍🧑 👥 🚶 🏃',
    ),
  },
  {
    key: 'work',
    icon: '💼',
    emojis: list(
      '💼 📁 📂 🗂️ 📄 📃 📑 📊 📈 📉 🗒️ 📋 📌 📍 📎 🖇️ ✂️ 🖊️ ✏️ 📝 🔍 🔎 🗃️ 🗄️ 🗑️ 🏦 🏢 🏠 🏘️ 🏭 🪪 💳 💰 💵 🧾 📦 ✉️ 📧 📨 📞 ☎️ 📱 💻 🖥️ 🖨️ ⌨️ 🖱️ 🔐 🔑 🗝️',
    ),
  },
  {
    key: 'travel',
    icon: '🚗',
    emojis: list(
      '🚗 🚕 🚙 🛵 🏍️ 🚲 🚌 🚆 🚇 ✈️ 🗺️ 🧭 📍 🛣️ 🚦 ⛽ 🅿️ 🕌 ⛪ 🏥 🏫 🏛️ 🌆 🌃 🌧️ ☀️ 🌤️ ⛅ 🌙 ⭐ ⚡ 🔥 💧 🌊',
    ),
  },
  {
    key: 'time',
    icon: '⏰',
    emojis: list('⏰ ⏱️ ⏲️ 🕐 🕑 🕒 🕓 🕔 🕕 🕖 🕗 🕘 🕙 🕚 🕛 ⌛ ⏳ 📅 📆 🗓️'),
  },
  {
    key: 'food',
    icon: '☕',
    emojis: list('☕ 🍵 🧃 🥤 💧 🍞 🥐 🥪 🍕 🍔 🌯 🥗 🍎 🍌 🍉 🍪 🍰 🎂 🍫'),
  },
  {
    key: 'symbols',
    icon: '✅',
    emojis: list(
      '✅ ☑️ ✔️ ❌ ❎ ⚠️ 🚫 ⛔ ❗ ❓ ❕ ❔ ‼️ ⁉️ 💯 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🔺 🔻 ➡️ ⬅️ ⬆️ ⬇️ 🔄 🔁 ➕ ➖ ✖️ 🆗 🆕 🆘 ℹ️ 🔔 🔕 📣 📢 💬 💭 🗨️',
    ),
  },
  {
    key: 'hearts',
    icon: '❤️',
    emojis: list('❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 ✨ 🎉 🎊 🎁 🏆 🥇 🎯 👑 🌹 🌸 🌺 🌷'),
  },
];

/** Search words, Arabic and English. */
export const KEYWORDS = {
  '😀': 'smile happy ضحك ابتسامة سعيد',
  '😂': 'laugh tears lol ضحك هههه',
  '🤣': 'laugh rolling ضحك',
  '🙂': 'smile ابتسامة',
  '😉': 'wink غمزة',
  '😊': 'blush happy سعيد',
  '😍': 'love eyes حب',
  '🥰': 'love حب',
  '😘': 'kiss بوسة',
  '🤔': 'think hmm تفكير',
  '😐': 'neutral محايد',
  '🙄': 'eye roll ملل',
  '😴': 'sleep نوم',
  '😷': 'mask sick مريض',
  '😎': 'cool نظارة',
  '🥳': 'party celebrate احتفال',
  '😢': 'sad cry حزين',
  '😭': 'cry بكاء',
  '😡': 'angry غضب',
  '😱': 'shock scream صدمة',
  '😅': 'sweat phew عرق',
  '🤗': 'hug حضن',
  '🙏': 'thanks please pray شكرا رجاء دعاء',
  '👍': 'like ok yes تمام موافق',
  '👎': 'dislike no لا مش موافق',
  '👌': 'ok perfect تمام',
  '👏': 'clap bravo تصفيق برافو',
  '🙌': 'hooray yay هييه',
  '👋': 'hi bye wave سلام مرحبا',
  '🤝': 'deal handshake اتفاق مصافحة',
  '💪': 'strong قوة',
  '🫡': 'salute تحية',
  '👀': 'look eyes see بص شوف',
  '💼': 'work briefcase شغل عمل',
  '📁': 'folder file ملف',
  '📄': 'document page مستند',
  '📊': 'chart report تقرير رسم',
  '📈': 'up growth صعود',
  '📉': 'down هبوط',
  '📋': 'clipboard checklist قائمة',
  '📌': 'pin تثبيت',
  '📍': 'location place موقع مكان',
  '📎': 'attach paperclip مرفق',
  '📝': 'note write ملاحظة كتابة',
  '🔍': 'search بحث',
  '🏦': 'bank بنك',
  '🏢': 'office building شركة مكتب',
  '🏠': 'home house بيت سكن',
  '🏭': 'factory مصنع',
  '🪪': 'id card بطاقة هوية',
  '💳': 'card credit كارت',
  '💰': 'money فلوس',
  '💵': 'cash money كاش',
  '🧾': 'receipt invoice إيصال فاتورة',
  '✉️': 'mail letter رسالة بريد',
  '📞': 'phone call تليفون مكالمة',
  '📱': 'mobile phone موبايل',
  '💻': 'laptop computer لابتوب',
  '🖨️': 'print طباعة',
  '🔐': 'lock secure قفل أمان',
  '🔑': 'key مفتاح',
  '🚗': 'car drive عربية سيارة',
  '🛵': 'scooter motorbike موتوسيكل',
  '🗺️': 'map خريطة',
  '🧭': 'compass navigate اتجاه',
  '☀️': 'sun weather شمس',
  '🌧️': 'rain مطر',
  '🔥': 'fire hot urgent نار عاجل',
  '⏰': 'alarm time منبه وقت',
  '⏳': 'wait hourglass انتظار',
  '📅': 'calendar date تاريخ موعد',
  '☕': 'coffee tea قهوة شاي',
  '✅': 'done check yes تم خلاص',
  '❌': 'no wrong cancel غلط إلغاء',
  '⚠️': 'warning تحذير',
  '❗': 'important مهم',
  '❓': 'question سؤال',
  '💯': 'hundred perfect ممتاز',
  '🔴': 'red أحمر',
  '🟢': 'green أخضر',
  '🔄': 'repeat refresh تحديث',
  '🆕': 'new جديد',
  '🔔': 'bell notify تنبيه',
  '📢': 'announce إعلان',
  '💬': 'chat message رسالة',
  '❤️': 'love heart قلب حب',
  '💔': 'broken heart حزن',
  '✨': 'sparkle نجوم',
  '🎉': 'party congrats مبروك احتفال',
  '🎁': 'gift هدية',
  '🏆': 'trophy win فوز كأس',
  '🎯': 'target هدف',
  '🌹': 'rose flower وردة',
};

/** Emoji matching a search, in category order. */
export function searchEmoji(term) {
  const query = term.trim().toLowerCase();
  if (!query) return [];
  const seen = new Set();
  const results = [];
  for (const category of EMOJI_CATEGORIES) {
    for (const emoji of category.emojis) {
      if (seen.has(emoji)) continue;
      if ((KEYWORDS[emoji] ?? '').toLowerCase().includes(query)) {
        seen.add(emoji);
        results.push(emoji);
      }
    }
  }
  return results;
}
